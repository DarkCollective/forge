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
 * Tests for the rsa primitive (src/prims/rsa.ts): the prime search of key generation on fixed pools of bytes.
 * Primality is checked with node:crypto (OpenSSL), an implementation independent of the one under test. The
 * words, the vectors and the measured costs are in src/rsa.test.ts and vocab/rsa.test.json.
 */
import { describe, expect, test } from "vitest";
import { primeFromPool, primitives } from "./rsa.js";

interface NodeCrypto {
  checkPrimeSync(candidate: bigint): boolean;
}
const nodeModule: string = "node:crypto";
const nodeCrypto = (await import(nodeModule)) as NodeCrypto;

/** SplitMix64: a small deterministic generator for the pools. */
function splitmix(seed: bigint): () => bigint {
  let s = seed;
  const mask = (1n << 64n) - 1n;
  return () => {
    s = (s + 0x9e3779b97f4a7c15n) & mask;
    let z = s;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & mask;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & mask;
    return z ^ (z >> 31n);
  };
}

function pool(seed: bigint, length: number): Uint8Array {
  const next = splitmix(seed);
  const out = new Uint8Array(length);
  for (let at = 0; at < length; at += 8) {
    let v = next();
    for (let i = 0; i < 8 && at + i < length; i++) {
      out[at + i] = Number(v & 255n);
      v >>= 8n;
    }
  }
  return out;
}

const toBytes = (v: bigint, size: number): Uint8Array => {
  const out = new Uint8Array(size);
  for (let i = size - 1; i >= 0; i--) {
    out[i] = Number(v & 255n);
    v >>= 8n;
  }
  return out;
};
const toBig = (b: Uint8Array): bigint => b.reduce((acc, x) => (acc << 8n) | BigInt(x), 0n);
const bases = pool(99n, 192);

describe("rsa primitives", () => {
  test("are exported with the name the vocabulary uses", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_prime"]);
    expect(primitives[0]?.vocab).toBe("rsa");
  });

  test("a prime of each size: right length, top two bits, odd, and prime for OpenSSL", () => {
    for (const bits of [64, 128, 512, 1024]) {
      let found = 0n;
      for (let seed = 1n; found === 0n && seed < 50n; seed++)
        found = primeFromPool(pool(seed * 1000n + BigInt(bits), 8192), bits, bases);
      expect(found).not.toBe(0n);
      expect(found.toString(2)).toHaveLength(bits);
      expect(found >> BigInt(bits - 2)).toBe(3n);
      expect(found & 1n).toBe(1n);
      expect(nodeCrypto.checkPrimeSync(found)).toBe(true);
      expect((found - 1n) % 65537n).not.toBe(0n);
    }
  });

  test("the result is the first prime among the candidates, in pool order, and is deterministic", () => {
    const p = pool(7n, 64 * 1500);
    const first = primeFromPool(p, 512, bases);
    expect(first).toBe(primeFromPool(p, 512, bases));
    expect(first).not.toBe(0n);
    // the candidates before it are not prime (the search keeps the order of the pool)
    for (let at = 0; at + 64 <= p.length; at += 64) {
      const c = p.slice(at, at + 64);
      c[0] = (c[0] as number) | 0xc0;
      c[63] = (c[63] as number) | 1;
      const v = toBig(c);
      if (v === first) break;
      expect(nodeCrypto.checkPrimeSync(v) && (v - 1n) % 65537n !== 0n).toBe(false);
    }
  });

  test("a pool that is too short or holds no prime gives 0", () => {
    expect(primeFromPool(new Uint8Array(0), 64, bases)).toBe(0n);
    expect(primeFromPool(new Uint8Array(7), 64, bases)).toBe(0n);
    expect(primeFromPool(new Uint8Array(8 * 20), 64, bases)).toBe(0n); // all zero bytes: 0xc000...01 is divisible by 3
  });

  test("a prime with p - 1 a multiple of 65537 is refused (the public exponent would not be invertible)", () => {
    // 64-bit primes p = 65537 m + 1 with the top two bits set
    const bad: bigint[] = [];
    for (let m = (0xc000000000000000n - 1n) / 65537n + 1n; bad.length < 3; m++) {
      const p = 65537n * m + 1n;
      if (p >= 1n << 64n) break;
      if ((p & 1n) === 1n && nodeCrypto.checkPrimeSync(p)) bad.push(p);
    }
    expect(bad).toHaveLength(3);
    const p = new Uint8Array(24);
    bad.forEach((v, i) => p.set(toBytes(v, 8), i * 8));
    expect(primeFromPool(p, 64, bases)).toBe(0n);
  });

  test("composites are refused: products of large primes, which no sieve below 65536 catches", () => {
    const small: bigint[] = [];
    for (let v = 0xe0000001n; small.length < 12; v += 2n)
      if (nodeCrypto.checkPrimeSync(v)) small.push(v);
    const composites = [];
    for (let i = 0; i + 1 < small.length; i++)
      composites.push((small[i] as bigint) * (small[i + 1] as bigint));
    const p = new Uint8Array(composites.length * 8);
    composites.forEach((v, i) => {
      expect(v >> 62n).toBe(3n);
      p.set(toBytes(v, 8), i * 8);
    });
    expect(primeFromPool(p, 64, bases)).toBe(0n);
  });

  test("the size is checked", () => {
    for (const bits of [0, 8, 63, 65, 2056, -64])
      expect(() => primeFromPool(new Uint8Array(100), bits, bases)).toThrow(/64 to 2048 bits/);
    expect(() => primeFromPool(new Uint8Array(100), 64n, bases)).toThrow(/64 to 2048 bits/);
  });
});
