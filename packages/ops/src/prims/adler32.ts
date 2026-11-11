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
 * adler32 primitive: the per-byte loop of Adler-32 (RFC 1950). In FL it needs the whole input as a
 * list of integers (16 bytes a byte, so a 16 MiB input is refused by the value limit before the first
 * step) and about 13 VM steps a byte. One private primitive:
 *
 *  - `_adler ( data -- int )`: the 32-bit checksum as an integer, b in the high 16 bits and a in the low 16.
 *
 * The word, its documentation and the four big-endian bytes of the result stay in FL (vocab/adler32.fth).
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";

const MOD = 65_521;
/** The most bytes that can be added before a and b must be reduced (zlib's NMAX) without passing 2^53. */
const BLOCK = 5_552;

/** Adler-32 of the bytes as an unsigned number. */
export function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length;) {
    const end = Math.min(data.length, i + BLOCK);
    for (; i < end; i++) {
      a += data[i] as number;
      b += a;
    }
    a %= MOD;
    b %= MOD;
  }
  return b * 65_536 + a;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "adler32",
    "_adler",
    "( data:bytes -- int )",
    (data: Uint8Array) => adler32(data),
    {
      doc: "The Adler-32 checksum of the bytes as an unsigned integer, b in the high 16 bits and a in the low 16 (private helper of adler32:checksum).",
      category: "Hashing",
    },
  ),
];
