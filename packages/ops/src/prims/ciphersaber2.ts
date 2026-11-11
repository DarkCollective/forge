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
 * ciphersaber2 primitives. CipherSaber-2 (Arnold Reinhold, 2000; the protocol is on ciphersaber.gurus.org):
 * RC4 whose key is the user key followed by a 10-byte IV, with the key setup repeated N times (the index j
 * carried over from round to round), then plain RC4 output. An encrypted message is the IV followed by the
 * XOR of the message with the key stream. `_crypt` is deterministic: the random IV comes from the shared
 * `random:bytes-of`. The words `ciphersaber2:encrypt` and `decrypt` (vocab/ciphersaber2.fth) hold the
 * metadata and the parameters.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { rc4Schedule, rc4Xor } from "../cipher-util.js";
import { rangeFailure } from "../prim-util.js";

const IV_LENGTH = 10;
const MAX_ROUNDS = 10000;

/** XORs `data` with the CipherSaber-2 key stream of key || iv after `rounds` key setup rounds. */
export function crypt(
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  rounds: number,
): Uint8Array {
  if (iv.length !== IV_LENGTH)
    throw rangeFailure(`the CipherSaber IV must be ${IV_LENGTH} bytes, not ${iv.length}`, {
      length: iv.length,
    });
  if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > MAX_ROUNDS)
    throw rangeFailure(`the CipherSaber rounds must be 1 to ${MAX_ROUNDS}, not ${rounds}`);
  const material = new Uint8Array(key.length + IV_LENGTH);
  material.set(key);
  material.set(iv, key.length);
  return rc4Xor(rc4Schedule(material, rounds), data, 0);
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "ciphersaber2",
    "_crypt",
    "( data:bytes key:bytes iv:bytes rounds:int -- bytes )",
    crypt,
    {
      doc: "The CipherSaber-2 XOR of the bytes under key and a 10-byte IV (private helper of ciphersaber2:encrypt and decrypt).",
      category: "Encryption",
    },
  ),
];
