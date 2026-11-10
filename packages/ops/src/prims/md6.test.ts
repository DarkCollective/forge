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
 * Tests for the md6 primitive module: the constant Q against its definition, and the parameter checks.
 */
import { describe, expect, test } from "vitest";
import { md6, Q } from "./md6.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const enc = (s: string) => new TextEncoder().encode(s);

describe("md6", () => {
  // MD6 report section 2.3.1: Q holds the first 15 words of the fractional part of sqrt(6).
  test("Q is the fractional part of sqrt(6)", () => {
    const bits = 64n * 16n;
    const target = 6n << (2n * bits);
    let lo = 0n;
    let hi = 1n << (bits + 4n);
    while (lo < hi) {
      const mid = (lo + hi + 1n) >> 1n;
      if (mid * mid <= target) lo = mid;
      else hi = mid - 1n;
    }
    const frac = lo - (2n << bits);
    Q.forEach((q, i) => expect(q).toBe((frac >> BigInt(64 * (15 - i))) & ((1n << 64n) - 1n)));
    expect(Q).toHaveLength(15);
  });

  test("published digests of the empty message and abc", () => {
    expect(hex(md6(new Uint8Array(), 256, 64, new Uint8Array()))).toBe(
      "bca38b24a804aa37d821d31af00f5598230122c5bbfc4c4ad5ed40e4258f04ca",
    );
    expect(hex(md6(enc("abc"), 256, 64, new Uint8Array()))).toBe(
      "230637d4e6845cf0d092b558e87625f03881dd53a7439da34cf3b94ed0d8b2c5",
    );
  });

  test("the digest length follows the size", () => {
    for (const d of [8, 160, 384]) {
      expect(md6(enc("abc"), d, 64, new Uint8Array())).toHaveLength(d / 8);
    }
  });

  test("bad parameters raise", () => {
    expect(() => md6(enc("abc"), 7, 64, new Uint8Array())).toThrow();
    expect(() => md6(enc("abc"), 256, 65, new Uint8Array())).toThrow();
    expect(() => md6(enc("abc"), 256, 64, new Uint8Array(65))).toThrow();
  });
});
