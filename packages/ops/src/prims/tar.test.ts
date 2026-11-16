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

/* Tests of the tar primitives themselves: the byte sum and octal fields. */
import { describe, expect, test } from "vitest";
import { byteSum, octal, primitives } from "./tar.js";

const text = (s: string) => new TextEncoder().encode(s);

describe("tar primitives", () => {
  test("are exported as private helpers", () => {
    expect(primitives.map((p) => `${p.vocab}:${p.name}`)).toEqual(["tar:_oct", "tar:_sum"]);
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
});
