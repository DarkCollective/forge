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

/**
 * Validation of the content clauses `checks` and `expects` (LANGUAGE.md section 5.9). Pure
 * functions: `parseCheck` returns the check or the reason text, `checkExpects` returns
 * `undefined` when the text is acceptable, otherwise the reason.
 */

import type { MagicCheck, MagicTest } from "./types.js";
import { cpLength } from "./values.js";

/** At most this many `checks` per word, across all `META:` blocks. */
export const CHECKS_MAX = 8;
/** At most this many code points in one string argument of a check. */
export const CHECK_ARG_MAX = 1024;
/** At most this many code points in an `expects` text. */
export const EXPECTS_MAX = 64;
/** `magic-bytes` reads the first 4 KiB: the offset plus the signature must fit. */
export const MAGIC_WINDOW = 4096;
/** The longest id of a named signature. */
export const FORMAT_ID_MAX = 64;
/** The minimum share of `charset` and `printable` when none is written. */
export const DEFAULT_CHARSET_MIN = 1;
export const DEFAULT_PRINTABLE_MIN = 0.9;

/** One argument of a clause as the compiler tokenised it (a number arrives as its text). */
export type CheckArg =
  | { readonly type: "str"; readonly value: string }
  | { readonly type: "name"; readonly text: string };

const INT_RE = /^-?(?:0x[0-9a-fA-F](?:_?[0-9a-fA-F])*|0b[01](?:_?[01])*|[0-9](?:_?[0-9])*)$/;
const FLOAT_RE =
  /^-?[0-9](?:_?[0-9])*(?:\.[0-9](?:_?[0-9])*(?:[eE][+-]?[0-9](?:_?[0-9])*)?|[eE][+-]?[0-9](?:_?[0-9])*)$/;
const FORMAT_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_RE = /^(?:[0-9a-fA-F]{2})+$/;
// eslint-disable-next-line no-control-regex
const C0 = /[\u0000-\u001f]/;

const TESTS = ["regex", "charset", "entropy", "magic-bytes", "utf8", "binary", "printable"];

function toNumber(text: string): { value: number; isInt: boolean } | undefined {
  if (INT_RE.test(text)) {
    const neg = text.startsWith("-");
    const big = BigInt(text.replace(/_/g, "").slice(neg ? 1 : 0));
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
    return { value: neg ? 0 - Number(big) : Number(big), isInt: true };
  }
  if (FLOAT_RE.test(text)) {
    const v = Number(text.replace(/_/g, ""));
    return Number.isFinite(v) ? { value: v + 0, isInt: false } : undefined;
  }
  return undefined;
}

/** The reason an `expects` text is refused (the `use-when` rules, 64 code points), or undefined. */
export function checkExpects(text: string): string | undefined {
  if (C0.test(text)) return "expects must be a single line without control characters";
  if (/^\s*$/u.test(text)) return "expects must not be empty or only white space";
  if (/^\s|\s$/u.test(text)) return "expects must not start or end with a space";
  if (cpLength(text) > EXPECTS_MAX) return `expects is longer than ${EXPECTS_MAX} code points`;
  return undefined;
}

/**
 * The reason a `charset` alphabet is refused, or undefined. Read left to right: a character, `-`
 * and a character is a range; a `-` anywhere else is itself.
 */
export function checkAlphabet(alphabet: string): string | undefined {
  const cps = Array.from(alphabet);
  if (cps.length === 0) return "the charset alphabet must not be empty";
  for (let i = 0; i < cps.length; i++) {
    if (cps[i + 1] === "-" && i + 2 < cps.length) {
      const lo = cps[i] as string;
      const hi = cps[i + 2] as string;
      if ((lo.codePointAt(0) as number) > (hi.codePointAt(0) as number)) {
        return `empty range ${lo}-${hi} in the charset alphabet`;
      }
      i += 2;
    }
  }
  return undefined;
}

type Fail = { readonly error: string };

