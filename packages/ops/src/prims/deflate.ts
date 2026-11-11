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
 * deflate primitives (RFC 1951), over `fflate` (MIT, pinned to an exact version). Entropy coding
 * (LZ77 plus Huffman) is far too slow in FL at 64 KiB, so it is a primitive; the zlib and gzip
 * containers (headers, trailers, checksums) are FL in vocab/deflate.fth. Two private primitives:
 *
 *  - `_deflate ( data level -- bytes )`: a raw DEFLATE stream, level 0 (stored blocks) to 9.
 *  - `_inflate ( data start -- bytes end )`: inflate the raw DEFLATE stream that begins at byte
 *    `start`; `end` is the offset of the first byte after the stream, so FL can read the trailer.
 *
 * The output limit of the wave 6 conventions (packages/ops/README.md, "Wave 6 conventions"): every
 * decompressor stops at `ctx.limits.maxValueBytes` and raises `E_LIMIT_VALUE` (see
 * `inflateLimited`). fflate's one-shot `inflateSync` cannot do that (it grows its buffer without
 * bound, and `gunzipSync` allocates the size the trailer claims, up to 4 GiB), so the primitive
 * drives fflate's streaming `Inflate` with small input chunks and counts the output as it comes.
 */
import { Inflate, deflateSync } from "fflate";
import { definePrimitive } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef } from "@forge/lang";
import { BoundedOutput, coerceFailure, rangeFailure } from "../prim-util.js";

/** Level 0 stores, 1 to 9 compress (fflate chooses stored, fixed or dynamic Huffman blocks by size). */
export function deflateRaw(data: Uint8Array, level: number): Uint8Array {
  if (!Number.isInteger(level) || level < 0 || level > 9)
    throw rangeFailure(`the compression level must be 0 to 9, not ${String(level)}`);
  return deflateSync(data, { level: level as 0 });
}

/** The largest ratio of DEFLATE: a 258-byte match costs at least two bits, so 1032 bytes per byte. */
const MAX_RATIO = 1032;
/** Smallest input chunk, so tiny limits do not cost one stream push per byte. */
const MIN_CHUNK = 256;

/** The parts of fflate's streaming `Inflate` that tell where the stream ended (pinned version). */
interface InflateState {
  /** `s.f`: the final block was seen; `s.l`: still inside a block; `s.p`: bit offset in `p`. */
  readonly s: { readonly f?: number; readonly l?: unknown; readonly p: number };
  /** The input not yet consumed, from the byte that holds the current bit. */
  readonly p: Uint8Array;
}

function corrupt(reason: string) {
  return coerceFailure("deflate stream", "bytes", reason);
}

/**
 * Inflates the raw DEFLATE stream that starts at `start` and returns the output and the offset just
 * after the stream. Never produces more than `maxOut` bytes: the input is pushed in chunks small
 * enough that one chunk cannot expand beyond `chunk * 1032` bytes, and `BoundedOutput` checks the
 * total as each piece arrives, so memory stays under about `maxOut + maxOut / 2` (plus 264 KiB for a tiny limit) before
 * `E_LIMIT_VALUE`. Corrupt, cut-short and empty streams are `E_COERCE` naming what was wrong.
 */
export function inflateLimited(
  data: Uint8Array,
  start: number,
  maxOut: number,
): { out: Uint8Array; end: number } {
  if (!Number.isInteger(start) || start < 0 || start > data.length)
    throw rangeFailure(`the start index must be 0 to ${data.length}, not ${String(start)}`);
  const output = new BoundedOutput(maxOut);
  const inf = new Inflate((chunk) => output.push(chunk));
  const state = inf as unknown as InflateState;
  const step = Math.min(65_536, Math.max(MIN_CHUNK, Math.floor(maxOut / (2 * MAX_RATIO))));
  let pos = start;
  let done = false;
  try {
    while (!done) {
      const next = Math.min(data.length, pos + step);
      inf.push(data.subarray(pos, next), next === data.length);
      pos = next;
      done = state.s.f === 1 && !state.s.l;
      if (!done && pos === data.length) break;
    }
  } catch (e) {
    if (e instanceof Error && "code" in e && typeof e.code === "number") throw corrupt(e.message);
    throw e;
  }
  if (!done) throw corrupt("the data ends before the final block (truncated)");
  // `state.p` begins at the byte that holds the last bit; it is consumed when bits of it were used.
  const used = (state.s.p & 7) !== 0 ? 1 : 0;
  const end = pos - (state.p.length - used);
  return { out: output.finish(), end };
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "deflate",
    "_deflate",
    "( data:bytes level:int -- bytes )",
    (data: Uint8Array, level: number | bigint) => deflateRaw(data, Number(level)),
    {
      doc: "A raw DEFLATE stream of the bytes at a level from 0 (stored) to 9 (private helper of deflate:deflate and the zlib and gzip words).",
      category: "Compression",
    },
  ),
  definePrimitive(
    "deflate",
    "_inflate",
    "( data:bytes start:int -- bytes int )",
    (data: Uint8Array, start: number | bigint, ctx: PrimitiveContext) => {
      const { out, end } = inflateLimited(data, Number(start), ctx.limits.maxValueBytes);
      return [out, end];
    },
    {
      doc: "Inflate the raw DEFLATE stream that begins at a byte offset; gives the bytes and the offset after the stream. Stops at the value limit with E_LIMIT_VALUE (private helper of deflate:inflate and the zlib and gzip words).",
      category: "Compression",
    },
  ),
];
