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
 * triple-des primitives: Triple DES in the encrypt-decrypt-encrypt form, C = E_K3(D_K2(E_K1(P))) and
 * P = D_K1(E_K2(D_K3(C))) (NIST SP 800-67, the TDEA). The single-block DES is the one in `des.ts`.
 *
 *  - `_check-key`: the key must be 24 bytes (three-key) or 16 bytes (two-key, K3 = K1, which is how
 *    CyberChef treats a 16-byte key); anything else is E_RANGE;
 *  - `_encrypt-block` and `_decrypt-block`: one 8-byte block, the block functions of the shared
 *    `blockmode` layer. The three schedules of the last key are cached.
 *
 * Triple DES is composed here from the block functions, never from the modes: the chaining of the
 * `blockmode` layer is not reentrant.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { checkBlock, getBE32, keyCache, putBE32 } from "../cipher-util.js";
import { rangeFailure } from "../prim-util.js";
import { desBlock, desKeySchedule } from "./des.js";
import type { DesSchedule } from "./des.js";

/** Rejects a key that is not 16 or 24 bytes (E_RANGE). */
export function checkKey(key: Uint8Array): void {
  if (key.length !== 16 && key.length !== 24)
    throw rangeFailure(`the Triple DES key must be 16 or 24 bytes, not ${key.length}`, {
      length: key.length,
    });
}

const schedules = keyCache((key: Uint8Array): [DesSchedule, DesSchedule, DesSchedule] => {
  checkKey(key);
  const k1 = desKeySchedule(key.subarray(0, 8));
  const k2 = desKeySchedule(key.subarray(8, 16));
  // Two-key Triple DES reuses the first key as the third.
  const k3 = key.length === 24 ? desKeySchedule(key.subarray(16, 24)) : k1;
  return [k1, k2, k3];
});

function run(block: Uint8Array, key: Uint8Array, decrypt: boolean): Uint8Array {
  checkBlock(block, 8, "Triple DES");
  const [k1, k2, k3] = schedules(key);
  // Encryption is E(K1), D(K2), E(K3); decryption is D(K3), E(K2), D(K1).
  const [a, b, c] = decrypt ? [k3, k2, k1] : [k1, k2, k3];
  let w = desBlock(a, getBE32(block, 0), getBE32(block, 4), decrypt);
  w = desBlock(b, w[0]!, w[1]!, !decrypt);
  w = desBlock(c, w[0]!, w[1]!, decrypt);
  const out = new Uint8Array(8);
  putBE32(out, 0, w[0]!);
  putBE32(out, 4, w[1]!);
  return out;
}

/** Encrypts one 8-byte block with a 16 or 24-byte key. */
export function tdesEncryptBlock(block: Uint8Array, key: Uint8Array): Uint8Array {
  return run(block, key, false);
}

/** Decrypts one 8-byte block with a 16 or 24-byte key. */
export function tdesDecryptBlock(block: Uint8Array, key: Uint8Array): Uint8Array {
  return run(block, key, true);
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("triple-des", "_check-key", "( key:bytes -- )", checkKey, {
    doc: "Raise E_RANGE unless the key is 16 or 24 bytes (private helper of triple-des:encrypt).",
    category: "Encryption",
  }),
  definePrimitive(
    "triple-des",
    "_encrypt-block",
    "( block:bytes key:bytes -- bytes )",
    tdesEncryptBlock,
    {
      doc: "Encrypt one 8-byte block with raw Triple DES, EDE (private block function for the blockmode layer).",
      category: "Encryption",
    },
  ),
  definePrimitive(
    "triple-des",
    "_decrypt-block",
    "( block:bytes key:bytes -- bytes )",
    tdesDecryptBlock,
    {
      doc: "Decrypt one 8-byte block with raw Triple DES, EDE (private block function for the blockmode layer).",
      category: "Encryption",
    },
  ),
];
