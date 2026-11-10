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
 * sha1 primitives. Only `_hash` is a primitive: SHA-1 is 32-bit word arithmetic over 80 rounds per
 * block, far too slow in FL at 64 KiB, so it wraps the audited `@noble/hashes` (FIPS 180-4). The
 * word `sha1:digest` (vocab/sha1.fth) holds the metadata.
 */
import { sha1 } from "@noble/hashes/legacy.js";
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";

/** The SHA-1 digest of `data` (20 bytes). */
export function hash(data: Uint8Array): Uint8Array {
  return sha1(data);
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("sha1", "_hash", "( data:bytes -- bytes )", hash, {
    doc: "The SHA-1 digest of the bytes (private helper of sha1:digest).",
    category: "Hashing",
  }),
];
