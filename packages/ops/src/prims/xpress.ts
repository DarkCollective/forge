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
 * xpress primitives: the two XPRESS decompressors of [MS-XCA], written from that specification.
 *
 *  - `_lz77 ( data -- bytes )`: Plain LZ77 (sections 2.3 and 2.4): 32-bit flag words, literals, and
 *    16-bit match words with the 4-bit, 8-bit, 16-bit and 32-bit length extensions.
 *  - `_huffman ( data -- bytes )`: LZ77+Huffman (sections 2.1 and 2.2): blocks of a 256-byte table
 *    of 512 four-bit code lengths followed by a bit stream read in 16-bit words.
 *
 * Both are primitives because they loop over every output byte (a prototype of the byte-oriented
 * LZNT1 decoder in FL cost 12 to 49 VM steps per byte and capped the output near 200 KB under the
 * default step limit, see src/prims/lznt1.ts; the Huffman decoder is bit-level and worse).
 *
 * Output limit: the output is a growable array that never exceeds `maxValueBytes`. Before a literal
 * is stored or a match is copied, the new size is checked and `E_LIMIT_VALUE` (`bombFailure`) is
 * raised if it would pass the limit, so a match length of billions (a 32-bit field) allocates and
 * copies nothing. No size in the data is trusted.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef } from "@forge/lang";
import { bombFailure, coerceFailure, readU16LE, readU32LE } from "../prim-util.js";

function corrupt(format: string, reason: string) {
  return coerceFailure(format, "bytes", reason);
}

/** An output array that grows as needed and never holds more than `max` bytes. */
class Output {
  private buf: Uint8Array;
  length = 0;

  constructor(private readonly max: number) {
    this.buf = new Uint8Array(Math.min(max, 65_536));
  }

  private grow(extra: number): void {
    const total = this.length + extra;
    if (total > this.max) throw bombFailure(this.max, total);
    const cap = Math.min(this.max, Math.max(this.buf.length * 2, total));
    const bigger = new Uint8Array(cap);
    bigger.set(this.buf.subarray(0, this.length));
    this.buf = bigger;
  }

  push(b: number): void {
    if (this.length >= this.buf.length) this.grow(1);
    this.buf[this.length++] = b;
  }

