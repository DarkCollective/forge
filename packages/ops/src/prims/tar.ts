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
 * tar primitives. The tar container is FL (vocab/tar.fth); three small helpers are primitives, each
 * measured against FL:
 *  - `_headers ( data verify -- list )`: the offsets of all the headers. Each offset depends on the size
 *    field of the header before, and growing a list one header at a time in FL is quadratic (12,000
 *    entries took over 30 s; the cobs and zip vocabularies have the same walk and the same answer).
 *  - `_oct ( field what -- int )`: an octal header field, about 250 VM steps in FL, six times a header.
 *  - `_sum ( data -- int )`: the sum of the bytes for the header checksum, about 2,500 steps in FL
 *    (the write path uses it too).
 * With them reading costs about 400 VM steps per entry (1,000 entries: 0.4 million steps).
 */
import { definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { coerceFailure } from "../prim-util.js";

const { int } = valueHelpers;

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

/**
 * The offsets of all the headers of an archive, in order: a header is followed by its data padded to
 * 512 bytes, so each offset depends on the size field of the one before (a sequential walk; in FL it
 * grows a list one header at a time, which is quadratic: 12,000 entries take over 30 s). The archive
 * ends at the end of the data or at a block of zeros; a part of a block that is not zeros, or an entry
 * whose data runs past the input, is `E_COERCE`. With `verify` each header's checksum must match.
 */
export function headerOffsets(data: Uint8Array, verify: boolean): number[] {
  if (data.length === 0)
    throw coerceFailure("tar data", "list", "not tar data: the input is empty");
  const out: number[] = [];
  let p = 0;
  for (;;) {
    if (p >= data.length) break;
    const rest = data.length - p;
    const block = data.subarray(p, p + Math.min(512, rest));
    if (block.every((b) => b === 0)) {
      if (rest < 512) break; // zeros only: padding after the last block
      break;
    }
    if (rest < 512)
      throw coerceFailure(
        "tar data",
        "list",
        "tar data is cut short: the last header is incomplete",
      );
    if (verify) {
      const stored = octal(block.subarray(148, 156), "header checksum");
      const actual = byteSum(block) - byteSum(block.subarray(148, 156)) + 8 * 0x20;
      if (stored !== actual)
        throw coerceFailure(
          "tar data",
          "list",
          `tar header checksum mismatch at offset ${p} (not a tar archive, or corrupt data)`,
        );
    }
    const size = octal(block.subarray(124, 136), "size");
    if (p + 512 + size > data.length)
      throw coerceFailure(
        "tar data",
        "list",
        "tar data is cut short: an entry's data ends early (truncated)",
      );
    out.push(p);
    p += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "tar",
    "_headers",
    "( data:bytes verify:bool -- list )",
    (data: Uint8Array, verify: boolean) => headerOffsets(data, verify).map((p) => int(p)),
    {
      doc: "The offsets of the headers of a tar archive, checked (private helper of tar:untar and tar:entry).",
      category: "Compression",
    },
  ),
  definePrimitive("tar", "_oct", "( field:bytes what:str -- int )", octal, {
    doc: "The value of an octal header field (private helper of the tar words).",
    category: "Compression",
  }),
  definePrimitive("tar", "_sum", "( data:bytes -- int )", byteSum, {
    doc: "The sum of the bytes (private helper of the tar header checksum).",
    category: "Compression",
  }),
];
