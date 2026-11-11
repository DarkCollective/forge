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
 * lmhash primitive: the LAN Manager hash (MS-NLMP 3.3.1 "LMOWFv1"). One private primitive,
 * `_hash ( password -- bytes )`, over the single-block DES of src/prims/des.ts (private to the des
 * vocabulary, so FL cannot call it). The password is the bytes of the already upper-cased OEM text;
 * it is zero-padded or truncated to 14 bytes, each 7-byte half is spread over eight 7-bit groups to
 * make a DES key (the parity bits are left clear, and DES ignores them), and the constant
 * "KGS!@#$%" is encrypted under each key. The hash is the two 8-byte results.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { desEncryptBlock } from "./des.js";

/** "KGS!@#$%": the constant encrypted by the LM hash. */
const MAGIC = Uint8Array.of(0x4b, 0x47, 0x53, 0x21, 0x40, 0x23, 0x24, 0x25);

/** Spreads 7 bytes (56 bits) over the 8 bytes of a DES key, 7 bits in the high bits of each byte. */
function desKey(h: Uint8Array): Uint8Array {
  const key = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    // Bits 7*i .. 7*i+6 of the 56-bit string, most significant first.
    let v = 0;
    for (let j = 0; j < 7; j++) {
      const bit = 7 * i + j;
      v = (v << 1) | ((h[bit >> 3]! >> (7 - (bit & 7))) & 1);
    }
    key[i] = v << 1;
  }
  return key;
}

/** The LM hash of upper-cased OEM password bytes: 16 bytes. */
export function lmHash(password: Uint8Array): Uint8Array {
  const padded = new Uint8Array(14);
  padded.set(password.subarray(0, 14));
  const out = new Uint8Array(16);
  out.set(desEncryptBlock(MAGIC, desKey(padded.subarray(0, 7))), 0);
  out.set(desEncryptBlock(MAGIC, desKey(padded.subarray(7, 14))), 8);
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("lmhash", "_hash", "( password:bytes -- bytes )", lmHash, {
    doc: "The LM hash of upper-cased password bytes, padded or truncated to 14 (private helper of lmhash:digest).",
    category: "Hashing",
  }),
];