  /** Appends `n` bytes copied from `offset` bytes back (they may overlap their own output). */
  copy(offset: number, n: number): void {
    if (this.length + n > this.buf.length) this.grow(n);
    const b = this.buf;
    let at = this.length;
    const from = at - offset;
    if (offset >= n) b.copyWithin(at, from, from + n);
    else for (let i = 0; i < n; i++) b[at + i] = b[from + i] as number;
    at += n;
    this.length = at;
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

const PLAIN = "XPRESS data";

/** Decompresses Plain LZ77 (MS-XCA 2.4). */
export function xpressDecompress(data: Uint8Array, maxOut: number): Uint8Array {
  const out = new Output(maxOut);
  const n = data.length;
  let p = 0;
  let flags = 0;
  let flagCount = 0;
  let lastHalf = -1; // the position of the byte whose high nibble is the next 4-bit length, or -1
  const need = (bytes: number, what: string): void => {
    if (p + bytes > n) throw corrupt(PLAIN, `the data ends inside ${what} (truncated)`);
  };
  for (;;) {
    if (flagCount === 0) {
      need(4, "a flag word");
      flags = readU32LE(data, p);
      p += 4;
      flagCount = 32;
    }
    flagCount--;
    if (((flags >>> flagCount) & 1) === 0) {
      need(1, "a literal");
      out.push(data[p++] as number);
      continue;
    }
    if (p === n) return out.finish(); // a match flag with no input left: the end of the data
    need(2, "a match word");
    const word = readU16LE(data, p);
    p += 2;
    let length = word & 7;
    const offset = (word >> 3) + 1;
    if (length === 7) {
      if (lastHalf < 0) {
        need(1, "a match length");
        length = (data[p] as number) & 15;
        lastHalf = p;
        p++;
      } else {
        length = (data[lastHalf] as number) >> 4;
        lastHalf = -1;
      }
      if (length === 15) {
        need(1, "a match length");
        length = data[p++] as number;
        if (length === 255) {
          need(2, "a match length");
          length = readU16LE(data, p);
          p += 2;
          if (length === 0) {
            need(4, "a match length");
            length = readU32LE(data, p);
            p += 4;
          }
          if (length < 15 + 7)
            throw corrupt(PLAIN, `a match length field of ${length} is too small`);
          length -= 15 + 7;
        }
        length += 15;
      }
      length += 7;
    }
    length += 3;
    if (offset > out.length)
      throw corrupt(
        PLAIN,
        `a match refers to ${offset} bytes back but only ${out.length} bytes were written`,
      );
    out.copy(offset, length);
  }
}

const HUFF = "XPRESS Huffman data";
const SYMBOLS = 512;
const TABLE_BYTES = SYMBOLS / 2;
const MAX_BITS = 15;
const BLOCK = 65_536;

/** The decoding table of a block: 2^15 entries, each the symbol whose code starts with those 15 bits. */
function buildTable(data: Uint8Array, at: number, lengths: Uint8Array): Uint16Array {
  for (let i = 0; i < TABLE_BYTES; i++) {
    const b = data[at + i] as number;
    lengths[2 * i] = b & 15;
    lengths[2 * i + 1] = b >> 4;
  }
  const table = new Uint16Array(1 << MAX_BITS);
  let entry = 0;
  for (let bits = 1; bits <= MAX_BITS; bits++) {
    const count = 1 << (MAX_BITS - bits);
    for (let sym = 0; sym < SYMBOLS; sym++) {
      if (lengths[sym] !== bits) continue;
      if (entry + count > table.length)
        throw corrupt(
          HUFF,
          "the Huffman table is invalid: the code lengths over-subscribe the code space",
        );
      table.fill(sym, entry, entry + count);
      entry += count;
    }
  }
  if (entry !== table.length)
    throw corrupt(
      HUFF,
      "the Huffman table is invalid: the code lengths do not fill the code space (incomplete)",
    );
  return table;
}

/** Decompresses LZ77+Huffman (MS-XCA 2.2). */
export function xpressHuffmanDecompress(data: Uint8Array, maxOut: number): Uint8Array {
  const out = new Output(maxOut);
  const n = data.length;
  const lengths = new Uint8Array(SYMBOLS);
  let base = 0;
  let blocks = 0;
  for (;;) {
    const remaining = n - base;
    // A block is a 256-byte table and at least the two 16-bit words the reader starts with. The bytes
    // left after the last block (at most the one lookahead word) are the unread end-of-data symbol.
    if (blocks > 0 && remaining <= 2) return out.finish();
    if (remaining < TABLE_BYTES + 4)
      throw corrupt(
        HUFF,
        blocks === 0 && remaining === 0
          ? "the data is empty (no Huffman table)"
          : `the data ends inside the Huffman table or its bit stream (truncated): ${remaining} bytes remain for a block`,
      );
    const table = buildTable(data, base, lengths);
    let pos = base + TABLE_BYTES;
    const read16 = (): number => {
      if (pos + 2 > n) throw corrupt(HUFF, "the data ends inside the bit stream (truncated)");
      const w = readU16LE(data, pos);
      pos += 2;
      return w;
    };
    let next = (read16() << 16) >>> 0;
    next = (next | read16()) >>> 0;
    let extra = 16;
    const blockEnd = out.length + BLOCK;
    // Takes `bits` bits (0 to 15) off the top of the register, refilling a 16-bit word when it runs low.
    const consume = (bits: number): void => {
      next = (next << bits) >>> 0;
      extra -= bits;
      if (extra < 0) {
        next = (next | (read16() << -extra)) >>> 0;
        extra += 16;
      }
    };
    while (out.length < blockEnd) {
      const sym = table[next >>> 17] as number;
      consume(lengths[sym] as number);
      if (sym < 256) {
        out.push(sym);
        continue;
      }
      if (sym === 256 && pos >= n) return out.finish(); // the end-of-data symbol, all input read
      const s = sym - 256;
      let length = s & 15;
      const offsetBits = s >> 4;
      if (length === 15) {
        if (pos + 1 > n) throw corrupt(HUFF, "the data ends inside a match length (truncated)");
        length = data[pos++] as number;
        if (length === 255) {
          if (pos + 2 > n) throw corrupt(HUFF, "the data ends inside a match length (truncated)");
          length = readU16LE(data, pos);
          pos += 2;
          if (length === 0) {
            if (pos + 4 > n) throw corrupt(HUFF, "the data ends inside a match length (truncated)");
            length = readU32LE(data, pos);
            pos += 4;
          }
          if (length < 15) throw corrupt(HUFF, `a match length field of ${length} is too small`);
          length -= 15;
        }
        length += 15;
      }
      length += 3;
      let offset = 1 << offsetBits;
      if (offsetBits > 0) {
        offset += next >>> (32 - offsetBits);
        consume(offsetBits);
      }
      if (offset > out.length)
        throw corrupt(
          HUFF,
          `a match refers to ${offset} bytes back but only ${out.length} bytes were written`,
        );
      out.copy(offset, length);
    }
    base = pos;
    blocks++;
  }
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "xpress",
    "_lz77",
    "( data:bytes -- bytes )",
    (data: Uint8Array, ctx: PrimitiveContext) => xpressDecompress(data, ctx.limits.maxValueBytes),
    {
      doc: "Decompress XPRESS Plain LZ77 data (MS-XCA 2.4). Stops at the value limit with E_LIMIT_VALUE (private helper of xpress:decompress).",
      category: "Compression",
    },
  ),
  definePrimitive(
    "xpress",
    "_huffman",
    "( data:bytes -- bytes )",
    (data: Uint8Array, ctx: PrimitiveContext) =>
      xpressHuffmanDecompress(data, ctx.limits.maxValueBytes),
    {
      doc: "Decompress XPRESS LZ77+Huffman data (MS-XCA 2.2). Stops at the value limit with E_LIMIT_VALUE (private helper of xpress:huffman-decompress).",
      category: "Compression",
    },
  ),
];
