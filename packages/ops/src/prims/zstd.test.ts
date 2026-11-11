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
 * Tests of the zstd primitive itself: the XXH64 checksum (known answers, and streaming against one
 * shot), the frame walk on hand-built frames (RFC 8878 examples and the refusals the CLI cannot
 * produce: a dictionary ID, a reserved bit, an oversized window or declared size, a bad block type),
 * the checksum check, and the output limit. The frames built here are written out byte by byte, so
 * each test says what it builds. The CLI-made frames are in vocab/zstd.test.json (tested in src/zstd.test.ts).
 */
import { describe, expect, test } from "vitest";
import { primitives, Xxh64, zstdDecompress } from "./zstd.js";

const text = (s: string) => new TextEncoder().encode(s);
const hex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));
const ascii = (u: Uint8Array) => Array.from(u, (c) => String.fromCharCode(c)).join("");
const MiB = 1024 * 1024;

/** The error code and message of a call that must fail, or undefined. */
function failure(
  f: () => unknown,
): { code: string; message: string; detail?: unknown } | undefined {
  try {
    f();
    return undefined;
  } catch (e) {
    const err = e as { code?: string; message: string; detail?: unknown };
    return { code: err.code ?? "?", message: err.message, detail: err.detail };
  }
}

function randBytes(n: number, seed: number): Uint8Array {
  let s = seed >>> 0;
  return Uint8Array.from({ length: n }, () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s >>> 24;
  });
}

function xxh64(data: Uint8Array): bigint {
  const h = new Xxh64();
  h.update(data);
  return h.digest();
}

describe("XXH64", () => {
  test('known answers: the empty input and "abc" (seed 0)', () => {
    expect(xxh64(new Uint8Array(0))).toBe(0xef46db3751d8e999n);
    expect(xxh64(text("abc"))).toBe(0x44bc2cf5ad770999n);
  });

  test("streamed in pieces of every size gives the one-shot digest", () => {
    for (const n of [0, 1, 7, 31, 32, 33, 63, 64, 100, 1000, 4097]) {
      const data = randBytes(n, n + 1);
      const want = xxh64(data);
      for (const step of [1, 3, 8, 31, 32, 33, 500]) {
        const h = new Xxh64();
        for (let at = 0; at < n; at += step) h.update(data.subarray(at, Math.min(n, at + step)));
        expect(h.digest(), `length ${n} in pieces of ${step}`).toBe(want);
      }
    }
  });
});