/** Parses the arguments of one `checks` clause. Returns the check, or `{ error }` with the reason. */
export function parseCheck(args: readonly CheckArg[], maxRegexLength: number): MagicCheck | Fail {
  const fail = (error: string): Fail => ({ error });
  const [scopeArg, testArg, ...rest] = args;
  if (scopeArg?.type !== "name" || testArg?.type !== "name") {
    return fail("takes a scope and a test: checks <input|output> <test> <arguments> ;");
  }
  const scope = scopeArg.text;
  if (scope !== "input" && scope !== "output") {
    return fail(`the scope must be 'input' or 'output', not '${scope}'`);
  }
  const name = testArg.text;
  if (!TESTS.includes(name)) {
    return fail(`'${name}' is not a test (${TESTS.join(", ")})`);
  }
  for (const a of rest) {
    if (a.type === "str" && cpLength(a.value) > CHECK_ARG_MAX) {
      return fail(`an argument is longer than ${CHECK_ARG_MAX} code points`);
    }
  }
  let at = 0;
  const str = (what: string): string | Fail => {
    const a = rest[at++];
    return a?.type === "str" ? a.value : fail(`${name} needs ${what} as a string`);
  };
  const num = (what: string, lo: number, hi: number, int: boolean): number | Fail => {
    const a = rest[at++];
    const n = a?.type === "name" ? toNumber(a.text) : undefined;
    if (n === undefined) return fail(`${name} needs ${what} as a number`);
    if (int && !n.isInt) return fail(`${what} must be an integer`);
    if (n.value < lo || n.value > hi) return fail(`${what} must be from ${lo} to ${hi}`);
    return n.value;
  };
  const more = (): boolean => at < rest.length;
  const done = (test: MagicTest): MagicCheck | Fail =>
    more() ? fail(`too many arguments for ${name}`) : { scope, test };
  /** A minimum share: above 0 and at most 1; `fallback` when not written. */
  const share = (fallback: number): number | Fail => {
    if (!more()) return fallback;
    return num("the minimum share", Number.MIN_VALUE, 1, false);
  };

  switch (name) {
    case "utf8":
      return rest.length > 0 ? fail("utf8 takes no arguments") : { scope, test: { kind: "utf8" } };
    case "binary":
      return rest.length > 0
        ? fail("binary takes no arguments")
        : { scope, test: { kind: "binary" } };
    case "regex": {
      const p = str("a pattern");
      if (typeof p !== "string") return p;
      if (p === "") return fail("the pattern must not be empty");
      if (cpLength(p) > maxRegexLength) {
        return fail(`a pattern may be at most ${maxRegexLength} code points`);
      }
      try {
        new RegExp(p, "u");
      } catch {
        return fail("the pattern is not a valid regular expression");
      }
      return done({ kind: "regex", pattern: p });
    }
    case "charset": {
      const alphabet = str("an alphabet");
      if (typeof alphabet !== "string") return alphabet;
      const bad = checkAlphabet(alphabet);
      if (bad !== undefined) return fail(bad);
      const min = share(DEFAULT_CHARSET_MIN);
      if (typeof min !== "number") return min;
      return done({ kind: "charset", alphabet, min });
    }
    case "entropy": {
      const min = num("the minimum entropy", 0, 8, false);
      if (typeof min !== "number") return min;
      const max = num("the maximum entropy", 0, 8, false);
      if (typeof max !== "number") return max;
      if (min > max) return fail("the minimum entropy is above the maximum");
      return done({ kind: "entropy", min, max });
    }
    case "printable": {
      const min = share(DEFAULT_PRINTABLE_MIN);
      if (typeof min !== "number") return min;
      return done({ kind: "printable", min });
    }
    default: {
      // magic-bytes: `format "<id>"`, or `"<hex>" [<offset>]`.
      const first = rest[0];
      if (first?.type === "name" && first.text === "format") {
        at = 1;
        const id = str("a format id");
        if (typeof id !== "string") return id;
        if (id.length > FORMAT_ID_MAX || !FORMAT_ID_RE.test(id)) {
          return fail(
            `the format id must be lower-case words joined by hyphens, at most ${FORMAT_ID_MAX} characters`,
          );
        }
        return done({ kind: "magic-bytes", format: id });
      }
      const hex = str("a hex string");
      if (typeof hex !== "string") return hex;
      if (!HEX_RE.test(hex)) return fail("the hex string must be one or more whole bytes");
      let offset = 0;
      if (more()) {
        const o = num("the offset", 0, MAGIC_WINDOW - 1, true);
        if (typeof o !== "number") return o;
        offset = o;
      }
      if (offset + hex.length / 2 > MAGIC_WINDOW) {
        return fail(`the offset and the bytes must end within the first ${MAGIC_WINDOW} bytes`);
      }
      return done({ kind: "magic-bytes", hex: hex.toLowerCase(), offset });
    }
  }
}
