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
 * Tests of the zip primitives themselves: the CRC-32 check values, the entry budget (exactly the
 * limit passes, one byte more does not, the sum of the entries counts), and the directory walk.
 */
import { deflateRawSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { cdOffsets, crc32, extractEntries, primitives } from "./zip.js";

const text = (s: string) => new TextEncoder().encode(s);

describe("zip primitives", () => {
  test("are exported as private helpers", () => {
    expect(primitives.map((p) => `${p.vocab}:${p.name}`)).toEqual([
      "zip:_crc32",
      "zip:_deflate",
      "zip:_cd-offsets",
      "zip:_extract",
    ]);
  });

  test("crc32 matches the published check values", () => {
    expect(crc32(text("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(text("a"))).toBe(0xe8b7be43);
    expect(crc32(new Uint8Array(32))).toBe(0x190a55ad);
  });

  test("a stored entry is the slice; exactly the limit passes and one byte more does not", () => {
    const data = new Uint8Array(100).fill(7);
    const plan = [{ start: 10, size: 50, method: 0 }];
    expect(extractEntries(data, plan, 50)[0]?.length).toBe(50);
    expect(() => extractEntries(data, plan, 49)).toThrow(/exceeds the limit of 49/);
  });

  test("a deflate entry stops at the limit; exactly the limit passes", () => {
    const raw = deflateRawSync(new Uint8Array(10_000));
    const plan = [{ start: 0, size: raw.length, method: 8 }];
    expect(extractEntries(raw, plan, 10_000)[0]?.length).toBe(10_000);
    try {
      extractEntries(raw, plan, 9_999);
      expect.unreachable();
    } catch (e) {
      const err = e as { code: string; detail: { limit: string; max: number } };
      expect(err.code).toBe("E_LIMIT_VALUE");
      expect(err.detail.limit).toBe("maxValueBytes");
      expect(err.detail.max).toBe(9_999);
    }
  });

  test("the budget is shared: each entry gets what the earlier ones left", () => {
    const raw = deflateRawSync(new Uint8Array(6_000));
    const data = new Uint8Array(raw.length * 2 + 1_000);
    data.set(raw, 0);
    data.set(raw, raw.length);
    const plan = [
      { start: 0, size: raw.length, method: 8 },
      { start: raw.length, size: raw.length, method: 8 },
    ];
    expect(extractEntries(data, plan, 12_000).map((p) => p.length)).toEqual([6_000, 6_000]);
    expect(() => extractEntries(data, plan, 11_999)).toThrow(/exceeds the limit/);
    const mixed = [
      { start: 0, size: raw.length, method: 8 },
      { start: 0, size: 100, method: 0 },
    ];
    expect(() => extractEntries(data, mixed, 6_050)).toThrow(/exceeds the limit/);
  });

  test("a bomb stops far below its size and allocates nothing like it", () => {
    const bomb = deflateRawSync(new Uint8Array(64 * 1024 * 1024), { level: 9 });
    const t = Date.now();
    expect(() =>
      extractEntries(bomb, [{ start: 0, size: bomb.length, method: 8 }], 1_000_000),
    ).toThrow(/exceeds the limit of 1000000/);
    expect(Date.now() - t).toBeLessThan(5_000);
  });

  test("damaged plans are E_COERCE", () => {
    const data = new Uint8Array(20);
    const code = (f: () => unknown) => {
      try {
        f();
        return "ok";
      } catch (e) {
        return (e as { code: string }).code;
      }
    };
    expect(code(() => extractEntries(data, [{ start: 25, size: 0, method: 0 }], 100))).toBe(
      "E_COERCE",
    );
    expect(code(() => extractEntries(data, [{ start: 10, size: 50, method: 0 }], 100))).toBe(
      "E_COERCE",
    );
    expect(code(() => extractEntries(data, [{ start: 0, size: 5, method: 12 }], 100))).toBe(
      "E_COERCE",
    );
    expect(code(() => extractEntries(data, [{ start: 0, size: 5, method: 8 }], 100))).toBe(
      "E_COERCE",
    );
  });

  test("cdOffsets walks name, extra and comment lengths and checks each signature", () => {
    const entry = (n: number, x: number, c: number) => {
      const e = new Uint8Array(46 + n + x + c);
      e.set([0x50, 0x4b, 1, 2]);
      e[28] = n;
      e[30] = x;
      e[32] = c;
      return e;
    };
    const parts = [entry(3, 0, 0), entry(5, 4, 2), entry(1, 0, 9)];
    const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let at = 0;
    for (const p of parts) {
      all.set(p, at);
      at += p.length;
    }
    expect(cdOffsets(all, 0, 3)).toEqual([0, 49, 49 + 57]);
    expect(() => cdOffsets(all, 0, 4)).toThrow(/cut short/);
    all[49] = 0;
    expect(() => cdOffsets(all, 0, 3)).toThrow(/bad entry signature/);
  });
});
