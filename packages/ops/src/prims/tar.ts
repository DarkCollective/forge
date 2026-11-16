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
 * tar primitives. The tar container is FL (vocab/tar.fth), including the walk over the headers (a
 * collector keeps it linear); two small helpers are primitives, each measured against FL:
 *  - `_oct ( field what -- int )`: an octal header field, about 250 VM steps in FL, six times a header.
 *  - `_sum ( data -- int )`: the sum of the bytes for the header checksum, about 2,500 steps in FL
 *    (the write path uses it too).
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { coerceFailure } from "../prim-util.js";

/** The sum of the bytes. */
export function byteSum(data: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < data.length; i++) s += data[i] as number;
  return s;
}

/**
 * An octal number field of a header: the bytes up to the first NUL, spaces ignored, empty is 0. The
 * GNU base-256 form (high bit of the first byte) and any other character are `E_COERCE`.
 */
export function octal(field: Uint8Array, what: string): number {
  if (field.length > 0 && ((field[0] as number) & 0x80) !== 0)
    throw coerceFailure(
      "tar data",
      "int",
      `tar ${what} uses the binary (base-256) form, which is not supported`,
    );
  let value = 0;
  for (const b of field) {
    if (b === 0) break;
    if (b === 0x20) continue;
    if (b < 0x30 || b > 0x37)
      throw coerceFailure(
        "tar data",
        "int",
        `tar ${what} is not an octal number (not a tar archive, or corrupt data)`,
      );
    value = value * 8 + (b - 0x30);
  }
  return value;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("tar", "_oct", "( field:bytes what:str -- int )", octal, {
    doc: "The value of an octal header field (private helper of the tar words).",
    category: "Compression",
  }),
  definePrimitive("tar", "_sum", "( data:bytes -- int )", byteSum, {
    doc: "The sum of the bytes (private helper of the tar header checksum).",
    category: "Compression",
  }),
];
