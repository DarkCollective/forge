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
 * The Group L-A words of `core` added by FL 0.3 (LANGUAGE-0.3.md section 8, work package L2), kind P:
 * the element words `first`, `second` and `last`, the integer words `divmod`, `tdiv` and `zero-pad`,
 * the search and update words `index-of` and `set-nth`, and the three IEEE 754 float-bytes words.
 *
 * Each is one step. A word that cannot produce a value raises an error; there is no null (section 3.1).
 * The functions below are plain: they never mutate an argument and never return one.
 */
import { CORE_VOCAB } from "../dictionary.js";
import { ForgeError } from "../errors.js";
import { definePrimitive } from "../primitives.js";
import type { PrimitiveContext, PrimitiveDef, Value } from "../types.js";
import { bytes, cpLength, cpSlice, equals, int, list, sizeOf, str } from "../values.js";

type Int = number | bigint;

const big = (n: Int): bigint => (typeof n === "bigint" ? n : BigInt(n));

function rangeError(message: string, detail: Record<string, unknown>): ForgeError {
  return new ForgeError({ code: "E_RANGE", message, detail });
}

function typeError(expected: string, actual: string, param: number): ForgeError {
  return new ForgeError({
    code: "E_TYPE",
    message: `expected ${expected}, got ${actual}`,
    detail: { expected, actual, param },
  });
}

function limitError(what: string, limit: number, value: number): ForgeError {
  return new ForgeError({
    code: "E_LIMIT_VALUE",
    message: `${what} of ${value} exceeds the limit of ${limit}`,
    detail: { limit, value },
  });
}

/** Rejects a result of `size` bytes (spec 10.8 measure) that would exceed `maxValueBytes`. */
function guard(ctx: PrimitiveContext, size: number, what: string): void {
  const max = ctx.limits.maxValueBytes;
  if (size > max) throw limitError(`${what} (bytes)`, max, size);
}

/** The length of a str (code points), bytes or list; any other tag is E_TYPE. */
function lengthOf(a: Value): number {
  switch (a.tag) {
    case "str":
      return cpLength(a.v);
    case "bytes":
    case "list":
      return a.v.length;
    default:
      throw typeError("str, bytes or list", a.tag, 0);
  }
}

/** Element k of a sequence already checked to hold it, in the form `nth` gives it. */
function elementOf(a: Value, k: number): Value {
  switch (a.tag) {
    case "str":
      return str(cpSlice(a.v, k, k + 1));
    case "bytes":
      return int(a.v[k] as number);
    case "list":
      return a.v[k] as Value;
    default:
      throw typeError("str, bytes or list", a.tag, 0);
  }
}

/** The element at a position counted from the start; out of range is E_RANGE. */
function positional(a: Value, k: number, word: string): Value {
  const n = lengthOf(a);
  if (k >= n) throw rangeError(`${word} of a sequence of length ${n}`, { index: k, length: n });
  return elementOf(a, k);
}

/** A position in `[0, length)`; a bigint or any other value is E_RANGE. */
function checkIndex(i: Int, length: number, what: string): number {
  if (typeof i === "bigint" || i < 0 || i >= length) {
    throw rangeError(`${what} ${String(i)} out of range`, { index: i, length });
  }
  return i;
}

/**
 * The first code-point position of `sub` in `s`, or -1. A match that would start or end inside a
 * surrogate pair does not count, as in `find`.
 */
function cpIndexOf(s: string, sub: string): number {
  const isHigh = (u: number): boolean => u >= 0xd800 && u <= 0xdbff;
  const isLow = (u: number): boolean => u >= 0xdc00 && u <= 0xdfff;
  let i = s.indexOf(sub);
  while (i >= 0) {
    const e = i + sub.length;
    const insideStart = i > 0 && isLow(s.charCodeAt(i)) && isHigh(s.charCodeAt(i - 1));
    const insideEnd = e < s.length && isHigh(s.charCodeAt(e - 1)) && isLow(s.charCodeAt(e));
    if (!insideStart && !insideEnd) return cpLength(s.slice(0, i));
    i = s.indexOf(sub, i + 1);
  }
  return -1;
}

