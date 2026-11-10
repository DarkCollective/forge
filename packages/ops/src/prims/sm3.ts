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
 * sm3 primitive. SM3 is 32-bit word arithmetic over 64 rounds per 64-byte block, too slow in FL
 * at 64 KiB, so `_hash` is a TypeScript primitive written from the specification: GB/T 32905-2016,
 * as published in draft-sca-cfrg-sm3 (the section numbers below are that draft's). The word
 * `sm3:digest` (vocab/sm3.fth) holds the metadata. Only the standard 64 rounds exist.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { mdPad, rotl32 } from "../hash-util-b.js";

// 4.1 Initialization vector.
const IV = [
  0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600, 0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e,
];

// 4.4 Permutations P_0 and P_1.
const p0 = (x: number) => (x ^ rotl32(x, 9) ^ rotl32(x, 17)) >>> 0;
const p1 = (x: number) => (x ^ rotl32(x, 15) ^ rotl32(x, 23)) >>> 0;

/** The SM3 digest (32 bytes) of `data`. */
export function hash(data: Uint8Array): Uint8Array {
  // 5.2 Padding: bit 1, zeros, then the 64-bit big-endian bit length.
  const m = mdPad(data, 64, 8, true);
  const view = new DataView(m.buffer);
  const v = Uint32Array.from(IV);
  const w = new Uint32Array(68);
  const w1 = new Uint32Array(64);
  for (let off = 0; off < m.length; off += 64) {
    // 5.3.2 Message expansion.
    for (let j = 0; j < 16; j++) w[j] = view.getUint32(off + 4 * j);
    for (let j = 16; j < 68; j++) {
      w[j] =
        (p1((w[j - 16]! ^ w[j - 9]! ^ rotl32(w[j - 3]!, 15)) >>> 0) ^
          rotl32(w[j - 13]!, 7) ^
          w[j - 6]!) >>>
        0;
    }
    for (let j = 0; j < 64; j++) w1[j] = (w[j]! ^ w[j + 4]!) >>> 0;
    // 5.3.3 Compression function.
    let a = v[0]!;
    let b = v[1]!;
    let c = v[2]!;
    let d = v[3]!;
    let e = v[4]!;
    let f = v[5]!;
    let g = v[6]!;
    let h = v[7]!;
    for (let j = 0; j < 64; j++) {
      const t = j < 16 ? 0x79cc4519 : 0x7a879d8a; // 4.2 constants T_j
      const a12 = rotl32(a, 12);
      const ss1 = rotl32((a12 + e + rotl32(t, j & 31)) >>> 0, 7);
      const ss2 = (ss1 ^ a12) >>> 0;
      // 4.3 Boolean functions FF_j and GG_j.
      const ff = j < 16 ? (a ^ b ^ c) >>> 0 : ((a & b) | (a & c) | (b & c)) >>> 0;
      const gg = j < 16 ? (e ^ f ^ g) >>> 0 : ((e & f) | (~e & g)) >>> 0;
      const tt1 = (ff + d + ss2 + w1[j]!) >>> 0;
      const tt2 = (gg + h + ss1 + w[j]!) >>> 0;
      d = c;
      c = rotl32(b, 9);
      b = a;
      a = tt1;
      h = g;
      g = rotl32(f, 19);
      f = e;
      e = p0(tt2);
    }
    const nv = [a, b, c, d, e, f, g, h];
    for (let i = 0; i < 8; i++) v[i] = (nv[i]! ^ v[i]!) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(4 * i, v[i]!);
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("sm3", "_hash", "( data:bytes -- bytes )", hash, {
    doc: "The SM3 digest of the bytes (private helper of sm3:digest).",
    category: "Hashing",
  }),
];
