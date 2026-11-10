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
 * blake2b primitives. Only `_hash` is a primitive: BLAKE2b is 64-bit word arithmetic over 12 rounds
 * per 128-byte block, far too slow in FL at 64 KiB, so it wraps the audited `@noble/hashes` (RFC 7693).
 * The word `blake2b:digest` (vocab/blake2b.fth) holds the metadata and the parameters. An empty key is
 * the unkeyed hash; noble rejects a zero-length key, so it is passed as undefined.
 */
import { blake2b } from "@noble/hashes/blake2.js";
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { rangeFailure } from "../prim-util.js";

/** The BLAKE2b digest of `data`, `size` bytes long (1 to 64), keyed when `key` is not empty (up to 64 bytes). */
export function hash(data: Uint8Array, size: number, key: Uint8Array): Uint8Array {
  if (!Number.isSafeInteger(size) || size < 1 || size > 64) {
    throw rangeFailure(`BLAKE2b output size ${size} is not 1 to 64 bytes`);
  }
  if (key.length > 64) throw rangeFailure(`BLAKE2b key of ${key.length} bytes is over 64`);
  return blake2b(data, { dkLen: size, key: key.length === 0 ? undefined : key });
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("blake2b", "_hash", "( data:bytes size:int key:bytes -- bytes )", hash, {
    doc: "The BLAKE2b digest of the bytes, size bytes long, keyed when the key is not empty (private helper of blake2b:digest).",
    category: "Hashing",
  }),
];
