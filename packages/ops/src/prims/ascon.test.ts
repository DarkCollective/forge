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
import { aead, hash, mac, primitives } from "./ascon.js";

const hex = (u: Uint8Array) =>
  Array.from(u, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
const unhex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => Number.parseInt(x, 16));
const seq = (from: number, n: number) => Uint8Array.from({ length: n }, (_, i) => from + i);
const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return "none";
};

// Known-answer tests of the Ascon designers' reference repository (github.com/ascon/ascon-c, the files
// named below); the Count numbers are the files' own. The key is 00..0f in all of them.
const key = seq(0, 16);

describe("ascon primitives", () => {
  test("are exported as private primitives", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_hash", "_mac", "_aead"]);
  });

  // crypto_hash/asconhash256/LWC_HASH_KAT_128_256.txt: Msg is 00 01 02 ... (Count - 1 bytes).
  test.each([
    [1, 0, "0B3BE5850F2F6B98CAF29F8FDEA89B64A1FA70AA249B8F839BD53BAA304D92B2"],
    [2, 1, "0728621035AF3ED2BCA03BF6FDE900F9456F5330E4B5EE23E7F6A1E70291BC80"],
    [9, 8, "B88E497AE8E6FB641B87EF622EB8F2FCA0ED95383F7FFEBE167ACF1099BA764F"],
    [10, 9, "94269C30E0296E1EC86655041841823EFA1927F520FD58C8E9BCE6197878C1A6"],
    [17, 16, "3158C1940A2FBADBD68AB661777859B94A689E4EFC375911467ADDD641835C38"],
    [18, 17, "F149E99DD0F429599BB89B8079BF3F4DCA3F298EFEFCF9B1EA16FE84F9B8B6E2"],
    [34, 33, "A58665A2CB9530C502096A7957A76E428AF4AD044B4DA5C471F9DA6F7B3E5868"],
  ])("Ascon-Hash256 KAT Count %i (%i-byte message)", (_count, len, md) => {
    expect(hex(hash(seq(0, len)))).toBe(md);
  });

  // crypto_auth/asconmacv13/LWC_MAC_KAT_128_128.txt: Msg is 10 11 12 ... (Count - 1 bytes).
  test.each([
    [1, 0, "EAC9D74BBEDF8BF1EBA2862B26AA6D39"],
    [2, 1, "E5BE5B6DFB7B0E3EAE00A070791947A8"],
    [3, 2, "2FBF6E4B9F38F5833796D00AB74B7CAE"],
    [4, 3, "46A48DBA27848EE3B4DDC97C79D15835"],
    [33, 32, "9B103257685DDE6FD994426172BF7B64"],
    [34, 33, "29313284670B54F0564F9C73F27131F1"],
    [35, 34, "C2A51B64489344C82AE660CFF8BCEBEA"],
  ])("Ascon-Mac KAT Count %i (%i-byte message)", (_count, len, tag) => {
    expect(hex(mac(seq(0x10, len), key))).toBe(tag);
  });

  // crypto_aead/asconaead128/LWC_AEAD_KAT_128_128.txt: nonce 10..1f, PT 20 21 22 ..., AD 30 31 32 ...;
  // Count = 33 * (PT length) + (AD length) + 1.
  test.each([
    [1, 0, 0, "4F9C278211BEC9316BF68F46EE8B2EC6"],
    [2, 0, 1, "CCCB674FE18A09A285D6AB11B35675C0"],
    [3, 0, 2, "F65B191550C4DF9CFDD4460EBBCCA782"],
    [4, 0, 3, "D127CF7D2CD4DA8930616C70B3619F42"],
    [5, 0, 4, "000BA92E52B5ED6B97C9D913CC4C82DF"],
    [34, 1, 0, "E8DD576ABA1CD3E6FC704DE02AEDB79588"],
    [35, 1, 1, "962B8016836C75A7D86866588CA245D886"],
    [66, 1, 32, "CB9963324ED507234028425D0F64BA269C"],
    [529, 16, 0, "E8C3DEEE246CC5EAE3E872313897A2BB9EAA915C9DD3245D77048F24D46D27A7"],
    [530, 16, 1, "96107D8A29A7529A7941BDC7DF1FE3C6B48691673A22DA04BCC261FEE0FD6A4D"],
    [545, 16, 16, "6373EBB28BE97C9BAC090CF399C13EF13ABFC0D209E8F4844C90814D13F32C59"],
    [562, 17, 0, "E8C3DEEE246CC5EAE3E872313897A2BB60301002539D456275DD0B0CEAB3B23844"],
  ])("Ascon-AEAD128 KAT Count %i (PT %i bytes, AD %i bytes)", (_count, pt, ad, ct) => {
    const nonce = seq(0x10, 16);
    const out = aead(seq(0x20, pt), key, nonce, seq(0x30, ad), false);
    expect(hex(out)).toBe(ct);
    expect(hex(aead(out, key, nonce, seq(0x30, ad), true))).toBe(hex(seq(0x20, pt)));
  });

  test("a failed tag is E_COERCE, a short input is E_COERCE, bad lengths are E_RANGE", () => {
    const nonce = seq(0x10, 16);
    const ct = aead(seq(0x20, 5), key, nonce, new Uint8Array(0), false);
    const bad = ct.slice();
    bad[bad.length - 1] = bad[bad.length - 1]! ^ 1;
    expect(code(() => aead(bad, key, nonce, new Uint8Array(0), true))).toBe("E_COERCE");
    expect(code(() => aead(ct, key, nonce, Uint8Array.of(1), true))).toBe("E_COERCE");
    expect(code(() => aead(ct.slice(0, 15), key, nonce, new Uint8Array(0), true))).toBe("E_COERCE");
    expect(code(() => aead(ct, key.slice(1), nonce, new Uint8Array(0), true))).toBe("E_RANGE");
    expect(code(() => aead(ct, key, nonce.slice(1), new Uint8Array(0), true))).toBe("E_RANGE");
    expect(code(() => mac(ct, key.slice(1)))).toBe("E_RANGE");
  });

  test("a 64 KiB input round-trips", () => {
    const data = Uint8Array.from({ length: 65536 }, (_, i) => (i * 7 + 3) & 0xff);
    const nonce = seq(0x10, 16);
    const ct = aead(data, key, nonce, unhex("0102"), false);
    expect(ct.length).toBe(65536 + 16);
    expect(hex(aead(ct, key, nonce, unhex("0102"), true))).toBe(hex(data));
    expect(hash(data).length).toBe(32);
    expect(mac(data, key).length).toBe(16);
  });
});