/** The text of a byte value for `set-nth` and `index-of`: an int 0 to 255, else E_RANGE. */
function byteValueOf(x: Value): number {
  if (x.tag !== "int" || big(x.v) < 0n || big(x.v) > 255n) {
    throw rangeError("a byte must be an int 0 to 255", { value: x.tag === "int" ? x.v : x.tag });
  }
  return Number(x.v);
}

/** The float view of a byte payload: 4 bytes is binary32, 8 is binary64, any other length E_RANGE. */
function floatView(b: Uint8Array): { read: DataView; width: 4 | 8 } {
  if (b.length !== 4 && b.length !== 8) {
    throw rangeError("a float pattern is 4 or 8 bytes", { length: b.length });
  }
  return {
    read: new DataView(b.buffer, b.byteOffset, b.byteLength),
    width: b.length === 4 ? 4 : 8,
  };
}

/** The decoded value of a float pattern, NaN and the infinities included. */
function decodeFloat(b: Uint8Array, little: boolean): number {
  const { read, width } = floatView(b);
  return width === 4 ? read.getFloat32(0, little) : read.getFloat64(0, little);
}

function def(
  name: string,
  effect: string,
  category: string,
  doc: string,
  fn: PrimitiveDef["fn"],
): PrimitiveDef {
  return definePrimitive(CORE_VOCAB, name, effect, fn, { category, doc });
}

