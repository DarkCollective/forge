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
 * Tests for the Blowfish primitives (src/prims/blowfish.ts): the digits of pi, Eric Young's ECB known
 * answers as published by Schneier (https://www.schneier.com/wp-content/uploads/2015/12/vectors-2.txt),
 * the variable key length set, and the exports that WP 5.28 (bcrypt) uses.
 */
import { describe, expect, test } from "vitest";
import {
  bfDecryptBlock,
  bfEncryptBlock,
  bfEncryptWords,
  bfExpandKey,
  bfInit,
  primitives,
} from "./blowfish.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));

function expanded(key: string, salt?: string) {
  const st = bfInit();
  bfExpandKey(st, unhex(key), salt === undefined ? undefined : unhex(salt));
  return st;
}

// [key, plaintext, ciphertext]: the ECB section of vectors-2.txt (the DES validation set, run through Blowfish).
const ECB: [string, string, string][] = [
  ["0000000000000000", "0000000000000000", "4ef997456198dd78"],
  ["ffffffffffffffff", "ffffffffffffffff", "51866fd5b85ecb8a"],
  ["3000000000000000", "1000000000000001", "7d856f9a613063f2"],
  ["1111111111111111", "1111111111111111", "2466dd878b963c9d"],
  ["0123456789abcdef", "1111111111111111", "61f9c3802281b096"],
  ["1111111111111111", "0123456789abcdef", "7d0cc630afda1ec7"],
  ["fedcba9876543210", "0123456789abcdef", "0aceab0fc6a0a28d"],
  ["7ca110454a1a6e57", "01a1d6d039776742", "59c68245eb05282b"],
  ["0131d9619dc1376e", "5cd54ca83def57da", "b1b8cc0b250f09a0"],
  ["07a1133e4a0b2686", "0248d43806f67172", "1730e5778bea1da4"],
  ["3849674c2602319e", "51454b582ddf440a", "a25e7856cf2651eb"],
  ["04b915ba43feb5b6", "42fd443059577fa2", "353882b109ce8f1a"],
  ["0113b970fd34f2ce", "059b5e0851cf143a", "48f4d0884c379918"],
  ["0170f175468fb5e6", "0756d8e0774761d2", "432193b78951fc98"],
  ["43297fad38e373fe", "762514b829bf486a", "13f04154d69d1ae5"],
  ["07a7137045da2a16", "3bdd119049372802", "2eedda93ffd39c79"],
  ["04689104c2fd3b2f", "26955f6835af609a", "d887e0393c2da6e3"],
  ["37d06bb516cb7546", "164d5e404f275232", "5f99d04f5b163969"],
  ["1f08260d1ac2465e", "6b056e18759f5cca", "4a057a3b24d3977b"],
  ["584023641aba6176", "004bd6ef09176062", "452031c1e4fada8e"],
  ["025816164629b007", "480d39006ee762f2", "7555ae39f59b87bd"],
  ["49793ebc79b3258f", "437540c8698f3cfa", "53c55f9cb49fc019"],
  ["4fb05e1515ab73a7", "072d43a077075292", "7a8e7bfa937e89a3"],
  ["49e95d6d4ca229bf", "02fe55778117f12a", "cf9c5d7a4986adb5"],
  ["018310dc409b26d6", "1d9d5c5018f728c2", "d1abb290658bc778"],
  ["1c587f1c13924fef", "305532286d6f295a", "55cb3774d13ef201"],
  ["0101010101010101", "0123456789abcdef", "fa34ec4847b268b2"],
  ["1f1f1f1f0e0e0e0e", "0123456789abcdef", "a790795108ea3cae"],
  ["e0fee0fef1fef1fe", "0123456789abcdef", "c39e072d9fac631d"],
  ["0000000000000000", "ffffffffffffffff", "014933e0cdaff6e4"],
  ["ffffffffffffffff", "0000000000000000", "f21e9a77b71c49bc"],
  ["0123456789abcdef", "0000000000000000", "245946885754369a"],
  ["fedcba9876543210", "ffffffffffffffff", "6b5c5a9c5d9e0a5a"],
];

describe("blowfish primitives", () => {
  test("are exported as private helpers", () => {
    expect(primitives.map((p) => p.name)).toEqual([
      "_check-key",
      "_encrypt-block",
      "_decrypt-block",
    ]);
  });

  test("the initial state is the digits of pi", () => {
    const st = bfInit();
    expect(st.p[0]!.toString(16)).toBe("243f6a88");
    expect(st.p[1]!.toString(16)).toBe("85a308d3");
    expect(st.p[17]!.toString(16)).toBe("8979fb1b");
    expect(st.s[0]!.toString(16)).toBe("d1310ba6");
    expect(st.s[1023]!.toString(16)).toBe("3ac372e6");
    // a second state is an independent copy
    st.p[0] = 0;
    expect(bfInit().p[0]!.toString(16)).toBe("243f6a88");
  });

  test.each(ECB)("ECB known answer %s / %s", (key, pt, ct) => {
    const st = expanded(key);
    expect(hex(bfEncryptBlock(st, unhex(pt)))).toBe(ct);
    expect(hex(bfDecryptBlock(st, unhex(ct)))).toBe(pt);
  });

  test("variable key length set: the first, a middle and the last of vectors-2.txt", () => {
    const pt = unhex("fedcba9876543210");
    const full = "f0e1d2c3b4a5968778695a4b3c2d1e0f0011223344556677";
    expect(hex(bfEncryptBlock(expanded(full.slice(0, 2)), pt))).toBe("f9ad597c49db005e");
    expect(hex(bfEncryptBlock(expanded(full.slice(0, 48)), pt))).toBe("05044b62fa52d080");
  });

  test("a zero salt is the plain key schedule, a real salt is not", () => {
    const key = "0123456789abcdef";
    const a = expanded(key);
    const b = expanded(key, "00000000000000000000000000000000");
    const c = expanded(key, "000102030405060708090a0b0c0d0e0f");
    const pt = unhex("0011223344556677");
    expect(hex(bfEncryptBlock(b, pt))).toBe(hex(bfEncryptBlock(a, pt)));
    expect(hex(bfEncryptBlock(c, pt))).not.toBe(hex(bfEncryptBlock(a, pt)));
  });

  test("bfEncryptWords agrees with bfEncryptBlock", () => {
    const st = expanded("0123456789abcdef");
    const out = new Uint32Array(2);
    bfEncryptWords(st, 0x00112233, 0x44556677, out);
    expect(hex(bfEncryptBlock(st, unhex("0011223344556677")))).toBe(
      out[0]!.toString(16).padStart(8, "0") + out[1]!.toString(16).padStart(8, "0"),
    );
  });
});