describe("zstd primitive", () => {
  test("the one primitive is the private helper _decompress", () => {
    expect(primitives.map((p) => `${p.vocab}:${p.name}`)).toEqual(["zstd:_decompress"]);
  });

  test('RFC 8878 single-segment frame of a raw block: "hello"', () => {
    // magic, descriptor 0x20 (single segment, 1-byte content size), size 5, block header
    // (last, raw, 5 bytes), the bytes.
    const frame = hex("28b52ffd2005290000" + "68656c6c6f");
    expect(ascii(zstdDecompress(frame, true, 16 * MiB))).toBe("hello");
  });

  test("skippable frames are skipped, alone and between frames (magic 0x184D2A5x)", () => {
    const skip = hex("502a4d18" + "03000000" + "aabbcc");
    const frame = hex("28b52ffd2005290000" + "68656c6c6f");
    expect(zstdDecompress(skip, true, 16 * MiB).length).toBe(0);
    expect(
      ascii(
        zstdDecompress(Uint8Array.from([...skip, ...frame, ...skip, ...frame]), true, 16 * MiB),
      ),
    ).toBe("hellohello");
  });

  test("a frame with a content checksum: verified when asked, skipped when not", () => {
    // descriptor 0x24 (single segment, checksum); the checksum is wrong on purpose.
    const bad = hex("28b52ffd24" + "05" + "290000" + "68656c6c6f" + "00000000");
    const r = failure(() => zstdDecompress(bad, true, 16 * MiB));
    expect(r?.code).toBe("E_COERCE");
    expect(r?.message).toMatch(/zstd checksum mismatch/);
    expect(ascii(zstdDecompress(bad, false, 16 * MiB))).toBe("hello");
  });

  test("a dictionary-compressed frame is E_COERCE naming the dictionary", () => {
    // descriptor 0x21 (single segment, 1-byte dictionary ID), dictionary ID 7.
    const dict = hex("28b52ffd21" + "07" + "05" + "290000" + "68656c6c6f");
    const r = failure(() => zstdDecompress(dict, true, 16 * MiB));
    expect(r?.code).toBe("E_COERCE");
    expect(r?.message).toMatch(/dictionary \(ID 7\), which is not supported/);
  });

  test("a reserved bit in the descriptor, a reserved block type and a cut-short block are E_COERCE", () => {
    const reserved = failure(() =>
      zstdDecompress(hex("28b52ffd28" + "05" + "290000" + "68656c6c6f"), true, MiB),
    );
    expect(reserved?.code).toBe("E_COERCE");
    expect(reserved?.message).toMatch(/reserved bit/);
    const type3 = failure(() =>
      zstdDecompress(hex("28b52ffd2005" + "070000" + "68656c6c6f"), true, MiB),
    );
    expect(type3?.code).toBe("E_COERCE");
    expect(type3?.message).toMatch(/block type 3/);
    const cut = failure(() => zstdDecompress(hex("28b52ffd2005290000" + "68656c"), true, MiB));
    expect(cut?.code).toBe("E_COERCE");
    expect(cut?.message).toMatch(/cut short/);
  });

  test("no bytes, plain text and a magic number of another format are E_COERCE", () => {
    expect(failure(() => zstdDecompress(new Uint8Array(0), true, MiB))?.code).toBe("E_COERCE");
    const text1 = failure(() => zstdDecompress(text("hello, world"), true, MiB));
    expect(text1?.code).toBe("E_COERCE");
    expect(text1?.message).toMatch(/magic number/);
  });

  test("a window over the limit is refused before decoding (fzstd would allocate it)", () => {
    // descriptor 0x00 (not single segment), window descriptor 0xa7: exponent 20, mantissa 7, about 1.9 GiB.
    const r = failure(() =>
      zstdDecompress(hex("28b52ffd00a7" + "290000" + "68656c6c6f"), true, 16 * MiB),
    );
    expect(r?.code).toBe("E_LIMIT_VALUE");
    expect(r?.message).toMatch(/frame window of 2013265920 exceeds the limit of 16777216/);
  });

  test("a declared content size over the limit is refused early, with no output", () => {
    // descriptor 0xa0 (single segment, 4-byte content size), size 0x10000000 (256 MiB).
    const r = failure(() =>
      zstdDecompress(hex("28b52ffda0" + "00000010" + "290000" + "68656c6c6f"), true, 16 * MiB),
    );
    expect(r?.code).toBe("E_LIMIT_VALUE");
    expect(r?.message).toMatch(/declared content size of 268435456 exceeds the limit/);
  });

  test("the output limit: a bomb of RLE blocks stops at the limit, and the exact limit passes", () => {
    // Window 128 KiB (descriptor 0x38). 100 RLE blocks of 128 KiB of zeros: 4 bytes each, 12.5 MiB out.
    const rle = (last: boolean) => (last ? "030010" : "020010") + "00";
    let body = "";
    for (let i = 0; i < 100; i++) body += rle(i === 99);
    // descriptor 0x00 (not single segment), then the window descriptor 0x38.
    const bomb = hex("28b52ffd00" + "38" + body);
    const total = 100 * 128 * 1024;
    expect(bomb.length).toBe(4 + 1 + 1 + 400);
    expect(failure(() => zstdDecompress(bomb, true, MiB))?.code).toBe("E_LIMIT_VALUE");
    expect(zstdDecompress(bomb, true, total).length).toBe(total);
    const r = failure(() => zstdDecompress(bomb, true, total - 1));
    expect(r?.code).toBe("E_LIMIT_VALUE");
    expect(r?.detail).toEqual({ limit: "maxValueBytes", max: total - 1, value: total });
  });
});
