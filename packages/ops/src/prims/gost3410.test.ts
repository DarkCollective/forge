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
 * Tests of the gost3410 primitives (src/prims/gost3410.ts): the RFC 7091 section 7.1 and 7.2 examples (public key, r
 * and s from d, e and k), the consistency of every curve (the generator is on it and has the order q), the bounds of
 * the arguments, and that the library never reads the host's random generator.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { CURVES, order, primitives, publicKey, sign, size, verify } from "./gost3410.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));
const be = (v: bigint, n: number) => unhex(v.toString(16).padStart(2 * n, "0"));

afterEach(() => vi.restoreAllMocks());

// RFC 7091 section 7.1 (256 bits) and 7.2 (512 bits). e is the number of the RFC; the digest the primitive takes
// is its little-endian bytes (what the streebog words give).
const RFC = {
  "test-256": {
    d: "7a929ade789bb9be10ed359dd39a72c11b60961f49397eee1d19ce9891ec3b28",
    e: "2dfbc1b372d89a1188c09c52e0eec61fce52032ab1022e8e67ece6672b043ee5",
    k: "77105c9b20bcd3122823c8cf6fcc7b956de33814e95b7fe64fed924594dceab3",
    x: "7f2b49e270db6d90d8595bec458b50c58585ba1d4e9b788f6689dbd8e56fd80b",
    y: "26f1b489d6701dd185c8413a977b3cbbaf64d1c593d26627dffb101a87ff77da",
    r: "41aa28d2f1ab148280cd9ed56feda41974053554a42767b83ad043fd39dc0493",
    s: "01456c64ba4642a1653c235a98a60249bcd6d3f746b631df928014f6c5bf9c40",
  },
  "test-512": {
    d: "0ba6048aadae241ba40936d47756d7c93091a0e8514669700ee7508e508b102072e8123b2200a0563322dad2827e2714a2636b7bfd18aadfc62967821fa18dd4",
    e: "3754f3cfacc9e0615c4f4a7c4d8dab531b09b6f9c170c533a71d147035b0c5917184ee536593f4414339976c647c5d5a407adedb1d560c4fc6777d2972075b8c",
    k: "0359e7f4b1410feacc570456c6801496946312120b39d019d455986e364f365886748ed7a44b3e794434006011842286212273a6d14cf70ea3af71bb1ae679f1",
    x: "115dc5bc96760c7b48598d8ab9e740d4c4a85a65be33c1815b5c320c854621dd5a515856d13314af69bc5b924c8b4ddff75c45415c1d9dd9dd33612cd530efe1",
    y: "37c7c90cd40b0f5621dc3ac1b751cfa0e2634fa0503b3d52639f5d7fb72afd61ea199441d943ffe7f0c70a2759a3cdb84c114e1f9339fdf27f35eca93677beec",
    r: "2f86fa60a081091a23dd795e1e3c689ee512a3c82ee0dcc2643c78eea8fcacd35492558486b20f1c9ec197c90699850260c93bcbcd9c5c3317e19344e173ae36",
    s: "1081b394696ffe8e6585e7a9362d26b6325f56778aadbc081c0bfbe933d52ff5823ce288e8c4f362526080df7f70ce406a6eeb1f56919cb92a9853bde73e5b4a",
  },
} as const;

