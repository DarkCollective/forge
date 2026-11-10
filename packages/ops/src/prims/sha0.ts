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
 * sha0 primitive: SHA-0, the original Secure Hash Standard (FIPS 180, 1993). It differs from SHA-1
 * (FIPS 180-1) only in the message schedule, which has no one-bit rotation:
 * W(t) = W(t-3) xor W(t-8) xor W(t-14) xor W(t-16). Insecure; offered for compatibility only.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { padMessage, readWords, rotl32, wordsToBytes } from "../hash-util.js";

const INIT = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0] as const;
const K = [0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6] as const;

/** The SHA-0 digest (20 bytes) of `data`. */
export function sha0(data: Uint8Array): Uint8Array {
  const msg = padMessage(data, true); // the SHA padding, big-endian bit length
  const h = Uint32Array.from(INIT);
  const w = new Uint32Array(80);
  for (let off = 0; off < msg.length; off += 64) {
    w.set(readWords(msg, off, false));
    for (let t = 16; t < 80; t++) {
      w[t] =
        (w[t - 3] as number) ^ (w[t - 8] as number) ^ (w[t - 14] as number) ^ (w[t - 16] as number);
    }
    let a = h[0] as number;
    let b = h[1] as number;
    let c = h[2] as number;
    let d = h[3] as number;
    let e = h[4] as number;
    for (let t = 0; t < 80; t++) {
      const stage = Math.floor(t / 20);
      let f: number;
      if (stage === 0)
        f = (b & c) | (~b & d); // Ch
      else if (stage === 2)
        f = (b & c) | (b & d) | (c & d); // Maj
      else f = b ^ c ^ d; // Parity
      const temp = (rotl32(a, 5) + f + e + (K[stage] as number) + (w[t] as number)) >>> 0;
      e = d;
      d = c;
      c = rotl32(b, 30);
      b = a;
      a = temp;
    }
    h[0] = ((h[0] as number) + a) >>> 0;
    h[1] = ((h[1] as number) + b) >>> 0;
    h[2] = ((h[2] as number) + c) >>> 0;
    h[3] = ((h[3] as number) + d) >>> 0;
    h[4] = ((h[4] as number) + e) >>> 0;
  }
  return wordsToBytes(h, false);
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("sha0", "_hash", "( data:bytes -- bytes )", sha0, {
    doc: "The SHA-0 digest (FIPS 180, 1993) of the bytes (private helper of sha0:digest).",
    category: "Hashing",
  }),
];
