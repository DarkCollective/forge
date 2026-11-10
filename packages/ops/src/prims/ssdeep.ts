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
 * ssdeep primitives. Only `_pieces` is a primitive: one pass of context triggered piecewise hashing
 * (Kornblum, "Identifying almost identical files using context triggered piecewise hashing",
 * DFRWS 2006) over the data for a given block size. It needs a rolling hash and two running
 * hashes updated for every byte, with 32-bit wraparound arithmetic: roughly 60 to 100 interpreter
 * steps per byte in FL, so 64 KiB would be 4 to 7 million steps for a single pass, and the block
 * size can need several passes. The block size choice, the retry and the text format are FL
 * (vocab/ssdeep.fth).
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";

const WINDOW = 7;
const SPAM_LEN = 64;
const HASH_INIT = 0x28021967;
const HASH_PRIME = 0x01000193;
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * One pass for block size `bs`: the two hash strings (for `bs` and `2 * bs`) and the number of
 * characters the first one had before the final one was added.
 */
export function pieces(data: Uint8Array, bs: number): [string, string, number] {
  const win = new Uint8Array(WINDOW);
  let h1 = 0;
  let h2 = 0;
  let h3 = 0;
  let n = 0;
  let roll = 0;
  let a = HASH_INIT;
  let b = HASH_INIT;
  let j = 0;
  let k = 0;
  const ps: string[] = [];
  const ps2: string[] = [];
  const bs2 = bs * 2;
  for (let p = 0; p < data.length; p++) {
    const c = data[p] as number;
    // The rolling hash: h1 is the sum of the window, h2 the position-weighted sum, h3 a shift-xor.
    h2 = (h2 - h1 + WINDOW * c) >>> 0;
    h1 = (h1 + c - (win[n % WINDOW] as number)) >>> 0;
    win[n % WINDOW] = c;
    n++;
    h3 = ((h3 << 5) ^ c) >>> 0;
    roll = (h1 + h2 + h3) >>> 0;
    // The piece hashes: FNV style, (h * prime) xor c.
    a = (Math.imul(a, HASH_PRIME) ^ c) >>> 0;
    b = (Math.imul(b, HASH_PRIME) ^ c) >>> 0;
    if (roll % bs === bs - 1) {
      ps[j] = B64[a & 63] as string;
      // At the length limit the last character is overwritten at every trigger and not reset.
      if (j < SPAM_LEN - 1) {
        a = HASH_INIT;
        j++;
      }
    }
    if (roll % bs2 === bs2 - 1) {
      ps2[k] = B64[b & 63] as string;
      if (k < SPAM_LEN / 2 - 1) {
        b = HASH_INIT;
        k++;
      }
    }
  }
  // The trailing piece, unless the rolling hash ended at zero (which includes empty input).
  if (roll !== 0) {
    ps[j] = B64[a & 63] as string;
    ps2[k] = B64[b & 63] as string;
  }
  return [ps.join(""), ps2.join(""), j];
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "ssdeep",
    "_pieces",
    "( data:bytes bs:int -- str str int )",
    (d: Uint8Array, bs: number) => {
      return pieces(d, bs);
    },
    {
      doc: "One pass of context triggered piecewise hashing at a block size (private helper of ssdeep:digest).",
      category: "Hashing",
    },
  ),
];
