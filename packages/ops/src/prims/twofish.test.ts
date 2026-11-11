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
 * Tests for the Twofish primitives (src/prims/twofish.ts): the first three known answers of each key
 * size of the Twofish submission's ECB test vectors (ecb_ival.txt, "Intermediate Value Test" chain).
 */
import { describe, expect, test } from "vitest";
import { twofishDecryptBlock, twofishEncryptBlock, primitives } from "./twofish.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));

// [key, plaintext, ciphertext] for I = 1, 2, 3 of each KEYSIZE.
const KATS: [string, string, string][] = [
  [
    "00000000000000000000000000000000",
    "00000000000000000000000000000000",
    "9f589f5cf6122c32b6bfec2f2ae8c35a",
  ],
  [
    "00000000000000000000000000000000",
    "9f589f5cf6122c32b6bfec2f2ae8c35a",
    "d491db16e7b1c39e86cb086b789f5419",
  ],
  [
    "9f589f5cf6122c32b6bfec2f2ae8c35a",
    "d491db16e7b1c39e86cb086b789f5419",
    "019f9809de1711858faac3a3ba20fbc3",
  ],
  [
    "000000000000000000000000000000000000000000000000",
    "00000000000000000000000000000000",
    "efa71f788965bd4453f860178fc19101",
  ],
  [
    "000000000000000000000000000000000000000000000000",
    "efa71f788965bd4453f860178fc19101",
    "88b2b2706b105e36b446bb6d731a1e88",
  ],
  [
    "efa71f788965bd4453f860178fc191010000000000000000",
    "88b2b2706b105e36b446bb6d731a1e88",
    "39da69d6ba4997d585b6dc073ca341b2",
  ],
  [
    "0000000000000000000000000000000000000000000000000000000000000000",
    "00000000000000000000000000000000",
    "57ff739d4dc92c1bd7fc01700cc8216f",
  ],
  [
    "0000000000000000000000000000000000000000000000000000000000000000",
    "57ff739d4dc92c1bd7fc01700cc8216f",
    "d43bb7556ea32e46f2a282b7d45b4e0d",
  ],
  [
    "57ff739d4dc92c1bd7fc01700cc8216f00000000000000000000000000000000",
    "d43bb7556ea32e46f2a282b7d45b4e0d",
    "90afe91bb288544f2c32dc239b2635e6",
  ],
];

describe("twofish primitives", () => {
  test("are exported as private helpers", () => {
    expect(primitives.map((p) => p.name)).toEqual([
      "_check-key",
      "_encrypt-block",
      "_decrypt-block",
    ]);
  });

  test.each(KATS)("known answer, key %s", (key, pt, ct) => {
    expect(hex(twofishEncryptBlock(unhex(pt), unhex(key)))).toBe(ct);
    expect(hex(twofishDecryptBlock(unhex(ct), unhex(key)))).toBe(pt);
  });

  test("a wrong key length is E_RANGE", () => {
    expect(() => twofishEncryptBlock(new Uint8Array(16), new Uint8Array(20))).toThrow(
      /16, 24 or 32/,
    );
  });
});
