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
 * aes-kw primitives, over the audited `@noble/ciphers` (imported from the `aes.js` subpath only). AES Key
 * Wrap (RFC 3394) runs six passes of AES over every 64-bit block, too slow in FL at 64 KiB, so these wrap
 * the library's `aeskw`:
 *
 *  - `_wrap`: wraps the key data (a multiple of 8 bytes, at least 16) under the key-encryption key;
 *  - `_unwrap`: unwraps, and checks the RFC 3394 integrity value (the default IV) before it returns.
 *
 * The IV is the RFC 3394 default (A6A6A6A6A6A6A6A6), fixed by noble's `aeskw`; CyberChef's IV parameter is
 * not offered. Errors: a key-encryption key that is not 16, 24 or 32 bytes is E_RANGE; a data length that
 * the wrap cannot take, and a failed integrity check, are E_COERCE.
 */
import { aeskw } from "@noble/ciphers/aes.js";
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { coerceFailure, rangeFailure } from "../prim-util.js";

/** Rejects a key-encryption key that is not 16, 24 or 32 bytes (E_RANGE). */
function checkKek(kek: Uint8Array): void {
  if (kek.length !== 16 && kek.length !== 24 && kek.length !== 32)
    throw rangeFailure(`the key-encryption key must be 16, 24 or 32 bytes, not ${kek.length}`, {
      length: kek.length,
    });
}

/** RFC 3394 key wrap: the data is a multiple of 8 bytes, at least 16 (two 64-bit blocks). */
export function wrap(data: Uint8Array, kek: Uint8Array): Uint8Array {
  checkKek(kek);
  if (data.length % 8 !== 0 || data.length < 16)
    throw coerceFailure(
      "bytes",
      "bytes",
      `the key data must be a multiple of 8 bytes and at least 16, not ${data.length}`,
    );
  return aeskw(kek).encrypt(data);
}

/** RFC 3394 key unwrap: the wrapped key is a multiple of 8 bytes, at least 24 (three 64-bit blocks). */
export function unwrap(data: Uint8Array, kek: Uint8Array): Uint8Array {
  checkKek(kek);
  if (data.length % 8 !== 0 || data.length < 24)
    throw coerceFailure(
      "bytes",
      "bytes",
      `the wrapped key must be a multiple of 8 bytes and at least 24, not ${data.length}`,
    );
  try {
    return aeskw(kek).decrypt(data);
  } catch {
    throw coerceFailure(
      "bytes",
      "bytes",
      "the key unwrap integrity check failed: wrong key-encryption key or corrupted data",
    );
  }
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("aes-kw", "_wrap", "( data:bytes kek:bytes -- bytes )", wrap, {
    doc: "AES Key Wrap (RFC 3394) of the data under the key-encryption key (private helper of aes-kw:wrap).",
    category: "Encryption",
  }),
  definePrimitive("aes-kw", "_unwrap", "( data:bytes kek:bytes -- bytes )", unwrap, {
    doc: "AES Key Unwrap (RFC 3394), checking the integrity value (private helper of aes-kw:unwrap).",
    category: "Encryption",
  }),
];
