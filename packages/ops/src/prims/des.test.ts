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
 * Tests for the DES primitives (src/prims/des.ts): known answers from FIPS 46-3 / NBS SP 500-20, the
 * "Now is t" example, round trips, and the exports that WP 5.28 (LM hash) uses.
 */
import { describe, expect, test } from "vitest";
import { desDecryptBlock, desEncryptBlock, primitives } from "./des.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));

// [key, plaintext, ciphertext]
const KATS: [string, string, string][] = [
  // The worked example found in the DES literature (Grabbe).
  ["133457799bbcdff1", "0123456789abcdef", "85e813540f0ab405"],
  // "Now is t" under the key 0123456789abcdef (FIPS 81 appendix).
  ["0123456789abcdef", "4e6f772069732074", "3fa40e8a984d4815"],
  // NBS SP 500-20 variable plaintext known answer test (key 0101010101010101).
  ["0101010101010101", "8000000000000000", "95f8a5e5dd31d900"],
  ["0101010101010101", "4000000000000000", "dd7f121ca5015619"],
  ["0101010101010101", "2000000000000000", "2e8653104f3834ea"],
  // SP 500-20 variable key known answer test (plaintext zero).
  ["8001010101010101", "0000000000000000", "95a8d72813daa94d"],
  ["4001010101010101", "0000000000000000", "0eec1487dd8c26d5"],
  ["2001010101010101", "0000000000000000", "7ad16ffb79c45926"],
];

describe("des primitives", () => {
  test("are exported as private helpers", () => {
    expect(primitives.map((p) => p.name)).toEqual([
      "_check-key",
      "_encrypt-block",
      "_decrypt-block",
    ]);
  });

  test.each(KATS)("known answer %s / %s", (key, pt, ct) => {
    expect(hex(desEncryptBlock(unhex(pt), unhex(key)))).toBe(ct);
    expect(hex(desDecryptBlock(unhex(ct), unhex(key)))).toBe(pt);
  });

  test("the parity bits of the key are ignored", () => {
    const a = desEncryptBlock(unhex("0123456789abcdef"), unhex("133457799bbcdff1"));
    const b = desEncryptBlock(unhex("0123456789abcdef"), unhex("123556789abddef0"));
    expect(hex(a)).toBe(hex(b));
  });

  test("a wrong key or block length is E_RANGE", () => {
    expect(() => desEncryptBlock(new Uint8Array(8), new Uint8Array(7))).toThrow(/8 bytes/);
    expect(() => desEncryptBlock(new Uint8Array(7), new Uint8Array(8))).toThrow(/8 bytes/);
  });

  test("changing the key between calls changes the cached schedule", () => {
    const pt = unhex("0123456789abcdef");
    const k1 = unhex("133457799bbcdff1");
    const k2 = unhex("0123456789abcdef");
    const c1 = hex(desEncryptBlock(pt, k1));
    const c2 = hex(desEncryptBlock(pt, k2));
    expect(c1).not.toBe(c2);
    expect(hex(desEncryptBlock(pt, k1))).toBe(c1);
  });
});
