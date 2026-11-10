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
 * md6 primitive: the MD6 hash function, from "The MD6 Hash Function: A Proposal to NIST for SHA-3"
 * (Rivest et al., 2008, the MD6 report). Word size w = 64 bits, compression input of n = 89 words,
 * output of c = 16 words, data block of b = 64 words, key of k = 8 words. The 64-bit words are
 * BigInts; 64 KiB takes well under a second.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { rangeFailure } from "../prim-util.js";

const N = 89; // words in a compression input (report section 2.1)
const C = 16; // words in a compression output
const B = 64; // data words in a block
const MASK = (1n << 64n) - 1n;

// Report section 2.3.1: the constant vector Q, the first 15 words of the fractional part of
// sqrt(6) (md6.test.ts recomputes it).
export const Q: readonly bigint[] = [
  0x7311c2812425cfa0n,
  0x6432286434aac8e7n,
  0xb60450e9ef68b7c1n,
  0xe8fb23908d9f06f1n,
  0xdd2e76cba691e5bfn,
  0x0cd0d63b2c30bc41n,
  0x1f8ccf6823058f8an,
  0x54e5ed5b88e3775dn,
  0x4ad12aae0a6d6031n,
  0x3e7f16bb88222e0dn,
  0x8af8671d3fb50c2cn,
  0x995ad1178bd25c31n,
  0xc878c1dd04c4b633n,
  0x3b72066c7a1552acn,
  0x0d6f3522631effcbn,
];

// Section 2.3.2: tap positions, the round constants' seed and mask, and the per-step shifts.
const T0 = 17;
const T1 = 18;
const T2 = 21;
const T3 = 31;
const T4 = 67;
const S0 = 0x0123456789abcdefn;
const SMASK = 0x7311c2812425cfa0n;
const RS = [10, 5, 13, 10, 11, 12, 2, 7, 14, 15, 7, 13, 11, 7, 6, 12] as const;
const LS = [11, 24, 9, 16, 15, 9, 27, 15, 6, 2, 29, 8, 15, 5, 31, 9] as const;

/** The compression function f (section 2.3): 89 words in, the last 16 words of the 16r steps out. */
function compress(input: BigUint64Array, rounds: number): BigUint64Array {
  const a = new BigUint64Array(N + C * rounds);
  a.set(input);
  let s = S0;
  let i = N;
  for (let j = 0; j < rounds; j++) {
    for (let k = 0; k < C; k++, i++) {
      let x = s ^ (a[i - N] as bigint) ^ (a[i - T0] as bigint);
      x ^=
        ((a[i - T1] as bigint) & (a[i - T2] as bigint)) ^
        ((a[i - T3] as bigint) & (a[i - T4] as bigint));
      x ^= x >> BigInt(RS[k] as number);
      a[i] = x ^ ((x << BigInt(LS[k] as number)) & MASK);
    }
    // The next round constant: S <- (S rotated left one bit) xor (S and Smask).
    s = (((s << 1n) | (s >> 63n)) & MASK) ^ (s & SMASK);
  }
  return a.slice(a.length - C);
}

/** Big-endian bytes (zero-padded on the right to `words` words) as 64-bit words. */
function toWords(bytes: Uint8Array, words: number): BigUint64Array {
  const out = new BigUint64Array(words);
  const view = new DataView(new Uint8Array(words * 8).buffer);
  new Uint8Array(view.buffer).set(bytes);
  for (let i = 0; i < words; i++) out[i] = view.getBigUint64(i * 8, false);
  return out;
}

interface Params {
  readonly d: number; // digest bits
  readonly r: number; // rounds
  readonly levels: number; // L
  readonly key: Uint8Array;
}

/**
 * One compression call (section 2.4.1 node ID and control words): the input is
 * Q | K | U | V | B, where U = level.index and V packs r, L, z, p, keylen and d.
 */
