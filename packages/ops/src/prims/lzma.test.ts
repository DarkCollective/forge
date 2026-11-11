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
 * Tests of the lzma primitives themselves: the output limit (the bomb rule, with the exact limit and
 * one byte over), the unknown-size rewrite, the declared-size refusal, and the level range.
 */
import { compress } from "lzma1";
import { describe, expect, test } from "vitest";
import { lzmaCompress, lzmaDecode, primitives } from "./lzma.js";

const UNKNOWN_HEADER = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

/** The same stream with its 8-byte size field replaced by the unknown marker (xz's and Python's way). */
function unknownSize(stream: Uint8Array): Uint8Array {
  const s = stream.slice();
  s.set(UNKNOWN_HEADER, 5);
  return s;
}

function zeros(n: number): Uint8Array {
  return new Uint8Array(n);
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
    return "ok";
  } catch (e) {
    return (e as { code: string }).code;
  }
}

describe("lzma primitives", () => {
  test("are exported as private helpers", () => {
    expect(primitives.map((p) => `${p.vocab}:${p.name}`)).toEqual([
      "lzma:_compress",
      "lzma:_decode",
    ]);
  });

  test("the level must be 1 to 9", () => {
    expect(() => lzmaCompress(zeros(1), 0)).toThrow(/1 to 9/);
    expect(() => lzmaCompress(zeros(1), 10)).toThrow(/1 to 9/);
    expect(() => lzmaCompress(zeros(1), 1.5)).toThrow(/1 to 9/);
    expect(codeOf(() => lzmaCompress(zeros(1), 0))).toBe("E_RANGE");
  });

  test("a known size equal to the limit passes; one byte over is E_LIMIT_VALUE before decoding", () => {
    const data = zeros(100_000);
    const stream = compress(data, 7);
    expect(lzmaDecode(stream, 100_000).out.length).toBe(100_000);
    expect(codeOf(() => lzmaDecode(stream, 99_999))).toBe("E_LIMIT_VALUE");
  });

  test("a declared size far over the limit is refused without decoding, even with a body that is not there", () => {
    const stream = compress(zeros(10), 7);
    const lying = stream.slice();
    lying.set([0, 0, 0, 0, 0, 1, 0, 0], 5); // 2^40 bytes
    try {
      lzmaDecode(lying, 16 * 1024 * 1024);
      expect.unreachable();
    } catch (e) {
      const err = e as { code: string; detail: { limit: string; max: number } };
      expect(err.code).toBe("E_LIMIT_VALUE");
      expect(err.detail.limit).toBe("maxValueBytes");
      expect(err.detail.max).toBe(16 * 1024 * 1024);
    }
    // The same header with a body that is nothing at all: still refused by the size, not the body.
    expect(codeOf(() => lzmaDecode(lying.subarray(0, 13), 1 << 20))).toBe("E_LIMIT_VALUE");
  });

  test("the input is never changed (the unknown-size rewrite works on a copy)", () => {
    const stream = unknownSize(compress(zeros(64), 7));
    const before = Array.from(stream);
    expect(lzmaDecode(stream, 1000).out.length).toBe(64);
    expect(Array.from(stream)).toEqual(before);
  });

  test("an unknown size decodes up to the limit and stops one byte over it", () => {
    const stream = unknownSize(compress(zeros(5000), 7));
    expect(lzmaDecode(stream, 5000).declared).toBe(-1);
    expect(lzmaDecode(stream, 5000).out.length).toBe(5000);
    expect(codeOf(() => lzmaDecode(stream, 4999))).toBe("E_LIMIT_VALUE");
    expect(codeOf(() => lzmaDecode(stream, 10))).toBe("E_LIMIT_VALUE");
  });

  test("a small bomb: 8 MiB of zeros stops at a 64 KiB limit, whatever the size field says", () => {
    const bomb = compress(zeros(8 * 1024 * 1024), 9);
    expect(bomb.length).toBeLessThan(50_000);
    const limit = 64 * 1024;
    for (const stream of [bomb, unknownSize(bomb)]) {
      const err = (() => {
        try {
          lzmaDecode(stream, limit);
          return undefined;
        } catch (e) {
          return e as { code: string; detail: { limit: string; max: number } };
        }
      })();
      expect(err?.code).toBe("E_LIMIT_VALUE");
      expect(err?.detail.limit).toBe("maxValueBytes");
      expect(err?.detail.max).toBe(limit);
    }
  }, 60_000);

  test("a declared size smaller than the data is E_COERCE naming the excess", () => {
    const stream = compress(new TextEncoder().encode("0123456789abcdef"), 6).slice();
    stream.set([4, 0, 0, 0, 0, 0, 0, 0], 5);
    const e = (() => {
      try {
        lzmaDecode(stream, 1 << 20);
        return undefined;
      } catch (err) {
        return err as { code: string; message: string };
      }
    })();
    expect(e?.code).toBe("E_COERCE");
    expect(e?.message).toMatch(/data exceeds the declared size/);
  });

  test("a cut-short stream is E_COERCE and says it is cut short", () => {
    const stream = compress(
      new TextEncoder().encode("a longer line of text, a longer line of text"),
      7,
    );
    for (const n of [0, 5, 12, 13, 14, stream.length >> 1, stream.length - 2]) {
      const e = (() => {
        try {
          lzmaDecode(stream.subarray(0, n), 1 << 20);
          return undefined;
        } catch (err) {
          return err as { code: string; message: string };
        }
      })();
      expect(e?.code, `cut at ${n}`).toBe("E_COERCE");
    }
    const e = (() => {
      try {
        lzmaDecode(stream.subarray(0, 14), 1 << 20);
        return undefined;
      } catch (err) {
        return err as { message: string };
      }
    })();
    expect(e?.message).toMatch(/cut short|unexpected EOF|Truncated/);
  });
});
