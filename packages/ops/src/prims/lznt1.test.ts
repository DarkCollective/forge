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
 * Tests of the lznt1 primitive itself with hand-built buffers (the encoder round trips are in
 * src/lznt1.test.ts): the displacement/length split at each position band, overlapping matches,
 * stored chunks, and the output limit.
 */
import { describe, expect, test } from "vitest";
import { lznt1Decompress, primitives } from "./lznt1.js";

const BIG = 64 * 1024 * 1024;
const str = (u: Uint8Array) => Array.from(u, (c) => String.fromCharCode(c)).join("");
const chunk = (body: number[]) => {
  const h = 0xb000 | (body.length + 2 - 3);
  return [h & 255, h >> 8, ...body];
};

describe("lznt1 primitive", () => {
  test("is exported as a private helper", () => {
    expect(primitives.map((p) => `${p.vocab}:${p.name}`)).toEqual(["lznt1:_decompress"]);
  });

  test("a match may run into its own output (4 bits of displacement while the chunk is short)", () => {
    // 'a', then displacement 1 and length 9 - 3 = 6: word = (0 << 12) | 6
    const r = lznt1Decompress(Uint8Array.from(chunk([0x02, 0x61, 0x06, 0x00])), BIG);
    expect(str(r)).toBe("a".repeat(10));
  });

  test("the displacement field widens with the position: 5 bits from the 18th byte", () => {
    // 17 literals 'a'..'q' (u = 17 needs 5 displacement bits), then a match back 17 with length 3:
    // word = (16 << 11) | 0 = 0x8000
    const lits = Array.from({ length: 17 }, (_, i) => 97 + i);
    const body = [
      0x00,
      ...lits.slice(0, 8),
      0x00,
      ...lits.slice(8, 16),
      0x02,
      lits[16] as number,
      0x00,
      0x80,
    ];
    const r = lznt1Decompress(Uint8Array.from(chunk(body)), BIG);
    expect(str(r)).toBe("abcdefghijklmnopq" + "abc");
  });

  test("with 16 bytes written the displacement is still 4 bits (the 17th byte needs 5)", () => {
    // 16 literals, then word 4/12: displacement 16 (stored 15 << 12), length 3
    const lits = Array.from({ length: 16 }, (_, i) => 97 + i);
    const body = [0x00, ...lits.slice(0, 8), 0x00, ...lits.slice(8), 0x01, 0x00, 0xf0];
    const r = lznt1Decompress(Uint8Array.from(chunk(body)), BIG);
    expect(str(r)).toBe("abcdefghijklmnop" + "abc");
  });

  test("a stored chunk and a compressed chunk, then the end marker and junk", () => {
    const stored = [0x02, 0x30, 0x41, 0x42, 0x43]; // header 0x3002: 3 bytes
    const data = Uint8Array.from([...stored, ...chunk([0x00, 0x44]), 0, 0, 7, 7]);
    expect(str(lznt1Decompress(data, BIG))).toBe("ABCD");
  });

  test("the limit stops a chunk that would pass it, and allows exactly the limit", () => {
    const zeros = chunk([0x02, 0x00, 0xff, 0x0f]).slice(0); // 'NUL' plus a match of 4098: too long
    expect(() => lznt1Decompress(Uint8Array.from(zeros), BIG)).toThrow(/4096/);
    const stored = Uint8Array.from([0x02, 0x30, 1, 2, 3]);
    expect(lznt1Decompress(stored, 3).length).toBe(3);
    expect(() => lznt1Decompress(stored, 2)).toThrow(/decompressed data/);
  });
});
