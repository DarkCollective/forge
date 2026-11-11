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
 * twofish primitives: the Twofish block cipher (B. Schneier, J. Kelsey, D. Whiting, D. Wagner, C. Hall,
 * N. Ferguson, "Twofish: A 128-Bit Block Cipher", AES submission, 1998), 128-bit block, 16 rounds, a
 * key of 128, 192 or 256 bits, written from the paper. The permutations q0 and q1 are built from the
 * paper's four 4-bit tables t0 to t3 (section 4.3.5, figure 6); the MDS matrix is over GF(2^8) modulo
 * x^8 + x^6 + x^5 + x^3 + 1 (0x169), the RS matrix over GF(2^8) modulo x^8 + x^6 + x^3 + x^2 + 1
 * (0x14d); the whitening, round keys and the key-dependent S-boxes follow sections 4.2 to 4.4. All
 * words are little-endian.
 *
 *  - `_check-key`: the key must be 16, 24 or 32 bytes (E_RANGE);
 *  - `_encrypt-block` and `_decrypt-block`: one 16-byte block, the block functions of the shared
 *    `blockmode` layer. The key schedule of the last key is cached (the round keys and the four
 *    key-dependent S-box tables of the paper, each merged with its MDS column).
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { checkBlock, getLE32, keyCache, putLE32, rotl32, rotr32 } from "../cipher-util.js";
import { rangeFailure } from "../prim-util.js";

// The 4-bit tables of q0 and q1 (paper, section 4.3.5).
const T0 = [
  [0x8, 0x1, 0x7, 0xd, 0x6, 0xf, 0x3, 0x2, 0x0, 0xb, 0x5, 0x9, 0xe, 0xc, 0xa, 0x4],
  [0x2, 0x8, 0xb, 0xd, 0xf, 0x7, 0x6, 0xe, 0x3, 0x1, 0x9, 0x4, 0x0, 0xa, 0xc, 0x5],
];
const T1 = [
  [0xe, 0xc, 0xb, 0x8, 0x1, 0x2, 0x3, 0x5, 0xf, 0x4, 0xa, 0x6, 0x7, 0x0, 0x9, 0xd],
  [0x1, 0xe, 0x2, 0xb, 0x4, 0xc, 0x3, 0x7, 0x6, 0xd, 0xa, 0x5, 0xf, 0x9, 0x0, 0x8],
];
const T2 = [
  [0xb, 0xa, 0x5, 0xe, 0x6, 0xd, 0x9, 0x0, 0xc, 0x8, 0xf, 0x3, 0x2, 0x4, 0x7, 0x1],
  [0x4, 0xc, 0x7, 0x5, 0x1, 0x6, 0x9, 0xa, 0x0, 0xe, 0xd, 0x8, 0x2, 0xb, 0x3, 0xf],
];
const T3 = [
  [0xd, 0x7, 0xf, 0x4, 0x1, 0x2, 0x6, 0xe, 0x9, 0xb, 0x3, 0x0, 0x8, 0x5, 0xc, 0xa],
  [0xb, 0x9, 0x5, 0x1, 0xc, 0x3, 0xd, 0xe, 0x6, 0x4, 0x7, 0xf, 0x2, 0x0, 0x8, 0xa],
];

const ror4 = (x: number, n: number) => ((x >> n) | (x << (4 - n))) & 15;

/** The 8-bit permutation q_n (n = 0 or 1) built from the four 4-bit tables. */
function makeQ(n: number): Uint8Array {
  const q = new Uint8Array(256);
  for (let x = 0; x < 256; x++) {
    const a0 = x >> 4;
    const b0 = x & 15;
    const a1 = a0 ^ b0;
    const b1 = (a0 ^ ror4(b0, 1) ^ ((8 * a0) & 15)) & 15;
    const a2 = T0[n]![a1]!;
    const b2 = T1[n]![b1]!;
    const a3 = a2 ^ b2;
    const b3 = (a2 ^ ror4(b2, 1) ^ ((8 * a2) & 15)) & 15;
    const a4 = T2[n]![a3]!;
    const b4 = T3[n]![b3]!;
    q[x] = 16 * b4 + a4;
  }
  return q;
}
const Q = [makeQ(0), makeQ(1)] as const;

/** Multiplication in GF(2^8) modulo the given polynomial (with the x^8 term). */
function gfMul(a: number, b: number, poly: number): number {
  let r = 0;
  while (b) {
    if (b & 1) r ^= a;
    a <<= 1;
    if (a & 256) a ^= poly;
    b >>= 1;
  }
  return r;
}

