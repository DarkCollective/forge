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
 * sha2 primitives. Only `_hash` is a primitive: SHA-2 is 32-bit and 64-bit word arithmetic over
 * 64 or 80 rounds per block, far too slow in FL at 64 KiB, so it wraps the audited
 * `@noble/hashes` (FIPS 180-4). The word `sha2:digest` (vocab/sha2.fth) holds the metadata and the
 * parameter. Only the standard round counts exist.
 */
import { sha224, sha256, sha384, sha512, sha512_224, sha512_256 } from "@noble/hashes/sha2.js";
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { rangeFailure } from "../prim-util.js";

const HASHES: Readonly<Record<string, (data: Uint8Array) => Uint8Array>> = {
  "224": sha224,
  "256": sha256,
  "384": sha384,
  "512": sha512,
  "512/224": sha512_224,
  "512/256": sha512_256,
};

/** The digest of `data` for a size name (224, 256, 384, 512, 512/224 or 512/256). */
export function hash(data: Uint8Array, size: string): Uint8Array {
  const fn = Object.hasOwn(HASHES, size) ? HASHES[size] : undefined;
  if (fn === undefined) throw rangeFailure(`unknown SHA-2 size '${size.slice(0, 20)}'`);
  return fn(data);
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("sha2", "_hash", "( data:bytes size:str -- bytes )", hash, {
    doc: "The SHA-2 digest of the bytes for a size name (private helper of sha2:digest).",
    category: "Hashing",
  }),
];
