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
 * rc4 primitive. RC4 (the stream cipher published as ARC4; Schneier, Applied Cryptography, 2nd ed.,
 * section 17.1, and the widely mirrored 1994 description): 256-byte state, key setup that cycles the key,
 * then the generator. `drop` discards that many key stream bytes first (RC4-drop[n], Mironov 2002). The
 * word `rc4:crypt` (vocab/rc4.fth) holds the metadata. Vectors are the Wikipedia/Schneier ones and RFC 6229
 * (see vocab/rc4.test.json).
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { rc4Schedule, rc4Xor } from "../cipher-util.js";
import { rangeFailure } from "../prim-util.js";

const MAX_DROP = 1 << 24;

/** RC4 of `data` under `key` (1 to 256 bytes) after dropping `drop` key stream bytes; encrypts and decrypts alike. */
export function crypt(data: Uint8Array, key: Uint8Array, drop: number): Uint8Array {
  if (key.length < 1 || key.length > 256)
    throw rangeFailure(`the RC4 key must be 1 to 256 bytes, not ${key.length}`, {
      length: key.length,
    });
  if (!Number.isSafeInteger(drop) || drop < 0 || drop > MAX_DROP)
    throw rangeFailure(`the RC4 drop must be 0 to ${MAX_DROP} bytes, not ${drop}`);
  return rc4Xor(rc4Schedule(key, 1), data, drop);
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("rc4", "_crypt", "( data:bytes key:bytes drop:int -- bytes )", crypt, {
    doc: "RC4 of the bytes under a key after dropping the first n key stream bytes (private helper of rc4:crypt).",
    category: "Encryption",
  }),
];