const MDS_POLY = 0x169;
const RS_POLY = 0x14d;
const MDS = [
  [0x01, 0xef, 0x5b, 0x5b],
  [0x5b, 0xef, 0xef, 0x01],
  [0xef, 0x5b, 0x01, 0xef],
  [0xef, 0x01, 0xef, 0x5b],
];
const RS = [
  [0x01, 0xa4, 0x55, 0x87, 0x5a, 0x58, 0xdb, 0x9e],
  [0xa4, 0x56, 0x82, 0xf3, 0x1e, 0xc6, 0x68, 0xe5],
  [0x02, 0xa1, 0xfc, 0xc1, 0x47, 0xae, 0x3d, 0x19],
  [0xa4, 0x55, 0x87, 0x5a, 0x58, 0xdb, 0x9e, 0x03],
];

/** MDS column j applied to the byte v, as a little-endian word. */
function mdsColumn(j: number, v: number): number {
  let w = 0;
  for (let i = 0; i < 4; i++) w |= gfMul(MDS[i]![j]!, v, MDS_POLY) << (8 * i);
  return w >>> 0;
}

/** The q-box and key-XOR chain of the function h for byte position i and input byte x (k = key words / 2). */
function hByte(i: number, x: number, l: readonly number[], k: number): number {
  const lb = (w: number) => (l[w]! >>> (8 * i)) & 255;
  let y = x;
  if (k === 4) y = Q[[1, 0, 0, 1][i]!]![y]! ^ lb(3);
  if (k >= 3) y = Q[[1, 1, 0, 0][i]!]![y]! ^ lb(2);
  switch (i) {
    case 0:
      return Q[1]![Q[0]![Q[0]![y]! ^ lb(1)]! ^ lb(0)]!;
    case 1:
      return Q[0]![Q[0]![Q[1]![y]! ^ lb(1)]! ^ lb(0)]!;
    case 2:
      return Q[1]![Q[1]![Q[0]![y]! ^ lb(1)]! ^ lb(0)]!;
    default:
      return Q[0]![Q[1]![Q[1]![y]! ^ lb(1)]! ^ lb(0)]!;
  }
}

/** The function h of the paper: x is a word, l the list of k key words. */
function h(x: number, l: readonly number[], k: number): number {
  let z = 0;
  for (let i = 0; i < 4; i++) z ^= mdsColumn(i, hByte(i, (x >>> (8 * i)) & 255, l, k));
  return z >>> 0;
}

interface TwofishKey {
  /** The 40 expanded key words: whitening 0 to 7, round keys 8 to 39. */
  readonly k: Uint32Array;
  /** The four key-dependent S-box tables merged with the MDS columns (4 x 256). */
  readonly sb: Uint32Array;
}

/** Rejects a key that is not 16, 24 or 32 bytes (E_RANGE). */
export function checkKey(key: Uint8Array): void {
  if (key.length !== 16 && key.length !== 24 && key.length !== 32)
    throw rangeFailure(`the Twofish key must be 16, 24 or 32 bytes, not ${key.length}`, {
      length: key.length,
    });
}

function expandKey(key: Uint8Array): TwofishKey {
  checkKey(key);
  const k = key.length / 8;
  const m = Array.from({ length: 2 * k }, (_, i) => getLE32(key, 4 * i));
  const me = Array.from({ length: k }, (_, i) => m[2 * i]!);
  const mo = Array.from({ length: k }, (_, i) => m[2 * i + 1]!);
  // The S vector, in the order (S_{k-1}, ..., S_0) in which h takes it.
  const sList: number[] = [];
  for (let i = 0; i < k; i++) {
    let w = 0;
    for (let r = 0; r < 4; r++) {
      let b = 0;
      for (let c = 0; c < 8; c++) b ^= gfMul(RS[r]![c]!, key[8 * i + c]!, RS_POLY);
      w |= b << (8 * r);
    }
    sList.unshift(w >>> 0);
  }
  const rho = 0x01010101;
  const ks = new Uint32Array(40);
  for (let i = 0; i < 20; i++) {
    const a = h(Math.imul(2 * i, rho) >>> 0, me, k);
    const b = rotl32(h(Math.imul(2 * i + 1, rho) >>> 0, mo, k), 8);
    ks[2 * i] = (a + b) >>> 0;
    ks[2 * i + 1] = rotl32((a + 2 * b) >>> 0, 9);
  }
  const sb = new Uint32Array(1024);
  for (let i = 0; i < 4; i++)
    for (let x = 0; x < 256; x++) sb[256 * i + x] = mdsColumn(i, hByte(i, x, sList, k));
  return { k: ks, sb };
}

