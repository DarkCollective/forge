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
 * tar primitive. The tar container is FL (vocab/tar.fth); only `_sum ( bytes -- int )` is a
 * primitive: the sum of the bytes, for the header checksum. In FL a 512-byte sum costs about 2,500
 * VM steps, which is the largest part of reading a header (about 5,000 steps each); with it as a
 * primitive an archive of 1,000 entries stays near 2.5 million steps instead of 5 million (the
 * untrusted limit).
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";

/** The sum of the bytes. */
export function byteSum(data: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < data.length; i++) s += data[i] as number;
  return s;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("tar", "_sum", "( data:bytes -- int )", byteSum, {
    doc: "The sum of the bytes (private helper of the tar header checksum).",
    category: "Compression",
  }),
];
