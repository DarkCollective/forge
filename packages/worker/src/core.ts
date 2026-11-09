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

/*
 * The bake engine (RECIPES.md section 8.2): validate, compile, load, run, attribute. The same code runs
 * in process and behind the worker protocol.
 */
import { bytes as bytesValue, formatErrorMessage, isForgeError } from "@forge/lang";
import type {
  CompiledWord,
  ForgeErrorShape,
  ForgeRuntime,
  RunResult,
  StepEvent,
  Value,
  FlWordEntry,
} from "@forge/lang";
import { assembleRuntime, buildCatalogue } from "@forge/ops";
import type { Catalogue } from "@forge/ops";
import {
  attributeError,
  compileRecipe,
  recipeNeedsHardKill,
  resolveStepIps,
  validateRecipe,
} from "@forge/recipe";
import type { RecipeIssue, Step, StepIpMap, StepLine } from "@forge/recipe";
import { effectiveLimits } from "./limits.js";
import { renderValue } from "./render.js";
import { PROGRESS_INTERVAL_MS, PROTOCOL_VERSION } from "./types.js";
import type {
  Baker,
  BakeCoercion,
  BakeError,
  BakeErrorCode,
  BakeEvent,
  BakeOptions,
  BakeResult,
  BakerCoreOptions,
  BakerInit,
  InitInfo,
  OutputValue,
  StepReport,
} from "./types.js";

interface Ready {
  readonly runtime: ForgeRuntime;
  readonly catalogue: Catalogue;
  readonly info: InitInfo;
}

type Resume = "step" | "continue" | "cancel";

interface Active {
  readonly controller: AbortController;
  readonly done: Promise<void>;
  resume: ((choice: Resume) => void) | null;
}

type Outcome =
  { ok: true; output: OutputValue } | { ok: false; error: BakeError; partial?: OutputValue };

interface FinishExtra {
  steps?: StepReport[];
  coercions?: BakeCoercion[];
  coercionsTruncated?: boolean;
  vmSteps?: number;
  effects?: BakeResult["stats"]["effects"];
}

type Finish = (outcome: Outcome, extra: FinishExtra) => BakeResult;

const TOP_LEVEL = /^\/steps\/\d+$/;

function errorMessage(e: unknown): string {
  if (isForgeError(e)) return formatErrorMessage(e);
  return e instanceof Error ? e.message : String(e);
}

function bakeError(
  code: BakeErrorCode,
  message: string,
  extra: Partial<Omit<BakeError, "code" | "message">> = {},
): BakeError {
  return { code, message, path: null, word: null, detail: {}, ...extra };
}

/** Op step paths mapped to their canonical op names (enabled steps only), and every op name used. */
function collectOps(
  steps: readonly Step[],
  prefix: string,
  disabled: ReadonlyMap<string, boolean>,
  aliases: ReadonlyMap<string, string>,
  out: Map<string, string>,
): void {
  steps.forEach((step, i) => {
    const path = `${prefix}/${i}`;
    if (step.kind === "comment" || disabled.get(path) === true) return;
    if (step.kind === "op") out.set(path, aliases.get(step.op) ?? step.op);
    else if (step.kind === "if") {
      collectOps(step.then, `${path}/then`, disabled, aliases, out);
      collectOps(step.else ?? [], `${path}/else`, disabled, aliases, out);
    } else if (step.kind === "fork" || step.kind === "subsection" || step.kind === "repeat") {
      collectOps(step.steps, `${path}/steps`, disabled, aliases, out);
    }
  });
}

/** Everything a running bake accumulates: step timings, the step log, progress. */
class Tracker {
  readonly reports = new Map<string, { ms: number; runs: number }>();
  private readonly open: { path: string; t0: number }[] = [];
  private readonly log: { step: number; path: string | null }[] = [];
  private logFullAt: number | null = null;
  private lastPath: string | null = null;
  private done = 0;
  private lastProgress = -Infinity;

  constructor(
    private readonly maxLog: number,
    private readonly total: number,
  ) {}

