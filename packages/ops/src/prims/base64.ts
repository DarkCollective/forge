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
 * The two private regrouping helpers of base64 (RFC 4648): three bytes are four 6-bit symbol values and
 * back. Everything else (the alphabets, white space, padding, every check and error) is FL in
 * `vocab/base64.fth`. In FL the regrouping costs about 50 VM steps for every 3 bytes (1.1 million steps
 * for 64 KiB, against a default limit of 10 million), which the PEM, JWT and JWK words that call
 * base64 many times could not afford; here it is a fixed 2 steps.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef } from "@forge/lang";
import { guardResult } from "../prim-util.js";

/** The symbol values (0 to 63) of the bytes, four to every three. The length must be a multiple of 3. */
function sextets(data: Uint8Array, ctx: PrimitiveContext): Uint8Array {
  guardResult(ctx, (data.length / 3) * 4, "base64 symbols");
  const out = new Uint8Array((data.length / 3) * 4);
  let o = 0;
  for (let i = 0; i + 3 <= data.length; i += 3) {
    const n =
      ((data[i] as number) << 16) | ((data[i + 1] as number) << 8) | (data[i + 2] as number);
    out[o++] = n >> 18;
    out[o++] = (n >> 12) & 63;
    out[o++] = (n >> 6) & 63;
    out[o++] = n & 63;
  }
  return out;
}

/** The bytes of the symbol values, three to every four. The length must be a multiple of 4. */
function unsextets(data: Uint8Array, ctx: PrimitiveContext): Uint8Array {
  guardResult(ctx, (data.length / 4) * 3, "base64 bytes");
  const out = new Uint8Array((data.length / 4) * 3);
  let o = 0;
  for (let i = 0; i + 4 <= data.length; i += 4) {
    const n =
      ((data[i] as number) << 18) |
      ((data[i + 1] as number) << 12) |
      ((data[i + 2] as number) << 6) |
      (data[i + 3] as number);
    out[o++] = n >> 16;
    out[o++] = (n >> 8) & 255;
    out[o++] = n & 255;
  }
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "base64",
    "_sextets",
    "( data:bytes -- bytes )",
    (data: Uint8Array, ctx: PrimitiveContext) => sextets(data, ctx),
    {
      doc: "The 6-bit symbol values of bytes, four to every three; the length must be a multiple of 3 (private helper of base64:encode).",
      category: "Encodings",
    },
  ),
  definePrimitive(
    "base64",
    "_unsextets",
    "( data:bytes -- bytes )",
    (data: Uint8Array, ctx: PrimitiveContext) => unsextets(data, ctx),
    {
      doc: "The bytes of 6-bit symbol values, three to every four; the length must be a multiple of 4, each value 0 to 63 (private helper of base64:decode).",
      category: "Encodings",
    },
  ),
];
