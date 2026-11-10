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
 * has160 primitive. HAS-160 is the Korean hash of TTAS.KO-12.0011/R2: 160-bit output, 512-bit
 * blocks, 80 steps in four rounds of 20, little-endian words and an MD4-style padding. Too slow in
 * FL at 64 KiB, so `_hash` is a TypeScript primitive. The word `has160:digest` (vocab/has160.fth)
 * holds the metadata. Only the standard 80 steps exist.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { mdPad, rotl32 } from "../hash-util-b.js";

// Initial chaining value (the SHA-1 constants, TTAS.KO-12.0011/R2).
const IV = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];

// Step constants of the four rounds.
const K = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc];

// Left rotation of A, per step within a round.
const S1 = [5, 11, 7, 15, 6, 13, 8, 14, 7, 12, 9, 11, 8, 15, 6, 12, 9, 14, 5, 13];

// Left rotation of B, per round.
const S2 = [10, 17, 25, 30];

// The four-word groups XORed into the extra words X[16..19] at the start of each round
// (TTAS.KO-12.0011, as tabulated in the description at randombit.net/has160.html).
const GROUPS: readonly (readonly (readonly number[])[])[] = [
  [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [8, 9, 10, 11],
    [12, 13, 14, 15],
  ],
  [
    [3, 6, 9, 12],
    [15, 2, 5, 8],
    [11, 14, 1, 4],
    [7, 10, 13, 0],
  ],
  [
    [12, 5, 14, 7],
    [0, 9, 2, 11],
    [4, 13, 6, 15],
    [8, 1, 10, 3],
  ],
  [
    [7, 2, 13, 8],
    [3, 14, 9, 4],
    [15, 10, 5, 0],
    [11, 6, 1, 12],
  ],
];

// The order in which each round uses its 20 message words X[0..19].
const ORDER: readonly (readonly number[])[] = [
  [18, 0, 1, 2, 3, 19, 4, 5, 6, 7, 16, 8, 9, 10, 11, 17, 12, 13, 14, 15],
  [18, 3, 6, 9, 12, 19, 15, 2, 5, 8, 16, 11, 14, 1, 4, 17, 7, 10, 13, 0],
  [18, 12, 5, 14, 7, 19, 0, 9, 2, 11, 16, 4, 13, 6, 15, 17, 8, 1, 10, 3],
  [18, 7, 2, 13, 8, 19, 3, 14, 9, 4, 16, 15, 10, 5, 0, 17, 11, 6, 1, 12],
];

/** The HAS-160 digest (20 bytes) of `data`. */
export function hash(data: Uint8Array): Uint8Array {
  const m = mdPad(data, 64, 8, false);
  const view = new DataView(m.buffer);
  const h = Uint32Array.from(IV);
  const x = new Uint32Array(20);
  for (let off = 0; off < m.length; off += 64) {
    for (let i = 0; i < 16; i++) x[i] = view.getUint32(off + 4 * i, true);
    let [a, b, c, d, e] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!];
    for (let r = 0; r < 4; r++) {
      const ord = ORDER[r]!;
      for (let g = 0; g < 4; g++) {
        const q = GROUPS[r]![g]!;
        x[16 + g] = (x[q[0]!]! ^ x[q[1]!]! ^ x[q[2]!]! ^ x[q[3]!]!) >>> 0;
      }
      for (let j = 0; j < 20; j++) {
        const f =
          r === 0 ? ((b & c) | (~b & d)) >>> 0 : r === 2 ? (c ^ (b | ~d)) >>> 0 : (b ^ c ^ d) >>> 0;
        const t = (rotl32(a, S1[j]!) + f + e + x[ord[j]!]! + K[r]!) >>> 0;
        e = d;
        d = c;
        c = rotl32(b, S2[r]!);
        b = a;
        a = t;
      }
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 5; i++) ov.setUint32(4 * i, h[i]!, true);
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("has160", "_hash", "( data:bytes -- bytes )", hash, {
    doc: "The HAS-160 digest of the bytes (private helper of has160:digest).",
    category: "Hashing",
  }),
];
