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
 * snefru primitive. Snefru is Ralph C. Merkle's one-way hash, "A Fast Software One-Way Hash
 * Function" (Journal of Cryptology 3, 1990), as in the Xerox reference distribution version 2.5a
 * (30 November 1990). Derived from the Xerox Secure Hash Function: Copyright (c) Xerox
 * Corporation 1989. All rights reserved. The 16 S-boxes below (4096 32-bit words, stored as the
 * base64 of the big-endian words) are the table "standardSBoxes" of that distribution, which was
 * generated from the RAND book of random digits. Its notices are retained, as its licence
 * requires: licence to copy and use is granted provided it is identified as the "Xerox Secure
 * Hash Function"; Xerox makes no representations concerning the merchantability or suitability of
 * the software; it is provided "as is" without warranty of any kind.
 *
 * Structure: the input is cut into chunks of (16 - out) words (out is 4 for 128-bit and 8 for
 * 256-bit output). The state is a 16-word block whose first `out` words are the previous hash and
 * the rest the next chunk, zero-filled; each block is mixed by Hash512 (below). A last block
 * holds the previous hash, zeros and the 64-bit bit length in its final two words. Words are
 * big-endian, and so is the output. `rounds` ("passes", SECURITY_LEVEL in the original) is 2 to 8
 * and uses S-boxes 0 to 2*rounds-1.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { rangeFailure } from "../prim-util.js";

const SBOXES_B64 =
  "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";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

let sboxes: Uint32Array | undefined;

/** The 16 S-boxes as 16 x 256 words, decoded on first use. */
function getSboxes(): Uint32Array {
  if (sboxes !== undefined) return sboxes;
  const out = new Uint32Array(4096);
  let acc = 0;
  let bits = 0;
  let nbytes = 0;
  for (const ch of SBOXES_B64) {
    const v = B64.indexOf(ch);
    if (v < 0) continue; // '=' padding
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      const byte = (acc >>> bits) & 0xff;
      out[nbytes >> 2] = ((out[nbytes >> 2]! << 8) | byte) >>> 0;
      nbytes++;
      acc &= (1 << bits) - 1;
    }
  }
  sboxes = out;
  return out;
}

// Right rotation (bits) applied to every word after each of the four sweeps of a pass.
const SHIFTS = [16, 8, 16, 24];

/**
 * Hash512: mixes a copy of the 16-word block, then replaces the first `out` words of `block` by
 * the input word xor a word of the mixed block taken from the end (b[15], b[14], ...).
 */
function hash512(block: Uint32Array, out: number, rounds: number, sb: Uint32Array): void {
  const b = Uint32Array.from(block);
  for (let pass = 0; pass < rounds; pass++) {
    for (let sweep = 0; sweep < 4; sweep++) {
      for (let i = 0; i < 16; i++) {
        // Box 2*pass for steps 0,1 mod 4, box 2*pass+1 for steps 2,3 mod 4.
        const box = (2 * pass + ((i >> 1) & 1)) * 256;
        const e = sb[box + (b[i]! & 0xff)]!;
        b[(i + 15) & 15] = (b[(i + 15) & 15]! ^ e) >>> 0;
        b[(i + 1) & 15] = (b[(i + 1) & 15]! ^ e) >>> 0;
      }
      const s = SHIFTS[sweep]!;
      for (let i = 0; i < 16; i++) b[i] = ((b[i]! >>> s) | (b[i]! << (32 - s))) >>> 0;
    }
  }
  for (let k = 0; k < out; k++) block[k] = (block[k]! ^ b[15 - k]!) >>> 0;
}

/** The Snefru digest of `data`: `size` "128" or "256" bits, `rounds` "2" to "8" passes. */
export function hash(data: Uint8Array, size: string, rounds: string): Uint8Array {
  if (size !== "128" && size !== "256") {
    throw rangeFailure(`unknown Snefru size '${size.slice(0, 20)}'`);
  }
  if (!/^[2-8]$/.test(rounds)) {
    throw rangeFailure(`unknown Snefru rounds '${rounds.slice(0, 20)}'`);
  }
  const out = size === "128" ? 4 : 8;
  const n = Number(rounds);
  const sb = getSboxes();
  const chunk = (16 - out) * 4;
  const block = new Uint32Array(16);
  for (let pos = 0; pos < data.length; pos += chunk) {
    // Words out..15 get the next chunk, big-endian words, zero-filled.
    const len = Math.min(chunk, data.length - pos);
    for (let w = out; w < 16; w++) block[w] = 0;
    for (let i = 0; i < len; i++) {
      const w = out + (i >> 2);
      block[w] = (block[w]! | (data[pos + i]! << (24 - 8 * (i & 3)))) >>> 0;
    }
    hash512(block, out, n, sb);
  }
  // Final block: previous hash, zeros, 64-bit bit length in the last two words.
  for (let w = out; w < 16; w++) block[w] = 0;
  const bits = data.length * 8;
  block[14] = Math.floor(bits / 4294967296) >>> 0;
  block[15] = bits >>> 0;
  hash512(block, out, n, sb);
  const res = new Uint8Array(out * 4);
  for (let k = 0; k < out; k++) {
    res[4 * k] = block[k]! >>> 24;
    res[4 * k + 1] = (block[k]! >>> 16) & 255;
    res[4 * k + 2] = (block[k]! >>> 8) & 255;
    res[4 * k + 3] = block[k]! & 255;
  }
  return res;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("snefru", "_hash", "( data:bytes size:str rounds:str -- bytes )", hash, {
    doc: "The Snefru digest of the bytes for a size (128 or 256) and a pass count (2 to 8) (private helper of snefru:digest).",
    category: "Hashing",
  }),
];
