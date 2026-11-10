/*
 * Copyright 2026 Darkcollective, LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
// The bake controller (UI.md WP 3.6): turns store changes into bakes and bake events into store
// writes. The baker is injected through `createBaker`, so tests use the in-process baker and the
// app uses the Web Worker client (see `web-baker.ts`).
import type { RecipeIssue } from "@forge/recipe";
import type { Baker, BakeEvent, BakeResult, DebugOptions } from "@forge/worker";
import type { Actions, AppStore } from "../state/actions.js";
import type { AppState } from "../state/types.js";
import { createDebouncer, realTimers } from "./debounce.js";
import type { Timers } from "./debounce.js";
import { isAborted, stepLabel } from "./format.js";
import { bakeUi } from "./ui-state.js";
import type { BakeUiStore } from "./ui-state.js";

export interface BakeControllerDeps {
  readonly store: AppStore;
  readonly actions: Actions;
  readonly createBaker: () => Baker;
  readonly ui?: BakeUiStore;
  readonly timers?: Timers;
  readonly warn?: (message: string) => void;
}

export interface BakeController {
  /** Create the baker, init it with the user unit and start watching the store. */
  start(): Promise<void>;
  /** Bake now (the Bake button), without waiting for the debounce. */
  bakeNow(): void;
  step(): void;
  continue(): void;
  /** Cancel a pending, running or paused bake. */
  cancel(): void;
  /** Resolves when init and the bake in flight (if any) have finished. For tests. */
  idle(): Promise<void>;
  dispose(): Promise<void>;
}

/** The part of the state that decides what a bake would produce. */
interface Content {
  readonly recipe: AppState["recipe"];
  readonly bytes: Uint8Array | undefined;
  readonly userSource: string;
}

interface Trigger extends Content {
  readonly autoBake: boolean;
  readonly catalogueReady: boolean;
  readonly issues: AppState["issues"];
  readonly debug: boolean;
}

function contentOf(s: AppState): Content {
  return {
    recipe: s.recipe,
    bytes: s.inputs.find((t) => t.id === s.activeInputId)?.bytes,
    userSource: s.user.source,
  };
}

function sameContent(a: Content, b: Content): boolean {
  return a.recipe === b.recipe && a.bytes === b.bytes && a.userSource === b.userSource;
}

/** True when an enabled step of the recipe has a breakpoint. */
export function hasBreakpoints(steps: readonly unknown[]): boolean {
  for (const raw of steps) {
    const step = raw as {
      disabled?: boolean;
      breakpoint?: boolean;
      steps?: unknown[];
      then?: unknown[];
      else?: unknown[];
    };
    if (step.disabled === true) continue;
    if (step.breakpoint === true) return true;
    for (const list of [step.steps, step.then, step.else]) {
      if (Array.isArray(list) && hasBreakpoints(list)) return true;
    }
  }
  return false;
}

