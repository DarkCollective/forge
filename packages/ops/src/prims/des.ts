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
 * des primitives: the Data Encryption Standard (FIPS 46-3, 64-bit block, 56-bit key), written from the
 * specification. The tables (IP, PC-1, PC-2, P, the key rotations and the eight S-boxes) are the ones
 * printed in FIPS 46-3; the final permutation is computed as the inverse of IP, and the S-boxes and the
 * P permutation are merged once at load into eight 64-entry lookup tables.
 *
 *  - `_check-key`: the key must be 8 bytes (E_RANGE; the parity bits are not checked);
 *  - `_encrypt-block` and `_decrypt-block`: one 8-byte block, the block functions of the shared
 *    `blockmode` layer. The key schedule of the last key is cached.
 *
 * Also exported for other primitive modules (triple-des, and the LM hash of WP 5.28): `desBlock`,
 * `desKeySchedule`, `desEncryptBlock` and `desDecryptBlock`.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { keyCache, checkBlock, getBE32, putBE32, rotl32, rotr32 } from "../cipher-util.js";
import { rangeFailure } from "../prim-util.js";

/** Initial permutation IP (FIPS 46-3): output bit i is input bit IP[i], bit 1 being the most significant. */
const IP = [
  58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6, 64,
  56, 48, 40, 32, 24, 16, 8, 57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3, 61, 53,
  45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
];
/** Permuted choice 1 (64 key bits to 56). */
const PC1 = [
  57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60,
  52, 44, 36, 63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21,
  13, 5, 28, 20, 12, 4,
];
/** Permuted choice 2 (56 bits to the 48-bit round key). */
const PC2 = [
  14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10, 23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2, 41, 52,
  31, 37, 47, 55, 30, 40, 51, 45, 33, 48, 44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32,
];
/** The left rotation of the two key halves before each round. */
const SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
/** The permutation P of the round function (32 bits). */
const P = [
  16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10, 2, 8, 24, 14, 32, 27, 3, 9, 19, 13,
  30, 6, 22, 11, 4, 25,
];
/** S-boxes S1 to S8, each as four rows of 16 values (row selected by the outer bits of the 6-bit input). */
const SBOX = [
  [
    14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11,
    9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5,
    11, 3, 14, 10, 0, 6, 13,
  ],
  [
    15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10,
    6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2,
    11, 6, 7, 12, 0, 5, 14, 9,
  ],
  [
    10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12,
    11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4,
    15, 14, 3, 11, 5, 2, 12,
  ],
  [
    7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1,
    10, 14, 9, 10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 1, 13, 8, 9,
    4, 5, 11, 12, 7, 2, 14,
  ],
  [
    2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10,
    3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6,
    15, 0, 9, 10, 4, 5, 3,
  ],
  [
    12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14,
    0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10,
    11, 14, 1, 7, 6, 0, 8, 13,
  ],
  [
    4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12,
    2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9,
    5, 0, 15, 14, 2, 3, 12,
  ],
  [
    13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11,
    0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13,
    15, 12, 9, 0, 3, 5, 6, 11,
  ],
];

/** FP, the inverse of IP. */
const FP = ((): number[] => {
  const fp = new Array<number>(64);
  IP.forEach((src, i) => {
    fp[src - 1] = i + 1;
  });
  return fp;
})();

/** Applies a bit permutation table to a 64-bit value held as two halves: returns [hi, lo]. */
function permute64(table: readonly number[], hi: number, lo: number): [number, number] {
  let oh = 0;
  let ol = 0;
  for (let i = 0; i < 64; i++) {
    const src = table[i]! - 1; // 0-based from the most significant bit
    const bit = src < 32 ? (hi >>> (31 - src)) & 1 : (lo >>> (63 - src)) & 1;
    if (i < 32) oh |= bit << (31 - i);
    else ol |= bit << (63 - i);
  }
  return [oh >>> 0, ol >>> 0];
}

/**
 * SP[i][v]: the output of S-box i for the 6-bit input v, already carried through P, as a 32-bit word. The
 * row of the S-box is the outer two bits of v and the column the middle four.
 */
const SP: Uint32Array[] = SBOX.map((sbox, i) => {
  const t = new Uint32Array(64);
  for (let v = 0; v < 64; v++) {
    const row = ((v >> 4) & 2) | (v & 1);
    const col = (v >> 1) & 15;
    const word = sbox[row * 16 + col]! << (28 - 4 * i); // the nibble in S-box i's position
    let out = 0;
    for (let k = 0; k < 32; k++) out |= ((word >>> (32 - P[k]!)) & 1) << (31 - k);
    t[v] = out >>> 0;
  }
  return t;
});

/** The key schedule of a DES key: 16 rounds of eight 6-bit values (128 bytes). */
export type DesSchedule = Uint8Array;

