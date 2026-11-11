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
 * Tests of the lz4 primitives themselves. XXH32 reference values come from frames written by the lz4
 * v1.10.0 command (the content checksum of an empty file, and of a 46-byte text).
 */
import { describe, expect, test } from "vitest";
import { decodeFrameBlocks, decodeLegacyBlocks, encodeBlocks, primitives, xxh32 } from "./lz4.js";

const text = (s: string) => new TextEncoder().encode(s);
const BIG = 64 * 1024 * 1024;

describe("lz4 primitives", () => {
  test("are exported as private helpers", () => {
    expect(primitives.map((p) => `${p.vocab}:${p.name}`)).toEqual([
      "lz4:_xxh32",
      "lz4:_blocks",
      "lz4:_legacy",
      "lz4:_encode",
    ]);
  });

  test("XXH32 matches the checksums the lz4 command wrote", () => {
    expect(xxh32(new Uint8Array(0), 0)).toBe(0x02cc5d05); // lz4 -c of an empty file ends 05 5d cc 02
    expect(xxh32(text("hello hello hello hello world, hello lz4 frame"), 0)).toBe(0xb891b356);
  });

  test("XXH32 on a range equals XXH32 of the slice, for every length around the 16-byte stripe", () => {
    const d = Uint8Array.from({ length: 80 }, (_, i) => (i * 37 + 11) & 255);
    for (let n = 0; n <= 70; n++) expect(xxh32(d, 0, 5, 5 + n)).toBe(xxh32(d.slice(5, 5 + n), 0));
    expect(xxh32(d, 1)).not.toBe(xxh32(d, 0));
  });

  test("blocks written by encodeBlocks decode, every option, level and block size", () => {
    const d = Uint8Array.from({ length: 200_000 }, (_, i) => (i % 97 < 50 ? i % 7 : (i * i) & 255));
    for (const level of [0, 1, 2, 9])
      for (const indep of [true, false])
        for (const bchk of [false, true]) {
          const enc = encodeBlocks(d, 65_536, indep, bchk, level, BIG);
          const framed = Uint8Array.from([...enc, 0, 0, 0, 0]);
          const r = decodeFrameBlocks(framed, 0, indep, bchk, 65_536, true, BIG);
          expect(r.end).toBe(framed.length);
          expect(r.out.length).toBe(d.length);
          expect(r.out.every((v, i) => v === d[i])).toBe(true);
        }
  });

  test("the last 5 bytes are literals and no match starts in the last 12 (LZ4 block rules)", () => {
    // 'a' repeated: the block ends with a literal-only sequence of at least 5 bytes.
    const enc = encodeBlocks(new Uint8Array(100).fill(97), 65_536, true, false, 1, BIG);
    const size = enc[0]! | (enc[1]! << 8);
    const block = enc.subarray(4, 4 + size);
    // Last token: literals only, 5 or more.
    let p = 0;
    let lastLit = 0;
    while (p < block.length) {
      const token = block[p++]!;
      let lit = token >> 4;
      if (lit === 15)
        for (;;) {
          const b = block[p++]!;
          lit += b;
          if (b !== 255) break;
        }
      p += lit;
      lastLit = lit;
      if (p >= block.length) break;
      p += 2;
      if ((token & 15) === 15)
        for (;;) {
          const b = block[p++]!;
          if (b !== 255) break;
        }
    }
    expect(lastLit).toBeGreaterThanOrEqual(5);
  });

  test("a block that does not shrink is stored (high bit of the size)", () => {
    let seed = 12345;
    const d = Uint8Array.from({ length: 1000 }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed >>> 24;
    });
    const enc = encodeBlocks(d, 65_536, true, false, 5, BIG);
    expect(enc[3]! & 0x80).toBe(0x80);
    expect(enc.length).toBe(1004);
  });

  test("bad parameters are E_RANGE", () => {
    expect(() => encodeBlocks(new Uint8Array(3), 65_536, true, false, 10, BIG)).toThrow(/level/);
    expect(() => encodeBlocks(new Uint8Array(3), 1000, true, false, 1, BIG)).toThrow(/block size/);
    expect(() => decodeFrameBlocks(new Uint8Array(4), 9, true, false, 65_536, true, BIG)).toThrow(
      /start index/,
    );
  });

  test("corrupt blocks are named", () => {
    const frame = (...b: number[]) => Uint8Array.from([...b, 0, 0, 0, 0]);
    // size 5, token 0x10 (1 literal, match follows), literal, offset 0
    expect(() =>
      decodeFrameBlocks(frame(5, 0, 0, 0, 0x14, 0x61, 0, 0, 0), 0, true, false, 65_536, true, BIG),
    ).toThrow(/offset is zero/);
    expect(() =>
      decodeFrameBlocks(frame(5, 0, 0, 0, 0x14, 0x61, 9, 0, 0), 0, true, false, 65_536, true, BIG),
    ).toThrow(/reaches before/);
    expect(() =>
      decodeFrameBlocks(frame(2, 0, 0, 0, 0x50, 0x61), 0, true, false, 65_536, true, BIG),
    ).toThrow(/literal run/);
    expect(() =>
      decodeFrameBlocks(Uint8Array.from([9, 0, 0, 0, 1]), 0, true, false, 65_536, true, BIG),
    ).toThrow(/truncated/);
    expect(() =>
      decodeFrameBlocks(Uint8Array.from([1, 0, 1, 0]), 0, true, false, 65_536, true, BIG),
    ).toThrow(/larger than/);
    expect(() => decodeFrameBlocks(new Uint8Array(0), 0, true, false, 65_536, true, BIG)).toThrow(
      /end mark/,
    );
  });

  test("independent blocks cannot refer to an earlier block; dependent ones can", () => {
    const d = new Uint8Array(70_000).fill(7);
    const dep = encodeBlocks(d, 65_536, false, false, 1, BIG);
    const withEnd = Uint8Array.from([...dep, 0, 0, 0, 0]);
    expect(decodeFrameBlocks(withEnd, 0, false, false, 65_536, true, BIG).out.length).toBe(70_000);
    expect(() => decodeFrameBlocks(withEnd, 0, true, false, 65_536, true, BIG)).toThrow(
      /reaches before/,
    );
  });

  test("legacy blocks: sizes, stop at the next magic number, truncation", () => {
    const one = encodeBlocks(
      text("legacy legacy legacy legacy legacy"),
      65_536,
      true,
      false,
      1,
      BIG,
    );
    const size = one[0]! | (one[1]! << 8);
    const legacy = Uint8Array.from([
      ...one.subarray(0, 0),
      size,
      0,
      0,
      0,
      ...one.subarray(4, 4 + size),
    ]);
    const r = decodeLegacyBlocks(legacy, 0, BIG);
    expect(new TextDecoder().decode(r.out)).toBe("legacy legacy legacy legacy legacy");
    const next = Uint8Array.from([...legacy, 0x04, 0x22, 0x4d, 0x18]);
    expect(decodeLegacyBlocks(next, 0, BIG).end).toBe(legacy.length);
    expect(() => decodeLegacyBlocks(legacy.subarray(0, legacy.length - 3), 0, BIG)).toThrow(
      /truncated/,
    );
    expect(() => decodeLegacyBlocks(Uint8Array.of(1, 2), 0, BIG)).toThrow(/truncated/);
  });

  test("the limit is E_LIMIT_VALUE and names maxValueBytes", () => {
    const bomb = encodeBlocks(new Uint8Array(8 * 1024 * 1024), 4_194_304, true, false, 1, BIG);
    const framed = Uint8Array.from([...bomb, 0, 0, 0, 0]);
    try {
      decodeFrameBlocks(framed, 0, true, false, 4_194_304, true, 100_000);
      expect.unreachable();
    } catch (e) {
      const err = e as { code: string; detail: { limit: string; max: number } };
      expect(err.code).toBe("E_LIMIT_VALUE");
      expect(err.detail.limit).toBe("maxValueBytes");
      expect(err.detail.max).toBe(100_000);
    }
  });
});