export const LA_PRIMITIVES: readonly PrimitiveDef[] = Object.freeze([
  def(
    "first",
    "( any -- any )",
    "sequence",
    "Element 0 of a str (a one-code-point str), bytes (an int) or list, as nth gives it. An empty sequence is E_RANGE.",
    (a: Value) => positional(a, 0, "first"),
  ),
  def(
    "second",
    "( any -- any )",
    "sequence",
    "Element 1 of a str, bytes or list, as nth gives it. A sequence of fewer than two elements is E_RANGE.",
    (a: Value) => positional(a, 1, "second"),
  ),
  def(
    "last",
    "( any -- any )",
    "sequence",
    "The last element of a str, bytes or list, as nth gives it. An empty sequence is E_RANGE.",
    (a: Value) => {
      const n = lengthOf(a);
      if (n === 0) throw rangeError("last of an empty sequence", { length: 0 });
      return elementOf(a, n - 1);
    },
  ),
  def(
    "divmod",
    "( a:int b:int -- q:int r:int )",
    "arithmetic",
    "Floor quotient and floor remainder in one step: div and mod together (-7 2 divmod gives -4 and 1). A zero divisor is E_DIV_ZERO.",
    (a: Int, b: Int): [bigint, bigint] => {
      if (big(b) === 0n) throw new ForgeError({ code: "E_DIV_ZERO", message: "divmod by zero" });
      const x = big(a);
      const y = big(b);
      let q = x / y;
      let r = x % y;
      if (r !== 0n && r < 0n !== y < 0n) {
        q -= 1n;
        r += y;
      }
      return [q, r];
    },
  ),
  def(
    "tdiv",
    "( a:int b:int -- int )",
    "arithmetic",
    "Integer division that rounds toward zero (-7 2 tdiv is -3, 7 -2 tdiv is -3). A zero divisor is E_DIV_ZERO. Promotes util:tdiv, which required b to be positive.",
    (a: Int, b: Int): bigint => {
      if (big(b) === 0n) throw new ForgeError({ code: "E_DIV_ZERO", message: "tdiv by zero" });
      return big(a) / big(b);
    },
  ),
  def(
    "zero-pad",
    "( n:int w:int -- str )",
    "conversion",
    "The decimal digits of a non-negative n, left-padded with 0 to at least w digits, never cut (7 3 gives 007, 1234 2 gives 1234). A negative n is E_RANGE. Promotes util:zero-pad.",
    (n: Int, w: Int, ctx: PrimitiveContext) => {
      if (big(n) < 0n) throw rangeError("zero-pad of a negative number", { value: String(n) });
      const max = ctx.limits.maxValueBytes;
      if (big(w) > BigInt(max)) throw limitError("zero-pad width", max, max + 1);
      const digits = String(n);
      const width = Math.max(Number(w), digits.length);
      guard(ctx, 2 * width, "str");
      return "0".repeat(width - digits.length) + digits;
    },
  ),
  def(
    "index-of",
    "( any any -- int )",
    "sequence",
    "The first position of x in a list (by =), in bytes (x an int 0 to 255, else E_RANGE) or in a str (x a str, a substring; the position in code points; the empty substring gives 0). -1 when absent, as find gives it.",
    (seq: Value, x: Value) => {
      switch (seq.tag) {
        case "list":
          return seq.v.findIndex((item) => equals(item, x));
        case "bytes":
          return seq.v.indexOf(byteValueOf(x));
        case "str":
          if (x.tag !== "str") throw typeError("str", x.tag, 1);
          return cpIndexOf(seq.v, x.v);
        default:
          throw typeError("str, bytes or list", seq.tag, 0);
      }
    },
  ),
  def(
    "set-nth",
    "( any i:int any -- any )",
    "sequence",
    "A copy of a list or bytes with element i replaced by x (bytes take an int 0 to 255, else E_RANGE). An i out of range is E_RANGE; a str is E_TYPE.",
    (seq: Value, i: Int, x: Value, ctx: PrimitiveContext) => {
      switch (seq.tag) {
        case "list": {
          const k = checkIndex(i, seq.v.length, "index");
          const old = seq.v[k] as Value;
          guard(ctx, sizeOf(seq) - sizeOf(old) + sizeOf(x), "list");
          const out = seq.v.slice();
          out[k] = x;
          return list(out);
        }
        case "bytes": {
          const k = checkIndex(i, seq.v.length, "index");
          const out = seq.v.slice();
          out[k] = byteValueOf(x);
          return bytes(out);
        }
        default:
          throw typeError("list or bytes", seq.tag, 0);
      }
    },
  ),
  def(
    "num>float-bytes",
    "( n:num width:int little:bool -- bytes )",
    "conversion",
    "The IEEE 754 binary32 (width 32, rounded to the nearest single) or binary64 (width 64) bytes of n, least significant byte first when little is true. Another width is E_RANGE; a finite n that overflows binary32 is E_RANGE.",
    (n: number, width: Int, little: boolean) => {
      const out = new Uint8Array(width === 32 ? 4 : width === 64 ? 8 : 0);
      if (out.length === 0) throw rangeError("width must be 32 or 64", { width });
      const view = new DataView(out.buffer);
      if (out.length === 4) {
        if (!Number.isFinite(Math.fround(n))) {
          throw rangeError("number overflows binary32", { value: n });
        }
        view.setFloat32(0, n, little);
      } else {
        view.setFloat64(0, n, little);
      }
      return out;
    },
  ),
  def(
    "float-bytes>num",
    "( b:bytes little:bool -- num )",
    "conversion",
    "The number in 4 bytes (binary32) or 8 bytes (binary64). Any other length is E_RANGE; a NaN or infinity pattern is E_RANGE, since a num is always finite.",
    (b: Uint8Array, little: boolean) => {
      const v = decodeFloat(b, little);
      if (!Number.isFinite(v)) {
        throw rangeError("a NaN or infinity pattern is not a num", { value: String(v) });
      }
      return v;
    },
  ),
  def(
    "float-bytes-class",
    "( b:bytes little:bool -- str )",
    "conversion",
    'The class of a float pattern: "finite", "nan", "inf" or "-inf", so that float:decode can report the patterns a num cannot hold. Any other length than 4 or 8 is E_RANGE.',
    (b: Uint8Array, little: boolean) => {
      const v = decodeFloat(b, little);
      if (Number.isNaN(v)) return "nan";
      if (v === Infinity) return "inf";
      if (v === -Infinity) return "-inf";
      return "finite";
    },
  ),
]);