describe("gost3410 primitives", () => {
  test("they are the private helpers of the gost3410 words", () => {
    expect(primitives.map((p) => p.name)).toEqual([
      "_size",
      "_order",
      "_public-key",
      "_sign",
      "_verify",
    ]);
  });

  for (const [curve, v] of Object.entries(RFC)) {
    test(`RFC 7091 ${curve}: the public key, r and s reproduce, and the signature verifies`, () => {
      const n = size(curve);
      const d = unhex(v.d);
      const pub = publicKey(curve, d);
      expect(hex(pub)).toBe(v.x + v.y);
      const digest = unhex(v.e).reverse();
      const sig = sign(curve, d, digest, unhex(v.k));
      expect(hex(sig)).toBe(v.r + v.s);
      expect(verify(curve, pub, digest, sig)).toBe(true);
      const bad = Uint8Array.from(sig);
      bad[n + 3] ^= 1;
      expect(verify(curve, pub, digest, bad)).toBe(false);
      const other = Uint8Array.from(digest);
      other[0] ^= 1;
      expect(verify(curve, pub, other, sig)).toBe(false);
    });
  }

  test("every curve: the generator is on it and q times it is the point at infinity", () => {
    for (const [name, c] of Object.entries(CURVES)) {
      const { p, n, a, b, Gx, Gy } = c.params;
      expect((Gy * Gy - (Gx * Gx * Gx + a * Gx + b)) % p).toBe(0n);
      // (q - 1) G = -G, so q G is the point at infinity
      const last = publicKey(name, be(n - 1n, c.size));
      expect(hex(last.subarray(0, c.size))).toBe(hex(be(Gx, c.size)));
      expect(hex(last.subarray(c.size))).toBe(hex(be(p - Gy, c.size)));
      expect(order(name)).toBe(n);
    }
  });

  test("the digest's bytes are read as a little-endian number: e = alpha mod q, and 0 becomes 1", () => {
    const d = unhex(RFC["test-256"].d);
    const k = unhex(RFC["test-256"].k);
    const q = CURVES["test-256"]!.params.n;
    const sigOf = (digest: Uint8Array) => hex(sign("test-256", d, digest, k));
    // alpha = q and alpha = 0 both give e = 1 (q mod q = 0), and 1 itself
    const one = be(1n, 32).reverse();
    expect(sigOf(be(q, 32).reverse())).toBe(sigOf(one));
    expect(sigOf(new Uint8Array(32))).toBe(sigOf(one));
    // big-endian reading would differ
    expect(sigOf(be(5n, 32))).not.toBe(sigOf(be(5n, 32).reverse()));
  });

  test("bounds: keys, k, digest and signature sizes", () => {
    const d = unhex(RFC["test-256"].d);
    const k = unhex(RFC["test-256"].k);
    const digest = new Uint8Array(32).fill(1);
    expect(() => sign("test-256", d.subarray(1), digest, k)).toThrow(/32 bytes/);
    expect(() => sign("test-256", new Uint8Array(32), digest, k)).toThrow(/private key/);
    expect(() => sign("test-256", be(CURVES["test-256"]!.params.n, 32), digest, k)).toThrow();
    expect(() => sign("test-256", d, digest, new Uint8Array(32))).toThrow(/k must be/);
    expect(() => sign("test-256", d, digest.subarray(1), k)).toThrow(/digest/);
    expect(() => sign("test-512", d, digest, k)).toThrow(/64 bytes/);
    expect(() => size("nope")).toThrow(/unknown GOST/);
    const pub = publicKey("test-256", d);
    const sig = sign("test-256", d, digest, k);
    expect(verify("test-256", pub, digest, sig.subarray(1))).toBe(false);
    expect(verify("test-256", pub, digest, new Uint8Array(64))).toBe(false);
    const off = Uint8Array.from(pub);
    off[63] ^= 1;
    expect(() => verify("test-256", off, digest, sig)).toThrow(/not on the curve/);
    expect(() => verify("test-256", pub.subarray(1), digest, sig)).toThrow(/64 bytes/);
  });

  test("r and s outside 1 to q - 1 are a failure", () => {
    const d = unhex(RFC["test-256"].d);
    const pub = publicKey("test-256", d);
    const digest = new Uint8Array(32).fill(7);
    const q = CURVES["test-256"]!.params.n;
    const mk = (r: bigint, s: bigint) => Uint8Array.from([...be(r, 32), ...be(s, 32)]);
    expect(verify("test-256", pub, digest, mk(0n, 1n))).toBe(false);
    expect(verify("test-256", pub, digest, mk(1n, 0n))).toBe(false);
    expect(verify("test-256", pub, digest, mk(q, 1n))).toBe(false);
    expect(verify("test-256", pub, digest, mk(1n, q))).toBe(false);
  });

  test("it never reads the host's random generator", () => {
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues");
    for (const [curve, v] of Object.entries(RFC)) {
      const pub = publicKey(curve, unhex(v.d));
      const sig = sign(curve, unhex(v.d), unhex(v.e).reverse(), unhex(v.k));
      verify(curve, pub, unhex(v.e).reverse(), sig);
    }
    expect(spy).not.toHaveBeenCalled();
  });
});
