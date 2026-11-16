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
 * The Magic search (PLAN.md WP 6.29). See score.ts for the scoring rule and RECIPES.md "The Magic engine" for the
 * design. In short: depth first, breadth limited. At each node every applicable operation is run once (a one-step
 * bake on the given baker), the outputs are scored and pruned, the best `branching` children are kept and expanded
 * in turn. Deterministic: operations are tried in a fixed order (evidence first, then qualified name), ties break on
 * the qualified names, nothing is ordered by time. Only the stopping point of a deadline depends on the clock.
 */
import type { MagicCheck } from "@forge/lang";
import { cpCompare } from "@forge/lang";
import type { CheckView } from "@forge/ops/checks";
import { dataView, evaluateChecks } from "@forge/ops/checks";
import type { Recipe } from "@forge/recipe";
import type { BakeOptions, BakeResult } from "../types.js";
import { MAGIC_LIMITS, MAGIC_OUTPUT_KEEP, MAGIC_RUN_LIMITS } from "./types.js";
import type { MagicCandidate, MagicOp, MagicOptions, MagicResult, MagicStop } from "./types.js";
import { PRODUCER_KINDS, SPECIFIC_KINDS, scoreOutput, worthReturning } from "./score.js";
import type { Scored } from "./score.js";

interface Node {
  readonly data: Uint8Array;
  readonly view: CheckView;
  readonly ops: readonly string[];
  readonly scored: Scored;
  readonly crib: boolean;
}

interface Applicable {
  readonly op: MagicOp;
  readonly evidence: boolean;
  readonly outputChecks: readonly MagicCheck[];
}

function clampInt(value: number | undefined, spec: { default: number; max: number }): number {
  if (value === undefined || !Number.isFinite(value)) return spec.default;
  return Math.min(spec.max, Math.max(1, Math.floor(value)));
}

