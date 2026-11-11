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

/* Tests of the tar primitives themselves: the byte sum, octal fields and the header walk. */
import { describe, expect, test } from "vitest";
import { byteSum, headerOffsets, octal, primitives } from "./tar.js";

const text = (s: string) => new TextEncoder().encode(s);

function block(name: string, size: number, fix = true): Uint8Array {
  const h = new Uint8Array(512);
  h.set(text(name));
  h.set(text(size.toString(8).padStart(11, "0")), 124);
  h.fill(0x20, 148, 156);
  let sum = 0;
  for (const b of h) sum += b;
  if (fix) h.set(text(sum.toString(8).padStart(6, "0") + "\0"), 148);
  return h;
}

describe("tar primitives", () => {
  test("are exported as private helpers", () => {
    expect(primitives.map((p) => `${p.vocab}:${p.name}`)).toEqual([
      "tar:_headers",
      "tar:_oct",
      "tar:_sum",
    ]);
  });

  test("byteSum", () => {
    expect(byteSum(new Uint8Array(0))).toBe(0);
    expect(byteSum(Uint8Array.of(255, 255, 1))).toBe(511);
    expect(byteSum(new Uint8Array(512).fill(255))).toBe(512 * 255);
  });

  test("octal reads digits up to a NUL, ignores spaces, and refuses anything else", () => {
    expect(octal(text("0000644\0"), "mode")).toBe(0o644);
    expect(octal(text("  644 \0"), "mode")).toBe(0o644);
    expect(octal(text("00000000011\0"), "size")).toBe(9);
    expect(octal(new Uint8Array(12), "size")).toBe(0);
    expect(octal(text("77777777777\0"), "size")).toBe(0o77777777777);
    expect(() => octal(text("0000089\0"), "mode")).toThrow(/mode is not an octal number/);
    expect(() => octal(text("-1\0"), "mode")).toThrow(/not an octal number/);
    expect(() => octal(Uint8Array.of(0x80, 1, 2), "size")).toThrow(/base-256/);
  });

  test("headerOffsets walks the sizes, stops at zeros and checks the checksum", () => {
    const a = new Uint8Array(512 * 6);
    a.set(block("one", 513), 0); // header 0, data 512..1025 padded to 1536
    a.set(block("two", 0), 1536);
    a.set(block("three", 5), 2048); // data 2560..2565 padded to 3072
    expect(headerOffsets(a, true)).toEqual([0, 1536, 2048]);
    expect(headerOffsets(a.subarray(0, 2565), true)).toEqual([0, 1536, 2048]);
    expect(() => headerOffsets(a.subarray(0, 2564), true)).toThrow(/cut short/);
    expect(() => headerOffsets(new Uint8Array(0), true)).toThrow(/empty/);
    expect(headerOffsets(new Uint8Array(1024), true)).toEqual([]);
    const bad = a.slice();
    bad[1536] = (bad[1536] as number) ^ 1;
    expect(() => headerOffsets(bad, true)).toThrow(/checksum mismatch at offset 1536/);
    expect(headerOffsets(bad, false)).toEqual([0, 1536, 2048]);
    expect(() => headerOffsets(a.subarray(0, 700), true)).toThrow(/cut short/);
  });

  test("a size field of 8 GiB allocates nothing", () => {
    const h = block("big", 0o77777777777);
    expect(() => headerOffsets(h, true)).toThrow(/cut short/);
  });

  test("100,000 headers are walked quickly", () => {
    const a = new Uint8Array(512 * 100_000);
    const one = block("x", 0);
    for (let i = 0; i < 100_000; i++) a.set(one, i * 512);
    const t = Date.now();
    expect(headerOffsets(a, true)).toHaveLength(100_000);
    expect(Date.now() - t).toBeLessThan(5_000);
  });
});
