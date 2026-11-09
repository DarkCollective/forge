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
 * The regex seam (RECIPES.md section 4.1). Every regex primitive goes through this module, so
 * Phase 5 can replace the engine with a bounded one without touching a caller.
 *
 * The engine is ECMAScript `RegExp`, always with the `u` flag. A synchronous `RegExp` call cannot be
 * interrupted by the VM, so the time box is the hard kill of the Worker (R11); this module
 * enforces the size limits and records which primitives use the engine.
 */
import type { PrimitiveDef } from "@forge/lang";
import { limitFailure, rangeFailure } from "./prim-util.js";
import type { RegexLimits, RegexMatch } from "./types.js";

/** At most this much input (UTF-16 code units) and this many matches per call. */
export const REGEX_LIMITS: RegexLimits = Object.freeze({
  maxInputChars: 4_194_304,
  maxMatches: 100_000,
});

const regexPrimitives = new Set<string>();

/** Records `def` as a regex-engine primitive (for `needsHardKill`) and returns it. */
export function markRegexPrimitive(def: PrimitiveDef): PrimitiveDef {
  regexPrimitives.add(`${def.vocab}:${def.name}`);
  return def;
}

/** True when the primitive with this qualified name was marked with `markRegexPrimitive`. */
export function isRegexPrimitive(qname: string): boolean {
  return regexPrimitives.has(qname);
}

/** A match with its named groups, which `replace` needs for `$<name>`. */
export interface RegexMatchNamed extends RegexMatch {
  readonly named: ReadonlyMap<string, string | undefined> | undefined;
}

function compile(pattern: string, flags: string, global: boolean): RegExp {
  let accepted = "";
  for (const ch of flags) {
    if (ch !== "i" && ch !== "m" && ch !== "s") {
      throw rangeFailure(`regex flag '${ch}' is not one of i, m, s`, { flags });
    }
    if (!accepted.includes(ch)) accepted += ch;
  }
  try {
    return new RegExp(pattern, accepted + "u" + (global ? "g" : ""));
  } catch (e) {
    throw rangeFailure(`invalid regular expression: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function checkInput(text: string): void {
  if (text.length > REGEX_LIMITS.maxInputChars) {
    throw limitFailure("regexInput", REGEX_LIMITS.maxInputChars, text.length, "regex input");
  }
}

/** Index after the code point that starts at `i`. */
export function nextCodePoint(text: string, i: number): number {
  const c = text.charCodeAt(i);
  if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
    const d = text.charCodeAt(i + 1);
    if (d >= 0xdc00 && d <= 0xdfff) return i + 2;
  }
  return i + 1;
}

/** Number of code points in `text[from, to)`; both ends sit on code point boundaries. */
export function codePointsBetween(text: string, from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to; i = nextCodePoint(text, i)) n++;
  return n;
}

/** `execAll` with the named groups of each match. */
export function execAllNamed(pattern: string, flags: string, text: string): RegexMatchNamed[] {
  checkInput(text);
  const re = compile(pattern, flags, true);
  const out: RegexMatchNamed[] = [];
  let pos = 0;
  while (pos <= text.length) {
    re.lastIndex = pos;
    const m = re.exec(text);
    if (m === null) break;
    if (out.length >= REGEX_LIMITS.maxMatches) {
      throw limitFailure("regexMatches", REGEX_LIMITS.maxMatches, out.length + 1, "regex matches");
    }
    const matched = m[0];
    const end = m.index + matched.length;
    out.push({
      index: m.index,
      end,
      text: matched,
      groups: m.slice(1),
      named: m.groups === undefined ? undefined : new Map(Object.entries(m.groups)),
    });
    pos = end > m.index ? end : nextCodePoint(text, end);
  }
  return out;
}

/**
 * All non-overlapping matches, left to right (indices are UTF-16). After an empty match the search
 * resumes one code point later. Throws `E_LIMIT_VALUE` (`detail.limit` `"regexInput"` or
 * `"regexMatches"`) beyond `REGEX_LIMITS`, and `E_RANGE` for a bad flag or pattern.
 */
export function execAll(pattern: string, flags: string, text: string): RegexMatch[] {
  return execAllNamed(pattern, flags, text);
}

/** Does the pattern match anywhere? Same limits and errors as `execAll`, but stops at the first match. */
export function testAny(pattern: string, flags: string, text: string): boolean {
  checkInput(text);
  return compile(pattern, flags, false).test(text);
}
