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
 * ripemd primitive: RIPEMD-128, RIPEMD-256 and RIPEMD-320 (Dobbertin, Bosselaers and Preneel,
 * "RIPEMD-160: a strengthened version of RIPEMD", 1996; the RIPEMD page of Bosselaers). RIPEMD-128
 * has four rounds of 16 steps in two parallel lines; RIPEMD-160 has five. RIPEMD-256 and -320 are the
 * 128 and 160 compression functions with the two lines kept separate (no combination), exchanging
 * one chaining variable between the lines after each round. RIPEMD-160 itself is the vocabulary
 * ripemd160 and is not offered here.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { padMessage, readWords, rotl32, wordsToBytes } from "../hash-util.js";
import { rangeFailure } from "../prim-util.js";

// Message word selected at each step, by round (16 steps per round): left line r, right line r'.
const R_LEFT = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8],
  [3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12],
  [1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2],
  [4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13],
] as const;
const R_RIGHT = [
  [5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12],
  [6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2],
  [15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13],
  [8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14],
  [12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11],
] as const;
// Rotation amounts s (left) and s' (right).
const S_LEFT = [
  [11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8],
  [7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12],
  [11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5],
  [11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12],
  [9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6],
] as const;
const S_RIGHT = [
  [8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6],
  [9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11],
  [9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5],
  [15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8],
  [8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11],
] as const;
// Round constants: left line, right line of RIPEMD-160/320, right line of RIPEMD-128/256.
const K_LEFT = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e] as const;
const K_RIGHT5 = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000] as const;
const K_RIGHT4 = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x00000000] as const;

const INIT5 = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0] as const;
// Initial values of the second line of RIPEMD-256 and -320.
const INIT_B = [0x76543210, 0xfedcba98, 0x89abcdef, 0x01234567, 0x3c2d1e0f] as const;

// Which chaining variable the two lines exchange after round 1, 2, ...: RIPEMD-256 swaps A, B, C,
// D; RIPEMD-320 swaps B, D, A, C, E (indices into [A, B, C, D, E]).
const SWAP4 = [0, 1, 2, 3] as const;
const SWAP5 = [1, 3, 0, 2, 4] as const;

/** The nonlinear function f_j of round `j` (1..5) on the words x, y, z. */
function fn(j: number, x: number, y: number, z: number): number {
  switch (j) {
    case 1:
      return x ^ y ^ z;
    case 2:
      return (x & y) | (~x & z);
    case 3:
      return (x | ~y) ^ z;
    case 4:
      return (x & z) | (y & ~z);
    default:
      return x ^ (y | ~z);
  }
}

interface Variant {
  readonly five: boolean;
  readonly dual: boolean;
  readonly bytes: number;
}

const VARIANTS: Readonly<Record<string, Variant>> = {
  "128": { five: false, dual: false, bytes: 16 },
  "256": { five: false, dual: true, bytes: 32 },
  "320": { five: true, dual: true, bytes: 40 },
};

/** One 64-byte block into the chaining value `h` (in place). */
function compress(h: Uint32Array, x: Uint32Array, v: Variant): void {
  const n = v.five ? 5 : 4;
  const rounds = n;
  const left = Array.from(h.subarray(0, n));
  const right = v.dual ? Array.from(h.subarray(n, 2 * n)) : left.slice();
  for (let j = 0; j < rounds; j++) {
    for (let i = 0; i < 16; i++) {
      stepLine(
        left,
        v.five,
        fn(j + 1, ...fArgs(left)),
        x[R_LEFT[j]![i]!]!,
        K_LEFT[j]!,
        S_LEFT[j]![i]!,
      );
      const kr = v.five ? K_RIGHT5[j]! : K_RIGHT4[j]!;
      stepLine(
        right,
        v.five,
        fn(rounds - j, ...fArgs(right)),
        x[R_RIGHT[j]![i]!]!,
        kr,
        S_RIGHT[j]![i]!,
      );
    }
    if (v.dual) {
      const idx = (v.five ? SWAP5 : SWAP4)[j]!;
      const t = left[idx]!;
      left[idx] = right[idx]!;
      right[idx] = t;
    }
  }
  if (v.dual) {
    for (let i = 0; i < n; i++) {
      h[i] = ((h[i] as number) + left[i]!) >>> 0;
      h[n + i] = ((h[n + i] as number) + right[i]!) >>> 0;
    }
  } else {
    // RIPEMD-128 combination: T = h1 + C + D'; h1 = h2 + D + A'; h2 = h3 + A + B'; h3 = h0 + B + C'.
    const [h0, h1, h2, h3] = [h[0]!, h[1]!, h[2]!, h[3]!];
    h[0] = (h1 + left[2]! + right[3]!) >>> 0;
    h[1] = (h2 + left[3]! + right[0]!) >>> 0;
    h[2] = (h3 + left[0]! + right[1]!) >>> 0;
    h[3] = (h0 + left[1]! + right[2]!) >>> 0;
  }
}

function fArgs(v: number[]): [number, number, number] {
  return [v[1]!, v[2]!, v[3]!];
}

/** One step of a line over the state [A, B, C, D(, E)], updated in place (rotating the variables). */
function stepLine(v: number[], five: boolean, f: number, x: number, k: number, s: number): void {
  const a = v[0]!;
  const t = rotl32((a + f + x + k) >>> 0, s);
  if (five) {
    const e = v[4]!;
    v[0] = e;
    v[4] = v[3]!;
    v[3] = rotl32(v[2]!, 10);
    v[2] = v[1]!;
    v[1] = (t + e) >>> 0;
  } else {
    v[0] = v[3]!;
    v[3] = v[2]!;
    v[2] = v[1]!;
    v[1] = t;
  }
}

/** The RIPEMD digest of `data` for a size name (128, 256 or 320). */
export function hash(data: Uint8Array, size: string): Uint8Array {
  const v = Object.hasOwn(VARIANTS, size) ? VARIANTS[size] : undefined;
  if (v === undefined) throw rangeFailure(`unknown RIPEMD size '${size.slice(0, 20)}'`);
  const msg = padMessage(data, false);
  const words = v.bytes / 4;
  const h = new Uint32Array(words);
  const n = v.five ? 5 : 4;
  for (let i = 0; i < n; i++) h[i] = INIT5[i] as number;
  if (v.dual) for (let i = 0; i < n; i++) h[n + i] = INIT_B[i] as number;
  for (let off = 0; off < msg.length; off += 64) compress(h, readWords(msg, off, true), v);
  return wordsToBytes(h, true);
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("ripemd", "_hash", "( data:bytes size:str -- bytes )", hash, {
    doc: "The RIPEMD-128, -256 or -320 digest of the bytes for a size name (private helper of ripemd:digest).",
    category: "Hashing",
  }),
];
