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
 * The Magic engine inside a bake (PLAN.md WP 6.33, RECIPES.md sections 4.4 and 8.9). `createRunMagicHost` makes
 * the `MagicHost` that the core installs (`provideMagicHost`) for one bake, so that `magic:magic` can reach the
 * engine, which `@forge/ops` cannot import.
 *
 * The search never runs on the baker that runs the bake (a baker runs one bake at a time and a new `bake` cancels
 * the active one): it runs on a nested baker of the core's own, with the same vocabularies, behind a metering
 * wrapper. The wrapper is how the enclosing run is charged, with no change to the engine:
 *
 *  - steps: every nested bake is limited to what is left of the run's `maxSteps` (the steps the run had used when the
 *    operation started, which the core sees at each step of the recipe, plus all that earlier searches were
 *    charged), and the VM steps it used are charged; when the budget is used up the search is cancelled and the
 *    operation fails with E_LIMIT_STEPS;
 *  - bytes: the input and the output of every nested bake count towards what is left of the run's `maxTotalBytes`
 *    (only the search's own allocation: the host cannot see what the rest of the run has allocated); when used up,
 *    the search is cancelled and the operation fails with E_LIMIT_TOTAL;
 *  - time: the search's deadline is the smaller of its own default and what is left of the run's `maxMillis`
 *    (less a reserve, so the operation can still report what it found before the run's own deadline fires);
 *  - cancellation: the run's signal cancels the search and the nested baker's run in progress.
 */
import { ForgeError } from "@forge/lang";
import type { AbortSignalLike, Limits } from "@forge/lang";
import type { ChecksOp, MagicHost, MagicHostReport, MagicHostRequest } from "@forge/ops";
import type { BakeOptions, BakeResult, Baker } from "../types.js";
import { MAGIC_LIMITS } from "./types.js";
import type { MagicOp } from "./types.js";

/** What the engine reads of the loaded vocabularies. */
export interface MagicEnvironment {
  readonly catalogue: { readonly ops: readonly MagicOp[] };
  readonly checks: Readonly<Record<string, ChecksOp>>;
}

export interface MagicHostDeps {
  /** A baker of its own, initialised with the vocabularies of the enclosing baker. */
  baker(): Promise<Baker>;
  environment(): MagicEnvironment;
}

/** The enclosing run, as the host sees it. */
export interface MagicRun {
  readonly signal: AbortSignalLike;
  /** The effective limits of the enclosing bake. */
  readonly limits: Pick<Limits, "maxSteps" | "maxTotalBytes" | "maxMillis">;
  /** `performance.now()` when the run started. */
  readonly startedAt: number;
  /** VM steps the run had used at its latest step of the recipe. */
  steps(): number;
}

export interface MagicCharge {
  steps: number;
  bytes: number;
}

/** Kept back from the run's remaining time, so the operation can report before the run's deadline fires. */
export const MAGIC_DEADLINE_RESERVE_MS = 200;

const WORD = "magic:magic";

function outputSize(result: BakeResult): number {
  if (!result.ok) return 0;
  const out = result.output;
  if (out.kind === "bytes") return out.bytes.length;
  if (out.kind === "str") return out.text.length;
  return 0;
}

function limitError(
  code: "E_LIMIT_STEPS" | "E_LIMIT_TOTAL",
  what: string,
  limit: number,
): ForgeError {
  return new ForgeError({
    code,
    message: `the Magic search used up the ${what} limit of ${limit} of the run`,
    detail: { limit, word: WORD },
  });
}

/**
 * The host of one bake. `charge` is what the searches of this bake have been charged so far; the core adds its
 * `steps` to the run's `vmSteps` in the result.
 */
export function createRunMagicHost(
  deps: MagicHostDeps,
  run: MagicRun,
): { readonly host: MagicHost; readonly charge: MagicCharge } {
  const charge: MagicCharge = { steps: 0, bytes: 0 };
  const stepsLeft = (): number => run.limits.maxSteps - run.steps() - charge.steps;
  const bytesLeft = (): number => run.limits.maxTotalBytes - charge.bytes;

  async function search(request: MagicHostRequest): Promise<MagicHostReport> {
    if (run.signal.aborted) throw new ForgeError({ code: "E_ABORTED", message: "aborted" });
    if (stepsLeft() <= 0) throw limitError("E_LIMIT_STEPS", "step", run.limits.maxSteps);
    if (bytesLeft() <= 0)
      throw limitError("E_LIMIT_TOTAL", "total allocation", run.limits.maxTotalBytes);
    const nested = await deps.baker();
    const env = deps.environment();
    const { magic } = await import("./search.js");

    const own = new AbortController();
    let exhausted: "steps" | "bytes" | null = null;
    const onRunAbort = (): void => own.abort();
    run.signal.addEventListener("abort", onRunAbort, { once: true });

    const metered: Baker = {
      ...nested,
      async bake(recipe: unknown, input: Uint8Array, options: BakeOptions = {}) {
        const limits = {
          ...options.limits,
          maxSteps: Math.min(options.limits?.maxSteps ?? Infinity, stepsLeft()),
          maxTotalBytes: Math.min(options.limits?.maxTotalBytes ?? Infinity, bytesLeft()),
        };
        const result = await nested.bake(recipe, input, { ...options, limits });
        charge.steps += Math.max(1, result.stats.vmSteps);
        charge.bytes += input.length + outputSize(result);
        if (exhausted === null) {
          if (stepsLeft() <= 0) exhausted = "steps";
          else if (bytesLeft() <= 0) exhausted = "bytes";
          if (exhausted !== null) own.abort();
        }
        return result;
      },
    };

    const leftMs = run.limits.maxMillis - (performance.now() - run.startedAt);
    const deadlineMs = Math.max(
      1,
      Math.floor(Math.min(MAGIC_LIMITS.deadlineMs.default, leftMs - MAGIC_DEADLINE_RESERVE_MS)),
    );
    try {
      const result = await magic(request.data, {
        baker: metered,
        catalogue: env.catalogue,
        checks: env.checks,
        depth: request.depth,
        deadlineMs,
        exclude: [WORD],
        signal: own.signal,
        ...(request.crib === "" ? {} : { crib: request.crib }),
      });
      if (exhausted === "steps") throw limitError("E_LIMIT_STEPS", "step", run.limits.maxSteps);
      if (exhausted === "bytes") {
        throw limitError("E_LIMIT_TOTAL", "total allocation", run.limits.maxTotalBytes);
      }
      if (run.signal.aborted) throw new ForgeError({ code: "E_ABORTED", message: "aborted" });
      return {
        candidates: result.candidates.map((c) => ({
          ops: c.ops,
          score100: Math.round(c.score * 100),
          reasons: c.reasons,
          output: c.output,
        })),
      };
    } catch (e) {
      if (e instanceof ForgeError) throw e;
      if (e instanceof RangeError) {
        throw new ForgeError({ code: "E_RANGE", message: e.message, detail: { word: WORD } });
      }
      throw new ForgeError({
        code: "E_PRIMITIVE",
        message: e instanceof Error ? e.message : String(e),
        detail: { word: WORD },
        cause: e,
      });
    } finally {
      run.signal.removeEventListener("abort", onRunAbort);
    }
  }

  return { host: { search }, charge };
}
