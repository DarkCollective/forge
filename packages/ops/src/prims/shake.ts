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
 * shake primitives. Only `_hash` is a primitive: the sponge is far too slow in FL at 64 KiB, so it
 * wraps the audited `@noble/hashes` (FIPS 202). The word `shake:digest` (vocab/shake.fth) holds the
 * metadata and the parameters. The output length is in bytes.
 */
import { shake128, shake256 } from "@noble/hashes/sha3.js";
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { rangeFailure } from "../prim-util.js";

type Xof = (data: Uint8Array, opts: { dkLen: number }) => Uint8Array;

const XOFS: Readonly<Record<string, Xof>> = {
  "128": shake128,
  "256": shake256,
};

/** `length` bytes of SHAKE128 (variant "128") or SHAKE256 (variant "256") of `data`. */
export function hash(data: Uint8Array, variant: string, length: number): Uint8Array {
  const fn = Object.hasOwn(XOFS, variant) ? XOFS[variant] : undefined;
  if (fn === undefined) throw rangeFailure(`unknown SHAKE variant '${variant.slice(0, 20)}'`);
  if (!Number.isSafeInteger(length) || length < 1 || length > 65536) {
    throw rangeFailure(`SHAKE output length ${length} is not 1 to 65536 bytes`);
  }
  return fn(data, { dkLen: length });
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("shake", "_hash", "( data:bytes variant:str length:int -- bytes )", hash, {
    doc: "The SHAKE output of the bytes for a variant and a length in bytes (private helper of shake:digest).",
    category: "Hashing",
  }),
];
