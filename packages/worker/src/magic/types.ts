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
 * The Magic engine, types and limits (PLAN.md WP 6.29, RECIPES.md "The Magic engine").
 *
 * `magic(input, options)` is a search over single operations that need no parameters beyond their
 * defaults. It never runs an operation itself: every candidate is a one-step bake on the `Baker` it is
 * given, so the untrusted-code limits, the watchdog and the hard kill are the baker's.
 */
import type { AbortSignalLike, ParamType } from "@forge/lang";
import type { ChecksOp } from "@forge/ops";
import type { Recipe } from "@forge/recipe";
import type { Baker } from "../types.js";

/** Hard maxima and defaults of the search (PLAN.md section 9, decision 12: the plan's defaults). */
export const MAGIC_LIMITS = Object.freeze({
  /** Operations in a candidate recipe. */
  depth: Object.freeze({ default: 3, max: 6 }),
  /** Children kept (and expanded) per node. */
  branching: Object.freeze({ default: 8, max: 64 }),
  /** Operation runs in the whole search (the crib test runs are not counted). */
  maxTried: Object.freeze({ default: 400, max: 10_000 }),
  /** Wall-clock milliseconds for the whole search. */
  deadlineMs: Object.freeze({ default: 10_000, max: 120_000 }),
  /** Candidates returned. */
  results: Object.freeze({ default: 5, max: 50 }),
  /** Longest crib pattern, in UTF-16 units (the recipe regex limit). */
  maxCribChars: 1024,
});

/** Limits for one candidate run, merged over (and never above) the baker's untrusted limits. */
export const MAGIC_RUN_LIMITS = Object.freeze({
  maxSteps: 1_000_000,
  /** Milliseconds; also capped by the time left until the deadline. */
  maxMillis: 1_000,
  maxValueBytes: 4 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
});

/** Bytes of an output kept on a returned candidate (the UI shows the first 80 characters). */
export const MAGIC_OUTPUT_KEEP = 4096;

/** The part of a catalogue operation the engine reads (a `CatalogueOp` fits). */
export interface MagicOp {
  readonly qname: string;
  readonly input: ParamType;
  readonly output: ParamType;
  readonly params: readonly { readonly required: boolean }[];
  readonly effects: readonly string[];
  readonly needsHardKill: boolean;
}

export interface MagicRunLimits {
  readonly maxSteps?: number;
  readonly maxMillis?: number;
  readonly maxValueBytes?: number;
  readonly maxTotalBytes?: number;
}

export interface MagicProgress {
  readonly tried: number;
  readonly candidates: number;
  readonly depth: number;
  readonly elapsedMs: number;
}

export interface MagicOptions {
  /**
   * An initialised baker (`init` with the vocabularies of `catalogue`). Use a `BakerClient` in a page:
   * the crib and every operation that `needsHardKill` are only run on a baker with `hardKill`.
   */
  readonly baker: Baker;
  /** The operations to search over (`catalogue.json`, plus any user ops the baker has loaded). */
  readonly catalogue: { readonly ops: readonly MagicOp[] };
  /** `checks.json`'s `ops`. Without it no operation has checks, so nothing counts as evidence and no candidate can be found without a crib. */
  readonly checks?: Readonly<Record<string, ChecksOp>>;
  /** Default 3, maximum 6. */
  readonly depth?: number;
  /** Per level; default 8, maximum 64. */
  readonly branching?: number;
  /** Total operation runs; default 400, maximum 10 000. */
  readonly maxTried?: number;
  /** Default 10 000, maximum 120 000. */
  readonly deadlineMs?: number;
  /** Candidates returned; default 5, maximum 50. */
  readonly results?: number;
  /** A regular expression the wanted output matches (the recipe regex dialect). Needs a baker with `hardKill`. Max 1024 chars. */
  readonly crib?: string;
  /** Flags of the crib, `[ims]*`. Default none. */
  readonly cribFlags?: string;
  /** Per-run limits; each can only lower `MAGIC_RUN_LIMITS`. */
  readonly limits?: MagicRunLimits;
  /** Qualified names never tried. */
  readonly exclude?: readonly string[];
  /** Cancels the search (and the run in progress) and returns what was found so far. */
  readonly signal?: AbortSignalLike;
  readonly onProgress?: (progress: MagicProgress) => void;
}

export interface MagicCandidate {
  /** Ready for `setRecipe`: one op step per operation, default parameters. */
  readonly recipe: Recipe;
  /** The qualified names, in order. */
  readonly ops: readonly string[];
  readonly depth: number;
  /** See `MAGIC_WEIGHTS` in `score.ts`. Higher is better; at most 1.35. */
  readonly score: number;
  /** Short plain-text reasons, in weight order. */
  readonly reasons: readonly string[];
  /** The first `MAGIC_OUTPUT_KEEP` bytes of the output. */
  readonly output: Uint8Array;
  /** Length of the whole output in bytes. */
  readonly outputLength: number;
}

export type MagicStop =
  /** The search ran out of nodes. */
  "done" | "deadline" | "max-tried" | "aborted";

export interface MagicResult {
  /** Best first: score descending, then fewer steps, then the qualified names in code-point order. */
  readonly candidates: readonly MagicCandidate[];
  readonly stopped: MagicStop;
  readonly stats: {
    /** Operation runs. */
    readonly tried: number;
    /** Runs that failed (an error of the operation, a limit, a kill). */
    readonly failed: number;
    readonly prunedEmpty: number;
    readonly prunedRepeat: number;
    readonly prunedNoGain: number;
    /** Children dropped by the breadth limit. */
    readonly prunedBreadth: number;
    readonly elapsedMs: number;
  };
  /** Operations that hit a time, step or size limit or were killed; not tried again in this search. */
  readonly quarantined: readonly string[];
}
