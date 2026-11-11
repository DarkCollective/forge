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
 * Tests for the SM4 primitives (src/prims/sm4.ts): GB/T 32907-2016 appendix A (the single block and the
 * 1,000,000-fold repeated encryption, as reproduced in draft-ribose-cfrg-sm4 appendix A.1).
 */
import { describe, expect, test } from "vitest";
import { sm4DecryptBlock, sm4EncryptBlock, primitives } from "./sm4.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));

const KEY = unhex("0123456789abcdeffedcba9876543210");

describe("sm4 primitives", () => {
  test("are exported as private helpers", () => {
    expect(primitives.map((p) => p.name)).toEqual([
      "_check-key",
      "_encrypt-block",
      "_decrypt-block",
    ]);
  });

  test("GB/T 32907-2016 appendix A example 1", () => {
    const ct = sm4EncryptBlock(KEY, KEY);
    expect(hex(ct)).toBe("681edf34d206965e86b3e94f536e4246");
    expect(hex(sm4DecryptBlock(ct, KEY))).toBe(hex(KEY));
  });

  test("GB/T 32907-2016 appendix A example 2: 1,000,000 encryptions", () => {
    let b: Uint8Array = KEY;
    for (let i = 0; i < 1_000_000; i++) b = sm4EncryptBlock(b, KEY);
    expect(hex(b)).toBe("595298c7c6fd271f0402f804c33d3f66");
  }, 60_000);

  test("a wrong key length is E_RANGE", () => {
    expect(() => sm4EncryptBlock(KEY, new Uint8Array(15))).toThrow(/16 bytes/);
  });
});
