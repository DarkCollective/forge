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
 * The one JSON implementation (LANGUAGE-0.3.md section 7, work package L3): the core words `json>value` and
 * `value>json`, and the two functions behind them, `jsonToValue` and `valueToJson`, which `@forge/ops`
 * wraps (its `json:parse` and `json:stringify`) so that there is no second reader or writer.
 *
 * A bare FL loop over the code points of a 64 KiB text costs 5.5 VM steps a character, so both words are
 * primitives (one step each). JSON `null` is `ext{null}` (section 7.2). The two functions take one optional
 * hook each so that `@forge/ops`, whose ten data-format vocabularies still hold null as a sentinel record
 * until the L12 sweep, can reuse them without a copy: `makeNull` builds the value a JSON `null` reads as,
 * and `isSentinel` names a record the writer must write as `null`.
 */
import { ForgeError } from "../errors.js";
import { definePrimitive } from "../primitives.js";
import { CORE_VOCAB } from "../dictionary.js";
import { nullValue } from "../ext.js";
import type { PrimitiveContext, PrimitiveDef, Value } from "../types.js";
import { bool, int, list, normaliseInt, num, str } from "../values.js";

const limitFailure = (limit: string, max: number, value: number, what: string): ForgeError =>
  new ForgeError({
    code: "E_LIMIT_VALUE",
    message: `${what} of ${value} exceeds the limit of ${max}`,
    detail: { limit, max, value },
  });

const coerceFailure = (from: string, to: string, reason: string): ForgeError =>
  new ForgeError({
    code: "E_COERCE",
    message: `cannot convert ${from} to ${to}: ${reason}`,
    detail: { from, to, reason },
  });

const rangeFailure = (message: string, detail: Record<string, unknown>): ForgeError =>
  new ForgeError({ code: "E_RANGE", message, detail });

function noJsonForm(what: string, tag: string): ForgeError {
  return new ForgeError({
    code: "E_TYPE",
    message: `${what} has no JSON form (convert bytes to hex or base64 text first)`,
    detail: { tag },
  });
}

/** Containers nested deeper than this are E_LIMIT_VALUE, in `parse` and in `stringify`. */
export const JSON_MAX_DEPTH = 512;
/** The largest indent `stringify` accepts. */
export const JSON_MAX_INDENT = 32;
function depthFailure(max: number, what: string): ForgeError {
  return new ForgeError({
    code: "E_LIMIT_VALUE",
    message: `${what} nested deeper than ${max} levels`,
    detail: { limit: "jsonDepth", max },
  });
}

// ---------------------------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------------------------

const WS = (c: number) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09;
const isDigit = (c: number) => c >= 0x30 && c <= 0x39;
const hexVal = (c: number) =>
  c >= 0x30 && c <= 0x39
    ? c - 0x30
    : c >= 0x61 && c <= 0x66
      ? c - 0x57
      : c >= 0x41 && c <= 0x46
        ? c - 0x37
        : -1;

