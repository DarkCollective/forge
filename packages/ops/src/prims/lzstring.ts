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
 * lz-string primitives (lz-string 1.5.0, MIT, pinned). The library defines the format, so it does the
 * compressing and the decompressing; this file only adapts representations and enforces the output
 * limit. Two private primitives:
 *
 *  - `_compress ( data:bytes format:str -- bytes )`
 *  - `_decompress ( data:bytes format:str -- bytes )`
 *
 * Representation. lz-string works on JavaScript strings, and its default `compress` output is a string
 * of arbitrary 16-bit code units, lone surrogates included, which Forge's strict UTF-8 text cannot
 * carry (CyberChef turns such a string into UTF-8 and silently corrupts it). So the formats are:
 *
 *  - `default`: the 16-bit code units as UCS-2 big-endian bytes, which is exactly the library's own
 *    `compressToUint8Array` (two bytes per unit, an even length);
 *  - `utf16`: `compressToUTF16`, whose units are U+0020 to U+8020 (never a surrogate), written as UTF-8;
 *  - `base64`: `compressToBase64`, ASCII;
 *  - `uri`: `compressToEncodedURIComponent`, ASCII.
 *
 * The input of `_compress` is text (strict UTF-8, E_COERCE otherwise); the output of `_decompress` is
 * the UTF-8 of the decompressed string (E_COERCE when it holds a lone surrogate, which only data that
 * did not come from valid text can).
 *
 * The output limit. `decompress` is one-shot and, being an LZ78 variant, expands quadratically (n
 * tokens can expand to about n squared / 2 characters), so a few kilobytes can ask for gigabytes.
 * Before the library is called, `measure` replays only the token structure of the stream with
 * lengths instead of strings (the same bit reader, quirks included) and raises `E_LIMIT_VALUE` as soon
 * as the output would pass `maxValueBytes` characters. So the library only ever builds a string of at
 * most `maxValueBytes` UTF-16 units (at most 2 x maxValueBytes bytes), and the UTF-8 form, at most 3 x that
 * in the worst case, is checked against the limit before the result is returned.
 */
import LZString from "lz-string";
import { definePrimitive } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef } from "@forge/lang";
import { bombFailure, coerceFailure, guardResult, rangeFailure } from "../prim-util.js";

// The package builds against ES2022 only (no DOM or Node typings), so declare the global used.
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  decode(input?: Uint8Array): string;
}

export type Format = "default" | "utf16" | "base64" | "uri";
export const FORMATS: readonly Format[] = ["default", "utf16", "base64", "uri"];

const KEY_BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
const KEY_URI = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$";

function checkFormat(format: string): Format {
  if (!(FORMATS as readonly string[]).includes(format))
    throw rangeFailure(`the LZString format must be one of ${FORMATS.join(", ")}, not ${format}`);
  return format as Format;
}

function decodeText(data: Uint8Array, what: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
  } catch {
    throw coerceFailure(what, "text", "the bytes are not valid UTF-8");
  }
}

/** Code units as big-endian byte pairs (the library's compressToUint8Array layout). */
function unitsToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const u = s.charCodeAt(i);
    out[2 * i] = u >>> 8;
    out[2 * i + 1] = u & 255;
  }
  return out;
}

function bytesToUnits(data: Uint8Array): string {
  const parts: string[] = [];
  const step = 8192;
  for (let i = 0; i < data.length; i += 2 * step) {
    const n = Math.min(step, (data.length - i) >> 1);
    const units = new Array<number>(n);
    for (let k = 0; k < n; k++)
      units[k] = (data[i + 2 * k] as number) * 256 + (data[i + 2 * k + 1] as number);
    parts.push(String.fromCharCode(...units));
  }
  return parts.join("");
}

/** Compresses text (UTF-8 bytes) to the bytes of a format. */
export function compress(data: Uint8Array, format: string, maxBytes: number): Uint8Array {
  const f = checkFormat(format);
  const text = decodeText(data, "LZString input");
  let out: Uint8Array;
  switch (f) {
    case "default":
      out = unitsToBytes(LZString.compress(text));
      break;
    case "utf16":
      out = new TextEncoder().encode(LZString.compressToUTF16(text));
      break;
    case "base64":
      out = new TextEncoder().encode(LZString.compressToBase64(text));
      break;
    case "uri":
      out = new TextEncoder().encode(LZString.compressToEncodedURIComponent(text));
      break;
  }
  if (out.length > maxBytes) throw bombFailure(maxBytes, out.length);
  return out;
}

/** What the replay of a stream found. */
export type Replay = "end" | "ran-out" | "bad-code";

/**
 * Replays the token structure of an lz-string stream, tracking only the length of each dictionary
 * entry, exactly as `LZString._decompress` reads it (same bit reader, same dictionary growth, same
 * ending rules), and throws `bombFailure` when the output would pass `max` characters.
 * `next(i)` is the library's getNextValue, `length` its length and `reset` its resetValue.
 */
