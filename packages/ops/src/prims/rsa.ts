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
 * rsa primitive: the prime search of RSA key generation. Everything else in `rsa` (the keys, the padding, the
 * private operation with the Chinese remainder theorem) is FL over the core `powmod`, which measured 4 ms for a
 * 1024-bit and 27 ms for a 2048-bit modular exponentiation, so a 4096-bit private operation is 55 ms in FL.
 *
 *  - `_prime ( pool:bytes bits:int bases:bytes -- int )`: the first probable prime among the candidates cut from
 *    `pool` (bits/8 bytes each), or 0 when none of them is. The primitive reads no random source: the caller
 *    supplies the random bytes (`random:bytes-of`), so the word that calls it carries `+random` and a test pins the
 *    source. A candidate has its top two bits set (so the product of two primes has exactly twice the bits) and its
 *    low bit set, is rejected when p - 1 is a multiple of 65537 (the public exponent must be invertible), when a prime
 *    below 65536 divides it (trial division by chunks: one BigInt remainder per chunk of primes whose product is below
 *    2^52), when 2^(p-1) is not 1 mod p (a cheap Fermat test: squarings only), and then by the Miller-Rabin test: base
 *    2 and one base per 16 bytes of `bases` (each 128 bits, reduced into [2, p - 2]). With 12 random bases and base 2
 *    that is 13 rounds: the error bound 4^-13 holds for any candidate, and for random candidates of 512 bits or more
 *    it is far below the 2^-100 that FIPS 186-5 (Appendix B, Table B.1) asks. The FL loop calls it with a pool of
 *    32 KiB (128 candidates of 2048 bits), so one call takes tens of milliseconds and the VM's time limit is checked
 *    between calls. The search is not constant time; the candidates are random and thrown away, never secret input.
 *
 * Measured (Node 22): the core `powmod` takes 27 ms for a 2048-bit exponentiation. The FL search of `prime:generate`
 * (trial division by the primes below 200, then one exponentiation for each of the 150 or so survivors per prime)
 * took, over 12 runs, a median of 1.9 s, a mean of 2.3 s and a maximum of 5.2 s for one 2048-bit prime, 549,000 VM
 * steps at most: a 4096-bit key needs two of them, about 4.6 s on average with a tail (about 1 run in 100 past the
 * 30 s limit here, and far more on a slower machine). Here the sieve to 65536 leaves about 1 candidate in 72 to test
 * and the Fermat test to base 2 needs squarings only (a doubling is a shift): a 2048-bit prime takes 0.2 to 3 s, a
 * 4096-bit key 1.8 s on average (median 1.4 s, slowest of twelve runs 3.4 s, 4,186 VM steps), a 2048-bit key 0.25 s
 * and a 1024-bit key 0.04 s.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { rangeFailure } from "../prim-util.js";

/** The public exponent of every generated key. */
const E = 65537n;

/** Chunks of the primes below 65536: the product (below 2^52, exact as a Number) and the primes in it. */
let chunks: { prod: bigint; primes: number[] }[] | undefined;

function sieveChunks(): { prod: bigint; primes: number[] }[] {
  if (chunks !== undefined) return chunks;
  const limit = 65536;
  const composite = new Uint8Array(limit);
  const out: { prod: bigint; primes: number[] }[] = [];
  let prod = 1;
  let primes: number[] = [];
  for (let p = 3; p < limit; p += 2) {
    if (composite[p] === 1) continue;
    for (let m = p * p; m < limit; m += 2 * p) composite[m] = 1;
    if (prod * p >= 2 ** 52) {
      out.push({ prod: BigInt(prod), primes });
      prod = 1;
      primes = [];
    }
    prod *= p;
    primes.push(p);
  }
  out.push({ prod: BigInt(prod), primes });
  chunks = out;
  return out;
}

/** True when no odd prime below 65536 divides n (n above 65536). */
function sieved(n: bigint): boolean {
  for (const c of sieveChunks()) {
    const r = Number(n % c.prod);
    for (const p of c.primes) if (r % p === 0) return false;
  }
  return true;
}

/** 2^e mod n by squarings, doubling instead of multiplying (n odd and above 2). */
function pow2(e: bigint, n: bigint): bigint {
  let r = 1n;
  for (const bit of e.toString(2)) {
    r = (r * r) % n;
    if (bit === "1") {
      r <<= 1n;
      if (r >= n) r -= n;
    }
  }
  return r;
}

function powmod(b: bigint, e: bigint, n: bigint): bigint {
  let r = 1n;
  b %= n;
  for (const bit of e.toString(2)) {
    r = (r * r) % n;
    if (bit === "1") r = (r * b) % n;
  }
  return r;
}

/** One Miller-Rabin round: d and s with n - 1 = d * 2^s, x = a^d mod n already computed. */
function strongWitness(x0: bigint, n: bigint, s: number): boolean {
  const nm1 = n - 1n;
  let x = x0;
  if (x === 1n || x === nm1) return true;
  for (let i = 1; i < s; i++) {
    x = (x * x) % n;
    if (x === nm1) return true;
    if (x === 1n) return false;
  }
  return false;
}

function toBig(b: Uint8Array): bigint {
  let h = "";
  for (const v of b) h += (v < 16 ? "0" : "") + v.toString(16);
  return h === "" ? 0n : BigInt("0x" + h);
}

/** True when the odd n above 65536 passes the Fermat test to base 2 and Miller-Rabin to base 2 and the given bases. */
function probablePrime(n: bigint, bases: Uint8Array): boolean {
  const nm1 = n - 1n;
  if (pow2(nm1, n) !== 1n) return false;
  let d = nm1;
  let s = 0;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    s++;
  }
  if (!strongWitness(pow2(d, n), n, s)) return false;
  for (let at = 0; at + 16 <= bases.length; at += 16) {
    const a = (toBig(bases.subarray(at, at + 16)) % (n - 3n)) + 2n;
    if (!strongWitness(powmod(a, d, n), n, s)) return false;
  }
  return true;
}

/** The first probable prime of `bits` bits among the candidates of the pool, or 0n. */
export function primeFromPool(pool: Uint8Array, bits: number | bigint, bases: Uint8Array): bigint {
  if (typeof bits !== "number" || bits < 64 || bits > 2048 || bits % 8 !== 0)
    throw rangeFailure("a prime for RSA has 64 to 2048 bits, a multiple of 8", { bits });
  const size = bits / 8;
  for (let at = 0; at + size <= pool.length; at += size) {
    const c = pool.slice(at, at + size);
    c[0] = (c[0] as number) | 0xc0;
    c[size - 1] = (c[size - 1] as number) | 1;
    const n = toBig(c);
    if ((n - 1n) % E === 0n) continue;
    if (!sieved(n)) continue;
    if (probablePrime(n, bases)) return n;
  }
  return 0n;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "rsa",
    "_prime",
    "( pool:bytes bits:int bases:bytes -- int )",
    (pool: Uint8Array, bits: number | bigint, bases: Uint8Array) =>
      primeFromPool(pool, bits, bases),
    {
      doc: "The first probable prime of the given size among the candidates cut from the random pool, or 0 (private helper of rsa:generate-key-pair).",
      category: "Public Key",
    },
  ),
];
