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
 * Value helpers (spec sections 3, 4, 5.5, 5.6 and 10.8): constructors, integer normal form,
 * equality, printing, the coercion table, constraint validation, metering, and code-point string
 * helpers. Implements `ValueHelpers` from types.ts.
 *
 * Everything that walks a value tree (equals, repr, sizeOf) is iterative, so deeply nested lists
 * cannot overflow the JS call stack.
 */

import { ForgeError, REDACTED } from "./errors.js";
import type {
  CoercionRecord,
  Constraint,
  Limits,
  ParamType,
  StackSlot,
  Tag,
  Value,
  ValueHelpers,
} from "./types.js";

// The package builds against ES2022 only (no DOM or Node typings), so declare the two globals used.
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  decode(input?: Uint8Array): string;
}

const utf8Encoder = new TextEncoder();
/** Strict: malformed input throws; `ignoreBOM: true` keeps a leading U+FEFF in the output. */
const utf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// ---------------------------------------------------------------------------------------------
// Code-point string helpers (spec 3.1 "String order", decision D30)
// ---------------------------------------------------------------------------------------------

function isHigh(u: number): boolean {
  return u >= 0xd800 && u <= 0xdbff;
}

function isLow(u: number): boolean {
  return u >= 0xdc00 && u <= 0xdfff;
}

/** Number of code points of `s`. A lone surrogate counts as one code point. */
export function cpLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (isHigh(s.charCodeAt(i)) && i + 1 < s.length && isLow(s.charCodeAt(i + 1))) i++;
    n++;
  }
  return n;
}

/** The code points of `s` as numbers. */
export function codePoints(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length;) {
    const cp = s.codePointAt(i) as number;
    out.push(cp);
    i += cp > 0xffff ? 2 : 1;
  }
  return out;
}

/** Compare two strings by code point (not by UTF-16 code unit). Returns -1, 0 or 1. */
export function cpCompare(a: string, b: string): -1 | 0 | 1 {
  const la = a.length;
  const lb = b.length;
  let i = 0;
  let j = 0;
  while (i < la && j < lb) {
    const ca = a.codePointAt(i) as number;
    const cb = b.codePointAt(j) as number;
    if (ca !== cb) return ca < cb ? -1 : 1;
    i += ca > 0xffff ? 2 : 1;
    j += cb > 0xffff ? 2 : 1;
  }
  if (i < la) return 1;
  if (j < lb) return -1;
  return 0;
}

/**
 * UTF-16 offset of the code point with index `index` (0 <= index <= cpLength). `index === cpLength`
 * gives `s.length`. Returns -1 when out of range.
 */
export function cpOffset(s: string, index: number): number {
  if (!Number.isInteger(index) || index < 0) return -1;
  let off = 0;
  let n = 0;
  while (n < index) {
    if (off >= s.length) return -1;
    off += (s.codePointAt(off) as number) > 0xffff ? 2 : 1;
    n++;
  }
  return off;
}

/** The code point at code-point index `index`, or undefined when out of range. */
export function cpAt(s: string, index: number): number | undefined {
  const off = cpOffset(s, index);
  if (off < 0 || off >= s.length) return undefined;
  return s.codePointAt(off);
}

/** Substring of code points `[from, to)`. Indices are clamped to the string. */
export function cpSlice(s: string, from: number, to?: number): string {
  const start = cpOffset(s, Math.max(0, from));
  if (start < 0) return "";
  if (to === undefined) return s.slice(start);
  const end = cpOffset(s, Math.max(0, to));
  return end < 0 ? s.slice(start) : s.slice(start, Math.max(start, end));
}