export function measure(
  length: number,
  reset: number,
  next: (i: number) => number,
  max: number,
): { status: Replay; chars: number } {
  let val = next(0) | 0;
  let position = reset;
  let index = 1;
  const read = (n: number): number => {
    let bits = 0;
    for (let power = 1, top = 2 ** n; power !== top; power <<= 1) {
      const resb = val & position;
      position >>= 1;
      if (position === 0) {
        position = reset;
        val = next(index++) | 0;
      }
      if (resb > 0) bits |= power;
    }
    return bits;
  };
  // Entry lengths. Codes 0 to 2 are the controls; entry 3 on is a string (length 1 for a literal).
  const lens: number[] = [0, 0, 0];
  let enlargeIn = 4;
  let numBits = 3;
  let chars = 0;
  const first = read(2);
  if (first === 2) return { status: "end", chars };
  read(first === 0 ? 8 : 16);
  lens[3] = 1;
  let w = 1;
  chars = 1;
  for (;;) {
    if (index > length) return { status: "ran-out", chars };
    let c = read(numBits);
    if (c === 0 || c === 1) {
      read(c === 0 ? 8 : 16);
      lens.push(1);
      c = lens.length - 1;
      enlargeIn--;
    } else if (c === 2) {
      return { status: "end", chars };
    }
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
    let entry: number;
    const known = lens[c];
    if (known !== undefined && known > 0) entry = known;
    else if (c === lens.length) entry = w + 1;
    else return { status: "bad-code", chars };
    chars += entry;
    if (chars > max) throw bombFailure(max, chars);
    lens.push(w + 1);
    enlargeIn--;
    w = entry;
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
  }
}

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

function corrupt(reason: string) {
  return coerceFailure("LZString data", "text", reason);
}

/** The value of a character in an alphabet; a character outside it reads as 0, as in the library. */
function keyed(key: string, s: string, i: number): number {
  return Math.max(0, key.indexOf(s.charAt(i)));
}

/** Decompresses the bytes of a format to UTF-8 text bytes, never building more than `max` characters. */
export function decompress(data: Uint8Array, format: string, max: number): Uint8Array {
  const f = checkFormat(format);
  if (data.length === 0) throw corrupt("the input is empty");
  let units: string;
  let reset: number;
  let value: (s: string, i: number) => number;
  let run: (s: string) => string | null;
  if (f === "default") {
    if (data.length % 2 !== 0) throw corrupt("the input is not whole 16-bit units (odd length)");
    units = bytesToUnits(data);
    reset = 32768;
    value = (s, i) => s.charCodeAt(i);
    run = (s) => LZString.decompress(s);
  } else {
    units = decodeText(data, "LZString data");
    if (f === "utf16") {
      reset = 16384;
      value = (s, i) => s.charCodeAt(i) - 32;
      run = (s) => LZString.decompressFromUTF16(s);
    } else if (f === "base64") {
      reset = 32;
      value = (s, i) => keyed(KEY_BASE64, s, i);
      run = (s) => LZString.decompressFromBase64(s);
    } else {
      units = units.replace(/ /g, "+");
      reset = 32;
      value = (s, i) => keyed(KEY_URI, s, i);
      run = (s) => LZString.decompressFromEncodedURIComponent(s);
    }
  }
  const s = units;
  const { status, chars } = measure(s.length, reset, (i) => value(s, i), max);
  if (status === "ran-out") throw corrupt("the data ends before the end marker (truncated)");
  if (status === "bad-code")
    throw corrupt("a code refers to a dictionary entry that does not exist (corrupt data)");
  const text = run(s);
  if (text === null || text.length !== chars) throw corrupt("the data is not an LZString stream");
  if (LONE_SURROGATE.test(text))
    throw corrupt(
      "the decompressed text holds an unpaired UTF-16 surrogate, which cannot be written as UTF-8",
    );
  const out = new TextEncoder().encode(text);
  if (out.length > max) throw bombFailure(max, out.length);
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "lzstring",
    "_compress",
    "( data:bytes format:str -- bytes )",
    (data: Uint8Array, format: string, ctx: PrimitiveContext) => {
      const out = compress(data, format, ctx.limits.maxValueBytes);
      guardResult(ctx, out.length, "compressed data");
      return out;
    },
    {
      doc: "LZString-compress UTF-8 text in a format (default, utf16, base64, uri); lz-string 1.5.0 (private helper of lzstring:compress).",
      category: "Compression",
    },
  ),
  definePrimitive(
    "lzstring",
    "_decompress",
    "( data:bytes format:str -- bytes )",
    (data: Uint8Array, format: string, ctx: PrimitiveContext) =>
      decompress(data, format, ctx.limits.maxValueBytes),
    {
      doc: "LZString-decompress the bytes of a format to UTF-8 text; the output is capped at the value limit before the library runs (private helper of lzstring:decompress).",
      category: "Compression",
    },
  ),
];
