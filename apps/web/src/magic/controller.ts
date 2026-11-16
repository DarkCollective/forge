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
// The Magic run (WP 6.30), without DOM and without the store, so it is unit tested with fakes. It owns what
// the dialog must not: a baker of its own (created on the first run, so a normal bake is never blocked by
// Magic and a page that never uses Magic never starts a second worker), the lazy load of the engine and of
// the checks, the AbortController behind Cancel, and the state the dialog shows. Run events are told to
// the screen reader through `announcement`, which the dialog puts in its own live region (the page's one
// is inert while a modal dialog is open).
import type { Catalogue, ChecksOp } from "@forge/ops";
import type { Baker } from "@forge/worker";
import type { MagicOptions, MagicProgress, MagicResult } from "@forge/worker/magic";
import type { ChecksReady } from "../ops/checks-data.js";
import { summarise } from "./magic-view.js";

/** The part of `@forge/worker/magic` the controller calls. */
export interface MagicEngine {
  readonly magic: (input: Uint8Array, options: MagicOptions) => Promise<MagicResult>;
}

export interface MagicDeps {
  /** A new baker of its own (the app passes the Web Worker client). Called at most once, on the first run. */
  readonly createBaker: () => Baker;
  /** Loads the engine module (a dynamic import, its own chunk). */
  readonly loadEngine: () => Promise<MagicEngine>;
  /** Loads the checks for the catalogue (the shared lazy loader of the Operations pane). */
  readonly loadChecks: (catalogue: Catalogue) => Promise<ChecksReady>;
  /** The user words' source, as the bake controller gives it to its baker. */
  readonly userSource: () => string;
}

export interface MagicRunOptions {
  /** Operations in a candidate, 1 to 6 (the engine's maximum). */
  readonly depth: number;
  /** A regular expression the wanted output matches; empty for none. */
  readonly crib: string;
}

export const DEFAULT_RUN_OPTIONS: MagicRunOptions = Object.freeze({ depth: 3, crib: "" });
export const DEPTH_RANGE = Object.freeze({ min: 1, max: 6 });
export const CRIB_MAX_CHARS = 1024;

export type MagicState =
  | { readonly phase: "idle"; readonly announcement: string }
  | {
      readonly phase: "running";
      /** "loading" while the engine, the checks and the baker start; then "searching". */
      readonly stage: "loading" | "searching";
      readonly progress: MagicProgress | null;
      readonly announcement: string;
    }
  | {
      readonly phase: "done" | "cancelled";
      readonly result: MagicResult;
      readonly announcement: string;
    }
  | { readonly phase: "error"; readonly message: string; readonly announcement: string };

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Clamp the user's options to what the engine accepts; an out-of-range depth is not an error. */
export function normaliseOptions(o: MagicRunOptions): MagicRunOptions {
  const depth = Number.isFinite(o.depth) ? Math.trunc(o.depth) : DEFAULT_RUN_OPTIONS.depth;
  return {
    depth: Math.min(DEPTH_RANGE.max, Math.max(DEPTH_RANGE.min, depth)),
    crib: o.crib.slice(0, CRIB_MAX_CHARS),
  };
}

export interface MagicController {
  readonly state: MagicState;
  subscribe(listener: () => void): () => void;
  /** Start a run on `input`. A run in progress is cancelled first. Never rejects. */
  run(input: Uint8Array, catalogue: Catalogue, options: MagicRunOptions): Promise<void>;
  /** Cancel the run in progress (a no-op otherwise). */
  cancel(): void;
  /** Back to idle (the dialog closed). Cancels a run in progress. */
  reset(): void;
  /** Release the baker. */
  dispose(): Promise<void>;
}

