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
 * FL values to plain JavaScript values and back, for the wave 7 text-format ops that hand a JSON document to a
 * JavaScript library (JPath, Jsonata) or build FL values out of a library's output (YAML). util-candidate:
 * to-js, from-js. This file is not in `prims/` because every file there is loaded as a vocabulary's primitive
 * module.
 *
 *  - `toJs`: str -> string, int -> number (a big integer beyond the safe range stays a bigint when `bigInts`),
 *    num -> number, bool -> boolean, a list -> an array, a record -> an object with no prototype (so a key such as
 *    `__proto__` or `constructor` is an ordinary own key), the json null sentinel -> null. bytes, quotations and
 *    files have no JSON form (E_TYPE). Nesting deeper than `MAX_DEPTH` is E_LIMIT_VALUE, as in the json words.
 *  - `fromJs`: the reverse. A number is an `int` when it is a safe integer, else a `num` (NaN and the
 *    infinities are E_COERCE: no JSON text holds them), a bigint is an `int`, null is the json null sentinel,
 *    undefined inside an array or object is skipped like JSON.stringify skips it (null inside an array), and a
 *    JSONata function (an object marked `_jsonata_lambda` or `_jsonata_function`) is E_COERCE. A lone
 *    surrogate in a string is E_COERCE (the json words refuse them, and the null sentinel's key is one). The size
 *    of what is built is held to `ctx.limits.maxValueBytes` while it grows.
 */
import { ForgeError, valueHelpers } from "@forge/lang";
import type { PrimitiveContext, Value } from "@forge/lang";
import { MAX_DEPTH, NULL_KEY } from "./prims/json.js";
import { coerceFailure, limitFailure } from "./prim-util.js";

const { int, num, str, bool, list, normaliseInt } = valueHelpers;

export { MAX_DEPTH };

/** The json null sentinel as a value. */
export function nullValue(): Value {
  return { tag: "record", v: new Map<string, Value>([[NULL_KEY, bool(true)]]) };
}

/** True for the json null sentinel. */
export function isNullValue(v: Value): boolean {
  if (v.tag !== "record") return false;
  const m = v.v as ReadonlyMap<string, Value>;
  return m.size === 1 && m.has(NULL_KEY);
}

export function depthFailure(what: string): ForgeError {
  return new ForgeError({
    code: "E_LIMIT_VALUE",
    message: `${what} nested deeper than ${MAX_DEPTH} levels`,
    detail: { limit: "jsonDepth", max: MAX_DEPTH },
  });
}

/** An FL value as a plain JavaScript value (see the file comment). */
export function toJs(value: Value, bigInts: boolean): unknown {
  function conv(v: Value, depth: number): unknown {
    switch (v.tag) {
      case "str":
        return v.v as string;
      case "int": {
        const n = v.v;
        if (typeof n === "bigint") return bigInts ? n : Number(n);
        return n;
      }
      case "num":
        return v.v as number;
      case "bool":
        return v.v as boolean;
      case "list": {
        if (depth >= MAX_DEPTH) throw depthFailure("value");
        const items = v.v as readonly Value[];
        const out: unknown[] = new Array<unknown>(items.length);
        for (let i = 0; i < items.length; i++) out[i] = conv(items[i] as Value, depth + 1);
        return out;
      }
      case "record": {
        if (isNullValue(v)) return null;
        if (depth >= MAX_DEPTH) throw depthFailure("value");
        const out = Object.create(null) as Record<string, unknown>;
        for (const [k, item] of v.v as ReadonlyMap<string, Value>) out[k] = conv(item, depth + 1);
        return out;
      }
      default:
        throw new ForgeError({
          code: "E_TYPE",
          message: `a ${v.tag} has no JSON form (convert bytes to hex or base64 text first)`,
          detail: { tag: v.tag },
        });
    }
  }
  return conv(value, 0);
}

/** True when the string holds a lone surrogate. */
export function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
      else return true;
    } else if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
}

/** A plain JavaScript value as an FL value (see the file comment). */
export function fromJs(x: unknown, ctx: PrimitiveContext): Value {
  const max = ctx.limits.maxValueBytes;
  const maxIntBits = ctx.limits.maxIntBits;
  let size = 0;
  const account = (n: number): void => {
    size += n;
    if (size > max) throw limitFailure("maxValueBytes", max, size, "result value");
  };
  function checkText(s: string): void {
    if (hasLoneSurrogate(s)) {
      throw coerceFailure(
        "value",
        "FL value",
        "a string holds a lone surrogate, which no UTF-8 text can hold",
      );
    }
  }
  function conv(v: unknown, depth: number): Value {
    if (v === null) {
      account(40);
      return nullValue();
    }
    switch (typeof v) {
      case "string":
        checkText(v);
        account(2 * v.length);
        return str(v);
      case "number":
        if (!Number.isFinite(v)) {
          throw coerceFailure(
            "value",
            "FL value",
            "a number is not finite (NaN and the infinities have no JSON form)",
          );
        }
        account(8);
        return Number.isSafeInteger(v) ? int(v) : num(v);
      case "bigint": {
        const bits = (v < 0n ? -v : v).toString(2).length;
        if (bits > maxIntBits) throw limitFailure("maxIntBits", maxIntBits, bits, "integer bits");
        account(Math.ceil(bits / 8) + 1);
        return { tag: "int", v: normaliseInt(v) };
      }
      case "boolean":
        account(1);
        return bool(v);
      case "object": {
        if (depth >= MAX_DEPTH) throw depthFailure("result");
        if (Array.isArray(v)) {
          const items: Value[] = [];
          for (let i = 0; i < v.length; i++) {
            account(8);
            const item: unknown = v[i];
            items.push(
              item === undefined || typeof item === "function"
                ? nullValue()
                : conv(item, depth + 1),
            );
          }
          return list(items);
        }
        if ("_jsonata_lambda" in v || "_jsonata_function" in v) {
          throw coerceFailure("value", "FL value", "a function has no JSON form");
        }
        const m = new Map<string, Value>();
        account(16);
        for (const k of Object.keys(v)) {
          const item = (v as Record<string, unknown>)[k];
          if (item === undefined || typeof item === "function") continue;
          checkText(k);
          account(16 + 2 * k.length);
          m.set(k, conv(item, depth + 1));
        }
        return { tag: "record", v: m };
      }
      default:
        throw coerceFailure("value", "FL value", `a ${typeof v} has no JSON form`);
    }
  }
  return conv(x, 0);
}
