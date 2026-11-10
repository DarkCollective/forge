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
 * blake3 primitives. Only `_hash` is a primitive: BLAKE3 compresses 1 KiB chunks in a Merkle tree of
 * 7 rounds per block, far too slow in FL at 64 KiB, so it wraps the audited `@noble/hashes`. The word
 * `blake3:digest` (vocab/blake3.fth) holds the metadata and the parameters. An empty key is the
 * unkeyed hash; noble rejects a zero-length key, so it is passed as undefined.
 */
import { blake3 } from "@noble/hashes/blake3.js";
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { rangeFailure } from "../prim-util.js";

/** `length` bytes of the BLAKE3 output of `data`, keyed when `key` is not empty (it must then be 32 bytes). */
export function hash(data: Uint8Array, length: number, key: Uint8Array): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 1 || length > 65536) {
    throw rangeFailure(`BLAKE3 output length ${length} is not 1 to 65536 bytes`);
  }
  if (key.length !== 0 && key.length !== 32) {
    throw rangeFailure(`BLAKE3 key of ${key.length} bytes is not 32`);
  }
  return blake3(data, { dkLen: length, key: key.length === 0 ? undefined : key });
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("blake3", "_hash", "( data:bytes length:int key:bytes -- bytes )", hash, {
    doc: "The BLAKE3 output of the bytes, length bytes long, keyed (32-byte key) when the key is not empty (private helper of blake3:digest).",
    category: "Hashing",
  }),
];
