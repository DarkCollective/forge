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
 * lznt1 primitive: the LZNT1 decompressor of [MS-XCA] section 2.5, written from that specification.
 * One private primitive, `_decompress ( data -- bytes )`. A prototype of the same decoder in FL (a
 * `while` loop per flag group, the output of each 4096-byte chunk grown with `cat`) decoded 64 KiB
 * in 0.1 to 0.3 s but cost 12 to 49 VM steps per output byte (1.0 to 3.2 million steps for 64 KiB),
 * which caps the output near 200 KB under the default step limit and near 100 KB for an untrusted
 * recipe, far below the 16 MiB value limit, so the match loop is a primitive (wave 6 conventions).
 * The vocabulary (vocab/lznt1.fth) keeps the op, its documentation and metadata.
 *
 * Output limit: every chunk expands to at most 4096 bytes, decoded into a private 4096-byte array
 * and then handed to `BoundedOutput`, which raises `E_LIMIT_VALUE` before the chunk that would pass
 * `maxValueBytes` is kept. Sizes are never read from the data to allocate anything.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef } from "@forge/lang";
import { BoundedOutput, coerceFailure, readU16LE } from "../prim-util.js";

/** The most a chunk can expand to (the uncompressed size of the last chunk is at most this). */
const CHUNK = 4096;

function corrupt(reason: string) {
  return coerceFailure("LZNT1 data", "bytes", reason);
}

/** The number of bits of `n` (0 for 0). */
function bitLength(n: number): number {
  return n === 0 ? 0 : 32 - Math.clz32(n);
}

/**
 * Decodes one compressed chunk, the bytes `from` to `end` of `data` (after the 2-byte header), into
 * `buf` and returns how many bytes it produced.
 */
function decodeChunk(data: Uint8Array, from: number, end: number, buf: Uint8Array): number {
  let u = 0;
  let q = from;
  while (q < end) {
    const flags = data[q++] as number;
    for (let bit = 0; bit < 8 && q < end; bit++) {
      if ((flags & (1 << bit)) === 0) {
        if (u >= CHUNK) throw corrupt("a chunk expands to more than 4096 bytes");
        buf[u++] = data[q++] as number;
        continue;
      }
      if (q + 2 > end) throw corrupt("a compressed word is cut short by the end of its chunk");
      const word = readU16LE(data, q);
      q += 2;
      if (u === 0) throw corrupt("a match refers to bytes before the start of the chunk");
      // D displacement bits and L = 16 - D length bits; D grows with the output so far (4 to 12).
      const d = Math.min(12, Math.max(4, bitLength(u - 1)));
      const lengthBits = 16 - d;
      const length = (word & ((1 << lengthBits) - 1)) + 3;
      const offset = (word >> lengthBits) + 1;
      if (offset > u) throw corrupt("a match refers to bytes before the start of the chunk");
      if (u + length > CHUNK) throw corrupt("a chunk expands to more than 4096 bytes");
      // One byte at a time: the match may run into bytes it has just written.
      for (let i = 0; i < length; i++, u++) buf[u] = buf[u - offset] as number;
    }
  }
  return u;
}

/** Decompresses an LZNT1 buffer; never produces more than `maxOut` bytes. */
export function lznt1Decompress(data: Uint8Array, maxOut: number): Uint8Array {
  const output = new BoundedOutput(maxOut);
  const buf = new Uint8Array(CHUNK);
  let p = 0;
  while (p < data.length) {
    if (p + 2 > data.length) throw corrupt("the data ends inside a chunk header (truncated)");
    const header = readU16LE(data, p);
    if (header === 0) break; // End_of_buffer; whatever follows is ignored
    const signature = (header >> 12) & 7;
    if (signature !== 3)
      throw corrupt(
        `bad chunk header: the signature is ${signature}, not 3 (header ${header.toString(16)})`,
      );
    const size = (header & 0xfff) + 3; // the whole chunk, header included
    if (p + size > data.length)
      throw corrupt(
        `the data ends inside a chunk (truncated): the header gives ${size} bytes, ${data.length - p} remain`,
      );
    if ((header & 0x8000) === 0) {
      output.push(data.slice(p + 2, p + size));
    } else {
      const produced = decodeChunk(data, p + 2, p + size, buf);
      output.push(buf.slice(0, produced));
    }
    p += size;
  }
  return output.finish();
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "lznt1",
    "_decompress",
    "( data:bytes -- bytes )",
    (data: Uint8Array, ctx: PrimitiveContext) => lznt1Decompress(data, ctx.limits.maxValueBytes),
    {
      doc: "Decompress an LZNT1 buffer (MS-XCA 2.5). Stops at the value limit with E_LIMIT_VALUE (private helper of lznt1:decompress).",
      category: "Compression",
    },
  ),
];