/** A fingerprint of the whole data (length and two 32-bit hashes) for the repeat test. */
function fingerprint(data: Uint8Array): string {
  let a = 0x811c9dc5;
  let b = 5381;
  for (let i = 0; i < data.length; i++) {
    const x = data[i] as number;
    a = Math.imul(a ^ x, 0x01000193);
    b = (Math.imul(b, 33) + x) | 0;
  }
  return `${String(data.length)}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
}

function recipeOf(ops: readonly string[]): Recipe {
  return { forge: 1, steps: ops.map((op) => ({ kind: "op" as const, op })) };
}

function byteOutput(result: BakeResult): Uint8Array | null {
  if (!result.ok) return null;
  const out = result.output;
  if (out.kind === "bytes") return out.bytes;
  if (out.kind === "str") return new TextEncoder().encode(out.text);
  return null;
}

/** Failures that mean the operation (not this one input) is the problem: not tried again. */
function quarantines(result: BakeResult): boolean {
  if (result.ok) return false;
  const e = result.error;
  return (
    e.terminated === true ||
    e.code === "E_LIMIT_TIME" ||
    e.code === "E_LIMIT_STEPS" ||
    e.code === "E_LIMIT_VALUE" ||
    e.code === "E_UNSAFE_HOST"
  );
}

export async function magic(input: Uint8Array, options: MagicOptions): Promise<MagicResult> {
  const { baker } = options;
  const maxDepth = clampInt(options.depth, MAGIC_LIMITS.depth);
  const branching = clampInt(options.branching, MAGIC_LIMITS.branching);
  const maxTried = clampInt(options.maxTried, MAGIC_LIMITS.maxTried);
  const deadlineMs = clampInt(options.deadlineMs, MAGIC_LIMITS.deadlineMs);
  const wanted = clampInt(options.results, MAGIC_LIMITS.results);
  const crib = options.crib === undefined || options.crib === "" ? null : options.crib;
  if (crib !== null) {
    if (crib.length > MAGIC_LIMITS.maxCribChars) throw new RangeError("the crib is too long");
    if (!baker.hardKill) throw new Error("a crib needs a baker with hardKill (a BakerClient)");
  }
  const cribFlags = options.cribFlags ?? "";
  if (!/^[ims]{0,3}$/.test(cribFlags))
    throw new RangeError("the crib flags must be a subset of ims");
  const runLimits = {
    maxSteps: Math.min(MAGIC_RUN_LIMITS.maxSteps, options.limits?.maxSteps ?? Infinity),
    maxMillis: Math.min(MAGIC_RUN_LIMITS.maxMillis, options.limits?.maxMillis ?? Infinity),
    maxValueBytes: Math.min(
      MAGIC_RUN_LIMITS.maxValueBytes,
      options.limits?.maxValueBytes ?? Infinity,
    ),
    maxTotalBytes: Math.min(
      MAGIC_RUN_LIMITS.maxTotalBytes,
      options.limits?.maxTotalBytes ?? Infinity,
    ),
  };

  const t0 = performance.now();
  const elapsed = (): number => performance.now() - t0;
  const excluded = new Set(options.exclude ?? []);
  const checksDoc = options.checks ?? {};

  // The operations that may ever be tried: no required parameter, no effect, bytes or str in and out.
  const pool: MagicOp[] = options.catalogue.ops
    .filter(
      (op) =>
        !excluded.has(op.qname) &&
        (op.input === "bytes" || op.input === "str") &&
        (op.output === "bytes" || op.output === "str") &&
        op.effects.length === 0 &&
        !op.params.some((p) => p.required) &&
        (baker.hardKill || !op.needsHardKill),
    )
    .sort((a, b) => cpCompare(a.qname, b.qname));

  let aborted = options.signal?.aborted === true;
  const onAbort = (): void => {
    aborted = true;
    void baker.cancel();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  const stats = {
    tried: 0,
    failed: 0,
    prunedEmpty: 0,
    prunedRepeat: 0,
    prunedNoGain: 0,
    prunedBreadth: 0,
  };
  const quarantined = new Set<string>();
  const seen = new Set<string>();
  const found: (MagicCandidate & { readonly key: string })[] = [];
  let stopped: MagicStop | null = null;

  const halted = (): boolean => {
    if (stopped !== null) return true;
    if (aborted) stopped = "aborted";
    else if (elapsed() >= deadlineMs) stopped = "deadline";
    return stopped !== null;
  };

  const progress = (depth: number): void => {
    options.onProgress?.({
      tried: stats.tried,
      candidates: found.length,
      depth,
      elapsedMs: Math.round(elapsed()),
    });
  };

  /** One bake of one op; the limits are the smaller of the run limits and the time left. */
  async function run(
    steps: readonly unknown[],
    data: Uint8Array,
    extra: Pick<BakeOptions, "trust">,
  ): Promise<BakeResult> {
    const left = Math.max(1, Math.floor(deadlineMs - elapsed()));
    return baker.bake({ forge: 1, steps }, data, {
      ...extra,
      pins: "ignore",
      limits: { ...runLimits, maxMillis: Math.min(runLimits.maxMillis, left) },
    });
  }

  async function cribMatches(view: CheckView): Promise<boolean> {
    if (crib === null || view.utf8Validity !== "valid") return false;
    const r = await run(
      [{ kind: "op", op: "regex:test", params: { pattern: crib, flags: cribFlags } }],
      view.bytes,
      { trust: "untrusted" },
    );
    return r.ok && r.output.kind === "bool" && r.output.value;
  }

  function applicable(node: Node): Applicable[] {
    const withEvidence: Applicable[] = [];
    const without: Applicable[] = [];
    for (const op of pool) {
      if (quarantined.has(op.qname)) continue;
      if (op.input === "str" && node.view.utf8Validity !== "valid") continue;
      const doc = checksDoc[op.qname];
      const checks = doc === undefined ? [] : doc.checks;
      const inputChecks = checks.filter((c) => c.scope === "input");
      if (inputChecks.length > 0 && evaluateChecks(checks, node.view, "input").result !== "pass") {
        continue;
      }
      const outputChecks = checks.filter((c) => c.scope === "output");
      const evidence =
        inputChecks.some((c) => SPECIFIC_KINDS.has(c.test.kind)) &&
        !outputChecks.some((c) => PRODUCER_KINDS.has(c.test.kind));
      // Without evidence an operation can only score through the crib, so without a crib it is not worth a run.
      if (!evidence && crib === null) continue;
      const entry = { op, evidence, outputChecks };
      (evidence ? withEvidence : without).push(entry);
    }
    return withEvidence.concat(without);
  }

  const rootView = dataView(input);
  const rootScored = scoreOutput({
    view: rootView,
    rootEntropy: rootView.entropy,
    // The input is scored by its text quality only: crediting what it is (PEM, gzip) would make decoding it a loss.
    evidence: false,
    outputChecks: [],
    cribMatched: false,
    parent: null,
  });
  const root: Node = { data: input, view: rootView, ops: [], scored: rootScored, crib: false };
  const rootEntropy = rootView.entropy;
  if (input.length > 0) seen.add(fingerprint(input));

  async function expand(node: Node): Promise<void> {
    if (node.ops.length >= maxDepth) return;
    const kept: Node[] = [];
    for (const { op, evidence, outputChecks } of applicable(node)) {
      if (halted()) break;
      if (stats.tried >= maxTried) {
        stopped = "max-tried";
        break;
      }
      stats.tried++;
      const result = await run([{ kind: "op", op: op.qname }], node.data, { trust: "untrusted" });
      const out = byteOutput(result);
      if (out === null) {
        if (!result.ok && result.error.code === "E_NOT_READY") {
          throw new Error("the baker is not initialised");
        }
        // A run that the search itself cancelled is not the operation's fault.
        if (!aborted) {
          stats.failed++;
          if (quarantines(result)) quarantined.add(op.qname);
        }
        if (halted()) break;
        continue;
      }
      if (halted()) break;
      if (out.length === 0) {
        stats.prunedEmpty++;
        continue;
      }
      const key = fingerprint(out);
      if (seen.has(key)) {
        stats.prunedRepeat++;
        continue;
      }
      seen.add(key);
      const view = dataView(out);
      const matched = await cribMatches(view);
      if (halted()) break;
      const scored = scoreOutput({
        view,
        rootEntropy,
        evidence,
        outputChecks,
        cribMatched: matched,
        parent: { score: node.scored.score, id: node.scored.id },
      });
      if (!scored.improves) {
        stats.prunedNoGain++;
        continue;
      }
      kept.push({ data: out, view, ops: [...node.ops, op.qname], scored, crib: matched });
    }
    kept.sort(
      (a, b) => b.scored.score - a.scored.score || cpCompare(a.ops.join(" "), b.ops.join(" ")),
    );
    stats.prunedBreadth += Math.max(0, kept.length - branching);
    kept.length = Math.min(kept.length, branching);
    for (const child of kept) {
      if (worthReturning(child.scored, child.crib, rootScored.score)) {
        found.push({
          recipe: recipeOf(child.ops),
          ops: child.ops,
          depth: child.ops.length,
          score: child.scored.score,
          reasons: child.scored.reasons,
          output: child.data.slice(0, MAGIC_OUTPUT_KEEP),
          outputLength: child.data.length,
          key: child.ops.join(" "),
        });
      }
    }
    progress(node.ops.length + 1);
    for (const child of kept) {
      if (halted()) return;
      await expand(child);
    }
  }

  try {
    if (!halted() && input.length > 0) await expand(root);
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }

  found.sort((a, b) => b.score - a.score || a.depth - b.depth || cpCompare(a.key, b.key));
  const candidates: MagicCandidate[] = found.slice(0, wanted).map((c) => ({
    recipe: c.recipe,
    ops: c.ops,
    depth: c.depth,
    score: c.score,
    reasons: c.reasons,
    output: c.output,
    outputLength: c.outputLength,
  }));
  return {
    candidates,
    stopped: (stopped as MagicStop | null) ?? "done",
    stats: { ...stats, elapsedMs: Math.round(elapsed()) },
    quarantined: [...quarantined].sort(cpCompare),
  };
}
