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
import { blockDecrypt, blockEncrypt, checkKey, crypt, gcmCrypt, primitives } from "./aes.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));

describe("aes primitives", () => {
  test("are exported as private helpers", () => {
    expect(primitives.map((p) => p.name)).toEqual([
      "_check-key",
      "_block-enc",
      "_block-dec",
      "_crypt",
      "_gcm",
    ]);
  });

  test("the raw block is the FIPS 197 appendix C.1 example", () => {
    const key = unhex("000102030405060708090a0b0c0d0e0f");
    const pt = unhex("00112233445566778899aabbccddeeff");
    const ct = blockEncrypt(pt, key);
    expect(hex(ct)).toBe("69c4e0d86a7b0430d8cdb78070b4c55a");
    expect(hex(blockDecrypt(ct, key))).toBe(hex(pt));
  });

  test("FIPS 197 appendix C.2 and C.3 (192 and 256-bit keys)", () => {
    const pt = unhex("00112233445566778899aabbccddeeff");
    expect(hex(blockEncrypt(pt, unhex("000102030405060708090a0b0c0d0e0f1011121314151617")))).toBe(
      "dda97ca4864cdfe06eaf70a0ec0d7191",
    );
    expect(
      hex(
        blockEncrypt(pt, unhex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f")),
      ),
    ).toBe("8ea2b7ca516745bfeafc49904b496089");
  });

  test("a bad key or block length is E_RANGE", () => {
    expect(() => checkKey(new Uint8Array(20))).toThrow(/16, 24 or 32 bytes/);
    expect(() => blockEncrypt(new Uint8Array(15), new Uint8Array(16))).toThrow(/16 bytes/);
    expect(() =>
      crypt(new Uint8Array(16), new Uint8Array(16), new Uint8Array(3), "CBC", true, false),
    ).toThrow(/IV must be 16/);
    expect(() =>
      crypt(new Uint8Array(16), new Uint8Array(16), new Uint8Array(16), "XTS", true, false),
    ).toThrow(/unknown AES mode/);
    expect(() =>
      gcmCrypt(new Uint8Array(1), new Uint8Array(16), new Uint8Array(4), new Uint8Array(0), false),
    ).toThrow(/at least 8/);
  });
});
