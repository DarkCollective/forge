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
 * zip primitives, over `fflate` (MIT, pinned) through the deflate primitives' bounded inflater. The
 * ZIP container itself (local headers, the central directory, the end record, DOS times, the
 * checks) is FL in vocab/zip.fth. Private helpers:
 *
 *  - `_crc32 ( data -- int )`: CRC-32 (the zip checksum). In FL it costs about 13 VM steps per
 *    byte, which would cap a zip at about 380,000 bytes in an untrusted recipe, well under the
 *    16 MiB value limit.
 *  - `_deflate ( data level -- bytes )`: a raw DEFLATE stream (the same encoder as `deflate:_deflate`;
 *    a vocabulary cannot call another vocabulary's private word).
 *  - `_cd-offsets ( data cdoff n -- list )`: where each central directory entry starts (a sequential walk, quadratic in FL).
 *  - `_extract ( data plan -- list )`: the contents of several entries under ONE budget. Each plan
 *    item is `{ start compressed-size method }` (method 0 stored, 8 deflate; FL has already refused
 *    any other). The sum of all the entries is capped by `maxValueBytes`: the bomb rule of the wave 6
 *    conventions applied to an archive (a zip of a thousand 16 MiB entries must not reach 16 GiB). The
 *    budget has to be carried from one entry to the next, which FL cannot do without a quadratic list
 *    (the total-bytes meter would count every earlier entry again), so the loop is here.
 */
import { definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef, Value } from "@forge/lang";
import { bombFailure, coerceFailure, rangeFailure } from "../prim-util.js";
import { deflateRaw, inflateLimited } from "./deflate.js";

const { bytes, int } = valueHelpers;

let table: Uint32Array | undefined;

/** CRC-32 (IEEE 802.3, reflected, init and xorout 0xffffffff) of the bytes, as an unsigned number. */
export function crc32(data: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++)
    crc = (table[(crc ^ (data[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** One entry to read: where its data starts, how many bytes it occupies, and the zip method. */
export interface ZipPlanItem {
  readonly start: number;
  readonly size: number;
  readonly method: number;
}

function corrupt(reason: string) {
  return coerceFailure("zip data", "bytes", reason);
}

/**
 * The contents of each entry, in order. The sum of the sizes never passes `max`: a deflate entry is
 * inflated with what is left of the budget (so it stops while it decompresses), and a stored entry is
 * counted by its length. Declared sizes are never used to allocate: a deflate entry is as long as its
 * stream, a stored entry as long as the bytes the central directory says it occupies (which must lie
 * inside the data).
 */
export function extractEntries(
  data: Uint8Array,
  plan: readonly ZipPlanItem[],
  max: number,
): Uint8Array[] {
  const out: Uint8Array[] = [];
  let used = 0;
  for (const item of plan) {
    if (item.start > data.length)
      throw corrupt("an entry starts past the end of the data (truncated)");
    let piece: Uint8Array;
    if (item.method === 0) {
      if (item.start + item.size > data.length)
        throw corrupt("a stored entry runs past the end of the data (truncated)");
      if (used + item.size > max) throw bombFailure(max, used + item.size);
      piece = data.slice(item.start, item.start + item.size);
    } else if (item.method === 8) {
      try {
        piece = inflateLimited(data, item.start, max - used).out;
      } catch (e) {
        if (e instanceof Error && "code" in e && e.code === "E_LIMIT_VALUE") {
          const d = (e as { detail?: { value?: number } }).detail;
          throw bombFailure(max, used + (d?.value ?? max - used + 1));
        }
        throw e;
      }
    } else {
      throw corrupt(`unsupported compression method ${String(item.method)}`);
    }
    used += piece.length;
    out.push(piece);
  }
  return out;
}

/**
 * The offset of each central directory entry: entry i + 1 starts after the name, extra field and comment
 * of entry i, so the walk is sequential. In FL it has to grow a list one entry at a time, which is
 * quadratic (3,000 entries take 1 s, 10,000 take 27 s, and the total-bytes meter ends it at about 14,000);
 * the cobs vocabulary has the same walk and the same answer.
 */
export function cdOffsets(data: Uint8Array, cdoff: number, count: number): number[] {
  const out: number[] = [];
  let p = cdoff;
  for (let i = 0; i < count; i++) {
    if (p + 46 > data.length) throw corrupt("zip data is cut short (truncated)");
    const sig =
      ((data[p] as number) |
        ((data[p + 1] as number) << 8) |
        ((data[p + 2] as number) << 16) |
        ((data[p + 3] as number) << 24)) >>>
      0;
    if (sig !== 0x02014b50)
      throw corrupt("the zip central directory is damaged: bad entry signature");
    out.push(p);
    const at = (q: number) => (data[q] as number) | ((data[q + 1] as number) << 8);
    p += 46 + at(p + 28) + at(p + 30) + at(p + 32);
  }
  return out;
}

function planOf(items: readonly Value[]): ZipPlanItem[] {
  return items.map((it) => {
    if (it.tag !== "list" || it.v.length !== 3)
      throw rangeFailure("a plan item is { start size method }");
    const [s, z, m] = it.v.map((x) => (x.tag === "int" ? Number(x.v) : NaN)) as [
      number,
      number,
      number,
    ];
    if (
      !Number.isSafeInteger(s) ||
      !Number.isSafeInteger(z) ||
      !Number.isSafeInteger(m) ||
      s < 0 ||
      z < 0
    )
      throw rangeFailure("a plan item is three non-negative integers");
    return { start: s, size: z, method: m };
  });
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("zip", "_crc32", "( data:bytes -- int )", (data: Uint8Array) => crc32(data), {
    doc: "CRC-32 of the bytes as an unsigned integer (private helper of the zip words).",
    category: "Compression",
  }),
  definePrimitive(
    "zip",
    "_deflate",
    "( data:bytes level:int -- bytes )",
    (data: Uint8Array, level: number | bigint) => deflateRaw(data, Number(level)),
    {
      doc: "A raw DEFLATE stream of the bytes at a level from 0 (stored blocks) to 9 (private helper of zip:zip).",
      category: "Compression",
    },
  ),
  definePrimitive(
    "zip",
    "_cd-offsets",
    "( data:bytes cdoff:int n:int -- list )",
    (data: Uint8Array, cdoff: number | bigint, n: number | bigint) =>
      cdOffsets(data, Number(cdoff), Number(n)).map((p) => int(p)),
    {
      doc: "The offsets of the n central directory entries that start at cdoff, each checked for its signature (private helper of zip:unzip and zip:entry).",
      category: "Compression",
    },
  ),
  definePrimitive(
    "zip",
    "_extract",
    "( data:bytes plan:list -- list )",
    (data: Uint8Array, plan: readonly Value[], ctx: PrimitiveContext) =>
      extractEntries(data, planOf(plan), ctx.limits.maxValueBytes).map((b) => bytes(b)),
    {
      doc: "The bytes of several zip entries, each given as { start size method }, under one budget of the value limit: stops with E_LIMIT_VALUE when the sum passes it (private helper of zip:unzip and zip:entry).",
      category: "Compression",
    },
  ),
];
