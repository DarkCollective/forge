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
 * present primitives. PRESENT (Bogdanov, Knudsen, Leander, Paar, Poschmann, Robshaw, Seurin, Vikkelsoe,
 * "PRESENT: An Ultra-Lightweight Block Cipher", CHES 2007; ISO/IEC 29192-2). A 64-bit block, 31 rounds of
 * addRoundKey, sBoxLayer and pLayer, then a final addRoundKey with K32. The 4-bit S-box is the table of
 * section 3 of the paper (C 5 6 B 9 0 A D 3 E F 8 4 7 1 2) and the bit permutation is P(i) = i * 16 mod 63
 * for i < 63, P(63) = 63. The key register is 80 or 128 bits; the round key K_i is the 64 leftmost bits, and
 * the update (section 3.2) rotates the register 61 places left, runs the S-box over the leftmost 4 bits (80
 * bit keys) or the two leftmost nibbles (128 bit keys), and XORs the round counter i into bits 19..15 (80) or
 * 66..62 (128). The block and the key are big-endian (the paper's vectors write them as hex numbers). The
 * 32 round keys are cached for the last key. Block functions for the shared `blockmode` layer. The words
 * `present:encrypt` and `decrypt` (vocab/present.fth) hold the metadata.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { be32, checkBlock, KeyCache, putBe32 } from "../cipher-util-b.js";
import { rangeFailure } from "../prim-util.js";

const SBOX = [0xc, 0x5, 0x6, 0xb, 0x9, 0x0, 0xa, 0xd, 0x3, 0xe, 0xf, 0x8, 0x4, 0x7, 0x1, 0x2];
const SBOX_INV: number[] = [];
SBOX.forEach((v, i) => (SBOX_INV[v] = i));

/** The pLayer: bit i moves to bit P(i). */
const P = (i: number): number => (i === 63 ? 63 : (i * 16) % 63);
const P_INV = (j: number): number => (j === 63 ? 63 : (j * 4) % 63);

/** Per byte position (0 = the least significant byte) and byte value, the 64-bit result as [hi, lo]. */
function makeTables(byteFn: (b: number) => number, perm: (i: number) => number): Uint32Array[] {
  const tables: Uint32Array[] = [];
  for (let pos = 0; pos < 8; pos++) {
    const t = new Uint32Array(512);
    for (let v = 0; v < 256; v++) {
      const sv = byteFn(v);
      let hi = 0;
      let lo = 0;
      for (let bit = 0; bit < 8; bit++) {
        if (((sv >> bit) & 1) === 0) continue;
        const dst = perm(8 * pos + bit);
        if (dst >= 32) hi |= 1 << (dst - 32);
        else lo |= 1 << dst;
      }
      t[2 * v] = hi >>> 0;
      t[2 * v + 1] = lo >>> 0;
    }
    tables.push(t);
  }
  return tables;
}

const sByte = (v: number): number => (SBOX[v >> 4]! << 4) | SBOX[v & 15]!;
const sInvByte = (v: number): number => (SBOX_INV[v >> 4]! << 4) | SBOX_INV[v & 15]!;
const identity = (i: number): number => i;

/** sBoxLayer then pLayer, and the pLayer inverse (the S-box inverse is applied after it). */
const SP = makeTables(sByte, P);
const PINV = makeTables((v) => v, P_INV);
const SINV = makeTables(sInvByte, identity);

function apply(tables: Uint32Array[], hi: number, lo: number): [number, number] {
  let rh = 0;
  let rl = 0;
  for (let pos = 0; pos < 8; pos++) {
    const byte = pos < 4 ? (lo >>> (8 * pos)) & 255 : (hi >>> (8 * (pos - 4))) & 255;
    const t = tables[pos]!;
    rh |= t[2 * byte]!;
    rl |= t[2 * byte + 1]!;
  }
  return [rh >>> 0, rl >>> 0];
}

/** The 32 round keys as [hi, lo] pairs, from an 80-bit or 128-bit key. */
function roundKeys(key: Uint8Array): Uint32Array {
  const bits = BigInt(key.length * 8);
  let reg = 0n;
  for (const b of key) reg = (reg << 8n) | BigInt(b);
  const mask = (1n << bits) - 1n;
  const out = new Uint32Array(64);
  for (let i = 1; i <= 32; i++) {
    const rk = reg >> (bits - 64n);
    out[2 * (i - 1)] = Number(rk >> 32n);
    out[2 * (i - 1) + 1] = Number(rk & 0xffffffffn);
    if (i === 32) break;
    reg = ((reg << 61n) | (reg >> (bits - 61n))) & mask;
    if (bits === 80n) {
      const top = Number(reg >> 76n);
      reg = (reg & ((1n << 76n) - 1n)) | (BigInt(SBOX[top]!) << 76n);
      reg ^= BigInt(i) << 15n;
    } else {
      const top = Number(reg >> 120n);
      const sub = (SBOX[top >> 4]! << 4) | SBOX[top & 15]!;
      reg = (reg & ((1n << 120n) - 1n)) | (BigInt(sub) << 120n);
      reg ^= BigInt(i) << 62n;
    }
  }
  return out;
}

const cache = new KeyCache<Uint32Array>();

function schedule(key: Uint8Array): Uint32Array {
  if (key.length !== 10 && key.length !== 16)
    throw rangeFailure(`the PRESENT key must be 10 or 16 bytes, not ${key.length}`, {
      length: key.length,
    });
  return cache.get(key, "p", () => roundKeys(key));
}

/** One 8-byte block encrypted. */
export function encryptBlock(block: Uint8Array, key: Uint8Array): Uint8Array {
  const rk = schedule(key);
  checkBlock(block, 8, "PRESENT");
  let hi = be32(block, 0);
  let lo = be32(block, 4);
  for (let r = 0; r < 31; r++) {
    [hi, lo] = apply(SP, (hi ^ rk[2 * r]!) >>> 0, (lo ^ rk[2 * r + 1]!) >>> 0);
  }
  const out = new Uint8Array(8);
  putBe32(out, 0, (hi ^ rk[62]!) >>> 0);
  putBe32(out, 4, (lo ^ rk[63]!) >>> 0);
  return out;
}

/** One 8-byte block decrypted. */
export function decryptBlock(block: Uint8Array, key: Uint8Array): Uint8Array {
  const rk = schedule(key);
  checkBlock(block, 8, "PRESENT");
  let hi = (be32(block, 0) ^ rk[62]!) >>> 0;
  let lo = (be32(block, 4) ^ rk[63]!) >>> 0;
  for (let r = 30; r >= 0; r--) {
    [hi, lo] = apply(PINV, hi, lo);
    [hi, lo] = apply(SINV, hi, lo);
    hi = (hi ^ rk[2 * r]!) >>> 0;
    lo = (lo ^ rk[2 * r + 1]!) >>> 0;
  }
  const out = new Uint8Array(8);
  putBe32(out, 0, hi);
  putBe32(out, 4, lo);
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("present", "_encrypt-block", "( block:bytes key:bytes -- bytes )", encryptBlock, {
    doc: "Encrypt one 8-byte block with PRESENT (private block function for the blockmode layer).",
    category: "Encryption",
  }),
  definePrimitive("present", "_decrypt-block", "( block:bytes key:bytes -- bytes )", decryptBlock, {
    doc: "Decrypt one 8-byte block with PRESENT (private block function for the blockmode layer).",
    category: "Encryption",
  }),
  definePrimitive(
    "present",
    "_check-key",
    "( key:bytes -- )",
    (key: Uint8Array) => void schedule(key),
    {
      doc: "Raise E_RANGE unless the key is 10 or 16 bytes (private helper of present:encrypt).",
      category: "Encryption",
    },
  ),
];
