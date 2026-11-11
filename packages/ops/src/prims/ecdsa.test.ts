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
 * Tests of the ecdsa primitives (src/prims/ecdsa.ts): the RFC 6979 appendix A.2 deterministic signatures (the
 * values were also computed with the Python `ecdsa` package and `cryptography`/OpenSSL, which agree), the curve
 * parameters against the named-curve modules of @noble/curves, and that the library never reads the host's
 * random generator.
 */
import { p256, p384, p521 } from "@noble/curves/nist.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256, sha384, sha512 } from "@noble/hashes/sha2.js";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  CURVES,
  keygen,
  primitives,
  publicKey,
  seedLength,
  sign,
  size,
  uncompressed,
  validPoint,
  verify,
} from "./ecdsa.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));
const text = (s: string) => new TextEncoder().encode(s);

const P256_D = unhex("c9afa9d845ba75166b5c215767b1d6934e50c3db36e89b127b8a622b120f6721");
const P384_D = unhex(
  "6b9d3dad2e1b8c1c05b19875b6659f4de23c3b667bf297ba9aa47740787137d896d5724e4c70a825f872c9ea60d2edf5",
);
const P521_D = unhex(
  "00fad06daa62ba3b25d2fb40133da757205de67f5bb0018fee8c86e1b68c7e75caa896eb32f1f47c70855836a6d16fcc1466f6d8fbec67db89ec0c08b0e996b83538",
);

afterEach(() => vi.restoreAllMocks());

