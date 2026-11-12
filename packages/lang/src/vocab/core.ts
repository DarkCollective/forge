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
 * The primitive part of the `core` vocabulary (spec section 13, kind P). The intrinsic words
 * (stack words, combinators, `call`, `.`, `.s`) belong to the compiler and the VM and the
 * introspection words to the runtime facade; their names are listed here only so that the whole
 * table can be cross-checked.
 *
 * Every function receives plain payloads (tagged values for `any` and `number` slots) followed by
 * the PrimitiveContext, never mutates an argument and never returns one. Operations that can grow
 * a value pre-check the size against `ctx.limits` before allocating.
 */
import { ForgeError } from "../errors.js";
import { CORE_VOCAB } from "../dictionary.js";
import { definePrimitive } from "../primitives.js";
import { NUMERIC_PRIMITIVES } from "./numeric.js";
import type {
  EffectLabel,
  IntrinsicName,
  PrimitiveContext,
  PrimitiveDef,
  PrimitiveRegistry,
  Value,
} from "../types.js";
import {
  bytes,
  coerce,
  codePoints,
  cpCompare,
  cpLength,
  cpSlice,
  equals,
  int,
  intBitLength,
  list,
  normaliseInt,
  num,
  reprShort,
  sizeOf,
  str,
} from "../values.js";

type Int = number | bigint;

/** Intrinsic words (compiled to dedicated instructions by the compiler and the VM). */
export const CORE_INTRINSIC_WORDS: readonly IntrinsicName[] = Object.freeze([
  "dup",
  "drop",
  "swap",
  "over",
  "rot",
  "-rot",
  "nip",
  "tuck",
  "dup2",
  "drop2",
  "depth",
  "clear",
  "call",
  "if",
  "when",
  "unless",
  "times",
  "each",
  "map",
  "mapi",
  "filter",
  "reduce",
  "while",
  "loop",
  "try",
  "fork",
  ".",
  ".s",
] as const);

/** Words supplied by the runtime facade, which has access to the dictionary (spec 13.7, kind R). */
export const CORE_RUNTIME_WORDS: readonly string[] = Object.freeze([
  "help",
  "see",
  "words",
  "vocabs",
  "current-vocab",
]);

// ---------------------------------------------------------------------------------------------
// Errors and limits
// ---------------------------------------------------------------------------------------------

function typeError(
  expected: string,
  actual: string,
  param?: string | number,
  extra?: Record<string, unknown>,
): ForgeError {
  return new ForgeError({
    code: "E_TYPE",
    message: `expected ${expected}, got ${actual}`,
    detail: { expected, actual, ...(param !== undefined ? { param } : {}), ...extra },
  });
}

function rangeError(message: string, detail?: Record<string, unknown>): ForgeError {
  return new ForgeError({ code: "E_RANGE", message, ...(detail ? { detail } : {}) });
}

