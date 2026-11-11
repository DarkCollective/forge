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

import { describe, expect, test } from "vitest";
import { derive, primitives } from "./scrypt.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const text = (s: string) => new TextEncoder().encode(s);
const empty = new Uint8Array(0);

describe("scrypt._derive", () => {
  test("is exported as a private primitive", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_derive"]);
  });

  test("RFC 7914 section 12 test vector 1", () => {
    expect(hex(derive(empty, empty, 16, 1, 1, 64))).toBe(
      "77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906",
    );
  });

  test("the largest memory allowed (256 MiB) runs: N = 2^18, r = 8", () => {
    expect(derive(text("pw"), text("salt"), 2 ** 18, 8, 1, 32)).toHaveLength(32);
  });

  test("the caps are E_RANGE", () => {
    const d = (n: number, r: number, p: number, len: number) =>
      derive(text("p"), text("s"), n, r, p, len);
    expect(() => d(1000, 1, 1, 16)).toThrow(/power of two/);
    expect(() => d(1, 1, 1, 16)).toThrow(/N must be/);
    expect(() => d(2 ** 21, 1, 1, 16)).toThrow(/N must be/);
    expect(() => d(2 ** 20, 8, 1, 16)).toThrow(/256 MiB/);
    expect(() => d(2 ** 19, 8, 1, 16)).toThrow(/256 MiB/);
    expect(() => d(2 ** 16, 8, 32, 16)).toThrow(/N \* r \* p/);
    expect(() => d(16, 0, 1, 16)).toThrow(/scrypt r/);
    expect(() => d(16, 1, 0, 16)).toThrow(/scrypt p/);
    expect(() => d(16, 1, 1, 0)).toThrow(/key length/);
    expect(() => d(16, 1, 1, 4097)).toThrow(/key length/);
    expect(() => d(16.5, 1, 1, 16)).toThrow(/N must be/);
  });
});