/** `debug` option of a bake: present when the user asked for debug mode or a step has a breakpoint. */
export function debugOptionsFor(
  recipe: AppState["recipe"],
  ui: { readonly debug: boolean; readonly startPaused: boolean },
): DebugOptions | undefined {
  if (ui.debug) return ui.startPaused ? { startPaused: true } : {};
  return hasBreakpoints(recipe.steps) ? {} : undefined;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** A failed result for bakes that never reached the baker (invalid recipe, crash of the call). */
export function syntheticFailure(
  code: "E_RECIPE_INVALID" | "E_INTERNAL",
  message: string,
  issues?: readonly RecipeIssue[],
): BakeResult {
  return {
    id: 0,
    ok: false,
    error: {
      code,
      message,
      path: null,
      word: null,
      detail: {},
      ...(issues === undefined ? {} : { issues }),
    },
    steps: [],
    coercions: [],
    coercionsTruncated: false,
    warnings: [],
    stats: { elapsedMs: 0, vmSteps: 0, effects: [] },
  };
}

export function createBakeController(deps: BakeControllerDeps): BakeController {
  const { store, actions } = deps;
  const ui = deps.ui ?? bakeUi;
  const warn = deps.warn ?? ((m: string) => console.warn(m));

  let baker: Baker | null = null;
  let ready: Promise<void> = Promise.resolve();
  let seq = 0;
  let inFlight: Promise<void> = Promise.resolve();
  let restStatus: AppState["bake"]["status"] = "idle";
  let unsubs: (() => void)[] = [];

  const debouncer = createDebouncer(
    () => void run(),
    () => store.get().settings.debounceMs,
    deps.timers ?? realTimers,
  );

  function trigger(s: AppState): Trigger {
    return {
      ...contentOf(s),
      autoBake: s.settings.autoBake,
      catalogueReady: s.catalogue.status === "ready",
      issues: s.issues,
      debug: ui.get().debug,
    };
  }

  // ---- baker (re)initialisation ------------------------------------------------------------------

  async function initBaker(source: string): Promise<void> {
    const b = baker;
    if (b === null) return;
    // A running bake would be thrown away by the reload; end it now and let the next bake redo it.
    seq += 1;
    const s0 = store.get().bake.status;
    await b.cancel();
    if (s0 === "baking" || s0 === "paused") actions.setBake({ ...clearRun(), status: "cancelled" });
    const units = source === "" ? [] : [{ name: "user", source }];
    let info;
    try {
      info = await b.init({ vocabs: "all", units });
    } catch (e) {
      const message = errorMessage(e);
      if (units.length === 0) {
        warn(`bake: the baker could not start: ${message}`);
        return;
      }
      actions.setUserError(message);
      try {
        info = await b.init({ vocabs: "all" });
      } catch (e2) {
        warn(`bake: the baker could not start: ${errorMessage(e2)}`);
        return;
      }
    }
    const cat = store.get().catalogue;
    if (
      cat.status === "ready" &&
      cat.catalogue.version !== info.catalogueVersion &&
      source === ""
    ) {
      warn(
        `bake: the baker's catalogue version (${info.catalogueVersion}) differs from the loaded catalogue (${cat.catalogue.version})`,
      );
    }
  }

  function reinit(): void {
    const source = store.get().user.source;
    ready = ready
      .then(() => initBaker(source))
      .catch((e) => warn(`bake: init failed: ${errorMessage(e)}`));
  }

  // ---- baking ----------------------------------------------------------------------------------

  function clearRun() {
    return { runningPath: null, progress: null, paused: null } as const;
  }

  function onEvent(mySeq: number, event: BakeEvent): void {
    if (mySeq !== seq || debouncer.pending) return;
    switch (event.type) {
      case "progress":
        actions.setBake({
          status: "baking",
          runningPath: event.path,
          progress: { done: event.done, total: event.total },
        });
        break;
      case "paused":
        actions.setBake({
          status: "paused",
          runningPath: event.path,
          paused: { path: event.path, reason: event.reason, data: event.data },
        });
        actions.selectStep(event.path);
        actions.announce(`Paused at step ${stepLabel(event.path)}.`);
        break;
      case "resumed":
        actions.setBake({ status: "baking", paused: null });
        break;
    }
  }

  function finish(result: BakeResult, snapshot: Content): void {
    const stale = !sameContent(snapshot, contentOf(store.get()));
    const aborted = isAborted(result);
    const status = result.ok ? "done" : aborted ? "cancelled" : "failed";
    restStatus = status;
    const previous = store.get().bake.result;
    actions.setBake({
      ...clearRun(),
      status: debouncer.pending ? "queued" : status,
      // A cancelled bake leaves the last real result in place (marked out of date).
      result: aborted ? previous : result,
      elapsedMs: aborted ? null : result.stats.elapsedMs,
      stale: aborted ? previous !== null || stale : stale,
    });
  }

  async function run(): Promise<void> {
    const b = baker;
    if (b === null) return;
    debouncer.cancel();
    const mySeq = ++seq;
    const s = store.get();
    if (s.catalogue.status !== "ready") {
      if (s.bake.status === "queued") actions.setBake({ status: restStatus });
      return;
    }
    const snapshot = contentOf(s);
    const errors = s.issues.filter((i) => i.severity === "error");
    if (errors.length > 0) {
      void b.cancel();
      restStatus = "failed";
      actions.setBake({
        ...clearRun(),
        status: "failed",
        result: syntheticFailure(
          "E_RECIPE_INVALID",
          `The recipe has ${errors.length} problem${errors.length === 1 ? "" : "s"}, so it was not baked.`,
          errors,
        ),
        elapsedMs: null,
        stale: false,
      });
      return;
    }
    const debug = debugOptionsFor(s.recipe, ui.get());
    actions.setBake({ ...clearRun(), status: "baking" });
    const flight = (async () => {
      await ready;
      if (mySeq !== seq) return;
      const input = snapshot.bytes ?? new Uint8Array(0);
      let result: BakeResult;
      try {
        result = await b.bake(s.recipe, input, {
          trust: "untrusted",
          onEvent: (e) => onEvent(mySeq, e),
          ...(debug === undefined ? {} : { debug }),
        });
      } catch (e) {
        result = syntheticFailure("E_INTERNAL", `The baker failed: ${errorMessage(e)}`);
      }
      if (mySeq !== seq) return; // a newer bake or a reload took over; its result is the one to show
      finish(result, snapshot);
    })();
    inFlight = flight;
    await flight;
  }

  function schedule(): void {
    if (!store.get().settings.autoBake) return;
    if (store.get().catalogue.status !== "ready") return;
    const status = store.get().bake.status;
    if (status !== "queued") actions.setBake({ status: "queued" });
    debouncer.schedule();
  }

  function onTriggerChange(now: Trigger, before: Trigger): void {
    if (baker === null) return;
    if (now.userSource !== before.userSource) reinit();
    if (!now.autoBake) {
      if (debouncer.pending) {
        debouncer.cancel();
        actions.setBake({ status: restStatus });
      }
      return;
    }
    schedule();
  }

  // ---- controls ----------------------------------------------------------------------------------

  return {
    async start(): Promise<void> {
      baker = deps.createBaker();
      reinit();
      unsubs.push(
        store.select(trigger, onTriggerChange, {
          equals: (a, b) =>
            sameContent(a, b) &&
            a.autoBake === b.autoBake &&
            a.catalogueReady === b.catalogueReady &&
            a.issues === b.issues &&
            a.debug === b.debug,
        }),
      );
      // The debug switch lives in this package's own store.
      let debug = ui.get().debug;
      unsubs.push(
        ui.subscribe((state) => {
          if (state.debug === debug) return;
          debug = state.debug;
          const now = trigger(store.get());
          onTriggerChange(now, { ...now, debug: !debug });
        }),
      );
      await ready;
      // The catalogue may already be there (or arrive later: the trigger fires then).
      if (store.get().catalogue.status === "ready") schedule();
    },
    bakeNow(): void {
      void run();
    },
    step(): void {
      if (store.get().bake.status === "paused") void baker?.step();
    },
    continue(): void {
      if (store.get().bake.status === "paused") void baker?.continue();
    },
    cancel(): void {
      const status = store.get().bake.status;
      if (debouncer.pending) {
        debouncer.cancel();
        actions.setBake({ status: restStatus === "queued" ? "idle" : restStatus });
      }
      if (status === "baking" || status === "paused") void baker?.cancel();
    },
    async idle(): Promise<void> {
      let seen: Promise<void>;
      do {
        seen = inFlight;
        await ready;
        await seen;
      } while (seen !== inFlight);
    },
    async dispose(): Promise<void> {
      debouncer.cancel();
      for (const u of unsubs) u();
      unsubs = [];
      seq += 1;
      await baker?.dispose();
      baker = null;
    },
  };
}
