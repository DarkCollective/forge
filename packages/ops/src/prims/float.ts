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
 * float primitives: one IEEE 754 number to and from its bytes. The core has no way to reinterpret
 * float bits, no way to parse decimal text to a float, and its `num` cannot hold NaN or an
 * infinity, so the conversion has to go through text. The words `float:encode` and `float:decode`
 * (vocab/float.fth) do the splitting, the looping and the parameters in FL.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { coerceFailure } from "../prim-util.js";

const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const SPECIAL = /^([+-]?)(?:(nan)|(inf(?:inity)?))$/i;

/** Decimal text (or NaN, Infinity, with an optional sign, any case) to a JS number. */
export function parseNumber(text: string): number {
  const special = SPECIAL.exec(text);
  if (special) {
    if (special[2]) return Number.NaN;
    return special[1] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  }
  if (!DECIMAL.test(text)) {
    throw coerceFailure("str", "bytes", `'${text.slice(0, 40)}' is not a decimal number`);
  }
  return Number(text);
}

/** The bytes of one number as binary32 (size 32) or binary64 (size 64). */
export function pack(text: string, size: number, little: boolean): Uint8Array {
  const x = parseNumber(text);
  const out = new Uint8Array(size / 8);
  const view = new DataView(out.buffer);
  // A number written as digits that overflows the format is an error; written as Infinity it is not.
  const digits = DECIMAL.test(text);
  if (size === 32) {
    const f = Math.fround(x);
    if (digits && !Number.isFinite(f)) {
      throw coerceFailure("str", "bytes", `'${text.slice(0, 40)}' is out of range for binary32`);
    }
    view.setFloat32(0, f, little);
  } else {
    if (digits && !Number.isFinite(x)) {
      throw coerceFailure("str", "bytes", `'${text.slice(0, 40)}' is out of range for binary64`);
    }
    view.setFloat64(0, x, little);
  }
  return out;
}

/** The shortest decimal text that reads back as the same binary32 value. */
function shortest32(x: number): string {
  for (let p = 1; p <= 9; p++) {
    const s = x.toPrecision(p);
    if (Math.fround(Number(s)) === x) return String(Number(s));
  }
  return String(x);
}

/** One number's bytes (4 or 8) to its shortest round-trip decimal text. */
export function unpack(data: Uint8Array, little: boolean): string {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const x = data.length === 4 ? view.getFloat32(0, little) : view.getFloat64(0, little);
  if (Number.isNaN(x)) return "NaN";
  if (Object.is(x, -0)) return "-0";
  if (!Number.isFinite(x)) return x > 0 ? "Infinity" : "-Infinity";
  return data.length === 4 ? shortest32(x) : String(x);
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "float",
    "_pack",
    "( text:str size:int little:bool -- bytes )",
    (text: string, size: number, little: boolean) => pack(text, size, little),
    {
      doc: "One decimal number (or NaN, Infinity) as 4 or 8 IEEE 754 bytes (private helper of float:encode).",
      category: "Encodings",
    },
  ),
  definePrimitive(
    "float",
    "_unpack",
    "( data:bytes little:bool -- str )",
    (data: Uint8Array, little: boolean) => unpack(data, little),
    {
      doc: "4 or 8 IEEE 754 bytes as the shortest decimal text that reads back the same (private helper of float:decode).",
      category: "Encodings",
    },
  ),
];
