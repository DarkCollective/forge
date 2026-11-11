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
 * rison primitives: Rison, O-Rison and A-Rison (the compact JSON-in-URLs syntax of Nanonid's rison.js,
 * github.com/Nanonid/rison, written from its grammar and its encoder rules). A per-character scanner is far too
 * slow in FL (5.5 VM steps a character before any state, see json.ts), so the reader and the writer are
 * primitives; the JSON text side and the parameters are FL.
 *
 *  - `_encode ( value:any mode:str -- str )`: mode "rison", "o-rison" (an object, without its outer parentheses)
 *    or "a-rison" (an array, without `!(` and `)`). null is `!n`, true and false `!t` and `!f`, numbers as
 *    JavaScript prints them with the `+` of an exponent dropped (an integer in full digits), strings bare when
 *    they are identifiers and else in single quotes with `!` and `'` doubled by `!`, arrays `!(a,b)`, objects
 *    `(k:v,k:v)` with the keys sorted by UTF-16 code unit as rison.js does. A string with a lone surrogate, bytes
 *    and nesting deeper than 64 are E_COERCE; o-rison of a non-object and a-rison of a non-array are E_COERCE.
 *  - `_decode ( text:str mode:str -- any )`: the inverse. White space is not allowed except around the whole text.
 *    Numbers without fraction or exponent are ints (exact), others nums; a repeated key, an unknown `!x`, a bad
 *    number, an unterminated string or list, a text after the value and nesting deeper than 64 are E_COERCE
 *    naming the position.
 */
import { ForgeError, definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef, Value } from "@forge/lang";
import {
  MAX_DEPTH,
  Meter,
  intValue,
  isNullValue,
  nullValue,
  writeFailure,
} from "../data-format-util.js";
import { limitFailure } from "../prim-util.js";

const { num, str, bool, list } = valueHelpers;

const NOT_IDCHAR = " '!:(),*@$";
const NOT_IDSTART = "-0123456789";

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";

function isIdentifier(s: string): boolean {
  if (s === "") return false;
  if (NOT_IDSTART.includes(s[0] as string) || NOT_IDCHAR.includes(s[0] as string)) return false;
  for (let i = 1; i < s.length; i++) if (NOT_IDCHAR.includes(s[i] as string)) return false;
  return true;
}

function quote(s: string): string {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00)
      i++;
    else if (c >= 0xd800 && c <= 0xdfff)
      throw writeFailure("Rison", "a string holds a lone surrogate");
  }
  if (s === "") return "''";
  if (isIdentifier(s)) return s;
  return `'${s.replace(/['!]/g, (m) => `!${m}`)}'`;
}

function encode(value: Value, mode: string, ctx: PrimitiveContext): string {
  if (mode !== "rison" && mode !== "o-rison" && mode !== "a-rison")
    throw new ForgeError({
      code: "E_RANGE",
      message: `the mode must be rison, o-rison or a-rison, not ${mode}`,
    });
  const max = ctx.limits.maxValueBytes;
  let total = 0;
  const account = (n: number) => {
    total += n;
    if (total > max) throw limitFailure("maxValueBytes", max, total, "encoded Rison text");
  };

  function enc(v: Value, depth: number): string {
    if (depth > MAX_DEPTH) throw writeFailure("Rison", `nesting deeper than ${MAX_DEPTH} levels`);
    switch (v.tag) {
      case "int":
        return String(v.v);
      case "num":
        return String(v.v).replace("+", "");
      case "bool":
        return v.v ? "!t" : "!f";
      case "str": {
        account(v.v.length);
        return quote(v.v);
      }
      case "list": {
        const parts = (v.v as readonly Value[]).map((x) => enc(x, depth + 1));
        account(parts.length * 2);
        return `!(${parts.join(",")})`;
      }
      case "record": {
        if (isNullValue(v)) return "!n";
        const m = v.v as ReadonlyMap<string, Value>;
        const keys = Array.from(m.keys()).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        const parts = keys.map((k) => `${quote(k)}:${enc(m.get(k) as Value, depth + 1)}`);
        account(parts.length * 2);
        return `(${parts.join(",")})`;
      }
      default:
        throw writeFailure("Rison", `a ${v.tag} has no JSON form`);
    }
  }

  if (mode === "o-rison") {
    if (value.tag !== "record" || isNullValue(value))
      throw writeFailure("Rison", "O-Rison writes an object, but the JSON is not one");
    const s = enc(value, 0);
    return s.slice(1, -1);
  }
  if (mode === "a-rison") {
    if (value.tag !== "list")
      throw writeFailure("Rison", "A-Rison writes an array, but the JSON is not one");
    const s = enc(value, 0);
    return s.slice(2, -1);
  }
  const out = enc(value, 0);
  account(out.length);
  return out;
}

