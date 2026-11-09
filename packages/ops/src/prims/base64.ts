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
 * base64 primitives (RFC 4648). `vocab/base64.fth` adds the parameter help.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef } from "@forge/lang";
import { coerceFailure, guardResult, isAsciiSpace } from "../prim-util.js";

const STANDARD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const URL_SAFE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function reverseTable(alphabet: string): Int8Array {
  const table = new Int8Array(256).fill(-1);
  for (let i = 0; i < alphabet.length; i++) table[alphabet.charCodeAt(i)] = i;
  return table;
}

const STANDARD_TABLE = reverseTable(STANDARD);
const URL_TABLE = reverseTable(URL_SAFE);

function fail(reason: string) {
  return coerceFailure("str", "bytes", reason);
}

function hexByte(byte: number): string {
  return "0x" + byte.toString(16).padStart(2, "0");
}

/** Decodes base64 text (as ASCII bytes). Whitespace is ignored; padding is optional but must be right. */
function decode(data: Uint8Array, alphabet: string): Uint8Array {
  const table = alphabet === "url" ? URL_TABLE : STANDARD_TABLE;
  const sextets = new Uint8Array(data.length);
  let n = 0;
  let pad = 0;
  for (const byte of data) {
    if (isAsciiSpace(byte)) continue;
    if (byte === 0x3d) {
      pad++;
      continue;
    }
    if (pad > 0) throw fail("data after the padding");
    const v = table[byte] as number;
    if (v < 0) throw fail(`byte ${hexByte(byte)} is not in the ${alphabet} alphabet`);
    sextets[n++] = v;
  }
  const rest = n % 4;
  if (rest === 1) throw fail("a single character cannot be the end of base64 data");
  if (pad > 2 || (pad > 0 && (n + pad) % 4 !== 0)) throw fail("incorrect padding");
  if (rest === 2 && ((sextets[n - 1] as number) & 0x0f) !== 0) {
    throw fail("non-zero bits after the end of the data");
  }
  if (rest === 3 && ((sextets[n - 1] as number) & 0x03) !== 0) {
    throw fail("non-zero bits after the end of the data");
  }
  const out = new Uint8Array(Math.floor((n * 6) / 8));
  let o = 0;
  let i = 0;
  for (; i + 4 <= n; i += 4) {
    const a = sextets[i] as number;
    const b = sextets[i + 1] as number;
    const c = sextets[i + 2] as number;
    const d = sextets[i + 3] as number;
    out[o++] = (a << 2) | (b >> 4);
    out[o++] = ((b & 0x0f) << 4) | (c >> 2);
    out[o++] = ((c & 0x03) << 6) | d;
  }
  if (rest >= 2) {
    const a = sextets[i] as number;
    const b = sextets[i + 1] as number;
    out[o++] = (a << 2) | (b >> 4);
    if (rest === 3) out[o] = ((b & 0x0f) << 4) | ((sextets[i + 2] as number) >> 2);
  }
  return out;
}

const CHUNK_BYTES = 3 * 4096;

function encode(data: Uint8Array, alphabet: string, padding: boolean, ctx: PrimitiveContext) {
  const chars = alphabet === "url" ? URL_SAFE : STANDARD;
  const full = Math.floor(data.length / 3);
  const rest = data.length - full * 3;
  const length = full * 4 + (rest === 0 ? 0 : padding ? 4 : rest + 1);
  guardResult(ctx, 2 * length, "base64 text");
  const parts: string[] = [];
  for (let start = 0; start < full * 3; start += CHUNK_BYTES) {
    const stop = Math.min(start + CHUNK_BYTES, full * 3);
    let part = "";
    for (let i = start; i < stop; i += 3) {
      const n =
        ((data[i] as number) << 16) | ((data[i + 1] as number) << 8) | (data[i + 2] as number);
      part +=
        chars.charAt(n >> 18) +
        chars.charAt((n >> 12) & 63) +
        chars.charAt((n >> 6) & 63) +
        chars.charAt(n & 63);
    }
    parts.push(part);
  }
  const at = full * 3;
  if (rest === 1) {
    const n = (data[at] as number) << 16;
    parts.push(chars.charAt(n >> 18) + chars.charAt((n >> 12) & 63) + (padding ? "==" : ""));
  } else if (rest === 2) {
    const n = ((data[at] as number) << 16) | ((data[at + 1] as number) << 8);
    parts.push(
      chars.charAt(n >> 18) +
        chars.charAt((n >> 12) & 63) +
        chars.charAt((n >> 6) & 63) +
        (padding ? "=" : ""),
    );
  }
  return parts.join("");
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "base64",
    "decode",
    "( bytes alphabet:choice{standard|url}=standard -- bytes )",
    (data: Uint8Array, alphabet: string) => decode(data, alphabet),
    {
      doc: "Decode base64 text (RFC 4648). White space is ignored and padding is optional.",
      category: "Encodings",
    },
  ),
  definePrimitive(
    "base64",
    "encode",
    "( bytes alphabet:choice{standard|url}=standard padding:bool=true -- str )",
    (data: Uint8Array, alphabet: string, padding: boolean, ctx: PrimitiveContext) =>
      encode(data, alphabet, padding, ctx),
    { doc: "Encode bytes as base64 text (RFC 4648).", category: "Encodings" },
  ),
];