function node(
  p: Params,
  level: number,
  index: number,
  last: boolean,
  padBits: number,
  block: BigUint64Array,
): BigUint64Array {
  const input = new BigUint64Array(N);
  input.set(Q, 0);
  input.set(toWords(p.key, 8), 15);
  input[23] = (BigInt(level) << 56n) | BigInt(index);
  input[24] =
    (BigInt(p.r) << 48n) |
    (BigInt(p.levels) << 40n) |
    ((last ? 1n : 0n) << 36n) |
    (BigInt(padBits) << 20n) |
    (BigInt(p.key.length) << 12n) |
    BigInt(p.d);
  input.set(block, 25);
  return compress(input, p.r);
}

/** The block of `size` bytes at `off` of `data`, zero-padded to `words` words. */
function chunk(data: Uint8Array, off: number, size: number, words: number): BigUint64Array {
  return toWords(data.subarray(off, Math.min(off + size, data.length)), words);
}

/** The MD6 digest of `data` with d = `size` bits, `levels` = L and an optional `key` (<= 64 bytes). */
export function md6(data: Uint8Array, size: number, levels: number, key: Uint8Array): Uint8Array {
  if (!Number.isInteger(size) || size < 8 || size > 512 || size % 8 !== 0) {
    throw rangeFailure("MD6 size must be a multiple of 8 from 8 to 512 bits", { size });
  }
  if (!Number.isInteger(levels) || levels < 0 || levels > 64) {
    throw rangeFailure("MD6 levels must be from 0 to 64", { levels });
  }
  if (key.length > 64) throw rangeFailure("MD6 key is at most 64 bytes", { length: key.length });
  // Section 2.1.2: the default round count, at least 80 with a key.
  let r = 40 + (size >> 2);
  if (key.length > 0) r = Math.max(80, r);
  const p: Params = { d: size, r, levels, key };

  let m = data;
  let level = 0;
  do {
    level++;
    const chunks: BigUint64Array[] = [];
    if (level === levels + 1) {
      // Section 2.4.1, SEQ: each block is the previous chaining value (16 words) then 48 data words.
      const dataBytes = (B - C) * 8;
      const count = Math.max(1, Math.ceil(m.length / dataBytes));
      let chain: BigUint64Array<ArrayBufferLike> = new BigUint64Array(C);
      for (let j = 0; j < count; j++) {
        const used = Math.min(dataBytes, Math.max(0, m.length - j * dataBytes));
        const block = new BigUint64Array(B);
        block.set(chain, 0);
        block.set(chunk(m, j * dataBytes, dataBytes, B - C), C);
        chain = node(p, level, j, j === count - 1, (dataBytes - used) * 8, block);
      }
      chunks.push(chain);
    } else {
      // PAR: independent 64-word blocks, the last zero-padded (an empty message is one block).
      const dataBytes = B * 8;
      const count = Math.max(1, Math.ceil(m.length / dataBytes));
      for (let j = 0; j < count; j++) {
        const used = Math.min(dataBytes, Math.max(0, m.length - j * dataBytes));
        chunks.push(
          node(
            p,
            level,
            j,
            count === 1,
            (dataBytes - used) * 8,
            chunk(m, j * dataBytes, dataBytes, B),
          ),
        );
      }
    }
    const next = new Uint8Array(chunks.length * C * 8);
    const view = new DataView(next.buffer);
    let at = 0;
    for (const c of chunks)
      for (const w of c) {
        view.setBigUint64(at, w, false);
        at += 8;
      }
    m = next;
  } while (m.length > C * 8);
  // Section 2.4.1: the digest is the last d bits of the 1024-bit result.
  return m.slice(m.length - size / 8);
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "md6",
    "_hash",
    "( data:bytes size:int levels:int key:str -- bytes )",
    (data: Uint8Array, size: number, levels: number, key: string) =>
      md6(data, size, levels, new TextEncoder().encode(key)),
    {
      doc: "The MD6 digest of the bytes: size in bits (a multiple of 8, 8..512), the mode levels L (0..64) and a key of up to 64 bytes (private helper of md6:digest).",
      category: "Hashing",
    },
  ),
];