/** Expands an 8-byte key into the 16 round keys. The parity bits (the least significant bit of each byte) are ignored. */
export function desKeySchedule(key: Uint8Array): DesSchedule {
  if (key.length !== 8)
    throw rangeFailure(`the DES key must be 8 bytes, not ${key.length}`, { length: key.length });
  const hi = getBE32(key, 0);
  const lo = getBE32(key, 4);
  // PC-1 into two 28-bit halves C and D.
  const bit = (n: number) => (n <= 32 ? (hi >>> (32 - n)) & 1 : (lo >>> (64 - n)) & 1);
  let c = 0;
  let d = 0;
  for (let i = 0; i < 28; i++) c = (c << 1) | bit(PC1[i]!);
  for (let i = 28; i < 56; i++) d = (d << 1) | bit(PC1[i]!);
  const ks = new Uint8Array(128);
  const M28 = 0x0fffffff;
  for (let r = 0; r < 16; r++) {
    const s = SHIFTS[r]!;
    c = ((c << s) | (c >>> (28 - s))) & M28;
    d = ((d << s) | (d >>> (28 - s))) & M28;
    // PC-2 selects 48 of the 56 bits of C || D.
    const cd = (n: number) => (n <= 28 ? (c >>> (28 - n)) & 1 : (d >>> (56 - n)) & 1);
    for (let g = 0; g < 8; g++) {
      let v = 0;
      for (let k = 0; k < 6; k++) v = (v << 1) | cd(PC2[g * 6 + k]!);
      ks[r * 8 + g] = v;
    }
  }
  return ks;
}

/** The result halves of {@link desBlock}. */
const OUT = new Uint32Array(2);

/**
 * Runs DES on a block held as two big-endian 32-bit halves with a key schedule. The result is left in
 * the returned two-element array (shared; copy it before the next call). `decrypt` applies the round
 * keys in reverse.
 */
export function desBlock(ks: DesSchedule, hi: number, lo: number, decrypt: boolean): Uint32Array {
  const [ih, il] = permute64(IP, hi, lo);
  let l = ih;
  let r = il;
  for (let round = 0; round < 16; round++) {
    const k = (decrypt ? 15 - round : round) * 8;
    // E expansion: rotating R right by one puts the six bits of group i at bits 4i to 4i+5 (wrapping).
    const x = rotr32(r, 1);
    const f =
      SP[0]![((x >>> 26) & 63) ^ ks[k]!]! ^
      SP[1]![(rotl32(x, 4) >>> 26) ^ ks[k + 1]!]! ^
      SP[2]![(rotl32(x, 8) >>> 26) ^ ks[k + 2]!]! ^
      SP[3]![(rotl32(x, 12) >>> 26) ^ ks[k + 3]!]! ^
      SP[4]![(rotl32(x, 16) >>> 26) ^ ks[k + 4]!]! ^
      SP[5]![(rotl32(x, 20) >>> 26) ^ ks[k + 5]!]! ^
      SP[6]![(rotl32(x, 24) >>> 26) ^ ks[k + 6]!]! ^
      SP[7]![(rotl32(x, 28) >>> 26) ^ ks[k + 7]!]!;
    const t = r;
    r = (l ^ f) >>> 0;
    l = t;
  }
  // The halves are swapped before the final permutation.
  const [oh, ol] = permute64(FP, r, l);
  OUT[0] = oh;
  OUT[1] = ol;
  return OUT;
}

const schedule = keyCache(desKeySchedule);

function run(block: Uint8Array, key: Uint8Array, decrypt: boolean): Uint8Array {
  checkBlock(block, 8, "DES");
  const out = desBlock(schedule(key), getBE32(block, 0), getBE32(block, 4), decrypt);
  const res = new Uint8Array(8);
  putBE32(res, 0, out[0]!);
  putBE32(res, 4, out[1]!);
  return res;
}

/** Encrypts one 8-byte block with an 8-byte key (also the single-block DES used by the LM hash). */
export function desEncryptBlock(block: Uint8Array, key: Uint8Array): Uint8Array {
  return run(block, key, false);
}

/** Decrypts one 8-byte block with an 8-byte key. */
export function desDecryptBlock(block: Uint8Array, key: Uint8Array): Uint8Array {
  return run(block, key, true);
}

/** Rejects a key that is not 8 bytes (E_RANGE). */
export function checkKey(key: Uint8Array): void {
  if (key.length !== 8)
    throw rangeFailure(`the DES key must be 8 bytes, not ${key.length}`, { length: key.length });
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("des", "_check-key", "( key:bytes -- )", checkKey, {
    doc: "Raise E_RANGE unless the key is 8 bytes (private helper of des:encrypt).",
    category: "Encryption",
  }),
  definePrimitive("des", "_encrypt-block", "( block:bytes key:bytes -- bytes )", desEncryptBlock, {
    doc: "Encrypt one 8-byte block with raw DES (private block function for the blockmode layer).",
    category: "Encryption",
  }),
  definePrimitive("des", "_decrypt-block", "( block:bytes key:bytes -- bytes )", desDecryptBlock, {
    doc: "Decrypt one 8-byte block with raw DES (private block function for the blockmode layer).",
    category: "Encryption",
  }),
];
