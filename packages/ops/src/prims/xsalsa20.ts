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
 * xsalsa20 primitive, over the audited `@noble/ciphers` (imported from the `salsa.js` subpath only). The
 * XSalsa20 keystream is ARX work per 64-byte block, too slow in FL at 64 KiB, so this wraps the library.
 *
 * XSalsa20 derives a subkey from the key and the first 16 nonce bytes (HSalsa20), then runs Salsa20/20
 * with the last 8 nonce bytes. Noble takes a 32-byte key and a 24-byte nonce; a 16-byte key, which CyberChef
 * accepts, raises E_RANGE here. Only 20 rounds exist. The word `xsalsa20:encrypt` (vocab/xsalsa20.fth)
 * holds the metadata and the parameters.
 */
import { xsalsa20 } from "@noble/ciphers/salsa.js";
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { rangeFailure } from "../prim-util.js";

/** Encrypts or decrypts (the same operation) the bytes with the XSalsa20/20 keystream. */
export function crypt(
  data: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array,
  counter: number,
): Uint8Array {
  if (key.length !== 32)
    throw rangeFailure(`the XSalsa20 key must be 32 bytes, not ${key.length}`, {
      length: key.length,
    });
  if (nonce.length !== 24)
    throw rangeFailure(`the XSalsa20 nonce must be 24 bytes, not ${nonce.length}`, {
      length: nonce.length,
    });
  if (!Number.isSafeInteger(counter) || counter < 0)
    throw rangeFailure(`the XSalsa20 counter must be a whole number from 0, not ${counter}`);
  try {
    return xsalsa20(key, nonce, data, undefined, counter);
  } catch (err) {
    throw rangeFailure(`XSalsa20: ${(err as Error).message}`);
  }
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "xsalsa20",
    "_crypt",
    "( data:bytes key:bytes nonce:bytes counter:int -- bytes )",
    crypt,
    {
      doc: "The XSalsa20 keystream XORed over the bytes, the same both ways (private helper of xsalsa20:encrypt).",
      category: "Encryption",
    },
  ),
];
