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
 * blake2s primitives. Only `_hash` is a primitive: BLAKE2s is 32-bit word arithmetic over 10 rounds
 * per 64-byte block, far too slow in FL at 64 KiB, so it wraps the audited `@noble/hashes` (RFC 7693).
 * The word `blake2s:digest` (vocab/blake2s.fth) holds the metadata and the parameters. An empty key is
 * the unkeyed hash; noble rejects a zero-length key, so it is passed as undefined.
 */
import { blake2s } from "@noble/hashes/blake2.js";
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { rangeFailure } from "../prim-util.js";

/** The BLAKE2s digest of `data`, `size` bytes long (1 to 32), keyed when `key` is not empty (up to 32 bytes). */
export function hash(data: Uint8Array, size: number, key: Uint8Array): Uint8Array {
  if (!Number.isSafeInteger(size) || size < 1 || size > 32) {
    throw rangeFailure(`BLAKE2s output size ${size} is not 1 to 32 bytes`);
  }
  if (key.length > 32) throw rangeFailure(`BLAKE2s key of ${key.length} bytes is over 32`);
  return blake2s(data, { dkLen: size, key: key.length === 0 ? undefined : key });
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("blake2s", "_hash", "( data:bytes size:int key:bytes -- bytes )", hash, {
    doc: "The BLAKE2s digest of the bytes, size bytes long, keyed when the key is not empty (private helper of blake2s:digest).",
    category: "Hashing",
  }),
];