  start(path: string, now: number): void {
    this.open.push({ path, t0: now });
    const r = this.reports.get(path) ?? { ms: 0, runs: 0 };
    r.runs++;
    this.reports.set(path, r);
    this.lastPath = path;
  }

  end(path: string, now: number): void {
    let i = this.open.length - 1;
    while (i >= 0 && (this.open[i] as { path: string }).path !== path) i--;
    if (i < 0) return;
    this.closeFrom(i, now);
    if (TOP_LEVEL.test(path)) this.done++;
  }

  closeAll(now: number): void {
    this.closeFrom(0, now);
  }

  private closeFrom(i: number, now: number): void {
    for (const o of this.open.splice(i)) {
      (this.reports.get(o.path) as { ms: number }).ms += now - o.t0;
    }
  }

  /** Called after an event's ends and starts: records the innermost open step at this VM step. */
  mark(step: number): void {
    if (this.log.length >= this.maxLog) {
      this.logFullAt ??= step;
      return;
    }
    this.log.push({ step, path: this.open.at(-1)?.path ?? null });
  }

  /** The innermost open step at VM step `step`, or null (none open, or the log was full). */
  pathAt(step: number): string | null {
    if (this.logFullAt !== null && step >= this.logFullAt) return null;
    let lo = 0;
    let hi = this.log.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.log[mid] as { step: number }).step <= step) lo = mid + 1;
      else hi = mid;
    }
    /* v8 ignore next -- the first log entry is the first instruction of the first step */
    return lo === 0 ? null : (this.log[lo - 1] as { path: string | null }).path;
  }

  lastStepPath(): string | null {
    return this.lastPath;
  }

  progress(id: number, vmSteps: number, t0: number, now: number, force: boolean): BakeEvent | null {
    if (!force && now - this.lastProgress < PROGRESS_INTERVAL_MS) return null;
    this.lastProgress = now;
    return {
      type: "progress",
      id,
      path: this.lastPath,
      done: this.done,
      total: this.total,
      vmSteps,
      elapsedMs: now - t0,
    };
  }
}

