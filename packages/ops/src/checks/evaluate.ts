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
 * The check evaluator (WP 6.23; LANGUAGE.md section 5.9, PLAN.md "Magic and content checks").
 * Pure and bounded: regex, charset, entropy and printable look at the first CHECK_PREFIX_BYTES
 * only; `magic-bytes` reads the bytes at its offset (or matches a named signature at offset 0);
 * `utf8` and `binary` use the whole data (one shared validity result) or answer `unknown` above
 * UTF8_WHOLE_CAP. The evaluator never throws.
 *
 * Results of one test: "pass", "fail" or "unknown" (no evidence). Empty data is `unknown` for
 * every test.
 *
 * Combination (the rule this module documents and the tests pin):
 *   - the checks of the asked scope are looked at; checks of the other scope are ignored;
 *   - `magic-bytes` checks of the scope (hex and `format` alike) are alternatives and count as ONE
 *     group: pass if any passes, else unknown if any is unknown, else fail;
 *   - the other checks and that one group all have to hold: any fail gives fail, else any unknown
 *     gives unknown, else pass. A fail beats an unknown, because one certain mismatch decides;
 *   - with no check in the scope the result is "pass" (vacuously); a consumer that wants "no
 *     checks" to read differently tests for the checks first.
 *   `failed` is the first failing check in declaration order (for a failed magic group, its first
 *     `magic-bytes` check).
 */
import type { MagicCheck, MagicTest } from "@forge/lang";
import { signatureById } from "../filetype-sigs.js";
import { matchesAt } from "../filetype-match.js";
import { testAny } from "../regex-engine.js";
import type { ChecksOp } from "../types.js";
import { CheckView, dataView } from "./data.js";
import { BINARY_MIN_BYTES } from "./limits.js";

export type CheckResult = "pass" | "fail" | "unknown";

export interface CheckEvaluation {
  readonly result: CheckResult;
  /** The first failing check; present only when `result` is "fail". */
  readonly failed?: MagicCheck;
}

export type CheckScope = "input" | "output";

const toView = (data: Uint8Array | CheckView): CheckView =>
  data instanceof CheckView ? data : dataView(data);

// --- helpers (small caches, bounded) ---------------------------------------------------------

const CACHE_MAX = 256;

function remember<V>(cache: Map<string, V>, key: string, make: () => V): V {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const v = make();
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, v);
  return v;
}

function parseHex(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const v = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
    const a = hex.charCodeAt(2 * i);
    const b = hex.charCodeAt(2 * i + 1);
    const isHex = (c: number): boolean =>
      (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
    if (!isHex(a) || !isHex(b)) return null;
    out[i] = v;
  }
  return out;
}

const hexCache = new Map<string, Uint8Array | null>();

interface Alphabet {
  readonly ascii: Uint8Array;
  readonly ranges: readonly (readonly [number, number])[];
}

/** `x-y` is a range of code points; a `-` first, last or after a range is itself. */
function parseAlphabet(text: string): Alphabet {
  const cps = Array.from(text, (c) => c.codePointAt(0) as number);
  const ascii = new Uint8Array(128);
  const ranges: [number, number][] = [];
  const add = (lo: number, hi: number): void => {
    for (let c = lo; c <= hi && c < 128; c++) ascii[c] = 1;
    if (hi >= 128) ranges.push([Math.max(lo, 128), hi]);
  };
  for (let i = 0; i < cps.length;) {
    if (i + 2 < cps.length && cps[i + 1] === 45) {
      add(cps[i] as number, cps[i + 2] as number);
      i += 3;
    } else {
      add(cps[i] as number, cps[i] as number);
      i++;
    }
  }
  return { ascii, ranges };
}

const alphabetCache = new Map<string, Alphabet>();

/** True when `$` occurs in the pattern outside a character class and not escaped. */
function endAnchored(pattern: string): boolean {
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") i++;
    else if (inClass) {
      if (c === "]") inClass = false;
    } else if (c === "[") inClass = true;
    else if (c === "$") return true;
  }
  return false;
}

// --- one test --------------------------------------------------------------------------------