export function createMagicController(deps: MagicDeps): MagicController {
  let state: MagicState = { phase: "idle", announcement: "" };
  const listeners = new Set<() => void>();
  let baker: Baker | null = null;
  /** The user source the baker was last initialised with, or null when it needs an init. */
  let initedWith: string | null = null;
  let abort: AbortController | null = null;
  let seq = 0;
  /** Resolves when the run in progress has finished; a new run waits for it, since a baker bakes one thing at a time. */
  let current: Promise<void> = Promise.resolve();

  const set = (next: MagicState): void => {
    state = next;
    for (const l of [...listeners]) l();
  };

  async function ensureBaker(): Promise<Baker> {
    baker ??= deps.createBaker();
    const source = deps.userSource();
    if (initedWith !== source) {
      const units = source === "" ? [] : [{ name: "user", source }];
      try {
        await baker.init({ vocabs: "all", units });
      } catch (e) {
        // As the bake controller does: a user unit that does not compile must not stop the bundled words.
        if (units.length === 0) throw e;
        await baker.init({ vocabs: "all" });
      }
      initedWith = source;
    }
    return baker;
  }

  async function execute(
    my: number,
    ac: AbortController,
    input: Uint8Array,
    catalogue: Catalogue,
    options: MagicRunOptions,
  ): Promise<void> {
    const live = (): boolean => my === seq;
    try {
      const [engine, checks] = await Promise.all([deps.loadEngine(), deps.loadChecks(catalogue)]);
      const b = await ensureBaker();
      if (!live()) return;
      if (ac.signal.aborted) {
        set({
          phase: "cancelled",
          result: { candidates: [], stopped: "aborted", stats: ZERO_STATS, quarantined: [] },
          announcement: "Magic cancelled",
        });
        return;
      }
      set({ phase: "running", stage: "searching", progress: null, announcement: "" });
      const opts: MagicOptions = {
        baker: b,
        catalogue,
        checks: Object.fromEntries(checks.index.entries()) as Record<string, ChecksOp>,
        depth: options.depth,
        signal: ac.signal,
        onProgress: (progress) => {
          if (live() && state.phase === "running") {
            set({ phase: "running", stage: "searching", progress, announcement: "" });
          }
        },
        ...(options.crib === "" ? {} : { crib: options.crib }),
      };
      const result = await engine.magic(input, opts);
      if (!live()) return;
      // A killed or cancelled run may have ended the worker: initialise it again next time.
      if (result.stopped === "aborted" || result.quarantined.length > 0) initedWith = null;
      if (result.stopped === "aborted") {
        set({ phase: "cancelled", result, announcement: "Magic cancelled" });
      } else {
        set({ phase: "done", result, announcement: summarise(result) });
      }
    } catch (e) {
      if (!live()) return;
      initedWith = null;
      if (ac.signal.aborted) {
        set({
          phase: "cancelled",
          result: { candidates: [], stopped: "aborted", stats: ZERO_STATS, quarantined: [] },
          announcement: "Magic cancelled",
        });
        return;
      }
      const message = errorMessage(e);
      set({ phase: "error", message, announcement: `Magic failed: ${message}` });
    }
  }

  return {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async run(input, catalogue, options) {
      abort?.abort();
      const previous = current;
      const my = ++seq;
      const ac = new AbortController();
      abort = ac;
      set({ phase: "running", stage: "loading", progress: null, announcement: "Magic started" });
      const opts = normaliseOptions(options);
      const mine = previous.then(() => execute(my, ac, input, catalogue, opts));
      current = mine;
      await mine;
    },
    cancel() {
      if (state.phase === "running") abort?.abort();
    },
    reset() {
      abort?.abort();
      seq += 1;
      set({ phase: "idle", announcement: "" });
    },
    async dispose() {
      abort?.abort();
      seq += 1;
      const b = baker;
      baker = null;
      initedWith = null;
      await current.catch(() => undefined);
      await b?.dispose();
    },
  };
}

const ZERO_STATS: MagicResult["stats"] = Object.freeze({
  tried: 0,
  failed: 0,
  prunedEmpty: 0,
  prunedRepeat: 0,
  prunedNoGain: 0,
  prunedBreadth: 0,
  elapsedMs: 0,
});