function decode(text: string, mode: string, ctx: PrimitiveContext): Value {
  if (mode !== "rison" && mode !== "o-rison" && mode !== "a-rison")
    throw new ForgeError({
      code: "E_RANGE",
      message: `the mode must be rison, o-rison or a-rison, not ${mode}`,
    });
  const s = text.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
  const meter = new Meter(ctx.limits.maxValueBytes, "decoded Rison value");
  const maxIntBits = ctx.limits.maxIntBits;
  let i = 0;

  function fail(reason: string, at: number = i): ForgeError {
    let cp = 0;
    for (let k = 0; k < at; k++) {
      const c = s.charCodeAt(k);
      if (c >= 0xd800 && c <= 0xdbff && k + 1 < at) k++;
      cp++;
    }
    return new ForgeError({
      code: "E_COERCE",
      message: `cannot read Rison text: ${reason} at offset ${cp}`,
      detail: { from: "str", to: "Rison", reason, offset: cp },
    });
  }
  const here = () =>
    i < s.length ? `'${String.fromCodePoint(s.codePointAt(i) as number)}'` : "the end of the text";

  function string(): string {
    // s[i] is the opening quote
    const start = i;
    i++;
    let out = "";
    for (;;) {
      if (i >= s.length) throw fail("unterminated string", start);
      const c = s[i] as string;
      if (c === "'") {
        i++;
        meter.add(2 * out.length + 16);
        return out;
      }
      if (c === "!") {
        const n = s[i + 1];
        if (n === "!" || n === "'") {
          out += n;
          i += 2;
          continue;
        }
        throw fail("a '!' in a string must be followed by '!' or a quote", i);
      }
      out += c;
      i++;
    }
  }

  function identifier(): string {
    const start = i;
    while (i < s.length && !NOT_IDCHAR.includes(s[i] as string)) i++;
    if (i === start) throw fail(`unexpected ${here()}`);
    const id = s.slice(start, i);
    meter.add(2 * id.length + 16);
    return id;
  }

  function number(): Value {
    const start = i;
    if (s[i] === "-") i++;
    const d0 = i;
    while (isDigit(s[i])) i++;
    if (i === d0) throw fail("a number needs digits", start);
    let frac = false;
    if (s[i] === ".") {
      const f0 = ++i;
      while (isDigit(s[i])) i++;
      if (i === f0) throw fail("a number needs digits after the point", start);
      frac = true;
    }
    if (s[i] === "e" || s[i] === "E") {
      i++;
      if (s[i] === "+" || s[i] === "-") i++;
      const e0 = i;
      while (isDigit(s[i])) i++;
      if (i === e0) throw fail("a number needs digits in the exponent", start);
      frac = true;
    }
    if (i < s.length && !NOT_IDCHAR.includes(s[i] as string) && s[i] !== undefined)
      throw fail(`unexpected ${here()} after a number`);
    const t = s.slice(start, i);
    meter.add(24);
    if (!frac) {
      if (t.length * 3.32 > maxIntBits + 8) throw fail("an integer is too large", start);
      return intValue(BigInt(t), maxIntBits);
    }
    const x = Number(t);
    if (!Number.isFinite(x)) throw fail("a number is out of range", start);
    return num(x);
  }

  function key(): string {
    const c = s[i];
    if (c === "'") return string();
    if (c !== undefined && (c === "-" || isDigit(c))) {
      const at = i;
      const v = number();
      if (v.tag === "int") return String(v.v);
      if (v.tag === "num") return String(v.v);
      throw fail("a bad key", at);
    }
    return identifier();
  }

  function members(depth: number, end: string | undefined): Value {
    const m = new Map<string, Value>();
    if (end !== undefined && s[i] === end) {
      i++;
      return { tag: "record", v: m };
    }
    if (end === undefined && i >= s.length) return { tag: "record", v: m };
    for (;;) {
      const ka = i;
      const k = key();
      if (s[i] !== ":") throw fail(`expected ':' after the key but found ${here()}`);
      i++;
      if (m.has(k)) throw fail(`the key ${JSON.stringify(k)} is repeated`, ka);
      m.set(k, value(depth + 1));
      meter.add(16 + 2 * k.length);
      if (s[i] === ",") {
        i++;
        continue;
      }
      if (end !== undefined && s[i] === end) {
        i++;
        return { tag: "record", v: m };
      }
      if (end === undefined && i >= s.length) return { tag: "record", v: m };
      throw fail(
        `expected ',' or ${end === undefined ? "the end" : `'${end}'`} but found ${here()}`,
      );
    }
  }

  function items(depth: number, end: string | undefined): Value {
    const out: Value[] = [];
    if (end !== undefined && s[i] === end) {
      i++;
      return list(out);
    }
    if (end === undefined && i >= s.length) return list(out);
    for (;;) {
      out.push(value(depth + 1));
      meter.add(8);
      if (s[i] === ",") {
        i++;
        continue;
      }
      if (end !== undefined && s[i] === end) {
        i++;
        return list(out);
      }
      if (end === undefined && i >= s.length) return list(out);
      throw fail(
        `expected ',' or ${end === undefined ? "the end" : `'${end}'`} but found ${here()}`,
      );
    }
  }

  function value(depth: number): Value {
    if (depth > MAX_DEPTH) throw fail(`nesting deeper than ${MAX_DEPTH} levels`);
    if (i >= s.length) throw fail("unexpected end of text");
    meter.add(24);
    const c = s[i] as string;
    if (c === "!") {
      const n = s[i + 1];
      if (n === "t") {
        i += 2;
        return bool(true);
      }
      if (n === "f") {
        i += 2;
        return bool(false);
      }
      if (n === "n") {
        i += 2;
        return nullValue();
      }
      if (n === "(") {
        i += 2;
        return items(depth, ")");
      }
      throw fail("unknown '!' form (expected !t, !f, !n or !()");
    }
    if (c === "(") {
      i++;
      return members(depth, ")");
    }
    if (c === "'") return str(string());
    if (c === "-" || isDigit(c)) return number();
    return str(identifier());
  }

  let v: Value;
  if (mode === "o-rison") v = members(0, undefined);
  else if (mode === "a-rison") v = items(0, undefined);
  else {
    if (s === "") throw fail("the text is empty", 0);
    v = value(0);
  }
  if (i < s.length) throw fail(`unexpected ${here()} after the value`);
  return v;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("rison", "_encode", "( value:any mode:str -- str )", encode, {
    doc: "A JSON value as Rison, O-Rison or A-Rison text (private helper of rison:encode).",
    category: "Data format",
  }),
  definePrimitive("rison", "_decode", "( text:str mode:str -- any )", decode, {
    doc: "Rison, O-Rison or A-Rison text as a JSON value (private helper of rison:decode).",
    category: "Data format",
  }),
];