function runTest(test: MagicTest, v: CheckView): CheckResult {
  const bytes = v.bytes;
  if (bytes.length === 0) return "unknown";
  switch (test.kind) {
    case "regex": {
      if (v.truncated && endAnchored(test.pattern)) return "unknown";
      return testAny(test.pattern, "", v.prefixText) ? "pass" : "fail";
    }
    case "charset": {
      const n = v.prefixLength;
      if (n === 0) return "unknown";
      const alpha = remember(alphabetCache, test.alphabet, () => parseAlphabet(test.alphabet));
      const text = v.prefixText;
      let inSet = 0;
      for (let i = 0; i < text.length; i++) {
        let cp = text.charCodeAt(i);
        if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < text.length) {
          const d = text.charCodeAt(i + 1);
          if (d >= 0xdc00 && d <= 0xdfff) {
            cp = (cp - 0xd800) * 0x400 + (d - 0xdc00) + 0x10000;
            i++;
          }
        }
        if (cp < 128) {
          if (alpha.ascii[cp] === 1) inSet++;
        } else {
          for (const [lo, hi] of alpha.ranges) {
            if (cp >= lo && cp <= hi) {
              inSet++;
              break;
            }
          }
        }
      }
      return inSet / n >= test.min ? "pass" : "fail";
    }
    case "entropy": {
      const h = v.entropy;
      return h >= test.min && h <= test.max ? "pass" : "fail";
    }
    case "printable":
      return v.printableShare >= test.min ? "pass" : "fail";
    case "magic-bytes": {
      if ("format" in test) {
        const sig = signatureById(test.format);
        if (sig === undefined) return "fail";
        return matchesAt(bytes, 0, sig) ? "pass" : "fail";
      }
      const want = remember(hexCache, test.hex, () => parseHex(test.hex));
      if (want === null) return "unknown";
      if (!Number.isInteger(test.offset) || test.offset < 0) return "unknown";
      if (test.offset + want.length > bytes.length) return "fail";
      for (let i = 0; i < want.length; i++) {
        if (bytes[test.offset + i] !== want[i]) return "fail";
      }
      return "pass";
    }
    case "utf8": {
      const s = v.utf8Validity;
      return s === "valid" ? "pass" : s === "invalid" ? "fail" : "unknown";
    }
    case "binary": {
      if (bytes.length < BINARY_MIN_BYTES) return "unknown";
      const s = v.utf8Validity;
      return s === "invalid" ? "pass" : s === "valid" ? "fail" : "unknown";
    }
  }
}

/** The result of one test on the data; never throws (a bad regex or other fault is `unknown`). */
export function evaluateTest(test: MagicTest, data: Uint8Array | CheckView): CheckResult {
  try {
    return runTest(test, toView(data));
  } catch {
    return "unknown";
  }
}

const isAlternative = (c: MagicCheck): boolean => c.test.kind === "magic-bytes";

/** Per unit of the scope (a plain check, or the magic-bytes group): its result and its first check. */
function units(
  checks: readonly MagicCheck[],
  v: CheckView,
  scope: CheckScope,
): { result: CheckResult; check: MagicCheck }[] {
  const out: { result: CheckResult; check: MagicCheck }[] = [];
  let group: { result: CheckResult; check: MagicCheck } | undefined;
  for (const c of checks) {
    if (c.scope !== scope) continue;
    const r = evaluateTest(c.test, v);
    if (!isAlternative(c)) {
      out.push({ result: r, check: c });
    } else if (group === undefined) {
      group = { result: r, check: c };
      out.push(group);
    } else if (r === "pass" || (r === "unknown" && group.result === "fail")) {
      group.result = r;
    }
  }
  return out;
}

/**
 * Do the checks of `scope` hold on the data? See the header comment for the combination rule.
 * `data` is the bytes or a `dataView` shared with other calls.
 */
export function evaluateChecks(
  checks: readonly MagicCheck[],
  data: Uint8Array | CheckView,
  scope: CheckScope,
): CheckEvaluation {
  try {
    const v = toView(data);
    let unknown = false;
    for (const u of units(checks, v, scope)) {
      if (u.result === "fail") return { result: "fail", failed: u.check };
      if (u.result === "unknown") unknown = true;
    }
    return { result: unknown ? "unknown" : "pass" };
  } catch {
    return { result: "unknown" };
  }
}

/**
 * The share of the scope's units that pass, in [0, 1]: each plain check is a unit and the
 * `magic-bytes` alternatives together are one. `unknown` and `fail` count 0. No check in the scope
 * gives 1.
 */
export function scoreChecks(
  checks: readonly MagicCheck[],
  data: Uint8Array | CheckView,
  scope: CheckScope,
): number {
  try {
    const us = units(checks, toView(data), scope);
    if (us.length === 0) return 1;
    let pass = 0;
    for (const u of us) if (u.result === "pass") pass++;
    return pass / us.length;
  } catch {
    return 0;
  }
}

/**
 * What an op expects: its `expects` text, else the display name of its first input `format`
 * signature, else undefined.
 */
export function expectedName(op: ChecksOp | undefined): string | undefined {
  if (op === undefined) return undefined;
  if (op.expects !== null && op.expects !== "") return op.expects;
  for (const c of op.checks) {
    if (c.scope === "input" && c.test.kind === "magic-bytes" && "format" in c.test) {
      const sig = signatureById(c.test.format);
      if (sig !== undefined) return sig.displayName;
    }
  }
  return undefined;
}
