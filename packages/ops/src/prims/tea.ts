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
 * tea primitives. The Tiny Encryption Algorithm of Wheeler and Needham ("TEA, a Tiny Encryption Algorithm",
 * 1994): a 64-bit block as two 32-bit halves v0, v1, a 128-bit key as four 32-bit words k0..k3, 32 cycles
 * (64 rounds) with delta = 0x9E3779B9 (2^32 over the golden ratio). The block and key words are read
 * big-endian (the order of the "network" reference and of CyberChef; the original C code reads host-order
 * words). The block function of the shared `blockmode` layer; the modes and padding are not here. The
 * words `tea:encrypt` and `tea:decrypt` (vocab/tea.fth) hold the metadata.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { getBE32, checkBlock, putBE32 } from "../cipher-util.js";
import { rangeFailure } from "../prim-util.js";

const DELTA = 0x9e3779b9;
const CYCLES = 32;

function words(key: Uint8Array): number[] {
  if (key.length !== 16)
    throw rangeFailure(`the TEA key must be 16 bytes, not ${key.length}`, { length: key.length });
  return [getBE32(key, 0), getBE32(key, 4), getBE32(key, 8), getBE32(key, 12)];
}

/** One 8-byte block encrypted (32 cycles). */
export function encryptBlock(block: Uint8Array, key: Uint8Array): Uint8Array {
  const k = words(key);
  checkBlock(block, 8, "TEA");
  let v0 = getBE32(block, 0);
  let v1 = getBE32(block, 4);
  let sum = 0;
  for (let i = 0; i < CYCLES; i++) {
    sum = (sum + DELTA) >>> 0;
    v0 = (v0 + ((((v1 << 4) + k[0]!) ^ (v1 + sum) ^ ((v1 >>> 5) + k[1]!)) >>> 0)) >>> 0;
    v1 = (v1 + ((((v0 << 4) + k[2]!) ^ (v0 + sum) ^ ((v0 >>> 5) + k[3]!)) >>> 0)) >>> 0;
  }
  const out = new Uint8Array(8);
  putBE32(out, 0, v0);
  putBE32(out, 4, v1);
  return out;
}

/** One 8-byte block decrypted. */
export function decryptBlock(block: Uint8Array, key: Uint8Array): Uint8Array {
  const k = words(key);
  checkBlock(block, 8, "TEA");
  let v0 = getBE32(block, 0);
  let v1 = getBE32(block, 4);
  let sum = Math.imul(DELTA, CYCLES) >>> 0;
  for (let i = 0; i < CYCLES; i++) {
    v1 = (v1 - ((((v0 << 4) + k[2]!) ^ (v0 + sum) ^ ((v0 >>> 5) + k[3]!)) >>> 0)) >>> 0;
    v0 = (v0 - ((((v1 << 4) + k[0]!) ^ (v1 + sum) ^ ((v1 >>> 5) + k[1]!)) >>> 0)) >>> 0;
    sum = (sum - DELTA) >>> 0;
  }
  const out = new Uint8Array(8);
  putBE32(out, 0, v0);
  putBE32(out, 4, v1);
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("tea", "_encrypt-block", "( block:bytes key:bytes -- bytes )", encryptBlock, {
    doc: "Encrypt one 8-byte block with TEA (private block function for the blockmode layer).",
    category: "Encryption",
  }),
  definePrimitive("tea", "_decrypt-block", "( block:bytes key:bytes -- bytes )", decryptBlock, {
    doc: "Decrypt one 8-byte block with TEA (private block function for the blockmode layer).",
    category: "Encryption",
  }),
  definePrimitive("tea", "_check-key", "( key:bytes -- )", (key: Uint8Array) => void words(key), {
    doc: "Raise E_RANGE unless the key is 16 bytes (private helper of tea:encrypt).",
    category: "Encryption",
  }),
];
