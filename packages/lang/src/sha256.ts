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

/**
 * Synchronous SHA-256, written from the description in FIPS 180-4 (spec section 12.4).
 * No WebCrypto and no dependency, so `load()` can hash without awaiting.
 */
import type { Sha256Fn } from "./types.js";

/** Round constants K0..K63: the first 32 bits of the fractional parts of the cube roots of the first 64 primes. */
const K = new Uint32Array(64);
/** Initial hash value H0..H7: the same for the square roots of the first 8 primes. */
const H0 = new Uint32Array(8);

(function initConstants(): void {
  const primes: number[] = [];
  for (let n = 2; primes.length < 64; n++) {
    if (primes.every((p) => n % p !== 0)) primes.push(n);
  }
  // Integer roots via BigInt, so no floating-point rounding can touch the 32 fraction bits:
  // floor(root(p) * 2^32) = floor(root(p * 2^(32 * root))).
  const frac = (p: number, root: 2 | 3): number => {
    const scaled = BigInt(p) << BigInt(32 * root);
    let lo = 0n;
    let hi = 1n << 40n;
    while (lo < hi) {
      const mid = (lo + hi + 1n) >> 1n;
      if (mid ** BigInt(root) <= scaled) lo = mid;
      else hi = mid - 1n;
    }
    return Number(lo & 0xffffffffn);
  };
  primes.forEach((p, i) => {
    K[i] = frac(p, 3);
    if (i < 8) H0[i] = frac(p, 2);
  });
})();

// The package builds against ES2022 only (no DOM or Node typings), so declare the global used.
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

const utf8 = new TextEncoder();
const W = new Uint32Array(64);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** SHA-256 of `data` (strings are UTF-8 encoded) as 64 lowercase hex digits. */
export const sha256: Sha256Fn = (data) => {
  const msg = typeof data === "string" ? utf8.encode(data) : data;
  const len = msg.length;
  // Padding: 0x80, zeros, then the 64-bit big-endian bit length; total a multiple of 64 bytes.
  const total = (Math.floor((len + 8) / 64) + 1) * 64;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(total - 8, Math.floor(len / 0x20000000), false);
  view.setUint32(total - 4, (len % 0x20000000) * 8, false);

  const h = Uint32Array.from(H0);
  for (let off = 0; off < total; off += 64) {
    for (let t = 0; t < 16; t++) W[t] = view.getUint32(off + 4 * t, false);
    for (let t = 16; t < 64; t++) {
      const w15 = W[t - 15] as number;
      const w2 = W[t - 2] as number;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      W[t] = ((W[t - 16] as number) + s0 + (W[t - 7] as number) + s1) | 0;
    }
    let a = h[0] as number;
    let b = h[1] as number;
    let c = h[2] as number;
    let d = h[3] as number;
    let e = h[4] as number;
    let f = h[5] as number;
    let g = h[6] as number;
    let hh = h[7] as number;
    for (let t = 0; t < 64; t++) {
      const bigS1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + bigS1 + ch + (K[t] as number) + (W[t] as number)) | 0;
      const bigS0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (bigS0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0] as number) + a;
    h[1] = (h[1] as number) + b;
    h[2] = (h[2] as number) + c;
    h[3] = (h[3] as number) + d;
    h[4] = (h[4] as number) + e;
    h[5] = (h[5] as number) + f;
    h[6] = (h[6] as number) + g;
    h[7] = (h[7] as number) + hh;
  }
  let out = "";
  for (const word of h) out += word.toString(16).padStart(8, "0");
  return out;
};
