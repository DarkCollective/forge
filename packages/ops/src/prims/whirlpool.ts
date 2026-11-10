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
 * whirlpool primitive. Whirlpool is the 512-bit hash of ISO/IEC 10118-3 (the final, third
 * version, as in "The WHIRLPOOL Hashing Function", Barreto and Rijmen, revised 2003). It is a
 * Miyaguchi-Preneel hash over a 512-bit AES-like block cipher W with a 10-round key schedule; the
 * state is an 8x8 byte matrix. Too slow in FL at 64 KiB, so `_hash` is a TypeScript primitive.
 * The word `whirlpool:digest` (vocab/whirlpool.fth) holds the metadata. The S-box and the round
 * constants are generated from their defining formulas (section 7.1), not stored.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { mdPad } from "../hash-util-b.js";

// Section 7.1: the S-box is built from three 4-bit mini-boxes: E (and its inverse) and R.
const E = [0x1, 0xb, 0x9, 0xc, 0xd, 0x6, 0xf, 0x3, 0xe, 0x8, 0x7, 0x4, 0xa, 0x2, 0x5, 0x0];
const R = [0x7, 0xc, 0xb, 0xd, 0xe, 0x4, 0x9, 0xf, 0x6, 0x3, 0x8, 0xa, 0x2, 0x5, 0x1, 0x0];

function makeSbox(): Uint8Array {
  const einv: number[] = [];
  E.forEach((v, i) => (einv[v] = i));
  const sbox = new Uint8Array(256);
  for (let u = 0; u < 256; u++) {
    const a = E[u >> 4]!;
    const b = einv[u & 15]!;
    const r = R[a ^ b]!;
    sbox[u] = (E[a ^ r]! << 4) | einv[b ^ r]!;
  }
  return sbox;
}

/** Multiplication in GF(2^8) modulo x^8 + x^4 + x^3 + x^2 + 1 (0x11d), section 7.2. */
function gmul(a: number, b: number): number {
  let p = 0;
  for (; b > 0; b >>= 1) {
    if (b & 1) p ^= a;
    a <<= 1;
    if (a & 0x100) a ^= 0x11d;
  }
  return p;
}

// Section 7.2: the diffusion matrix C = cir(1, 1, 4, 1, 8, 5, 2, 9); row k is the first row
// rotated right by k places.
const CIRC = [1, 1, 4, 1, 8, 5, 2, 9];

interface Tables {
  /** Per input column j and byte value x: x times row j of C, as (high, low) 32-bit words. */
  readonly t: readonly Uint32Array[];
  /** The round constants rc[1..10], each as (high, low) of its non-zero first row. */
  readonly rc: Uint32Array;
}

let tables: Tables | undefined;

function getTables(): Tables {
  if (tables !== undefined) return tables;
  const sbox = makeSbox();
  const t: Uint32Array[] = [];
  for (let j = 0; j < 8; j++) {
    const tj = new Uint32Array(512);
    for (let x = 0; x < 256; x++) {
      const row = Array.from({ length: 8 }, (_, c) => gmul(sbox[x]!, CIRC[(c - j + 8) & 7]!));
      tj[2 * x] = ((row[0]! << 24) | (row[1]! << 16) | (row[2]! << 8) | row[3]!) >>> 0;
      tj[2 * x + 1] = ((row[4]! << 24) | (row[5]! << 16) | (row[6]! << 8) | row[7]!) >>> 0;
    }
    t.push(tj);
  }
  // Round constant of round r: first row is S[8(r-1)] .. S[8(r-1)+7], other rows zero.
  const rc = new Uint32Array(22);
  for (let r = 1; r <= 10; r++) {
    const o = 8 * (r - 1);
    rc[2 * r] =
      ((sbox[o]! << 24) | (sbox[o + 1]! << 16) | (sbox[o + 2]! << 8) | sbox[o + 3]!) >>> 0;
    rc[2 * r + 1] =
      ((sbox[o + 4]! << 24) | (sbox[o + 5]! << 16) | (sbox[o + 6]! << 8) | sbox[o + 7]!) >>> 0;
  }
  tables = { t, rc };
  return tables;
}

/**
 * One application of rho[k] = sigma[k] o theta o pi o gamma to the state `a` (8 rows of
 * high/low 32-bit words, 16 entries), XORing the key `k` (or, for the key schedule, the round
 * constant). Row i of the result is the XOR over columns j of T_j[ a[(i - j) mod 8][j] ] (the
 * column shift pi, then the row-times-matrix product theta, with gamma folded into the tables).
 */
function round(a: Uint32Array, out: Uint32Array, t: readonly Uint32Array[]): void {
  for (let i = 0; i < 8; i++) {
    let hi = 0;
    let lo = 0;
    for (let j = 0; j < 8; j++) {
      const src = (i - j + 8) & 7;
      // Column j of row `src`: byte j, in the high word for j < 4 and the low word otherwise.
      const w = a[2 * src + (j >> 2)]!;
      const byte = (w >>> (24 - 8 * (j & 3))) & 0xff;
      const tj = t[j]!;
      hi ^= tj[2 * byte]!;
      lo ^= tj[2 * byte + 1]!;
    }
    out[2 * i] = hi >>> 0;
    out[2 * i + 1] = lo >>> 0;
  }
}

/** The Whirlpool digest (64 bytes) of `data`. */
export function hash(data: Uint8Array): Uint8Array {
  const { t, rc } = getTables();
  // Section 5: padding to 256 mod 512 bits, then a 256-bit big-endian bit length.
  const m = mdPad(data, 64, 32, true);
  const view = new DataView(m.buffer);
  const h = new Uint32Array(16);
  const k = new Uint32Array(16);
  const s = new Uint32Array(16);
  const nk = new Uint32Array(16);
  const ns = new Uint32Array(16);
  const blk = new Uint32Array(16);
  for (let off = 0; off < m.length; off += 64) {
    for (let i = 0; i < 16; i++) blk[i] = view.getUint32(off + 4 * i);
    k.set(h);
    // sigma[k0] with k0 = H(i-1): the state is block XOR the key.
    for (let i = 0; i < 16; i++) s[i] = (blk[i]! ^ k[i]!) >>> 0;
    for (let r = 1; r <= 10; r++) {
      round(k, nk, t);
      nk[0] = (nk[0]! ^ rc[2 * r]!) >>> 0;
      nk[1] = (nk[1]! ^ rc[2 * r + 1]!) >>> 0;
      k.set(nk);
      round(s, ns, t);
      for (let i = 0; i < 16; i++) s[i] = (ns[i]! ^ k[i]!) >>> 0;
    }
    // Miyaguchi-Preneel feed-forward: H = W[H](m) xor H xor m.
    for (let i = 0; i < 16; i++) h[i] = (h[i]! ^ s[i]! ^ blk[i]!) >>> 0;
  }
  const out = new Uint8Array(64);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 16; i++) ov.setUint32(4 * i, h[i]!);
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("whirlpool", "_hash", "( data:bytes -- bytes )", hash, {
    doc: "The Whirlpool digest of the bytes (private helper of whirlpool:digest).",
    category: "Hashing",
  }),
];