export function jsonToValue(
  text: string,
  ctx: PrimitiveContext,
  makeNull: () => Value = nullValue,
): Value {
  const s = text;
  const n = s.length;
  const maxBytes = ctx.limits.maxValueBytes;
  const maxIntBits = ctx.limits.maxIntBits;
  let i = 0;
  let size = 0;

  /** E_COERCE naming the place (offset in code points, line and column, both counted from 1). */
  function fail(at: number, reason: string): never {
    let cp = 0;
    let line = 1;
    let col = 1;
    for (let k = 0; k < at; k++) {
      const c = s.charCodeAt(k);
      if (c >= 0xd800 && c <= 0xdbff && k + 1 < at) k++;
      cp++;
      if (c === 0x0a) {
        line++;
        col = 1;
      } else col++;
    }
    throw new ForgeError({
      code: "E_COERCE",
      message: `cannot convert str to JSON value: ${reason} at offset ${cp} (line ${line}, column ${col})`,
      detail: { from: "str", to: "json", reason, offset: cp, line, column: col },
    });
  }

  function describe(at: number): string {
    if (at >= n) return "unexpected end of input";
    const cp = s.codePointAt(at) as number;
    if (cp > 0x20 && cp < 0x7f) return `unexpected character '${String.fromCharCode(cp)}'`;
    return `unexpected character U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
  }

  function account(bytes: number): void {
    size += bytes;
    if (size > maxBytes) throw limitFailure("maxValueBytes", maxBytes, size, "parsed JSON value");
  }

  function skipWs(): void {
    while (i < n && WS(s.charCodeAt(i))) i++;
  }

  function parseString(): string {
    // s[i] is the opening quote
    const start = i;
    i++;
    let out = "";
    let from = i;
    for (;;) {
      if (i >= n) fail(start, "unterminated string");
      const c = s.charCodeAt(i);
      if (c === 0x22) {
        out += s.slice(from, i);
        i++;
        return out;
      }
      if (c < 0x20) fail(i, "control character in string");
      if (c === 0x5c) {
        out += s.slice(from, i);
        const e = s.charCodeAt(i + 1);
        let r: string | null = null;
        switch (e) {
          case 0x22:
            r = '"';
            break;
          case 0x5c:
            r = "\\";
            break;
          case 0x2f:
            r = "/";
            break;
          case 0x62:
            r = "\b";
            break;
          case 0x66:
            r = "\f";
            break;
          case 0x6e:
            r = "\n";
            break;
          case 0x72:
            r = "\r";
            break;
          case 0x74:
            r = "\t";
            break;
          case 0x75: {
            const cu = hex4(i + 2);
            if (cu < 0) fail(i, "bad \\u escape");
            if (cu >= 0xd800 && cu <= 0xdbff) {
              if (s.charCodeAt(i + 6) === 0x5c && s.charCodeAt(i + 7) === 0x75) {
                const lo = hex4(i + 8);
                if (lo >= 0xdc00 && lo <= 0xdfff) {
                  out += String.fromCharCode(cu, lo);
                  i += 12;
                  from = i;
                  continue;
                }
              }
              fail(i, "lone surrogate escape");
            }
            if (cu >= 0xdc00 && cu <= 0xdfff) fail(i, "lone surrogate escape");
            out += String.fromCharCode(cu);
            i += 6;
            from = i;
            continue;
          }
          default:
            fail(i, i + 1 >= n ? "unterminated string" : "bad escape");
        }
        out += r;
        i += 2;
        from = i;
        continue;
      }
      if (c >= 0xd800 && c <= 0xdfff) {
        const d = s.charCodeAt(i + 1);
        if (c <= 0xdbff && d >= 0xdc00 && d <= 0xdfff) {
          i += 2;
          continue;
        }
        fail(i, "lone surrogate in string");
      }
      i++;
    }
  }

  function hex4(at: number): number {
    if (at + 4 > n) return -1;
    let v = 0;
    for (let k = 0; k < 4; k++) {
      const h = hexVal(s.charCodeAt(at + k));
      if (h < 0) return -1;
      v = v * 16 + h;
    }
    return v;
  }

  function parseNumber(): Value {
    const start = i;
    if (s.charCodeAt(i) === 0x2d) i++;
    const d0 = s.charCodeAt(i);
    if (d0 === 0x30) i++;
    else if (d0 >= 0x31 && d0 <= 0x39) while (isDigit(s.charCodeAt(i))) i++;
    else fail(i, `${describe(i)} in number`);
    const intEnd = i;
    let isInt = true;
    if (s.charCodeAt(i) === 0x2e) {
      i++;
      if (!isDigit(s.charCodeAt(i))) fail(i, "digits expected after the decimal point");
      while (isDigit(s.charCodeAt(i))) i++;
      isInt = false;
    }
    const e = s.charCodeAt(i);
    if (e === 0x65 || e === 0x45) {
      i++;
      const sg = s.charCodeAt(i);
      if (sg === 0x2b || sg === 0x2d) i++;
      if (!isDigit(s.charCodeAt(i))) fail(i, "digits expected in the exponent");
      while (isDigit(s.charCodeAt(i))) i++;
      isInt = false;
    }
    const lit = s.slice(start, i);
    if (isInt) {
      const digits = intEnd - start - (s.charCodeAt(start) === 0x2d ? 1 : 0);
      if (digits <= 15) {
        account(8);
        return int(Number(lit));
      }
      // refuse before converting a number that cannot fit maxIntBits (3.32 bits a digit)
      if (digits * 3.32 > maxIntBits + 8) {
        throw limitFailure("maxIntBits", maxIntBits, Math.ceil(digits * 3.32), "JSON integer bits");
      }
      const big = BigInt(lit);
      const bits = (big < 0n ? -big : big).toString(2).length;
      if (bits > maxIntBits)
        throw limitFailure("maxIntBits", maxIntBits, bits, "JSON integer bits");
      account(Math.ceil(bits / 8) + 1);
      return { tag: "int", v: normaliseInt(big) };
    }
    const v = Number(lit);
    if (!Number.isFinite(v)) fail(start, "number out of range");
    account(8);
    return num(v);
  }

  function literal(word: string, value: () => Value): Value {
    if (s.startsWith(word, i)) {
      i += word.length;
      return value();
    }
    return fail(i, describe(i));
  }

  function parseValue(depth: number): Value {
    skipWs();
    if (i >= n) fail(i, "unexpected end of input");
    const c = s.charCodeAt(i);
    if (c === 0x7b) {
      if (depth >= JSON_MAX_DEPTH) throw depthFailure(JSON_MAX_DEPTH, "JSON text");
      i++;
      const m = new Map<string, Value>();
      account(16);
      skipWs();
      if (s.charCodeAt(i) === 0x7d) {
        i++;
        return { tag: "record", v: m };
      }
      for (;;) {
        skipWs();
        if (s.charCodeAt(i) !== 0x22)
          fail(i, `${describe(i)}, an object key (a string) was expected`);
        const keyAt = i;
        const key = parseString();
        if (m.has(key)) fail(keyAt, "duplicate object key");
        skipWs();
        if (s.charCodeAt(i) !== 0x3a) fail(i, `${describe(i)}, ':' was expected`);
        i++;
        account(16 + key.length * 2);
        m.set(key, parseValue(depth + 1));
        skipWs();
        const d = s.charCodeAt(i);
        if (d === 0x2c) {
          i++;
          continue;
        }
        if (d === 0x7d) {
          i++;
          return { tag: "record", v: m };
        }
        fail(i, `${describe(i)}, ',' or '}' was expected`);
      }
    }
    if (c === 0x5b) {
      if (depth >= JSON_MAX_DEPTH) throw depthFailure(JSON_MAX_DEPTH, "JSON text");
      i++;
      const items: Value[] = [];
      skipWs();
      if (s.charCodeAt(i) === 0x5d) {
        i++;
        return list(items);
      }
      for (;;) {
        account(8);
        items.push(parseValue(depth + 1));
        skipWs();
        const d = s.charCodeAt(i);
        if (d === 0x2c) {
          i++;
          continue;
        }
        if (d === 0x5d) {
          i++;
          return list(items);
        }
        fail(i, `${describe(i)}, ',' or ']' was expected`);
      }
    }
    if (c === 0x22) {
      const v = parseString();
      account(v.length * 2);
      return str(v);
    }
    if (c === 0x2d || isDigit(c)) return parseNumber();
    if (c === 0x74) return literal("true", () => (account(1), bool(true)));
    if (c === 0x66) return literal("false", () => (account(1), bool(false)));
    if (c === 0x6e) return literal("null", () => (account(40), makeNull()));
    return fail(i, describe(i));
  }

  const v = parseValue(0);
  skipWs();
  if (i < n) fail(i, `${describe(i)} after the end of the value`);
  return v;
}

// ---------------------------------------------------------------------------------------------
// stringify
// ---------------------------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex -- the control characters are what this finds
const NEEDS_ESCAPE = /[\u0000-\u001f"\\\ud800-\udfff]/;
const SHORT: Readonly<Record<number, string>> = {
  0x22: '\\"',
  0x5c: "\\\\",
  0x08: "\\b",
  0x0c: "\\f",
  0x0a: "\\n",
  0x0d: "\\r",
  0x09: "\\t",
};

function quote(s: string): string {
  if (!NEEDS_ESCAPE.test(s)) return `"${s}"`;
  let out = '"';
  for (let k = 0; k < s.length; k++) {
    const c = s.charCodeAt(k);
    const short = SHORT[c];
    if (short !== undefined) out += short;
    else if (c < 0x20) out += `\\u${c.toString(16).padStart(4, "0")}`;
    else if (c >= 0xd800 && c <= 0xdfff) {
      const d = s.charCodeAt(k + 1);
      if (c <= 0xdbff && d >= 0xdc00 && d <= 0xdfff) {
        out += s[k] as string;
        out += s[k + 1] as string;
        k++;
      } else {
        throw coerceFailure(
          "str",
          "JSON text",
          "a string holds a lone surrogate, which no UTF-8 text can hold",
        );
      }
    } else out += s[k] as string;
  }
  return `${out}"`;
}

function numberText(v: number): string {
  const t = String(v);
  if (Object.is(v, -0)) return "-0.0";
  return /^-?\d+$/.test(t) ? `${t}.0` : t;
}

export function valueToJson(
  value: Value,
  indent: bigint | number,
  ctx: PrimitiveContext,
  isSentinel?: (v: Value) => boolean,
): string {
  const w = Number(indent);
  if (!Number.isInteger(w) || w < 0 || w > JSON_MAX_INDENT) {
    throw rangeFailure(`the indent must be from 0 to ${JSON_MAX_INDENT}`, {
      indent: String(indent),
    });
  }
  const max = ctx.limits.maxValueBytes;
  const colon = w > 0 ? ": " : ":";
  let out = "";
  const check = () => {
    if (out.length * 2 > max) throw limitFailure("maxValueBytes", max, out.length * 2, "JSON text");
  };
  const pad = (level: number) => `\n${" ".repeat(w * level)}`;

  function emit(v: Value, level: number): void {
    switch (v.tag) {
      case "str":
        out += quote(v.v as string);
        break;
      case "int":
        out += String(v.v);
        break;
      case "num":
        out += numberText(v.v as number);
        break;
      case "bool":
        out += (v.v as boolean) ? "true" : "false";
        break;
      case "list": {
        const items = v.v as readonly Value[];
        if (level >= JSON_MAX_DEPTH) throw depthFailure(JSON_MAX_DEPTH, "value");
        if (items.length === 0) {
          out += "[]";
          break;
        }
        out += "[";
        for (let k = 0; k < items.length; k++) {
          if (k > 0) out += ",";
          if (w > 0) out += pad(level + 1);
          emit(items[k] as Value, level + 1);
          check();
        }
        if (w > 0) out += pad(level);
        out += "]";
        break;
      }
      case "ext":
        if (v.kind !== "null") throw noJsonForm(`an ext value of kind ${v.kind}`, v.tag);
        out += "null";
        break;
      case "record": {
        if (isSentinel?.(v) === true) {
          out += "null";
          break;
        }
        const m = v.v as ReadonlyMap<string, Value>;
        if (level >= JSON_MAX_DEPTH) throw depthFailure(JSON_MAX_DEPTH, "value");
        if (m.size === 0) {
          out += "{}";
          break;
        }
        out += "{";
        let first = true;
        for (const [key, item] of m) {
          if (!first) out += ",";
          first = false;
          if (w > 0) out += pad(level + 1);
          out += quote(key);
          out += colon;
          emit(item, level + 1);
          check();
        }
        if (w > 0) out += pad(level);
        out += "}";
        break;
      }
      default:
        throw noJsonForm(`a ${v.tag}`, v.tag);
    }
  }

  emit(value, 0);
  check();
  return out;
}

export const JSON_PRIMITIVES: readonly PrimitiveDef[] = Object.freeze([
  definePrimitive(
    CORE_VOCAB,
    "json>value",
    "( text:str -- any )",
    (text: string, ctx: PrimitiveContext) => jsonToValue(text, ctx),
    {
      category: "conversion",
      doc: "Strict RFC 8259 JSON text to a value: object to record (keys in the order written; a repeated key is E_COERCE), array to list, string to str, a number written with only an optional minus and digits to an exact int, any other number to num (out of the double range is E_COERCE; an int over maxIntBits is E_LIMIT_VALUE), true and false to bool, null to the null value (ext{null}). Surrounding white space is allowed; a byte order mark, a comment, a trailing comma, a lone surrogate or any text after the value is E_COERCE with detail { offset, line, column, reason }. Nesting deeper than 512 is E_LIMIT_VALUE.",
    },
  ),
  definePrimitive(
    CORE_VOCAB,
    "value>json",
    "( value:any indent:int -- str )",
    (value: Value, indent: number | bigint, ctx: PrimitiveContext) =>
      valueToJson(value, indent, ctx),
    {
      category: "conversion",
      doc: "A value as JSON text: compact for an indent of 0, else that many spaces per level (1 to 32; E_RANGE otherwise), with a space after each colon. int is exact; num is the shortest text that reads back as the same number and always has a fraction or an exponent (100.0, -0.0, 1e+21); the null value is null. bytes, quotations, files and every ext value but null have no JSON form (E_TYPE); a lone surrogate in a string is E_COERCE; nesting deeper than 512 is E_LIMIT_VALUE.",
    },
  ),
]);
