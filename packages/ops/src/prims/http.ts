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
 * http primitive: `_dechunk ( data -- bytes )`, the chunked transfer coding of RFC 9112 section 7.1.
 *
 * Why a primitive: each chunk's position depends on the size before it, and FL has no mutable buffer, so
 * collecting the data of n chunks grows a value n times. Measured in FL on the untrusted limits (5 million
 * steps, 256 MiB of total allocation): appending a 6-byte chunk to a bytes value 10,900 times (the number of
 * chunks in 64 KiB) stops with E_LIMIT_TOTAL (268,474,780 bytes allocated against the 268,435,456 limit) after
 * 0.2 s, and appending an offset to a list 13,000 times does the same after 2.4 s (5,000 appends take 1.9 s).
 *
 * What it reads (strictly, as the recipient of RFC 9112 may, but accepting a bare LF where CRLF is expected,
 * section 2.2): chunk-size in hex digits, optional chunk extensions after a semicolon (skipped), the line end,
 * that many bytes, the line end; a chunk size of 0 ends the chunks; the trailer fields (lines, skipped) and
 * the empty line that ends the message. Nothing may follow it. A length is only compared with the bytes that
 * are left, so nothing is allocated from it; the output is never longer than the input.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef } from "@forge/lang";
import { coerceFailure, limitFailure } from "../prim-util.js";

const LF = 0x0a;
const CR = 0x0d;

function fail(reason: string) {
  return coerceFailure("chunked data", "bytes", reason);
}

function hexValue(b: number): number {
  if (b >= 0x30 && b <= 0x39) return b - 0x30;
  if (b >= 0x41 && b <= 0x46) return b - 0x41 + 10;
  if (b >= 0x61 && b <= 0x66) return b - 0x61 + 10;
  return -1;
}

/** The end of the line that starts at p (the offset of its LF), or -1 when there is no line end. */
function lineEnd(d: Uint8Array, p: number): number {
  const i = d.indexOf(LF, p);
  return i;
}

/**
 * Decodes a chunked body. `limit` is `maxValueBytes`; the result is never longer than `data`.
 */
export function dechunk(data: Uint8Array, limit: number): Uint8Array {
  if (data.length === 0) throw fail("the input is empty");
  const pieces: Array<[number, number]> = [];
  let total = 0;
  let p = 0;
  for (;;) {
    // chunk-size [ chunk-ext ] line end
    const lf = lineEnd(data, p);
    if (lf < 0)
      throw fail(
        `the chunk size line at offset ${p} has no line end (truncated, or not chunked data)`,
      );
    let q = p;
    let digits = 0;
    let size = 0;
    let tooBig = false;
    while (q < lf) {
      const v = hexValue(data[q] as number);
      if (v < 0) break;
      if (size > 0 || v > 0) {
        digits++;
        if (digits > 13) tooBig = true;
        else size = size * 16 + v;
      }
      q++;
    }
    if (q === p)
      throw fail(
        `the chunk size at offset ${p} is not hexadecimal (byte 0x${(data[p] ?? 0).toString(16).padStart(2, "0")})`,
      );
    // After the digits: white space then an extension, or the end of the line (with its CR).
    let r = q;
    while (r < lf && (data[r] === 0x20 || data[r] === 0x09)) r++;
    const end = lf > p && data[lf - 1] === CR ? lf - 1 : lf;
    if (r < end && data[r] !== 0x3b)
      throw fail(
        `the chunk size line at offset ${p} has an unexpected byte 0x${(data[r] as number).toString(16).padStart(2, "0")} after the size`,
      );
    for (let i = r; i < end; i++)
      if (data[i] === 0 || data[i] === CR)
        throw fail(`the chunk extension at offset ${i} holds a control character`);
    p = lf + 1;
    if (size === 0 && !tooBig) {
      // last-chunk: the trailer fields, then the empty line.
      for (;;) {
        const tl = lineEnd(data, p);
        if (tl < 0)
          throw fail(
            `the trailer at offset ${p} has no end: the empty line that closes the message is missing (truncated)`,
          );
        const content = tl > p && data[tl - 1] === CR ? tl - 1 : tl;
        const blank = content === p;
        p = tl + 1;
        if (blank) break;
      }
      if (p !== data.length)
        throw fail(
          `${data.length - p} bytes follow the last chunk and its trailer, at offset ${p}`,
        );
      break;
    }
    if (tooBig || size > data.length - p)
      throw fail(
        `the chunk at offset ${p} declares ${tooBig ? "a size too large to fit" : size + " bytes"} but only ${data.length - p} are left (truncated)`,
      );
    pieces.push([p, p + size]);
    total += size;
    p += size;
    // the line end after the data
    if (data[p] === CR && data[p + 1] === LF) p += 2;
    else if (data[p] === LF) p += 1;
    else if (p >= data.length)
      throw fail(`the chunk data ends at offset ${p} without its line end (truncated)`);
    else
      throw fail(
        `the chunk data at offset ${p} is not followed by a line end (byte 0x${(data[p] as number).toString(16).padStart(2, "0")})`,
      );
    if (p >= data.length)
      throw fail("the chunked data ends without the last chunk (size 0): truncated");
  }
  if (total > limit) throw limitFailure("maxValueBytes", limit, total, "the dechunked data");
  const out = new Uint8Array(total);
  let o = 0;
  for (const [a, b] of pieces) {
    out.set(data.subarray(a, b), o);
    o += b - a;
  }
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "http",
    "_dechunk",
    "( data:bytes -- bytes )",
    (data: Uint8Array, ctx: PrimitiveContext) => dechunk(data, ctx.limits.maxValueBytes),
    {
      doc: "The data of a chunked HTTP body (RFC 9112 section 7.1): the chunks joined, the extensions and the trailer fields skipped. Malformed or cut-short chunked data is E_COERCE with the offset (private helper of http:dechunk).",
    },
  ),
];
