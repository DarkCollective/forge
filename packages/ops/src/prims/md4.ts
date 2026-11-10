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
 * md4 primitive: MD4, RFC 1320 (Rivest, 1992). Written from the RFC; the private `_hash` is
 * implemented here (no library covers it). `md4:digest` (vocab/md4.fth) holds the metadata.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { padMessage, readWords, rotl32, wordsToBytes } from "../hash-util.js";

// RFC 1320 section 3.3: the initial chaining value.
const INIT = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476] as const;

// Section 3.4: the message word order and shifts of rounds 2 and 3 (round 1 is 0..15 in order).
const ORDER2 = [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15] as const;
const ORDER3 = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15] as const;
const SHIFT1 = [3, 7, 11, 19] as const;
const SHIFT2 = [3, 5, 9, 13] as const;
const SHIFT3 = [3, 9, 11, 15] as const;

/** The MD4 digest (16 bytes) of `data`. */
export function md4(data: Uint8Array): Uint8Array {
  const msg = padMessage(data, false); // sections 3.1 and 3.2
  let a = INIT[0] as number;
  let b = INIT[1] as number;
  let c = INIT[2] as number;
  let d = INIT[3] as number;
  for (let off = 0; off < msg.length; off += 64) {
    const x = readWords(msg, off, true);
    const [a0, b0, c0, d0] = [a, b, c, d];
    for (let i = 0; i < 48; i++) {
      const round = i >> 4;
      const j = i & 15;
      let f: number;
      let k: number;
      let add: number;
      let s: number;
      if (round === 0) {
        f = (b & c) | (~b & d); // F
        k = j;
        add = 0;
        s = SHIFT1[j & 3] as number;
      } else if (round === 1) {
        f = (b & c) | (b & d) | (c & d); // G
        k = ORDER2[j] as number;
        add = 0x5a827999;
        s = SHIFT2[j & 3] as number;
      } else {
        f = b ^ c ^ d; // H
        k = ORDER3[j] as number;
        add = 0x6ed9eba1;
        s = SHIFT3[j & 3] as number;
      }
      const t = rotl32((a + f + (x[k] as number) + add) >>> 0, s);
      a = d;
      d = c;
      c = b;
      b = t;
    }
    a = (a + a0) >>> 0;
    b = (b + b0) >>> 0;
    c = (c + c0) >>> 0;
    d = (d + d0) >>> 0;
  }
  return wordsToBytes([a, b, c, d], true);
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("md4", "_hash", "( data:bytes -- bytes )", md4, {
    doc: "The MD4 digest (RFC 1320) of the bytes (private helper of md4:digest).",
    category: "Hashing",
  }),
];
