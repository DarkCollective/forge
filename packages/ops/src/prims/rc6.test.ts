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
 * Tests for the RC6 primitives (src/prims/rc6.ts): the RC6-32/20 test vectors of the RC6 paper
 * (Rivest, Robshaw, Sidney, Yin, "The RC6 Block Cipher", appendix: test vectors), the magic constants,
 * and the equality of the 32-bit fast path and the BigInt path.
 */
import { describe, expect, test } from "vitest";
import {
  magic,
  rc6DecryptBlock,
  rc6DecryptBlockBig,
  rc6EncryptBlock,
  rc6EncryptBlockBig,
  primitives,
} from "./rc6.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));

const PT2 = "02132435465768798a9bacbdcedfe0f1";
// [key, plaintext, ciphertext], RC6-32/20.
const KATS: [string, string, string][] = [
  [
    "00000000000000000000000000000000",
    "00000000000000000000000000000000",
    "8fc3a53656b1f778c129df4e9848a41e",
  ],
  ["0123456789abcdef0112233445566778", PT2, "524e192f4715c6231f51f6367ea43f18"],
  [
    "000000000000000000000000000000000000000000000000",
    "00000000000000000000000000000000",
    "6cd61bcb190b30384e8a3f168690ae82",
  ],
  ["0123456789abcdef0112233445566778899aabbccddeeff0", PT2, "688329d019e505041e52e92af95291d4"],
  [
    "0000000000000000000000000000000000000000000000000000000000000000",
    "00000000000000000000000000000000",
    "8f5fbd0510d15fa893fa3fda6e857ec2",
  ],
  [
    "0123456789abcdef0112233445566778899aabbccddeeff01032547698badcfe",
    PT2,
    "c8241816f0d7e48920ad16a1674e5d48",
  ],
];

describe("rc6 primitives", () => {
  test("are exported as private helpers", () => {
    expect(primitives.map((p) => p.name)).toEqual([
      "_check-key",
      "_encrypt-block",
      "_decrypt-block",
    ]);
  });

  test("the magic constants of RC6-32 are P32 = b7e15163 and Q32 = 9e3779b9", () => {
    const { p, q } = magic(32);
    expect(p.toString(16)).toBe("b7e15163");
    expect(q.toString(16)).toBe("9e3779b9");
    // the 64-bit constants are the ones of RC5-64 (the same definition)
    expect(magic(64).p.toString(16)).toBe("b7e151628aed2a6b");
    expect(magic(64).q.toString(16)).toBe("9e3779b97f4a7c15");
    expect(magic(16).p.toString(16)).toBe("b7e1");
    expect(magic(16).q.toString(16)).toBe("9e37");
  });

  test.each(KATS)("RC6-32/20 known answer, key %s", (key, pt, ct) => {
    expect(hex(rc6EncryptBlock(unhex(pt), unhex(key), 32, 20))).toBe(ct);
    expect(hex(rc6DecryptBlock(unhex(ct), unhex(key), 32, 20))).toBe(pt);
  });

  test("the BigInt path equals the 32-bit path at w = 32, for several round counts", () => {
    const key = unhex("0123456789abcdef0112233445566778899aabbccddeeff0");
    const pt = unhex(PT2);
    for (const r of [1, 7, 20, 255]) {
      const fast = rc6EncryptBlock(pt, key, 32, r);
      expect(hex(rc6EncryptBlockBig(pt, key, 32, r))).toBe(hex(fast));
      expect(hex(rc6DecryptBlockBig(fast, key, 32, r))).toBe(hex(pt));
    }
  });

  test("other word sizes round-trip and use w / 2 byte blocks", () => {
    const key = unhex("0123456789abcdef");
    for (const w of [8, 16, 24, 64, 128, 256]) {
      const pt = Uint8Array.from({ length: w / 2 }, (_, i) => i * 7 + 1);
      const ct = rc6EncryptBlock(pt, key, w, 20);
      expect(ct.length).toBe(w / 2);
      expect(hex(ct)).not.toBe(hex(pt));
      expect(hex(rc6DecryptBlock(ct, key, w, 20))).toBe(hex(pt));
    }
  });

  test("bad parameters are E_RANGE", () => {
    const b = new Uint8Array(16);
    expect(() => rc6EncryptBlock(b, new Uint8Array(256), 32, 20)).toThrow(/255/);
    expect(() => rc6EncryptBlock(b, new Uint8Array(16), 12, 20)).toThrow(/word size/);
    expect(() => rc6EncryptBlock(b, new Uint8Array(16), 32, 0)).toThrow(/rounds/);
    expect(() => rc6EncryptBlock(b, new Uint8Array(16), 264, 20)).toThrow(/word size/);
  });
});
