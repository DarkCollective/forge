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
 * md2 primitive: MD2, RFC 1319 (Kaliski, 1992). Written from the RFC. Only the standard 18 rounds
 * of the compression function exist.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";

// RFC 1319 section 3.2 / appendix: the S-table, a permutation of 0..255 derived from the digits of pi.
const S = Uint8Array.from([
  41, 46, 67, 201, 162, 216, 124, 1, 61, 54, 84, 161, 236, 240, 6, 19, 98, 167, 5, 243, 192, 199,
  115, 140, 152, 147, 43, 217, 188, 76, 130, 202, 30, 155, 87, 60, 253, 212, 224, 22, 103, 66, 111,
  24, 138, 23, 229, 18, 190, 78, 196, 214, 218, 158, 222, 73, 160, 251, 245, 142, 187, 47, 238, 122,
  169, 104, 121, 145, 21, 178, 7, 63, 148, 194, 16, 137, 11, 34, 95, 33, 128, 127, 93, 154, 90, 144,
  50, 39, 53, 62, 204, 231, 191, 247, 151, 3, 255, 25, 48, 179, 72, 165, 181, 209, 215, 94, 146, 42,
  172, 86, 170, 198, 79, 184, 56, 210, 150, 164, 125, 182, 118, 252, 107, 226, 156, 116, 4, 241, 69,
  157, 112, 89, 100, 113, 135, 32, 134, 91, 207, 101, 230, 45, 168, 2, 27, 96, 37, 173, 174, 176,
  185, 246, 28, 70, 97, 105, 52, 64, 126, 15, 85, 71, 163, 35, 221, 81, 175, 58, 195, 92, 249, 206,
  186, 197, 234, 38, 44, 83, 13, 110, 133, 40, 132, 9, 211, 223, 205, 244, 65, 129, 77, 82, 106,
  220, 55, 200, 108, 193, 171, 250, 36, 225, 123, 8, 12, 189, 177, 74, 120, 136, 149, 139, 227, 99,
  232, 109, 233, 203, 213, 254, 59, 0, 29, 57, 242, 239, 183, 14, 102, 88, 208, 228, 166, 119, 114,
  248, 235, 117, 75, 10, 49, 68, 80, 180, 143, 237, 31, 26, 219, 153, 141, 51, 159, 17, 131, 20,
]);

/** The MD2 digest (16 bytes) of `data`. */
export function md2(data: Uint8Array): Uint8Array {
  // Section 3.1: pad with n bytes of value n so the length is a multiple of 16 (n in 1..16).
  const padLen = 16 - (data.length % 16);
  const end = data.length + padLen;
  const padded = new Uint8Array(end + 16);
  padded.set(data);
  padded.fill(padLen, data.length, end);
  // Section 3.2: append the 16-byte checksum.
  const checksum = new Uint8Array(16);
  let l = 0;
  for (let i = 0; i < end; i += 16) {
    for (let j = 0; j < 16; j++) {
      const c = padded[i + j] as number;
      checksum[j] = (checksum[j] as number) ^ (S[c ^ l] as number);
      l = checksum[j] as number;
    }
  }
  padded.set(checksum, end);
  // Section 3.4: each 16-byte block goes through the 48-byte buffer, 18 rounds.
  const x = new Uint8Array(48);
  for (let i = 0; i < padded.length; i += 16) {
    for (let j = 0; j < 16; j++) {
      x[16 + j] = padded[i + j] as number;
      x[32 + j] = (x[16 + j] as number) ^ (x[j] as number);
    }
    let t = 0;
    for (let round = 0; round < 18; round++) {
      for (let k = 0; k < 48; k++) {
        x[k] = (x[k] as number) ^ (S[t] as number);
        t = x[k] as number;
      }
      t = (t + round) & 0xff;
    }
  }
  return x.slice(0, 16);
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("md2", "_hash", "( data:bytes -- bytes )", md2, {
    doc: "The MD2 digest (RFC 1319) of the bytes (private helper of md2:digest).",
    category: "Hashing",
  }),
];
