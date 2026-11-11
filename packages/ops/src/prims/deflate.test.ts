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
 * Tests of the deflate primitives themselves: where a stream ends (the offset the FL zlib and gzip
 * words read their trailers at), chunk boundaries, and the output limit. The reference streams come
 * from the host's zlib.
 */
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { deflateRaw, inflateLimited, primitives } from "./deflate.js";

function randBytes(n: number, seed: number): Uint8Array {
  let s = seed >>> 0;
  return Uint8Array.from({ length: n }, () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s >>> 24;
  });
}

const BIG = 64 * 1024 * 1024;

describe("deflate primitives", () => {
  test("are exported as private helpers", () => {
    expect(primitives.map((p) => `${p.vocab}:${p.name}`)).toEqual([
      "deflate:_deflate",
      "deflate:_inflate",
    ]);
  });

  test("the end offset is the first byte after the stream, whatever follows", () => {
    for (const n of [0, 1, 5, 100, 5000, 70_000]) {
      for (const data of [randBytes(n, n + 1), new Uint8Array(n)]) {
        const c = deflateRawSync(data);
        const after = Uint8Array.from([...c, 0xaa, 0xbb, 0xcc, 0xdd, 0xee]);
        const r = inflateLimited(after, 0, BIG);
        expect(Array.from(r.out)).toEqual(Array.from(data));
        expect(r.end, `length ${n}`).toBe(c.length);
        const framed = Uint8Array.from([7, 7, 7, ...c, 1, 2, 3, 4, 5, 6, 7, 8]);
        expect(inflateLimited(framed, 3, BIG).end).toBe(3 + c.length);
      }
    }
  });

  test("streams that end mid-byte and on a byte boundary both give the right end", () => {
    for (let n = 0; n < 300; n++) {
      const data = randBytes(n, n * 7 + 3);
      const c = deflateRawSync(data, { level: n % 10 });
      const r = inflateLimited(Uint8Array.from([...c, 0x55, 0x55, 0x55]), 0, BIG);
      expect(r.end, `length ${n}`).toBe(c.length);
    }
  });

  test("level 0 writes exactly the stored blocks: no stray empty block at multiples of 65535", () => {
    // fflate 0.8.3 appended a second, empty final block when the length was a nonzero multiple of 65535
    // (found by the wave 6 cross-check): zlib then read the trailer from the wrong place.
    for (const n of [0, 1, 65_534, 65_535, 65_536, 131_069, 131_070, 131_071, 196_605]) {
      const data = randBytes(n, n + 9);
      const c = deflateRaw(data, 0);
      expect(c.length, `length ${n}`).toBe(n + 5 * Math.max(1, Math.ceil(n / 65_535)));
      const r = inflateLimited(Uint8Array.from([...c, 0xaa, 0xbb]), 0, BIG);
      expect(Array.from(r.out), `length ${n}`).toEqual(Array.from(data));
      expect(r.end, `length ${n}`).toBe(c.length);
      expect(Array.from(inflateRawSync(c)), `length ${n}`).toEqual(Array.from(data));
    }
  });

  test("a tiny limit still inflates correctly in many chunks", () => {
    const data = randBytes(40_000, 3);
    const c = deflateRawSync(data, { level: 0 });
    const r = inflateLimited(c, 0, 40_000);
    expect(Array.from(r.out)).toEqual(Array.from(data));
    expect(() => inflateLimited(c, 0, 39_999)).toThrow(/exceeds the limit of 39999/);
  });

  test("the limit is E_LIMIT_VALUE and names maxValueBytes", () => {
    const bomb = deflateRawSync(new Uint8Array(8 * 1024 * 1024));
    try {
      inflateLimited(bomb, 0, 100_000);
      expect.unreachable();
    } catch (e) {
      const err = e as { code: string; detail: { limit: string; max: number } };
      expect(err.code).toBe("E_LIMIT_VALUE");
      expect(err.detail.limit).toBe("maxValueBytes");
      expect(err.detail.max).toBe(100_000);
    }
  });

  test("a start beyond the data is E_RANGE; an empty or cut stream is E_COERCE", () => {
    const c = deflateRawSync(randBytes(1000, 2));
    expect(() => inflateLimited(c, c.length + 1, BIG)).toThrow(/start index/);
    expect(() => inflateLimited(c, c.length, BIG)).toThrow(/truncated|EOF/);
    expect(() => inflateLimited(c.subarray(0, 100), 0, BIG)).toThrow(/EOF/);
    try {
      inflateLimited(Uint8Array.of(7), 0, BIG);
      expect.unreachable();
    } catch (e) {
      expect((e as { code: string }).code).toBe("E_COERCE");
    }
  });

  test("deflateRaw rejects a level outside 0 to 9", () => {
    expect(() => deflateRaw(new Uint8Array(1), 10)).toThrow(/0 to 9/);
    expect(() => deflateRaw(new Uint8Array(1), 1.5)).toThrow(/0 to 9/);
  });
});
