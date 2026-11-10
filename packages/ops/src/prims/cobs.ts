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
 * cobs primitives. Only `_starts` is a primitive: the offsets of the blocks of COBS data are a
 * sequential walk (each block's offset depends on the previous block's code byte), and in FL that
 * walk has to grow a list one block at a time. That is quadratic: on 64 KiB of data made of one-byte
 * blocks (the encoding of 64 KiB of zero bytes) it exceeds the total allocation limit
 * (E_LIMIT_TOTAL). Everything else in the `cobs` vocabulary is FL (vocab/cobs.fth).
 */
import { definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { coerceFailure } from "../prim-util.js";

const { int } = valueHelpers;

/** The offset of the code byte of every block; E_COERCE for any zero byte or a block that is cut short. */
function starts(data: Uint8Array) {
  if (data.includes(0)) throw coerceFailure("COBS data", "bytes", "a zero byte in COBS data");
  const out = [];
  let pos = 0;
  while (pos < data.length) {
    const code = data[pos] as number;
    if (pos + code > data.length) throw coerceFailure("COBS data", "bytes", "truncated COBS block");
    out.push(int(pos));
    pos += code;
  }
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("cobs", "_starts", "( data:bytes -- list )", starts, {
    doc: "Offsets of the blocks of COBS data, checking each block (private helper of cobs:decode).",
    category: "Encodings",
  }),
];