export function createBakerCore(options: BakerCoreOptions): Baker {
  const hardKill = options.hardKill === true;
  let ready: Ready | null = null;
  let active: Active | null = null;
  let epoch = 0;
  let nextId = 1;
  let tail: Promise<unknown> = Promise.resolve();

  function cancelActive(): Promise<void> {
    if (active === null) return Promise.resolve();
    active.controller.abort();
    active.resume?.("cancel");
    return active.done;
  }

  async function init(request: BakerInit = {}): Promise<InitInfo> {
    await cancelActive();
    ready = null;
    try {
      const vocabs = request.vocabs ?? "all";
      const names = vocabs === "all" ? "all" : [...new Set([...vocabs, "recipe"])];
      const bundle = await options.loadBundle(names);
      const runtime = assembleRuntime(
        bundle,
        request.units === undefined ? {} : { units: request.units },
      );
      const catalogue = buildCatalogue(runtime, { bundleVocabs: bundle.vocabs });
      const info: InitInfo = {
        protocol: PROTOCOL_VERSION,
        catalogueVersion: catalogue.version,
        vocabs: bundle.vocabs,
      };
      ready = { runtime, catalogue, info };
      return info;
    } catch (e) {
      throw new Error(errorMessage(e), { cause: e });
    }
  }

  async function runBake(
    id: number,
    myEpoch: number,
    recipe: unknown,
    input: Uint8Array,
    opts: BakeOptions,
  ): Promise<BakeResult> {
    const t0 = performance.now();
    const trust = opts.trust ?? "untrusted";
    const limits = effectiveLimits(trust, opts.limits);
    const emit = (event: BakeEvent): void => {
      try {
        opts.onEvent?.(event);
      } catch {
        // A faulty listener must not break the bake.
      }
    };
    let warnings: readonly RecipeIssue[] = [];
    const finish = (outcome: Outcome, extra: FinishExtra = {}): BakeResult => ({
      id,
      ...outcome,
      steps: extra.steps ?? [],
      coercions: extra.coercions ?? [],
      coercionsTruncated: extra.coercionsTruncated ?? false,
      warnings,
      stats: {
        elapsedMs: performance.now() - t0,
        vmSteps: extra.vmSteps ?? 0,
        effects: extra.effects ?? [],
      },
    });
    const failed = (code: BakeErrorCode, message: string, e: Partial<BakeError> = {}): BakeResult =>
      finish({ ok: false, error: bakeError(code, message, e) });

    if (myEpoch !== epoch) return failed("E_ABORTED", "superseded by a newer bake");
    if (ready === null) return failed("E_NOT_READY", "the baker has not been initialised");
    const { runtime, catalogue } = ready;

    const validation = validateRecipe(recipe, catalogue, { pins: opts.pins ?? "warn" });
    if (!validation.ok) {
      return failed("E_RECIPE_INVALID", "the recipe is not valid", { issues: validation.issues });
    }
    warnings = validation.issues;
    if (trust === "untrusted" && !hardKill && recipeNeedsHardKill(validation.recipe, catalogue)) {
      return failed(
        "E_UNSAFE_HOST",
        "this recipe needs a host that can terminate a running bake (it uses a regular expression)",
        { detail: { reason: "regex" } },
      );
    }
    const compiled = compileRecipe(validation.recipe, catalogue, { pins: opts.pins ?? "warn" });
    if (!compiled.ok) {
      return failed("E_INTERNAL", "a valid recipe failed to compile", { issues: compiled.issues });
    }

    const controller = new AbortController();
    let resolveDone: () => void = () => undefined;
    const act: Active = {
      controller,
      done: new Promise<void>((resolve) => (resolveDone = resolve)),
      resume: null,
    };
    active = act;
    try {
      let map: StepIpMap;
      try {
        runtime.load(compiled.text, {
          unit: "recipe",
          scope: { current: "bake", using: [] },
        });
        const entry = runtime.lookup(compiled.word) as FlWordEntry;
        map = resolveStepIps(compiled.word, compiled.lines, (entry.code as CompiledWord).positions);
      } catch (e) {
        const error = isForgeError(e) ? e : null;
        return failed(error?.code ?? "E_INTERNAL", errorMessage(e), {
          detail: error === null ? {} : (error.toJSON().detail as Record<string, unknown>),
        });
      }
      return await execute(
        act,
        id,
        t0,
        opts,
        compiled.word,
        compiled.lines,
        map,
        limits.maxTraceEntries,
        input,
        validation.recipe.steps,
        finish,
        emit,
        runtime,
        catalogue,
        limits,
      );
    } finally {
      active = null;
      resolveDone();
    }
  }

  async function execute(
    act: Active,
    id: number,
    t0: number,
    opts: BakeOptions,
    word: string,
    lines: readonly StepLine[],
    map: StepIpMap,
    maxLog: number,
    input: Uint8Array,
    steps: readonly Step[],
    finish: Finish,
    emit: (event: BakeEvent) => void,
    runtime: ForgeRuntime,
    catalogue: Catalogue,
    limits: ReturnType<typeof effectiveLimits>,
  ): Promise<BakeResult> {
    const signal = act.controller.signal;
    const total = map.steps.filter((s) => TOP_LEVEL.test(s.path)).length;
    const tracker = new Tracker(maxLog, total);
    const byIp = new Map(map.events.map((e) => [e.ip, e]));
    const breakpointOf = new Map(map.steps.map((s) => [s.path, s.breakpoint]));
    const debug = opts.debug;
    let stepping = debug?.startPaused === true;
    let startPending = stepping;

    const pause = async (ev: StepEvent, starts: readonly string[]): Promise<void> => {
      const data = renderValue(ev.stack[ev.stack.length - 1] as Value);
      for (const path of starts) {
        const flagged = breakpointOf.get(path) === true;
        if (!stepping && !flagged) continue;
        const reason = startPending ? "start" : flagged ? "breakpoint" : "step";
        startPending = false;
        // The waiter exists before the event goes out, so a listener may resume synchronously.
        const wait = new Promise<Resume>((resolve) => {
          act.resume = resolve;
        });
        emit({ type: "paused", id, path, reason, data });
        const choice = await wait;
        act.resume = null;
        if (signal.aborted) return;
        stepping = choice === "step";
        emit({ type: "resumed", id });
      }
    };

    const onStep = (ev: StepEvent): void | Promise<void> => {
      if (ev.word !== word) return;
      const at = byIp.get(ev.ip);
      if (at === undefined) return;
      const now = performance.now();
      for (const path of at.ends) tracker.end(path, now);
      for (const path of at.starts) tracker.start(path, now);
      tracker.mark(ev.step);
      const progress = tracker.progress(id, ev.step, t0, now, false);
      if (progress !== null) emit(progress);
      if (debug !== undefined && at.starts.length > 0) return pause(ev, at.starts);
      return undefined;
    };

    const disabled = new Map(lines.map((l) => [l.path, l.disabled]));
    const aliases = new Map<string, string>();
    for (const op of catalogue.ops) {
      const vocab = op.qname.slice(0, op.qname.indexOf(":"));
      for (const alias of op.aliases) aliases.set(`${vocab}:${alias}`, op.qname);
    }
    const opByPath = new Map<string, string>();
    collectOps(steps, "/steps", disabled, aliases, opByPath);
    const opNames = new Set(opByPath.values());

    let res: RunResult;
    if (signal.aborted) {
      return finish({ ok: false, error: bakeError("E_ABORTED", "aborted") }, {});
    }
    try {
      res = await runtime.call(word, [bytesValue(input)], {
        limits,
        signal,
        ...(opts.abortFlag === undefined ? {} : { abortFlag: opts.abortFlag }),
        breakpoints: map.events.map((e) => ({ word, ip: e.ip })),
        onStep,
      });
    } catch (e) {
      return finish({ ok: false, error: bakeError("E_INTERNAL", errorMessage(e)) }, {});
    }

    const end = performance.now();
    tracker.closeAll(end);
    const last = tracker.progress(id, res.steps, t0, end, true);
    if (last !== null) emit(last);

    const coercions: BakeCoercion[] = [];
    for (const c of res.coercions) {
      if (c.slot !== 0) continue;
      const path = tracker.pathAt(c.step);
      if (path === null ? !opNames.has(c.word) : opByPath.get(path) !== c.word) continue;
      coercions.push({ path, op: c.word, from: c.from, to: c.to });
    }
    const extra = {
      steps: [...tracker.reports].map(([path, r]) => ({ path, ms: r.ms, runs: r.runs })),
      coercions,
      coercionsTruncated: res.coercions.length >= limits.maxTraceEntries,
      vmSteps: res.steps,
      effects: res.effects,
    };
    const top = res.stack[res.stack.length - 1];
    if (res.ok) {
      if (top === undefined) {
        return finish(
          { ok: false, error: bakeError("E_INTERNAL", "the recipe left no value") },
          extra,
        );
      }
      return finish({ ok: true, output: renderValue(top) }, extra);
    }
    const err: ForgeErrorShape = res.error;
    const error = bakeError(err.code, err.message, {
      path: attributeError(word, err.frames, map),
      word: err.word,
      detail: err.toJSON().detail as Record<string, unknown>,
    });
    return finish(
      { ok: false, error, ...(top === undefined ? {} : { partial: renderValue(top) }) },
      extra,
    );
  }

  function bake(recipe: unknown, input: Uint8Array, opts: BakeOptions = {}): Promise<BakeResult> {
    const myEpoch = ++epoch;
    const id = nextId++;
    void cancelActive();
    const run = tail.then(() => runBake(id, myEpoch, recipe, input, opts));
    tail = run.catch(() => undefined);
    return run;
  }

  function resume(choice: Resume): Promise<void> {
    const r = active?.resume;
    if (r) r(choice);
    return Promise.resolve();
  }

  return {
    hardKill,
    init,
    bake,
    step: () => resume("step"),
    continue: () => resume("continue"),
    cancel: cancelActive,
    async dispose() {
      await cancelActive();
      ready = null;
    },
  };
}
