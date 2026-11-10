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
 * ripemd160 primitives. Only `_hash` is a primitive: RIPEMD-160 is 32-bit word arithmetic over two
 * parallel lines of 80 steps per block, far too slow in FL at 64 KiB, so it wraps the audited
 * `@noble/hashes`. The word `ripemd160:digest` (vocab/ripemd160.fth) holds the metadata.
 */
import { ripemd160 } from "@noble/hashes/legacy.js";
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";

/** The RIPEMD-160 digest of `data`. */
export function hash(data: Uint8Array): Uint8Array {
  return ripemd160(data);
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("ripemd160", "_hash", "( data:bytes -- bytes )", hash, {
    doc: "The RIPEMD-160 digest of the bytes (private helper of ripemd160:digest).",
    category: "Hashing",
  }),
];
