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
 * sha3 primitives. Only `_hash` is a primitive: Keccak-f[1600] is 24 rounds over 25 lanes per block,
 * far too slow in FL at 64 KiB, so it wraps the audited `@noble/hashes` (FIPS 202). The word
 * `sha3:digest` (vocab/sha3.fth) holds the metadata and the parameter.
 */
import { sha3_224, sha3_256, sha3_384, sha3_512 } from "@noble/hashes/sha3.js";
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { rangeFailure } from "../prim-util.js";

const HASHES: Readonly<Record<string, (data: Uint8Array) => Uint8Array>> = {
  "224": sha3_224,
  "256": sha3_256,
  "384": sha3_384,
  "512": sha3_512,
};

/** The SHA-3 digest of `data` for a size in bits (224, 256, 384 or 512). */
export function hash(data: Uint8Array, size: string): Uint8Array {
  const fn = Object.hasOwn(HASHES, size) ? HASHES[size] : undefined;
  if (fn === undefined) throw rangeFailure(`unknown SHA-3 size '${size.slice(0, 20)}'`);
  return fn(data);
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("sha3", "_hash", "( data:bytes size:str -- bytes )", hash, {
    doc: "The SHA-3 digest of the bytes for a size name (private helper of sha3:digest).",
    category: "Hashing",
  }),
];
