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
 * Tests of the lzstring primitives themselves: the stream replay (`measure`) that bounds the output
 * against the library, and the limit.
 */
import LZString from "lz-string";
import { describe, expect, test } from "vitest";
import { compress, decompress, measure, primitives } from "./lzstring.js";

const text = (s: string) => new TextEncoder().encode(s);
const BIG = 64 * 1024 * 1024;

describe("lzstring primitives", () => {
  test("are exported as private helpers", () => {
    expect(primitives.map((p) => `${p.vocab}:${p.name}`)).toEqual([
      "lzstring:_compress",
      "lzstring:_decompress",
    ]);
  });

  test("measure counts exactly the characters the library returns", () => {
    for (const s of ["", "a", "abcabcabc", "a".repeat(5000), "café \u{1F600} ".repeat(100)]) {
      const c = LZString.compress(s);
      const m = measure(c.length, 32768, (i) => c.charCodeAt(i), BIG);
      expect(m.status).toBe("end");
      expect(m.chars).toBe(s.length);
    }
  });

  test("measure stops at the cap before the library would build the string", () => {
    const c = LZString.compress("a".repeat(2_000_000));
    expect(() => measure(c.length, 32768, (i) => c.charCodeAt(i), 1000)).toThrow(
      /exceeds the limit of 1000/,
    );
  });

  test("a bad format is E_RANGE; compress and decompress honour the cap", () => {
    expect(() => compress(text("x"), "gzip", BIG)).toThrow(/format/);
    expect(() => decompress(text("x"), "gzip", BIG)).toThrow(/format/);
    expect(() => compress(text("hello hello hello"), "base64", 4)).toThrow(/exceeds the limit/);
  });
});