describe("ecdsa primitives", () => {
  test("they are the private helpers of the ecdsa words", () => {
    expect(primitives.map((p) => p.name)).toEqual([
      "_size",
      "_seed-length",
      "_keygen",
      "_public-key",
      "_valid-point",
      "_uncompressed",
      "_sign",
      "_verify",
    ]);
  });

  test("RFC 6979 A.2.5: the public key of the P-256 key", () => {
    const pub = publicKey("P-256", P256_D);
    expect(hex(pub)).toBe(
      "0460fed4ba255a9d31c961eb74c6356d68c049b8923b61fa6ce669622e60f29fb67903fe1008b8bc99a41ae9e95628bc64f2f1b20c2d7e9f5177a3c294d4462299",
    );
  });

  test("RFC 6979 A.2.5: P-256 with SHA-256, 'sample' and 'test'", () => {
    expect(hex(sign("P-256", P256_D, sha256(text("sample")), "sha256"))).toBe(
      "efd48b2aacb6a8fd1140dd9cd45e81d69d2c877b56aaf991c34d0ea84eaf3716" +
        "f7cb1c942d657c41d436c7a1b6e29f65f3e900dbb9aff4064dc4ab2f843acda8",
    );
    expect(hex(sign("P-256", P256_D, sha256(text("test")), "sha256"))).toBe(
      "f1abb023518351cd71d881567b1ea663ed3efcf6c5132b354f28d3b0b7d38367" +
        "019f4113742a2b14bd25926b49c649155f267e60d3814b4c0cc84250e46f0083",
    );
  });

  test("RFC 6979 A.2.6: P-384 with SHA-384, 'sample'", () => {
    expect(hex(sign("P-384", P384_D, sha384(text("sample")), "sha384"))).toBe(
      "94edbb92a5ecb8aad4736e56c691916b3f88140666ce9fa73d64c4ea95ad133c81a648152e44acf96e36dd1e80fabe46" +
        "99ef4aeb15f178cea1fe40db2603138f130e740a19624526203b6351d0a3a94fa329c145786e679e7b82c71a38628ac8",
    );
  });

  test("RFC 6979 A.2.7: P-521 with SHA-512, 'sample'", () => {
    const sig = sign("P-521", P521_D, sha512(text("sample")), "sha512");
    expect(sig).toHaveLength(132);
    expect(hex(sig.subarray(0, 66))).toBe(
      "00c328fafcbd79dd77850370c46325d987cb525569fb63c5d3bc53950e6d4c5f174e25a1ee9017b5d450606add152b534931d7d4e8455cc91f9b15bf05ec36e377fa",
    );
    expect(hex(sig.subarray(66))).toBe(
      "00617cce7cf5064806c467f678d3b4080d6f1cc50af26ca209417308281b68af282623eaa63e5b5c0723d8b8c37ff0777b1a20f8ccb1dccc43997f1ee0e44da4a67a",
    );
  });

  test("a signature verifies, and a changed digest, key or signature does not", () => {
    const digest = sha256(text("sample"));
    const sig = sign("P-256", P256_D, digest, "sha256");
    const pub = publicKey("P-256", P256_D);
    expect(verify("P-256", pub, digest, sig, "sha256")).toBe(true);
    expect(verify("P-256", pub, sha256(text("other")), sig, "sha256")).toBe(false);
    const bad = Uint8Array.from(sig);
    bad[40] ^= 1;
    expect(verify("P-256", pub, digest, bad, "sha256")).toBe(false);
    expect(verify("P-256", pub, digest, sig.subarray(0, 63), "sha256")).toBe(false);
    expect(verify("P-256", pub, digest, new Uint8Array(64), "sha256")).toBe(false);
    expect(verify("P-256", publicKey("P-256", P384_D.subarray(0, 32)), digest, sig, "sha256")).toBe(
      false,
    );
  });

  test("a signature with the high half of s is accepted (lowS is off)", () => {
    const digest = sha256(text("sample"));
    const sig = Uint8Array.from(sign("P-256", P256_D, digest, "sha256"));
    const n = CURVES["P-256"]!.params.n;
    let s = 0n;
    for (const b of sig.subarray(32)) s = (s << 8n) | BigInt(b);
    const high = n - s;
    const flipped = new Uint8Array(64);
    flipped.set(sig.subarray(0, 32));
    for (let i = 0; i < 32; i++) flipped[63 - i] = Number((high >> BigInt(8 * i)) & 255n);
    expect(verify("P-256", publicKey("P-256", P256_D), digest, flipped, "sha256")).toBe(true);
  });

  test("a digest shorter or longer than the order is used as the standard says", () => {
    const pub = publicKey("P-256", P256_D);
    for (const len of [16, 20, 32, 48, 64]) {
      const digest = new Uint8Array(len).fill(0x5a);
      const sig = sign("P-256", P256_D, digest, "sha256");
      expect(verify("P-256", pub, digest, sig, "sha256")).toBe(true);
    }
  });

  test("the four curves have the parameters of the named-curve modules", () => {
    const named = { "P-256": p256, "P-384": p384, "P-521": p521, secp256k1 };
    for (const [name, curve] of Object.entries(named)) {
      const want = curve.Point.CURVE();
      const got = CURVES[name]!.params;
      expect(got.p).toBe(want.p);
      expect(got.n).toBe(want.n);
      expect(got.a).toBe(want.a);
      expect(got.b).toBe(want.b);
      expect(got.Gx).toBe(want.Gx);
      expect(got.Gy).toBe(want.Gy);
      expect(size(name)).toBe(Math.ceil(want.n.toString(2).length / 8));
    }
  });

  test("each curve signs and verifies with every digest", () => {
    for (const curve of Object.keys(CURVES)) {
      const d = new Uint8Array(size(curve)).fill(0x11);
      d[0] = 0;
      const pub = publicKey(curve, d);
      for (const [hash, len] of [
        ["md5", 16],
        ["sha1", 20],
        ["sha256", 32],
        ["sha384", 48],
        ["sha512", 64],
      ] as const) {
        const digest = new Uint8Array(len).fill(len);
        const sig = sign(curve, d, digest, hash);
        expect(sig).toHaveLength(2 * size(curve));
        expect(verify(curve, pub, digest, sig, hash)).toBe(true);
      }
    }
  });

  test("it never reads the host's random generator", () => {
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues");
    const mathSpy = vi.spyOn(Math, "random");
    for (const curve of Object.keys(CURVES)) {
      const d = new Uint8Array(size(curve)).fill(0x22);
      d[0] = 0;
      const digest = new Uint8Array(32).fill(1);
      const pub = publicKey(curve, d);
      const sig = sign(curve, d, digest, "sha256");
      expect(verify(curve, pub, digest, sig, "sha256")).toBe(true);
      keygen(curve, new Uint8Array(seedLength(curve)).fill(3));
    }
    expect(spy).not.toHaveBeenCalled();
    expect(mathSpy).not.toHaveBeenCalled();
  });

  test("a seed gives a private key of the order's size in 1 to n - 1, always the same", () => {
    for (const curve of Object.keys(CURVES)) {
      const seed = new Uint8Array(seedLength(curve)).fill(0xff);
      const d = keygen(curve, seed);
      expect(d).toHaveLength(size(curve));
      expect(hex(keygen(curve, seed))).toBe(hex(d));
      let v = 0n;
      for (const b of d) v = (v << 8n) | BigInt(b);
      expect(v >= 1n && v < CURVES[curve]!.params.n).toBe(true);
    }
    expect(seedLength("P-256")).toBe(48);
    expect(seedLength("P-384")).toBe(72);
    expect(seedLength("P-521")).toBe(99);
  });

  test("a seed of the wrong length, an unknown curve or digest and a bad key are refused", () => {
    expect(() => keygen("P-256", new Uint8Array(32))).toThrow(/seed/);
    expect(() => size("P-999")).toThrow(/unknown ECDSA curve/);
    expect(() => sign("P-256", P256_D, new Uint8Array(32), "sha3")).toThrow(/unknown ECDSA digest/);
    expect(() => sign("P-256", new Uint8Array(32), new Uint8Array(32), "sha256")).toThrow(
      /private key/,
    );
    expect(() => sign("P-256", P256_D.subarray(1), new Uint8Array(32), "sha256")).toThrow();
    expect(() => publicKey("P-256", new Uint8Array(32).fill(255))).toThrow();
  });

  test("a public key off the curve is refused by verify and uncompressed", () => {
    const pub = Uint8Array.from(publicKey("P-256", P256_D));
    const off = Uint8Array.from(pub);
    off[64] ^= 1;
    expect(validPoint("P-256", pub)).toBe(true);
    expect(validPoint("P-256", off)).toBe(false);
    expect(validPoint("P-256", new Uint8Array(65))).toBe(false);
    expect(() => verify("P-256", off, new Uint8Array(32), new Uint8Array(64), "sha256")).toThrow(
      /not on the curve/,
    );
    expect(() => uncompressed("P-256", off)).toThrow(/not on the curve/);
    const compressed = p256.getPublicKey(P256_D, true);
    expect(hex(uncompressed("P-256", compressed))).toBe(hex(pub));
  });

  test("secp256k1 and the other curves give the known public key of the key 1", () => {
    const one = (n: number) => {
      const d = new Uint8Array(n);
      d[n - 1] = 1;
      return d;
    };
    expect(hex(publicKey("secp256k1", one(32)).subarray(1, 33))).toBe(
      "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    );
    expect(hex(publicKey("P-256", one(32)).subarray(1, 33))).toBe(
      "6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296",
    );
    expect(hex(publicKey("P-384", one(48)).subarray(1, 49))).toBe(
      "aa87ca22be8b05378eb1c71ef320ad746e1d3b628ba79b9859f741e082542a385502f25dbf55296c3a545e3872760ab7",
    );
    expect(publicKey("P-521", one(66))).toHaveLength(133);
  });
});