const schedule = keyCache(expandKey);

/** The function g: the four S-box lookups. */
function g(sb: Uint32Array, x: number): number {
  return (
    (sb[x & 255]! ^
      sb[256 + ((x >>> 8) & 255)]! ^
      sb[512 + ((x >>> 16) & 255)]! ^
      sb[768 + (x >>> 24)]!) >>>
    0
  );
}

/** Encrypts one 16-byte block with a 16, 24 or 32-byte key. */
export function twofishEncryptBlock(block: Uint8Array, key: Uint8Array): Uint8Array {
  checkBlock(block, 16, "Twofish");
  const { k, sb } = schedule(key);
  let r0 = (getLE32(block, 0) ^ k[0]!) >>> 0;
  let r1 = (getLE32(block, 4) ^ k[1]!) >>> 0;
  let r2 = (getLE32(block, 8) ^ k[2]!) >>> 0;
  let r3 = (getLE32(block, 12) ^ k[3]!) >>> 0;
  for (let r = 0; r < 16; r++) {
    const t0 = g(sb, r0);
    const t1 = g(sb, rotl32(r1, 8));
    const f0 = (t0 + t1 + k[2 * r + 8]!) >>> 0;
    const f1 = (t0 + 2 * t1 + k[2 * r + 9]!) >>> 0;
    const n2 = rotr32((r2 ^ f0) >>> 0, 1);
    const n3 = (rotl32(r3, 1) ^ f1) >>> 0;
    r2 = r0;
    r3 = r1;
    r0 = n2;
    r1 = n3;
  }
  // The last swap is undone and the output whitening applied.
  const out = new Uint8Array(16);
  putLE32(out, 0, (r2 ^ k[4]!) >>> 0);
  putLE32(out, 4, (r3 ^ k[5]!) >>> 0);
  putLE32(out, 8, (r0 ^ k[6]!) >>> 0);
  putLE32(out, 12, (r1 ^ k[7]!) >>> 0);
  return out;
}

/** Decrypts one 16-byte block. */
export function twofishDecryptBlock(block: Uint8Array, key: Uint8Array): Uint8Array {
  checkBlock(block, 16, "Twofish");
  const { k, sb } = schedule(key);
  // The state after the last round's swap: (c2, c3, c0, c1) with the output whitening removed.
  let r0 = (getLE32(block, 8) ^ k[6]!) >>> 0;
  let r1 = (getLE32(block, 12) ^ k[7]!) >>> 0;
  let r2 = (getLE32(block, 0) ^ k[4]!) >>> 0;
  let r3 = (getLE32(block, 4) ^ k[5]!) >>> 0;
  for (let r = 15; r >= 0; r--) {
    // Undo the swap of this round, then the Feistel step.
    let t = r0;
    r0 = r2;
    r2 = t;
    t = r1;
    r1 = r3;
    r3 = t;
    const t0 = g(sb, r0);
    const t1 = g(sb, rotl32(r1, 8));
    const f0 = (t0 + t1 + k[2 * r + 8]!) >>> 0;
    const f1 = (t0 + 2 * t1 + k[2 * r + 9]!) >>> 0;
    r2 = (rotl32(r2, 1) ^ f0) >>> 0;
    r3 = rotr32((r3 ^ f1) >>> 0, 1);
  }
  const out = new Uint8Array(16);
  putLE32(out, 0, (r0 ^ k[0]!) >>> 0);
  putLE32(out, 4, (r1 ^ k[1]!) >>> 0);
  putLE32(out, 8, (r2 ^ k[2]!) >>> 0);
  putLE32(out, 12, (r3 ^ k[3]!) >>> 0);
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("twofish", "_check-key", "( key:bytes -- )", checkKey, {
    doc: "Raise E_RANGE unless the key is 16, 24 or 32 bytes (private helper of twofish:encrypt).",
    category: "Encryption",
  }),
  definePrimitive(
    "twofish",
    "_encrypt-block",
    "( block:bytes key:bytes -- bytes )",
    twofishEncryptBlock,
    {
      doc: "Encrypt one 16-byte block with raw Twofish (private block function for the blockmode layer).",
      category: "Encryption",
    },
  ),
  definePrimitive(
    "twofish",
    "_decrypt-block",
    "( block:bytes key:bytes -- bytes )",
    twofishDecryptBlock,
    {
      doc: "Decrypt one 16-byte block with raw Twofish (private block function for the blockmode layer).",
      category: "Encryption",
    },
  ),
];
