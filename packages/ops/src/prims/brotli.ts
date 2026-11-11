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
 * Brotli decompression (RFC 7932), the one private primitive of vocab/brotli.fth:
 * `_decompress ( data -- bytes )`. The decoder is the vendored brotli 2.1.0 decoder in
 * src/vendor/brotli (Apache-2.0, Copyright 2013 Google Inc., modified for the output cap: see the
 * notes in that folder and NOTICE). It is the only Brotli decoder the package uses. The compressor
 * and the `brotli` package entry points are not imported.
 *
 * The output limit of the wave 6 conventions: the decoder stops at `ctx.limits.maxValueBytes` with
 * E_LIMIT_VALUE, before it allocates a meta-block's output beyond the limit. A decoder fault
 * (corrupt or cut-short data) is E_COERCE.
 */
import { ForgeError, definePrimitive } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef } from "@forge/lang";
import { coerceFailure } from "../prim-util.js";
import { decompress } from "../vendor/brotli/decode.js";

/** Decompresses a Brotli stream; output past `max` bytes is E_LIMIT_VALUE, faults are E_COERCE. */
export function brotliDecompress(data: Uint8Array, max: number): Uint8Array {
  try {
    return decompress(data, max) as Uint8Array;
  } catch (e) {
    if (e instanceof ForgeError) throw e;
    const reason = e instanceof Error ? e.message : String(e);
    throw coerceFailure("brotli data", "bytes", reason);
  }
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "brotli",
    "_decompress",
    "( data:bytes -- bytes )",
    (data: Uint8Array, ctx: PrimitiveContext) => brotliDecompress(data, ctx.limits.maxValueBytes),
    {
      doc: "Decompress a Brotli stream (RFC 7932) with the vendored decoder, stopping at the value limit with E_LIMIT_VALUE (private helper of brotli:decompress).",
      category: "Compression",
    },
  ),
];