/** True when `s` contains a surrogate code unit that is not part of a valid pair. */
export function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const u = s.charCodeAt(i);
    if (isHigh(u)) {
      if (i + 1 < s.length && isLow(s.charCodeAt(i + 1))) i++;
      else return true;
    } else if (isLow(u)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Integers (spec 3.2)
// ---------------------------------------------------------------------------------------------

const MAX_SAFE_BIG = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIG = BigInt(Number.MIN_SAFE_INTEGER);

/** Bit length of the magnitude of an integer (0 has bit length 0). */
export function intBitLength(n: number | bigint): number {
  const abs = typeof n === "bigint" ? (n < 0n ? -n : n) : BigInt(Math.abs(n));
  if (abs === 0n) return 0;
  const hex = abs.toString(16);
  return (hex.length - 1) * 4 + (32 - Math.clz32(parseInt(hex[0] as string, 16)));
}

/**
 * Normal form of an integer: a `number` iff it is a safe integer, else a `bigint`; `-0` becomes
 * `0`. With `maxIntBits`, a magnitude of more bits raises E_LIMIT_VALUE. A non-integral or
 * non-finite `number` is a caller bug and raises E_INTERNAL.
 */
export function normaliseInt(n: number | bigint, maxIntBits?: number): number | bigint {
  let r: number | bigint;
  if (typeof n === "number") {
    if (!Number.isInteger(n)) {
      throw new ForgeError({
        code: "E_INTERNAL",
        message: `normaliseInt: ${String(n)} is not an integer`,
      });
    }
    r = Number.isSafeInteger(n) ? (n === 0 ? 0 : n) : BigInt(n);
  } else {
    r = n >= MIN_SAFE_BIG && n <= MAX_SAFE_BIG ? Number(n) : n;
  }
  if (maxIntBits !== undefined) {
    const bits = intBitLength(r);
    if (bits > maxIntBits) {
      throw new ForgeError({
        code: "E_LIMIT_VALUE",
        message: `integer of ${bits} bits exceeds maxIntBits ${maxIntBits}`,
        detail: { limit: maxIntBits, value: bits },
      });
    }
  }
  return r;
}

// ---------------------------------------------------------------------------------------------
// Constructors (spec 3.1). They take ownership of their arguments; nothing is copied.
// ---------------------------------------------------------------------------------------------

export function int(n: number | bigint, maxIntBits?: number): Value {
  return { tag: "int", v: normaliseInt(n, maxIntBits) };
}

/** `num` payloads must be finite (spec 3.2); anything else is E_RANGE. */
export function num(n: number): Value {
  if (!Number.isFinite(n)) {
    throw new ForgeError({
      code: "E_RANGE",
      message: `non-finite float result: ${String(n)}`,
    });
  }
  return { tag: "num", v: n };
}

export function str(s: string): Value {
  return { tag: "str", v: s };
}

export function bytes(b: Uint8Array): Value {
  return { tag: "bytes", v: b };
}

export function bool(b: boolean): Value {
  return { tag: "bool", v: b };
}

export function list(items: readonly Value[]): Value {
  return { tag: "list", v: items };
}

export function record(entries: Iterable<readonly [string, Value]>): Value {
  const m = new Map<string, Value>();
  for (const [k, v] of entries) m.set(k, v);
  return { tag: "record", v: m };
}

/** A copy of a `bytes` value carrying the `secret` mark (spec 10.14); other values are returned as is. */
export function markSecret(value: Value): Value {
  return value.tag === "bytes" ? { tag: "bytes", v: value.v, secret: true } : value;
}

export function isSecret(value: Value): boolean {
  return value.tag === "bytes" && value.secret === true;
}

// ---------------------------------------------------------------------------------------------
// Equality (spec 3.1)
// ---------------------------------------------------------------------------------------------

function intEqualsNum(i: number | bigint, n: number): boolean {
  if (typeof i === "number") return i === n;
  return Number.isInteger(n) && BigInt(n) === i;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Structural equality `=`. The only cross-tag equality is `int` against `num`. Ignores `secret`. */
export function equals(a: Value, b: Value): boolean {
  const work: Value[] = [a, b];
  while (work.length > 0) {
    const y = work.pop() as Value;
    const x = work.pop() as Value;
    if (x === y) continue;
    if (x.tag === "int" && y.tag === "num") {
      if (!intEqualsNum(x.v, y.v)) return false;
      continue;
    }
    if (x.tag === "num" && y.tag === "int") {
      if (!intEqualsNum(y.v, x.v)) return false;
      continue;
    }
    if (x.tag !== y.tag) return false;
    switch (x.tag) {
      case "int":
        if (x.v !== (y as typeof x).v) return false;
        break;
      case "num":
      case "str":
      case "bool":
        if (x.v !== (y as typeof x).v) return false;
        break;
      case "bytes":
        if (!bytesEqual(x.v, (y as typeof x).v)) return false;
        break;
      case "quot":
        if (x.v !== (y as typeof x).v) return false;
        break;
      case "file": {
        const f = (y as typeof x).v;
        if (x.v.name !== f.name || x.v.type !== f.type || !bytesEqual(x.v.bytes, f.bytes)) {
          return false;
        }
        break;
      }
      case "list": {
        const ys = (y as typeof x).v;
        if (x.v.length !== ys.length) return false;
        for (let i = x.v.length - 1; i >= 0; i--) work.push(x.v[i] as Value, ys[i] as Value);
        break;
      }
      case "record": {
        const ym = (y as typeof x).v;
        if (x.v.size !== ym.size) return false;
        for (const [k, xv] of x.v) {
          const yv = ym.get(k);
          if (yv === undefined) return false;
          work.push(xv, yv);
        }
        break;
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Printing (spec 3.3)
// ---------------------------------------------------------------------------------------------

const HEX = "0123456789abcdef";

function hex2(n: number): string {
  return HEX[n >> 4] + (HEX[n & 15] as string);
}

/** Display form of a `num`: JS `String`, `.0` appended to integral results, `-0.0` for negative zero. */
function numText(n: number): string {
  if (Object.is(n, -0)) return "-0.0";
  const s = String(n);
  return /^-?\d+$/.test(s) ? s + ".0" : s;
}

/** The quoted, escaped form of a string (the `repr` of a `str`). */
export function quoteString(s: string): string {
  let out = '"';
  let run = 0;
  for (let i = 0; i < s.length; i++) {
    const u = s.charCodeAt(i);
    let esc: string | undefined;
    if (u === 0x5c) esc = "\\\\";
    else if (u === 0x22) esc = '\\"';
    else if (u === 0x0a) esc = "\\n";
    else if (u === 0x0d) esc = "\\r";
    else if (u === 0x09) esc = "\\t";
    else if (u === 0x00) esc = "\\0";
    else if (u < 0x20 || u === 0x7f) esc = "\\x" + hex2(u);
    if (esc !== undefined) {
      out += s.slice(run, i) + esc;
      run = i + 1;
    }
  }
  return out + s.slice(run) + '"';
}

function bytesText(b: Uint8Array, limit: number): string {
  if (b.length === 0) return "#[ ]";
  const n = Math.min(b.length, limit);
  let out = "#[";
  for (let i = 0; i < n; i++) out += " " + hex2(b[i] as number);
  return out + " ]";
}

interface ListCursor {
  readonly items: readonly Value[];
  i: number;
}
interface RecordCursor {
  readonly it: Iterator<[string, Value]>;
  first: boolean;
}
type Work = string | Value | ListCursor | RecordCursor;

function isListCursor(w: Work): w is ListCursor {
  return typeof w === "object" && "items" in w;
}
function isRecordCursor(w: Work): w is RecordCursor {
  return typeof w === "object" && "it" in w;
}

/**
 * Renders `value` in repr form. Stops early once more than `budget` UTF-16 units have been
 * produced (`complete` is then false), so that huge values are cheap to summarise.
 */
function render(value: Value, budget: number): { text: string; complete: boolean } {
  const out: string[] = [];
  let units = 0;
  const work: Work[] = [value];
  const emit = (s: string): boolean => {
    out.push(s);
    units += s.length;
    return units > budget;
  };
  while (work.length > 0) {
    const w = work.pop() as Work;
    let over = false;
    if (typeof w === "string") {
      over = emit(w);
    } else if (isListCursor(w)) {
      if (w.i >= w.items.length) {
        over = emit(" }");
      } else {
        if (w.i > 0) over = emit(" ");
        const item = w.items[w.i] as Value;
        w.i++;
        work.push(w, item);
      }
    } else if (isRecordCursor(w)) {
      const r = w.it.next();
      if (r.done) {
        over = emit(" }");
      } else {
        const [k, v] = r.value;
        if (!w.first) over = emit(" ");
        w.first = false;
        over = emit(quoteString(k.length > budget + 1 ? k.slice(0, budget + 1) : k) + ": ") || over;
        work.push(w, v);
      }
    } else {
      switch (w.tag) {
        case "str": {
          const s = w.v.length > budget + 1 ? w.v.slice(0, budget + 1) : w.v;
          over = emit(quoteString(s));
          break;
        }
        case "int":
          over = emit(String(w.v));
          break;
        case "num":
          over = emit(numText(w.v));
          break;
        case "bool":
          over = emit(w.v ? "true" : "false");
          break;
        case "bytes":
          over = emit(w.secret === true ? REDACTED : bytesText(w.v, Math.floor(budget / 3) + 1));
          break;
        case "quot":
          over = emit("<quot>");
          break;
        case "file":
          over = emit(
            `<file ${quoteString(w.v.name)} ${quoteString(w.v.type)} ${w.v.bytes.length} bytes>`,
          );
          break;
        case "list":
          if (w.v.length === 0) {
            over = emit("{ }");
          } else {
            over = emit("{ ");
            work.push({ items: w.v, i: 0 });
          }
          break;
        case "record":
          if (w.v.size === 0) {
            over = emit("record{ }");
          } else {
            over = emit("record{ ");
            work.push({ it: w.v.entries(), first: true });
          }
          break;
      }
    }
    if (over) return { text: out.join(""), complete: work.length === 0 };
  }
  return { text: out.join(""), complete: true };
}

/** Repr form: used inside containers, by `.s`, and by diagnostics. Secret bytes print `<redacted>`. */
export function repr(value: Value): string {
  return render(value, Infinity).text;
}

/** Display form: used by `.` on the top value. A `str` prints raw; everything else as its repr. */
export function display(value: Value): string {
  return value.tag === "str" ? value.v : repr(value);
}

/**
 * Repr cut to at most `max` code points (default 80, the `.s` rule): a longer repr becomes its
 * first `max - 3` code points followed by `...`.
 */
export function reprShort(value: Value, max = 80): string {
  const { text, complete } = render(value, 2 * max);
  if (complete && cpLength(text) <= max) return text;
  return cpSlice(text, 0, max - 3) + "...";
}

// ---------------------------------------------------------------------------------------------
// Coercion (spec 4.2)
// ---------------------------------------------------------------------------------------------

/** The tag a declared type resolves to; "any" and "number" accept several tags. */
export function runtimeTypeOf(type: ParamType): Tag | "any" | "number" {
  switch (type) {
    case "choice":
    case "regex":
    case "charset":
      return "str";
    case "toggle":
    case "key":
      return "bytes";
    default:
      return type;
  }
}

export interface CoerceResult {
  readonly value: Value;
  /** Set when the tag changed (the entry for `RunResult.coercions`, minus step/word/slot/name). */
  readonly coercion: Pick<CoercionRecord, "from" | "to"> | null;
}

function typeError(value: Value, to: ParamType, param?: string | number): ForgeError {
  const detail: Record<string, unknown> = { expected: to, actual: value.tag };
  if (param !== undefined) detail.param = param;
  return new ForgeError({
    code: "E_TYPE",
    message: `expected ${to}, got ${value.tag}`,
    detail,
  });
}

function coerceError(from: Tag, to: Tag, why: string, param?: string | number): ForgeError {
  const detail: Record<string, unknown> = { from, to };
  if (param !== undefined) detail.param = param;
  return new ForgeError({
    code: "E_COERCE",
    message: `cannot coerce ${from} to ${to}: ${why}`,
    detail,
  });
}

/**
 * Applies the coercion table to one value against a declared type and also reports whether the
 * tag changed. Throws E_TYPE (no coercion path) or E_COERCE (path exists, value fails it).
 * `param` (slot name or index) is only added to the error detail.
 */
export function coerceTracked(value: Value, to: ParamType, param?: string | number): CoerceResult {
  const target = runtimeTypeOf(to);
  if (target === "any") return { value, coercion: null };
  if (target === "number") {
    if (value.tag === "int" || value.tag === "num") return { value, coercion: null };
    throw typeError(value, to, param);
  }
  if (value.tag === target) return { value, coercion: null };
  const changed = (v: Value): CoerceResult => ({
    value: v,
    coercion: { from: value.tag, to: target },
  });
  if (value.tag === "str" && target === "bytes") {
    if (hasLoneSurrogate(value.v)) {
      throw coerceError("str", "bytes", "string contains a lone surrogate", param);
    }
    return changed(bytes(utf8Encoder.encode(value.v)));
  }
  if (value.tag === "bytes" && target === "str") {
    let text: string;
    try {
      text = utf8Decoder.decode(value.v);
    } catch {
      throw coerceError("bytes", "str", "bytes are not well-formed UTF-8", param);
    }
    return changed(str(text));
  }
  if (value.tag === "int" && target === "num") {
    if (typeof value.v === "bigint") {
      throw coerceError("int", "num", "integer is outside the exactly representable range", param);
    }
    return changed({ tag: "num", v: value.v });
  }
  if (value.tag === "num" && target === "int") {
    if (!Number.isInteger(value.v)) {
      throw coerceError("num", "int", "number is not integral", param);
    }
    return changed({ tag: "int", v: normaliseInt(value.v) });
  }
  throw typeError(value, to, param);
}

/** `CoerceFn`: the coerced value only. */
export function coerce(value: Value, to: ParamType, param?: string | number): Value {
  return coerceTracked(value, to, param).value;
}

// ---------------------------------------------------------------------------------------------
// Validation (spec 4.3, 5.5, 5.6)
// ---------------------------------------------------------------------------------------------

function boundsText(min: number | undefined, max: number | undefined): string {
  if (min !== undefined && max !== undefined) return min === max ? `${min}` : `${min}..${max}`;
  if (min !== undefined) return `${min}..`;
  if (max !== undefined) return `..${max}`;
  return "";
}

/**
 * Canonical text of a constraint (spec 12.3): `[` + comma-joined parts + `]`, value part, then
 * length part, then the `/pattern/`. An empty constraint renders as "".
 */
export function constraintText(c: Constraint | undefined): string {
  if (c === undefined) return "";
  const parts: string[] = [];
  if (c.oneOf !== undefined) parts.push(c.oneOf.join("|"));
  else parts.push(boundsText(c.min, c.max));
  if (c.lengthOneOf !== undefined) parts.push(c.lengthOneOf.join("|"));
  else parts.push(boundsText(c.minLength, c.maxLength));
  if (c.pattern !== undefined) parts.push(`/${c.pattern}/`);
  const used = parts.filter((p) => p !== "");
  return used.length === 0 ? "" : `[${used.join(",")}]`;
}

/** Canonical text of a `choice` / encoding option list: `{a|b}`; awkward options become string literals. */
export function optionsText(options: readonly string[]): string {
  return `{${options.map((o) => (/[\s|{}"]/.test(o) || o === "" ? quoteString(o) : o)).join("|")}}`;
}

function compareIntToNumber(v: number | bigint, bound: number): number {
  if (typeof v === "number") return v < bound ? -1 : v > bound ? 1 : 0;
  const b = BigInt(bound);
  return v < b ? -1 : v > b ? 1 : 0;
}

function valueInConstraint(v: number | bigint, c: Constraint): boolean {
  if (c.min !== undefined && compareIntToNumber(v, c.min) < 0) return false;
  if (c.max !== undefined && compareIntToNumber(v, c.max) > 0) return false;
  if (
    c.oneOf !== undefined &&
    !c.oneOf.some((x) => Number.isInteger(x) && compareIntToNumber(v, x) === 0)
  ) {
    return false;
  }
  return true;
}

function numInConstraint(v: number, c: Constraint): boolean {
  if (c.min !== undefined && v < c.min) return false;
  if (c.max !== undefined && v > c.max) return false;
  if (c.oneOf !== undefined && !c.oneOf.includes(v)) return false;
  return true;
}

function lengthInConstraint(n: number, c: Constraint): boolean {
  if (c.minLength !== undefined && n < c.minLength) return false;
  if (c.maxLength !== undefined && n > c.maxLength) return false;
  if (c.lengthOneOf !== undefined && !c.lengthOneOf.includes(n)) return false;
  return true;
}

const patternCache = new Map<string, RegExp>();

function wholeStringRegExp(source: string): RegExp {
  let re = patternCache.get(source);
  if (re === undefined) {
    try {
      re = new RegExp(`^(?:${source})$`, "u");
    } catch (cause) {
      throw new ForgeError({
        code: "E_INTERNAL",
        message: `constraint pattern does not compile: /${source}/`,
        cause,
      });
    }
    if (patternCache.size >= 256) patternCache.clear();
    patternCache.set(source, re);
  }
  return re;
}

function tagAllowed(type: ParamType, tag: Tag): boolean {
  const rt = runtimeTypeOf(type);
  if (rt === "any") return true;
  if (rt === "number") return tag === "int" || tag === "num";
  return rt === tag;
}

/**
 * `ValidateFn`: checks an already-coerced value against the slot's constraint, `choice` options,
 * `charset` and `regex` rules. Throws E_PARAM_INVALID with `detail { param, constraint, value }`
 * (`param` is the slot name, else `index`, else 0; `value` is the repr cut to 80 code points).
 * A value whose tag does not fit the slot's type is E_TYPE (defensive; coercion comes first).
 */
export function validate(
  value: Value,
  slot: StackSlot,
  limits: Readonly<Limits>,
  index?: number,
): void {
  if (!tagAllowed(slot.type, value.tag)) throw typeError(value, slot.type, slot.name ?? index);
  const c = slot.constraint;
  const fail = (constraint: string, why: string): never => {
    const param = slot.name ?? index ?? 0;
    const shown = reprShort(value);
    throw new ForgeError({
      code: "E_PARAM_INVALID",
      message: `parameter ${String(param)}: ${shown} ${why}`,
      detail: { param, constraint, value: shown },
    });
  };
  const checkLength = (n: number): void => {
    if (c !== undefined && !lengthInConstraint(n, c)) {
      fail(constraintText(c), `has length ${n}, violating ${constraintText(c)}`);
    }
  };

  switch (value.tag) {
    case "int":
      if (c !== undefined && !valueInConstraint(value.v, c)) {
        fail(constraintText(c), `violates ${constraintText(c)}`);
      }
      return;
    case "num":
      if (slot.type === "num" && c !== undefined && !numInConstraint(value.v, c)) {
        fail(constraintText(c), `violates ${constraintText(c)}`);
      }
      return;
    case "bytes":
      checkLength(value.v.length);
      return;
    case "list":
      checkLength(value.v.length);
      return;
    case "str":
      break;
    default:
      return;
  }

  // str-valued types: str, choice, regex, charset
  const s = value.v;
  switch (slot.type) {
    case "choice": {
      const options = slot.options ?? [];
      if (!options.includes(s)) fail(optionsText(options), "is not one of the options");
      return;
    }
    case "regex": {
      if (cpLength(s) > limits.maxRegexLength) {
        fail("regex", `is longer than ${limits.maxRegexLength} code points`);
      }
      try {
        new RegExp(s, "u");
      } catch {
        fail("regex", "is not a valid regular expression");
      }
      return;
    }
    case "charset": {
      const cps = codePoints(s);
      if (cps.length === 0) fail("charset", "is an empty charset");
      if (new Set(cps).size !== cps.length) fail("charset", "repeats a code point");
      checkLength(cps.length);
      return;
    }
    default:
      if (c !== undefined) {
        checkLength(cpLength(s));
        if (c.pattern !== undefined && !wholeStringRegExp(c.pattern).test(s)) {
          fail(constraintText(c), `does not match /${c.pattern}/`);
        }
      }
  }
}

// ---------------------------------------------------------------------------------------------
// Metering (spec 10.8)
// ---------------------------------------------------------------------------------------------

/**
 * Size of a value in bytes for the value and total limits: bytes `byteLength`; str 2 per UTF-16
 * unit; int 8 (number) or `ceil(bits/8)` (bigint); num 8; bool 1; quot 16; list 8 per element plus
 * element sizes; record 16 per entry plus key and value sizes; file name + type (as str) + bytes.
 */
export function sizeOf(value: Value): number {
  let total = 0;
  const work: Value[] = [value];
  while (work.length > 0) {
    const x = work.pop() as Value;
    switch (x.tag) {
      case "bytes":
        total += x.v.byteLength;
        break;
      case "str":
        total += 2 * x.v.length;
        break;
      case "int":
        total += typeof x.v === "bigint" ? Math.ceil(intBitLength(x.v) / 8) : 8;
        break;
      case "num":
        total += 8;
        break;
      case "bool":
        total += 1;
        break;
      case "quot":
        total += 16;
        break;
      case "file":
        total += 2 * x.v.name.length + 2 * x.v.type.length + x.v.bytes.byteLength;
        break;
      case "list":
        total += 8 * x.v.length;
        for (const item of x.v) work.push(item);
        break;
      case "record":
        total += 16 * x.v.size;
        for (const [k, v] of x.v) {
          total += 2 * k.length;
          work.push(v);
        }
        break;
    }
  }
  return total;
}

// ---------------------------------------------------------------------------------------------

export const valueHelpers: ValueHelpers = {
  int,
  num,
  str,
  bytes,
  bool,
  list,
  record,
  normaliseInt,
  coerce,
  validate,
  display,
  repr,
  equals,
  sizeOf,
};
