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
 * Tests of the xpress primitives themselves with hand-built streams (the encoder round trips and the
 * specification's examples are in src/xpress.test.ts): the two exported helpers, the flag-word
 * boundary of Plain LZ77, the nibble shared by two long matches, and the output limit.
 */
import { describe, expect, test } from "vitest";
import { primitives, xpressDecompress, xpressHuffmanDecompress } from "./xpress.js";

const BIG = 64 * 1024 * 1024;
const str = (u: Uint8Array) => Array.from(u, (c) => String.fromCharCode(c)).join("");

describe("xpress primitives", () => {
  test("are exported as private helpers", () => {
    expect(primitives.map((p) => `${p.vocab}:${p.name}`)).toEqual([
      "xpress:_lz77",
      "xpress:_huffman",
    ]);
  });

  test("Plain LZ77: two matches of length 7 + n share one length byte (low nibble, then high)", () => {
    // literals a, b, c, then two matches of distance 3: lengths 3 + 7 + 1 = 11 and 3 + 7 + 2 = 12
    // flags: 0 0 0 1 1 then ones (0x1fffffff); each match word is (2 << 3) | 7 = 0x17; the shared byte is 0x21
    const enc = Uint8Array.of(0xff, 0xff, 0xff, 0x1f, 97, 98, 99, 0x17, 0x00, 0x21, 0x17, 0x00);
    const got = xpressDecompress(enc, BIG);
    expect(str(got)).toBe("abc".repeat(9).slice(0, 26));
    expect(got.length).toBe(3 + 11 + 12);
  });

  test("Plain LZ77: 33 literals cross a flag word", () => {
    const lits = Array.from({ length: 33 }, (_, i) => 65 + (i % 26));
    // flag word 1: 32 literal bits (0); flag word 2: the 33rd literal then ones (bit 31 = 0)
    const enc = Uint8Array.from([
      0,
      0,
      0,
      0,
      ...lits.slice(0, 32),
      0xff,
      0xff,
      0xff,
      0x7f,
      lits[32] as number,
    ]);
    expect(str(xpressDecompress(enc, BIG))).toBe(String.fromCharCode(...lits));
  });

  test("Plain LZ77: the limit is checked before a long match is copied", () => {
    const enc = Uint8Array.of(
      0xff,
      0xff,
      0xff,
      0x7f,
      0x61,
      0x07,
      0x00,
      0x0f,
      0xff,
      0x00,
      0x00,
      0xff,
      0xff,
      0xff,
      0xff,
    );
    expect(() => xpressDecompress(enc, BIG)).toThrow(/decompressed data/);
    expect(() => xpressDecompress(Uint8Array.of(0, 0, 0, 0, 65), 0)).toThrow(/decompressed data/);
  });

  test("Huffman: a table with all 512 codes of length 9 is complete, and the empty block is an error", () => {
    const t = new Uint8Array(256).fill(0x99);
    // symbols: 9 bits each; stream: 'symbol 0' = 000000000 ... a literal 0 then the end symbol 256
    // (code 256 is 100000000); bits 000000000 100000000 -> words 0x0040 0x0000... (MSB first)
    // 18 bits: 0000 0000 0100 0000 | 00.. -> word1 = 0x0040, word2 = 0x0000
    const bits = Uint8Array.of(0x40, 0x00, 0x00, 0x00, 0x00, 0x00); // two words, then the padding word
    const data = Uint8Array.from([...t, ...bits]);
    const got = xpressHuffmanDecompress(data, BIG);
    expect(Array.from(got)).toEqual([0]);
    expect(() => xpressHuffmanDecompress(new Uint8Array(0), BIG)).toThrow(/empty/);
  });
});
