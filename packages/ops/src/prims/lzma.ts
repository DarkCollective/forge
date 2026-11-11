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
 * lzma primitives: the `.lzma` ("LZMA alone") format over `lzma1` (Apache-2.0, pure ESM, synchronous;
 * see NOTICE). LZ matching and range coding are far too slow in FL at 64 KiB, so the codec is two
 * private primitives and the header checks and the size comparison are FL in vocab/lzma.fth:
 *
 *  - `_compress ( data level -- bytes )`: an `.lzma` stream at a level from 1 to 9 (the header holds
 *    the size and the stream ends with its end marker, as `lzma1` writes it).
 *  - `_decode ( data -- bytes int )`: decodes an `.lzma` stream and gives the output and the size the
 *    header declares (-1 when it is unknown), so FL can compare the two.
 *
 * The output limit (the decompression bomb rule of packages/ops/README.md, "Wave 6 conventions"):
 * `lzma1.decompress` has no cap of its own. Its output buffer grows with what it decodes, and an
 * unknown size makes it run to the end of the input. The primitive therefore never hands it a stream
 * that can exceed the limit:
 *
 *  - a declared size above `ctx.limits.maxValueBytes` is `E_LIMIT_VALUE` before any decoding;
 *  - an unknown size (all 0xFF, which xz and Python write) is replaced, in a copy, by the declared
 *    size `max + 1`. The decoder then stops at `max + 1` bytes; an end marker before it ends the
 *    stream as usual (`lzma1` accepts that unless `strict`), and a stream that has more output raises
 *    the library's "data exceeds the declared size", which is `E_LIMIT_VALUE` here. Its dictionary is
 *    `min(dictionary size, declared size)`, so memory is bounded by `max + 1` and the dictionary is
 *    never larger than that.
 */
import { compress, decompress } from "lzma1";
import { definePrimitive } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef } from "@forge/lang";
import { bombFailure, coerceFailure, limitFailure, rangeFailure } from "../prim-util.js";

/** The `.lzma` header: a properties byte, a 4-byte dictionary size and an 8-byte uncompressed size. */
const HEADER_SIZE = 13;
/** Declared size of -1 in FL: the header says the size is unknown (all 0xFF). */
const UNKNOWN = -1;
/** The library's message when the stream has more output than its declared size. */
const EXCEEDS = "Corrupted input: data exceeds the declared size";

/** An `.lzma` stream of the bytes at a level from 1 (fastest) to 9 (smallest). */
export function lzmaCompress(data: Uint8Array, level: number): Uint8Array {
  if (!Number.isInteger(level) || level < 1 || level > 9)
    throw rangeFailure(`the compression level must be 1 to 9, not ${String(level)}`);
  return compress(data, level as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9).slice();
}

/**
 * Decodes an `.lzma` stream without ever producing more than `max` bytes. Returns the output and the
 * declared size (UNKNOWN for an unknown size). A bad stream is `E_COERCE` naming the fault.
 */
export function lzmaDecode(data: Uint8Array, max: number): { out: Uint8Array; declared: number } {
  if (data.length < HEADER_SIZE)
    throw coerceFailure("LZMA data", "bytes", "unexpected EOF: an .lzma header is 13 bytes");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const unknown = view.getUint32(5, true) === 0xffffffff && view.getUint32(9, true) === 0xffffffff;
  const declaredBig =
    BigInt(view.getUint32(9, true)) * 4294967296n + BigInt(view.getUint32(5, true));
  if (!unknown && declaredBig > BigInt(max))
    throw limitFailure(
      "maxValueBytes",
      max,
      Number(declaredBig),
      "the uncompressed size declared in the .lzma header",
    );

  let input = data;
  if (unknown) {
    // A copy with the bound as the declared size; the caller's bytes are not changed.
    input = data.slice();
    const bound = max + 1;
    const bytes = new DataView(input.buffer);
    bytes.setUint32(5, bound % 4294967296, true);
    bytes.setUint32(9, Math.floor(bound / 4294967296), true);
  }

  let out: Uint8Array;
  try {
    out = decompress(input);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (unknown && message === EXCEEDS) throw bombFailure(max, max + 1);
    if (message === "Truncated input")
      throw coerceFailure("LZMA data", "bytes", "unexpected EOF: the stream is cut short");
    throw coerceFailure(
      "LZMA data",
      "bytes",
      message.replace(/^Corrupted input: /, "corrupt data: "),
    );
  }
  if (out.length > max) throw bombFailure(max, out.length);
  return { out: out.slice(), declared: unknown ? UNKNOWN : Number(declaredBig) };
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "lzma",
    "_compress",
    "( data:bytes level:int -- bytes )",
    (data: Uint8Array, level: number | bigint) => lzmaCompress(data, Number(level)),
    {
      doc: "An .lzma (LZMA alone) stream of the bytes at a level from 1 to 9 (private helper of lzma:compress).",
      category: "Compression",
    },
  ),
  definePrimitive(
    "lzma",
    "_decode",
    "( data:bytes -- bytes int )",
    (data: Uint8Array, ctx: PrimitiveContext) => {
      const { out, declared } = lzmaDecode(data, ctx.limits.maxValueBytes);
      return [out, declared];
    },
    {
      doc: "Decodes an .lzma stream; gives the output and the declared size, -1 when unknown. Stops at the value limit with E_LIMIT_VALUE (private helper of lzma:decompress).",
      category: "Compression",
    },
  ),
];
