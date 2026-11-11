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
 * salsa20 primitive, over the audited `@noble/ciphers` (imported from the `salsa.js` subpath only). The
 * Salsa20 keystream is ARX work per 64-byte block, too slow in FL at 64 KiB, so this wraps the library.
 *
 * Noble runs Salsa20/20 only: the reduced-round variants (CyberChef's rounds 12 and 8) are not in noble,
 * so the word takes no rounds parameter. The key is 16 or 32 bytes, the nonce 8 bytes, and the counter is
 * the 64-bit block counter (noble rejects a counter that would wrap). The word `salsa20:encrypt`
 * (vocab/salsa20.fth) holds the metadata and the parameters.
 */
import { salsa20 } from "@noble/ciphers/salsa.js";
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { rangeFailure } from "../prim-util.js";

/** Encrypts or decrypts (the same operation) the bytes with the Salsa20/20 keystream. */
export function crypt(
  data: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array,
  counter: number,
): Uint8Array {
  if (key.length !== 16 && key.length !== 32)
    throw rangeFailure(`the Salsa20 key must be 16 or 32 bytes, not ${key.length}`, {
      length: key.length,
    });
  if (nonce.length !== 8)
    throw rangeFailure(`the Salsa20 nonce must be 8 bytes, not ${nonce.length}`, {
      length: nonce.length,
    });
  if (!Number.isSafeInteger(counter) || counter < 0)
    throw rangeFailure(`the Salsa20 counter must be a whole number from 0, not ${counter}`);
  try {
    return salsa20(key, nonce, data, undefined, counter);
  } catch (err) {
    throw rangeFailure(`Salsa20: ${(err as Error).message}`);
  }
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "salsa20",
    "_crypt",
    "( data:bytes key:bytes nonce:bytes counter:int -- bytes )",
    crypt,
    {
      doc: "The Salsa20 keystream XORed over the bytes, the same both ways (private helper of salsa20:encrypt).",
      category: "Encryption",
    },
  ),
];