function coerceError(from: string, to: string, why: string): ForgeError {
  return new ForgeError({
    code: "E_COERCE",
    message: `cannot convert ${from} to ${to}: ${why}`,
    detail: { from, to },
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

// ---------------------------------------------------------------------------------------------
// Number helpers
// ---------------------------------------------------------------------------------------------

type NumVal = Extract<Value, { tag: "int" | "num" }>;

const big = (n: Int): bigint => (typeof n === "bigint" ? n : BigInt(n));

function asNumber(v: Value, param: number): NumVal {
  if (v.tag === "int" || v.tag === "num") return v;
  throw typeError("number", v.tag, param);
}

/** Float value of a number; a `bigint` int has no exact conversion (spec 3.2). */
function toFloat(v: NumVal): number {
  if (typeof v.v === "bigint") {
    throw coerceError("int", "num", "integer is outside the exactly representable range");
  }
  return v.v;
}

function copyNumber(v: NumVal): Value {
  return v.tag === "int" ? int(v.v) : num(v.v);
}

function compareNumbers(a: NumVal, b: NumVal): -1 | 0 | 1 {
  // JavaScript compares a bigint with a number by exact mathematical value.
  return a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
}

function compareBytes(a: Uint8Array, b: Uint8Array): -1 | 0 | 1 {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    if (x !== y) return x < y ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

function arith(op: "+" | "-" | "*", a: Value, b: Value, ctx: PrimitiveContext): Value {
  const x = asNumber(a, 0);
  const y = asNumber(b, 1);
  if (x.tag === "int" && y.tag === "int") {
    const p = x.v;
    const q = y.v;
    if (typeof p === "number" && typeof q === "number") {
      const r = op === "+" ? p + q : op === "-" ? p - q : p * q;
      if (Number.isSafeInteger(r)) return int(r);
    }
    const bp = big(p);
    const bq = big(q);
    const r = op === "+" ? bp + bq : op === "-" ? bp - bq : bp * bq;
    return int(r, ctx.limits.maxIntBits);
  }
  const fp = toFloat(x);
  const fq = toFloat(y);
  return num(op === "+" ? fp + fq : op === "-" ? fp - fq : fp * fq);
}

const SAFE_HALF = 2 ** 52;

function floorDivMod(a: Int, b: Int, want: "div" | "mod"): Int {
  if (b === 0) {
    throw new ForgeError({ code: "E_DIV_ZERO", message: `${want} by zero` });
  }
  if (
    typeof a === "number" &&
    typeof b === "number" &&
    Math.abs(a) <= SAFE_HALF &&
    Math.abs(b) <= SAFE_HALF
  ) {
    let r = a % b;
    if (r !== 0 && r < 0 !== b < 0) r += b;
    return want === "mod" ? r : (a - r) / b;
  }
  const x = big(a);
  const y = big(b);
  let q = x / y;
  let r = x % y;
  if (r !== 0n && r < 0n !== y < 0n) {
    q -= 1n;
    r += y;
  }
  return want === "div" ? q : r;
}

function gcdOf(a: Int, b: Int): Int {
  if (typeof a === "number" && typeof b === "number") {
    let x = Math.abs(a);
    let y = Math.abs(b);
    while (y !== 0) [x, y] = [y, x % y];
    return x;
  }
  let x = big(a) < 0n ? -big(a) : big(a);
  let y = big(b) < 0n ? -big(b) : big(b);
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

function modPositive(a: bigint, m: bigint): bigint {
  return ((a % m) + m) % m;
}

function powInt(a: Int, e: Int, ctx: PrimitiveContext): Int {
  if (e < 0) throw rangeError("negative exponent", { exponent: e });
  const be = big(e);
  const max = ctx.limits.maxIntBits;
  if (a === 0) return be === 0n ? 1 : 0;
  if (a === 1) return 1;
  if (a === -1) return be % 2n === 0n ? 1 : -1;
  // |a| >= 2: the result has more than (bits(a) - 1) * e bits.
  const lower = BigInt(intBitLength(a) - 1) * be;
  if (lower >= BigInt(max)) throw limitError("integer bit length", max, Number(lower) + 1);
  return normaliseInt(big(a) ** be, max);
}

function shiftLeft(a: Int, k: Int, ctx: PrimitiveContext): Int {
  if (k < 0) throw rangeError("negative shift count", { count: k });
  if (a === 0) return 0;
  const max = ctx.limits.maxIntBits;
  const bits = BigInt(intBitLength(a)) + big(k);
  if (bits > BigInt(max)) throw limitError("integer bit length", max, Number(bits));
  return normaliseInt(big(a) << big(k), max);
}

function shiftRight(a: Int, k: Int): Int {
  if (k < 0) throw rangeError("negative shift count", { count: k });
  if (big(k) >= BigInt(intBitLength(a))) return a < 0 ? -1 : 0;
  return big(a) >> big(k);
}

const isInt32 = (n: Int): n is number =>
  typeof n === "number" && n >= -0x80000000 && n <= 0x7fffffff;

function bitwise(op: "&" | "|" | "^", a: Int, b: Int): Int {
  if (isInt32(a) && isInt32(b)) return op === "&" ? a & b : op === "|" ? a | b : a ^ b;
  const x = big(a);
  const y = big(b);
  return op === "&" ? x & y : op === "|" ? x | y : x ^ y;
}

function invMod(a: Int, m: Int): Int {
  if (m < 1) throw rangeError("modulus must be at least 1", { modulus: m });
  const mod = big(m);
  let r0 = mod;
  let r1 = modPositive(big(a), mod);
  let t0 = 0n;
  let t1 = 1n;
  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [t0, t1] = [t1, t0 - q * t1];
  }
  if (r0 !== 1n) throw rangeError("no modular inverse", { a, modulus: m });
  return modPositive(t0, mod);
}

function powMod(base: Int, exp: Int, m: Int): Int {
  if (exp < 0) throw rangeError("negative exponent", { exponent: exp });
  if (m < 1) throw rangeError("modulus must be at least 1", { modulus: m });
  const mod = big(m);
  let b = modPositive(big(base), mod);
  let e = big(exp);
  let r = 1n % mod;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return r;
}

/** An integral JS number (finite) as an int payload. */
function integral(x: number): Int {
  return Number.isSafeInteger(x) ? x : BigInt(x);
}

function roundHalfAway(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

// ---------------------------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------------------------

function order(a: Value, b: Value): -1 | 0 | 1 {
  if ((a.tag === "int" || a.tag === "num") && (b.tag === "int" || b.tag === "num")) {
    return compareNumbers(a, b);
  }
  if (a.tag === "str" && b.tag === "str") return cpCompare(a.v, b.v);
  if (a.tag === "bytes" && b.tag === "bytes") return compareBytes(a.v, b.v);
  if (a.tag === "int" || a.tag === "num") throw typeError("number", b.tag, 1);
  if (a.tag === "str" || a.tag === "bytes") throw typeError(a.tag, b.tag, 1);
  throw typeError("number, str or bytes", a.tag, 0);
}

// ---------------------------------------------------------------------------------------------
// Strings
// ---------------------------------------------------------------------------------------------

const isHigh = (u: number): boolean => u >= 0xd800 && u <= 0xdbff;
const isLow = (u: number): boolean => u >= 0xdc00 && u <= 0xdfff;

/** `indexOf` that never matches a position inside a surrogate pair. */
function indexOfCp(s: string, sep: string, from: number): number {
  let i = s.indexOf(sep, from);
  while (i >= 0) {
    const e = i + sep.length;
    const insideStart = i > 0 && isLow(s.charCodeAt(i)) && isHigh(s.charCodeAt(i - 1));
    const insideEnd = e < s.length && isHigh(s.charCodeAt(e - 1)) && isLow(s.charCodeAt(e));
    if (!insideStart && !insideEnd) return i;
    i = s.indexOf(sep, i + 1);
  }
  return -1;
}

const HEX_DIGITS = "0123456789abcdef";
const HEX_PAIRS: readonly string[] = Array.from(
  { length: 256 },
  (_, i) => (HEX_DIGITS[i >> 4] as string) + (HEX_DIGITS[i & 15] as string),
);

const CHUNK = 8192;

function digitValue(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 97 && code <= 122) return code - 87;
  if (code >= 65 && code <= 90) return code - 55;
  return 99;
}

function checkRadix(radix: Int): number {
  if (typeof radix === "bigint" || radix < 2 || radix > 36) {
    throw rangeError("radix must be in 2..36", { radix });
  }
  return radix;
}

/**
 * Parses `-?` digits of `radix` (either case, at least one digit). Syntax errors are E_COERCE;
 * a value that cannot fit in `maxIntBits` is E_LIMIT_VALUE, decided before the costly parse.
 */
function parseInteger(text: string, radix: number, ctx: PrimitiveContext): Int {
  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  if (body.length === 0) throw coerceError("str", "int", "no digits");
  for (let i = 0; i < body.length; i++) {
    if (digitValue(body.charCodeAt(i)) >= radix) {
      throw coerceError("str", "int", `invalid digit in base ${radix}`);
    }
  }
  const digits = body.replace(/^0+/, "");
  const max = ctx.limits.maxIntBits;
  // value >= radix^(n-1), so it has at least this many bits; the exact check follows the parse
  const lowerBits = Math.floor((digits.length - 1) * Math.log2(radix) - 1e-6) + 1;
  if (digits.length > 0 && lowerBits > max) throw limitError("integer bit length", max, lowerBits);
  if (digits.length === 0) return 0;
  const chunk = Math.max(1, Math.floor(52 / Math.log2(radix)));
  let value: Int;
  if (digits.length <= chunk) {
    value = parseInt(digits, radix);
  } else {
    let acc = 0n;
    const r = BigInt(radix);
    for (let i = 0; i < digits.length; i += chunk) {
      const piece = digits.slice(i, i + chunk);
      acc = acc * r ** BigInt(piece.length) + BigInt(parseInt(piece, radix));
    }
    value = acc;
  }
  return normaliseInt(negative ? -big(value) : value, max);
}

function checkIndex(i: Int, length: number, what: string): number {
  if (typeof i === "bigint" || i < 0 || i >= length) {
    throw rangeError(`${what} ${String(i)} out of range`, { index: i, length });
  }
  return i;
}

function seqLength(v: Value): number {
  switch (v.tag) {
    case "str":
      return cpLength(v.v);
    case "bytes":
    case "list":
      return v.v.length;
    default:
      throw typeError("str, bytes or list", v.tag, 0);
  }
}

// ---------------------------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------------------------

function core(
  name: string,
  effect: string,
  category: string,
  doc: string,
  fn: PrimitiveDef["fn"],
  effects?: readonly EffectLabel[],
): PrimitiveDef {
  return definePrimitive(CORE_VOCAB, name, effect, fn, {
    category,
    doc,
    ...(effects ? { effects } : {}),
  });
}

const NUM2 = "( number number -- number )";
const CMP = "( any any -- bool )";

function comparison(name: string, doc: string, test: (c: -1 | 0 | 1) => boolean): PrimitiveDef {
  return core(name, CMP, "comparison", doc, (a: Value, b: Value) => test(order(a, b)));
}

/** The 69 `core` words of kind P, in the order of spec section 13. */
export const CORE_PRIMITIVES: readonly PrimitiveDef[] = Object.freeze([
  // 13.2 arithmetic and comparison
  core(
    "+",
    NUM2,
    "arithmetic",
    "Sum of two numbers.",
    (a: Value, b: Value, ctx: PrimitiveContext) => arith("+", a, b, ctx),
  ),
  core(
    "-",
    NUM2,
    "arithmetic",
    "Difference: the second value minus the top.",
    (a: Value, b: Value, ctx: PrimitiveContext) => arith("-", a, b, ctx),
  ),
  core(
    "*",
    NUM2,
    "arithmetic",
    "Product of two numbers.",
    (a: Value, b: Value, ctx: PrimitiveContext) => arith("*", a, b, ctx),
  ),
  core(
    "/",
    "( number number -- num )",
    "arithmetic",
    "Float division. A zero divisor is E_DIV_ZERO.",
    (a: Value, b: Value) => {
      const x = toFloat(asNumber(a, 0));
      const y = toFloat(asNumber(b, 1));
      if (y === 0) throw new ForgeError({ code: "E_DIV_ZERO", message: "division by zero" });
      return x / y;
    },
  ),
  core(
    "div",
    "( int int -- int )",
    "arithmetic",
    "Exact floor division of integers of any size. A zero divisor is E_DIV_ZERO.",
    (a: Int, b: Int) => floorDivMod(a, b, "div"),
  ),
  core(
    "mod",
    "( int int -- int )",
    "arithmetic",
    "Floor modulo, with the sign of the divisor. A zero divisor is E_DIV_ZERO.",
    (a: Int, b: Int) => floorDivMod(a, b, "mod"),
  ),
  core(
    "pow",
    "( int int -- int )",
    "arithmetic",
    "Integer power. A negative exponent is E_RANGE; a result over maxIntBits is E_LIMIT_VALUE.",
    (a: Int, e: Int, ctx: PrimitiveContext) => powInt(a, e, ctx),
  ),
  core(
    "gcd",
    "( int int -- int )",
    "arithmetic",
    "Greatest common divisor, never negative; gcd(0,0) is 0.",
    (a: Int, b: Int) => gcdOf(a, b),
  ),
  core(
    "invmod",
    "( a:int m:int -- int )",
    "arithmetic",
    "Modular inverse of a mod m in [0, m). m < 1 or no inverse is E_RANGE.",
    (a: Int, m: Int) => invMod(a, m),
  ),
  core(
    "powmod",
    "( base:int exp:int mod:int -- int )",
    "arithmetic",
    "base^exp mod mod in [0, mod). exp < 0 or mod < 1 is E_RANGE.",
    (base: Int, exp: Int, m: Int) => powMod(base, exp, m),
  ),
  core(
    "sqrt",
    "( number -- num )",
    "arithmetic",
    "Square root as a float. A negative operand is E_RANGE.",
    (a: Value) => {
      const x = toFloat(asNumber(a, 0));
      if (x < 0) throw rangeError("square root of a negative number", { value: x });
      return Math.sqrt(x);
    },
  ),
  core(
    "neg",
    "( number -- number )",
    "arithmetic",
    "Negation. An int zero stays zero (there is no negative zero int).",
    (a: Value) => {
      const x = asNumber(a, 0);
      return x.tag === "int" ? int(-big(x.v)) : num(-x.v);
    },
  ),
  core("abs", "( number -- number )", "arithmetic", "Absolute value.", (a: Value) => {
    const x = asNumber(a, 0);
    if (x.tag === "num") return num(Math.abs(x.v));
    return int(x.v < 0 ? -big(x.v) : x.v);
  }),
  core(
    "min",
    NUM2,
    "arithmetic",
    "The smaller of two numbers, keeping its tag. On a tie the deeper operand wins.",
    (a: Value, b: Value) => {
      const x = asNumber(a, 0);
      const y = asNumber(b, 1);
      return copyNumber(compareNumbers(y, x) < 0 ? y : x);
    },
  ),
  core(
    "max",
    NUM2,
    "arithmetic",
    "The larger of two numbers, keeping its tag. On a tie the deeper operand wins.",
    (a: Value, b: Value) => {
      const x = asNumber(a, 0);
      const y = asNumber(b, 1);
      return copyNumber(compareNumbers(y, x) > 0 ? y : x);
    },
  ),
  core(
    "=",
    CMP,
    "comparison",
    "Equality; different tags are unequal except int and num, which compare exactly.",
    (a: Value, b: Value) => equals(a, b),
  ),
  core("<>", CMP, "comparison", "Negation of =.", (a: Value, b: Value) => !equals(a, b)),
  comparison("<", "True when the second value is less than the top.", (c) => c < 0),
  comparison(">", "True when the second value is greater than the top.", (c) => c > 0),
  comparison("<=", "True when the second value is at most the top.", (c) => c <= 0),
  comparison(">=", "True when the second value is at least the top.", (c) => c >= 0),

  // 13.3 logic and bitwise
  core("and", "( bool bool -- bool )", "logic", "Logical and.", (a: boolean, b: boolean) => a && b),
  core("or", "( bool bool -- bool )", "logic", "Logical or.", (a: boolean, b: boolean) => a || b),
  core("not", "( bool -- bool )", "logic", "Logical not.", (a: boolean) => !a),
  core(
    "band",
    "( int int -- int )",
    "bitwise",
    "Bitwise and (two's complement, any width).",
    (a: Int, b: Int) => bitwise("&", a, b),
  ),
  core(
    "bor",
    "( int int -- int )",
    "bitwise",
    "Bitwise or (two's complement, any width).",
    (a: Int, b: Int) => bitwise("|", a, b),
  ),
  core(
    "bxor",
    "( any any -- any )",
    "bitwise",
    "Two ints: bitwise xor. Two bytes: xor of each data byte with the key repeated cyclically " +
      "(an empty key is E_RANGE). Other tags are E_TYPE.",
    (a: Value, b: Value) => {
      if (a.tag === "int" && b.tag === "int") return int(bitwise("^", a.v, b.v));
      if (a.tag === "bytes" && b.tag === "bytes") {
        const key = b.v;
        if (key.length === 0) throw rangeError("empty xor key");
        const out = new Uint8Array(a.v.length);
        for (let i = 0; i < out.length; i++) {
          out[i] = (a.v[i] as number) ^ (key[i % key.length] as number);
        }
        return bytes(out);
      }
      if (a.tag === "int" || a.tag === "bytes") throw typeError(a.tag, b.tag, 1);
      throw typeError("int or bytes", a.tag, 0);
    },
  ),
  core("bnot", "( int -- int )", "bitwise", "Bitwise not: -n-1.", (a: Int) =>
    typeof a === "bigint" ? -a - 1n : -a - 1,
  ),
  core(
    "shl",
    "( int k:int -- int )",
    "bitwise",
    "Shift left by k >= 0. A result over maxIntBits is E_LIMIT_VALUE, checked before computing.",
    (a: Int, k: Int, ctx: PrimitiveContext) => shiftLeft(a, k, ctx),
  ),
  core(
    "shr",
    "( int k:int -- int )",
    "bitwise",
    "Arithmetic shift right by k >= 0.",
    (a: Int, k: Int) => shiftRight(a, k),
  ),

  // 13.4 sequences, strings, bytes, lists, records
  core(
    "len",
    "( any -- int )",
    "sequence",
    "Length of a str (code points), bytes or list.",
    (a: Value) => seqLength(a),
  ),
  core(
    "cat",
    "( any any -- any )",
    "sequence",
    "Concatenate two values of the same kind (str, bytes or list).",
    (a: Value, b: Value, ctx: PrimitiveContext) => {
      if (a.tag === "str" && b.tag === "str") {
        guard(ctx, 2 * (a.v.length + b.v.length), "str");
        return str(a.v + b.v);
      }
      if (a.tag === "bytes" && b.tag === "bytes") {
        guard(ctx, a.v.length + b.v.length, "bytes");
        const out = new Uint8Array(a.v.length + b.v.length);
        out.set(a.v, 0);
        out.set(b.v, a.v.length);
        return bytes(out);
      }
      if (a.tag === "list" && b.tag === "list") {
        guard(ctx, sizeOf(a) + sizeOf(b), "list");
        return list(a.v.concat(b.v));
      }
      seqLength(a);
      throw typeError(a.tag, b.tag, 1);
    },
  ),
  core(
    "slice",
    "( any from:int to:int -- any )",
    "sequence",
    "Sub-sequence [from, to). Needs 0 <= from <= to <= len, else E_RANGE.",
    (a: Value, from: Int, to: Int) => {
      const n = seqLength(a);
      if (typeof from === "bigint" || typeof to === "bigint" || from < 0 || from > to || to > n) {
        throw rangeError("slice bounds out of range", { from, to, length: n });
      }
      switch (a.tag) {
        case "str":
          return str(cpSlice(a.v, from, to));
        case "bytes":
          return bytes(a.v.slice(from, to));
        default:
          return list((a.v as readonly Value[]).slice(from, to));
      }
    },
  ),
  core(
    "nth",
    "( any i:int -- any )",
    "sequence",
    "Element i: a one-code-point str, a byte as int, or a list element. Out of range is E_RANGE.",
    (a: Value, i: Int) => {
      const k = checkIndex(i, seqLength(a), "index");
      switch (a.tag) {
        case "str":
          return str(cpSlice(a.v, k, k + 1));
        case "bytes":
          return int(a.v[k] as number);
        default:
          return (a.v as readonly Value[])[k] as Value;
      }
    },
  ),
  core(
    "rev",
    "( any -- any )",
    "sequence",
    "Reverse a str (by code point), bytes or list.",
    (a: Value) => {
      switch (a.tag) {
        case "str":
          return str(Array.from(a.v).reverse().join(""));
        case "bytes":
          return bytes(a.v.slice().reverse());
        case "list":
          return list(a.v.slice().reverse());
        default:
          throw typeError("str, bytes or list", a.tag, 0);
      }
    },
  ),
  core(
    "split",
    "( str sep:str -- list )",
    "string",
    'Split at every occurrence of sep. An empty str gives { "" }; a trailing separator gives a ' +
      'trailing "". An empty sep is E_RANGE.',
    (s: string, sep: string, ctx: PrimitiveContext) => {
      if (sep.length === 0) throw rangeError("empty separator");
      const out: Value[] = [];
      let size = 0;
      let pos = 0;
      for (;;) {
        const i = indexOfCp(s, sep, pos);
        const piece = i < 0 ? s.slice(pos) : s.slice(pos, i);
        size += 8 + 2 * piece.length;
        guard(ctx, size, "list");
        out.push(str(piece));
        if (i < 0) return out;
        pos = i + sep.length;
      }
    },
  ),
  core(
    "join",
    "( list sep:str -- str )",
    "string",
    "Join a list of str with sep. A non-str element is E_TYPE.",
    (items: readonly Value[], sep: string, ctx: PrimitiveContext) => {
      const parts: string[] = new Array<string>(items.length);
      let total = sep.length * Math.max(0, items.length - 1);
      for (let i = 0; i < items.length; i++) {
        const it = items[i] as Value;
        if (it.tag !== "str") throw typeError("str", it.tag, undefined, { index: i });
        parts[i] = it.v;
        total += it.v.length;
      }
      guard(ctx, 2 * total, "str");
      return parts.join(sep);
    },
  ),
  core(
    "bjoin",
    "( list sep:bytes -- bytes )",
    "bytes",
    "Join a list of bytes with a bytes separator. A non-bytes element is E_TYPE.",
    (items: readonly Value[], sep: Uint8Array, ctx: PrimitiveContext) => {
      const parts: Uint8Array[] = new Array<Uint8Array>(items.length);
      let total = sep.length * Math.max(0, items.length - 1);
      for (let i = 0; i < items.length; i++) {
        const it = items[i] as Value;
        if (it.tag !== "bytes") throw typeError("bytes", it.tag, undefined, { index: i });
        parts[i] = it.v;
        total += it.v.length;
      }
      guard(ctx, total, "bytes");
      const out = new Uint8Array(total);
      let at = 0;
      parts.forEach((p, i) => {
        if (i > 0) {
          out.set(sep, at);
          at += sep.length;
        }
        out.set(p, at);
        at += p.length;
      });
      return out;
    },
  ),
  core("upper", "( str -- str )", "string", "String.prototype.toUpperCase.", (s: string) =>
    s.toUpperCase(),
  ),
  core("lower", "( str -- str )", "string", "String.prototype.toLowerCase.", (s: string) =>
    s.toLowerCase(),
  ),
  core(
    "translate",
    "( bytes table:bytes[256] -- bytes )",
    "bytes",
    "Replace each byte b by table[b]. The table must be exactly 256 bytes (E_PARAM_INVALID).",
    (data: Uint8Array, table: Uint8Array) => {
      if (table.length !== 256) {
        throw new ForgeError({
          code: "E_PARAM_INVALID",
          message: `translate table must be 256 bytes, got ${table.length}`,
          detail: { param: "table", constraint: "[256]", value: reprShort(bytes(table)) },
        });
      }
      const out = new Uint8Array(data.length);
      for (let i = 0; i < out.length; i++) out[i] = table[data[i] as number] as number;
      return out;
    },
  ),
  core(
    "append",
    "( list any -- list )",
    "list",
    "A new list with the element added at the end.",
    (items: readonly Value[], x: Value, ctx: PrimitiveContext) => {
      guard(ctx, sizeOf(list(items)) + 8 + sizeOf(x), "list");
      return [...items, x];
    },
  ),
  core(
    "zip",
    "( list list -- list )",
    "list",
    "A list of two-element lists { a b }, as long as the shorter input.",
    (a: readonly Value[], b: readonly Value[], ctx: PrimitiveContext) => {
      const n = Math.min(a.length, b.length);
      guard(ctx, n * 32, "list");
      const out = new Array<Value>(n);
      for (let i = 0; i < n; i++) out[i] = list([a[i] as Value, b[i] as Value]);
      return out;
    },
  ),
  core(
    "range",
    "( from:int to:int -- list )",
    "list",
    "{ from ... to-1 }; empty if to <= from.",
    (from: Int, to: Int, ctx: PrimitiveContext) => {
      if (to <= from) return [];
      const count = Number(big(to) - big(from));
      guard(ctx, count * 16, "list");
      const out = new Array<Value>(count);
      if (typeof from === "number" && typeof to === "number") {
        for (let i = 0; i < count; i++) out[i] = { tag: "int", v: from + i };
      } else {
        const f = big(from);
        for (let i = 0; i < count; i++) out[i] = int(f + BigInt(i));
      }
      return out;
    },
  ),
  core(
    ">record",
    "( list -- record )",
    "record",
    "Build a record from { key value } pairs with str keys; later duplicates win.",
    (pairs: readonly Value[]) => {
      const out = new Map<string, Value>();
      pairs.forEach((p, i) => {
        if (p.tag !== "list" || p.v.length !== 2) {
          throw typeError("a { key value } pair", p.tag, undefined, { index: i });
        }
        const [k, v] = p.v as readonly [Value, Value];
        if (k.tag !== "str") throw typeError("str key", k.tag, undefined, { index: i });
        out.set(k.v, v);
      });
      return out;
    },
  ),
  core(
    "get",
    "( record key:str -- any )",
    "record",
    "The value stored under key. A missing key is E_RANGE.",
    (rec: ReadonlyMap<string, Value>, key: string) => {
      const v = rec.get(key);
      if (v === undefined) throw rangeError(`no such key ${JSON.stringify(key)}`, { key });
      return v;
    },
  ),
  core(
    "put",
    "( record key:str any -- record )",
    "record",
    "A new record with the key set.",
    (rec: ReadonlyMap<string, Value>, key: string, v: Value) => {
      const out = new Map(rec);
      out.set(key, v);
      return out;
    },
  ),
  core(
    "keys",
    "( record -- list )",
    "record",
    "The keys, in insertion order.",
    (rec: ReadonlyMap<string, Value>) => [...rec.keys()].map((k) => str(k)),
  ),

  // 13.5 conversion
  core("type", "( any -- str )", "conversion", "The tag name of a value.", (a: Value) => a.tag),
  core("int>str", "( int -- str )", "conversion", "Decimal text.", (n: Int) => String(n)),
  core(
    "str>int",
    "( str -- int )",
    "conversion",
    "Parse -?[0-9]+ as an integer; anything else is E_COERCE.",
    (s: string, ctx: PrimitiveContext) => {
      if (!/^-?[0-9]+$/.test(s)) throw coerceError("str", "int", "not a decimal integer");
      return parseInteger(s, 10, ctx);
    },
  ),
  core(
    "int>str-radix",
    "( int radix:int -- str )",
    "conversion",
    "Text in base 2..36 with lowercase digits and - for negatives. Another radix is E_RANGE.",
    (n: Int, radix: Int) => n.toString(checkRadix(radix)),
  ),
  core(
    "str>int-radix",
    "( str radix:int -- int )",
    "conversion",
    "Parse -? and digits of the base (either case). A bad digit is E_COERCE, another radix " +
      "E_RANGE, a result over maxIntBits E_LIMIT_VALUE.",
    (s: string, radix: Int, ctx: PrimitiveContext) => parseInteger(s, checkRadix(radix), ctx),
  ),
  core(
    "int>num",
    "( int -- num )",
    "conversion",
    "Convert to a float. A bigint int is E_COERCE.",
    (n: Int) => {
      if (typeof n === "bigint") {
        throw coerceError("int", "num", "integer is outside the exactly representable range");
      }
      return n;
    },
  ),
  core(
    "num>int",
    "( num -- int )",
    "conversion",
    "Convert an integral float to an int; otherwise E_COERCE.",
    (x: number) => {
      if (!Number.isInteger(x)) throw coerceError("num", "int", "number is not integral");
      return integral(x);
    },
  ),
  core(
    "floor",
    "( number -- int )",
    "conversion",
    "Round toward negative infinity.",
    (a: Value) => {
      const x = asNumber(a, 0);
      return x.tag === "int" ? x.v : integral(Math.floor(x.v));
    },
  ),
  core("ceil", "( number -- int )", "conversion", "Round toward positive infinity.", (a: Value) => {
    const x = asNumber(a, 0);
    return x.tag === "int" ? x.v : integral(Math.ceil(x.v));
  }),
  core(
    "round",
    "( number -- int )",
    "conversion",
    "Round to the nearest int, halves away from zero.",
    (a: Value) => {
      const x = asNumber(a, 0);
      return x.tag === "int" ? x.v : integral(roundHalfAway(x.v));
    },
  ),
  core("str>bytes", "( str -- bytes )", "conversion", "UTF-8 encoding, strict.", (s: string) => {
    return coerce(str(s), "bytes").v;
  }),
  core(
    "bytes>str",
    "( bytes -- str )",
    "conversion",
    "UTF-8 decoding, strict.",
    (b: Uint8Array) => {
      return coerce(bytes(b), "str").v;
    },
  ),
  core(
    "latin1>bytes",
    "( str -- bytes )",
    "conversion",
    "One byte per code point. A code point above U+00FF is E_RANGE.",
    (s: string) => {
      const cps = codePoints(s);
      const out = new Uint8Array(cps.length);
      cps.forEach((cp, i) => {
        if (cp > 0xff) throw rangeError(`code point U+${cp.toString(16)} is above U+00FF`, { cp });
        out[i] = cp;
      });
      return out;
    },
  ),
  core(
    "bytes>latin1",
    "( bytes -- str )",
    "conversion",
    "One code point (U+0000..U+00FF) per byte.",
    (b: Uint8Array, ctx: PrimitiveContext) => {
      guard(ctx, 2 * b.length, "str");
      let out = "";
      for (let i = 0; i < b.length; i += CHUNK) {
        out += String.fromCharCode(...b.subarray(i, i + CHUNK));
      }
      return out;
    },
  ),
  core(
    "bytes>hex",
    "( bytes -- str )",
    "conversion",
    "Lowercase hex without separators.",
    (b: Uint8Array, ctx: PrimitiveContext) => {
      guard(ctx, 4 * b.length, "str");
      const parts = new Array<string>(b.length);
      for (let i = 0; i < b.length; i++) parts[i] = HEX_PAIRS[b[i] as number] as string;
      return parts.join("");
    },
  ),
  core(
    "hex>bytes",
    "( str -- bytes )",
    "conversion",
    "Parse hex digits; ASCII whitespace is ignored. An odd digit count or a non-hex character " +
      "is E_COERCE.",
    (s: string) => {
      const digits = s.replace(/[ \t\n\v\f\r]/g, "");
      if (!/^[0-9a-fA-F]*$/.test(digits)) throw coerceError("str", "bytes", "non-hex character");
      if (digits.length % 2 !== 0) throw coerceError("str", "bytes", "odd number of hex digits");
      const out = new Uint8Array(digits.length / 2);
      for (let i = 0; i < out.length; i++) {
        out[i] =
          digitValue(digits.charCodeAt(2 * i)) * 16 + digitValue(digits.charCodeAt(2 * i + 1));
      }
      return out;
    },
  ),
  core(
    "str>codes",
    "( str -- list )",
    "conversion",
    "The code points of a str as a list of ints.",
    (s: string, ctx: PrimitiveContext) => {
      const cps = codePoints(s);
      guard(ctx, 16 * cps.length, "list");
      return cps.map((cp): Value => ({ tag: "int", v: cp }));
    },
  ),
  core(
    "codes>str",
    "( list -- str )",
    "conversion",
    "A str from a list of code-point ints. An invalid or surrogate value is E_RANGE, a non-int " +
      "element E_TYPE.",
    (items: readonly Value[], ctx: PrimitiveContext) => {
      const cps = new Array<number>(items.length);
      let units = 0;
      for (let i = 0; i < items.length; i++) {
        const it = items[i] as Value;
        if (it.tag !== "int") throw typeError("int", it.tag, undefined, { index: i });
        const v = it.v;
        if (typeof v === "bigint" || v < 0 || v > 0x10ffff || (v >= 0xd800 && v <= 0xdfff)) {
          throw rangeError(`${String(v)} is not a Unicode scalar value`, { index: i });
        }
        cps[i] = v;
        units += v > 0xffff ? 2 : 1;
      }
      guard(ctx, 2 * units, "str");
      let out = "";
      for (let i = 0; i < cps.length; i += CHUNK)
        out += String.fromCodePoint(...cps.slice(i, i + CHUNK));
      return out;
    },
  ),
  core(
    "bytes>list",
    "( bytes -- list )",
    "conversion",
    "The bytes as a list of ints 0..255.",
    (b: Uint8Array, ctx: PrimitiveContext) => {
      guard(ctx, 16 * b.length, "list");
      return Array.from(b, (x): Value => ({ tag: "int", v: x }));
    },
  ),
  core(
    "list>bytes",
    "( list -- bytes )",
    "conversion",
    "A bytes from a list of ints 0..255 (E_RANGE or E_TYPE otherwise).",
    (items: readonly Value[]) => {
      const out = new Uint8Array(items.length);
      for (let i = 0; i < items.length; i++) {
        const it = items[i] as Value;
        if (it.tag !== "int") throw typeError("int", it.tag, undefined, { index: i });
        if (typeof it.v === "bigint" || it.v < 0 || it.v > 255) {
          throw rangeError(`${String(it.v)} is not a byte`, { index: i });
        }
        out[i] = it.v;
      }
      return out;
    },
  ),

  // 13.6 control
  core("fail", "( str -- )", "control", "Raise E_USER with this message.", (message: string) => {
    throw new ForgeError({ code: "E_USER", message });
  }),
]);

/** The ordering class of a value for `sort`: numbers compare with numbers, and so on. */
function sortClass(v: Value): "number" | "str" | "bytes" {
  switch (v.tag) {
    case "int":
    case "num":
      return "number";
    case "str":
    case "bytes":
      return v.tag;
    default:
      throw typeError("number, str or bytes", v.tag, undefined, { word: "sort" });
  }
}

/**
 * The `core` words added by FL 0.2 (docs/LANGUAGE-0.2.md sections 11 to 13), kind P: `has-key?`,
 * `sort`, the maths words with `str>num`, and the typed failure words. `CORE_PRIMITIVES` stays the
 * 69 words of the v0.1 table.
 */
export const CORE_PRIMITIVES_V02: readonly PrimitiveDef[] = Object.freeze([
  core(
    "has-key?",
    "( record key:str -- bool )",
    "record",
    "True when the record has the key.",
    (rec: ReadonlyMap<string, Value>, key: string) => rec.has(key),
  ),
  core(
    "sort",
    "( list -- list )",
    "sequence",
    "A new list, stably ascending: all numbers, all strings (code point order) or all bytes " +
      "(lexicographic). Any other mixture or tag is E_TYPE.",
    (items: readonly Value[]) => {
      if (items.length < 2) return items.slice();
      const first = sortClass(items[0] as Value);
      for (let i = 1; i < items.length; i++) {
        const c = sortClass(items[i] as Value);
        if (c !== first) {
          throw typeError(first, (items[i] as Value).tag, undefined, { index: i, word: "sort" });
        }
      }
      return items.slice().sort(order);
    },
  ),
  ...NUMERIC_PRIMITIVES,
  core(
    "fail-coerce",
    "( reason:str -- )",
    "control",
    "Raise E_COERCE: the data cannot be read as the format. The same error as raise:coerce.",
    (reason: string) => {
      throw new ForgeError({
        code: "E_COERCE",
        message: `cannot convert str to bytes: ${reason}`,
        detail: { from: "str", to: "bytes", reason },
      });
    },
  ),
  core(
    "fail-range",
    "( reason:str -- )",
    "control",
    "Raise E_RANGE with the reason as the message: an argument has a bad value. The same error as raise:range.",
    (reason: string) => {
      throw new ForgeError({ code: "E_RANGE", message: reason, detail: {} });
    },
  ),
]);

/** Registers every primitive of `core` kind P into a registry. */
export function registerCorePrimitives(registry: PrimitiveRegistry): void {
  for (const def of CORE_PRIMITIVES) registry.define(def);
  for (const def of CORE_PRIMITIVES_V02) registry.define(def);
}
