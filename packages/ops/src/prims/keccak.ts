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
 * keccak primitives. Only `_hash` is a primitive: the Keccak-f[1600] permutation is far too slow in
 * FL at 64 KiB, so it wraps the audited `@noble/hashes`, whose keccak_* functions use the original
 * Keccak padding (0x01), not the FIPS 202 padding of sha3_*. The word `keccak:digest`
 * (vocab/keccak.fth) holds the metadata and the parameter.
 */
import { keccak_224, keccak_256, keccak_384, keccak_512 } from "@noble/hashes/sha3.js";
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { rangeFailure } from "../prim-util.js";

const HASHES: Readonly<Record<string, (data: Uint8Array) => Uint8Array>> = {
  "224": keccak_224,
  "256": keccak_256,
  "384": keccak_384,
  "512": keccak_512,
};

/** The Keccak digest of `data` for a size in bits (224, 256, 384 or 512). */
export function hash(data: Uint8Array, size: string): Uint8Array {
  const fn = Object.hasOwn(HASHES, size) ? HASHES[size] : undefined;
  if (fn === undefined) throw rangeFailure(`unknown Keccak size '${size.slice(0, 20)}'`);
  return fn(data);
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("keccak", "_hash", "( data:bytes size:str -- bytes )", hash, {
    doc: "The Keccak digest of the bytes for a size name (private helper of keccak:digest).",
    category: "Hashing",
  }),
];
