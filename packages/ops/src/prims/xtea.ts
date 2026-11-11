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
 * xtea primitives. XTEA, the eXtended TEA of Needham and Wheeler ("Tea extensions", Computer Laboratory,
 * University of Cambridge, 1997): the 64-bit block as v0, v1, the 128-bit key as k0..k3, and a round count
 * of `rounds` cycles (32 is the recommended 64 rounds; every cycle is two Feistel rounds). The key word of a
 * cycle is chosen by sum & 3 and (sum >> 11) & 3. Block and key words are big-endian (CyberChef's order).
 * Block functions for the shared `blockmode` layer. The words `xtea:encrypt` and `xtea:decrypt` (vocab/xtea.fth)
 * hold the metadata.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { getBE32, checkBlock, putBE32 } from "../cipher-util.js";
import { rangeFailure } from "../prim-util.js";

const DELTA = 0x9e3779b9;

function setup(block: Uint8Array, key: Uint8Array, rounds: number): number[] {
  if (key.length !== 16)
    throw rangeFailure(`the XTEA key must be 16 bytes, not ${key.length}`, { length: key.length });
  if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 255)
    throw rangeFailure(`the XTEA rounds must be 1 to 255, not ${rounds}`);
  checkBlock(block, 8, "XTEA");
  return [getBE32(key, 0), getBE32(key, 4), getBE32(key, 8), getBE32(key, 12)];
}

const mix = (v: number): number => ((((v << 4) ^ (v >>> 5)) >>> 0) + v) >>> 0;

/** One 8-byte block encrypted with `rounds` cycles. */
export function encryptBlock(block: Uint8Array, key: Uint8Array, rounds: number): Uint8Array {
  const k = setup(block, key, rounds);
  let v0 = getBE32(block, 0);
  let v1 = getBE32(block, 4);
  let sum = 0;
  for (let i = 0; i < rounds; i++) {
    v0 = (v0 + ((mix(v1) ^ (sum + k[sum & 3]!)) >>> 0)) >>> 0;
    sum = (sum + DELTA) >>> 0;
    v1 = (v1 + ((mix(v0) ^ (sum + k[(sum >>> 11) & 3]!)) >>> 0)) >>> 0;
  }
  const out = new Uint8Array(8);
  putBE32(out, 0, v0);
  putBE32(out, 4, v1);
  return out;
}

/** One 8-byte block decrypted with `rounds` cycles. */
export function decryptBlock(block: Uint8Array, key: Uint8Array, rounds: number): Uint8Array {
  const k = setup(block, key, rounds);
  let v0 = getBE32(block, 0);
  let v1 = getBE32(block, 4);
  let sum = Math.imul(DELTA, rounds) >>> 0;
  for (let i = 0; i < rounds; i++) {
    v1 = (v1 - ((mix(v0) ^ (sum + k[(sum >>> 11) & 3]!)) >>> 0)) >>> 0;
    sum = (sum - DELTA) >>> 0;
    v0 = (v0 - ((mix(v1) ^ (sum + k[sum & 3]!)) >>> 0)) >>> 0;
  }
  const out = new Uint8Array(8);
  putBE32(out, 0, v0);
  putBE32(out, 4, v1);
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "xtea",
    "_encrypt-block",
    "( block:bytes key:bytes rounds:int -- bytes )",
    encryptBlock,
    {
      doc: "Encrypt one 8-byte block with XTEA (private block function for the blockmode layer).",
      category: "Encryption",
    },
  ),
  definePrimitive(
    "xtea",
    "_decrypt-block",
    "( block:bytes key:bytes rounds:int -- bytes )",
    decryptBlock,
    {
      doc: "Decrypt one 8-byte block with XTEA (private block function for the blockmode layer).",
      category: "Encryption",
    },
  ),
  definePrimitive(
    "xtea",
    "_check-key",
    "( key:bytes -- )",
    (key: Uint8Array) => {
      if (key.length !== 16)
        throw rangeFailure(`the XTEA key must be 16 bytes, not ${key.length}`, {
          length: key.length,
        });
    },
    {
      doc: "Raise E_RANGE unless the key is 16 bytes (private helper of xtea:encrypt).",
      category: "Encryption",
    },
  ),
];
