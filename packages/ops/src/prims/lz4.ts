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
 * LZ4 primitives, written from the LZ4 block and frame format specifications (lz4/doc), no library.
 * The frame container (magic numbers, the FLG and BD descriptor, content size, the header and content
 * checksums, concatenated and skippable frames) is FL in vocab/lz4.fth. The loops that touch every
 * byte are here, because an FL loop costs about 13 VM steps a byte and caps a file near 750 KB:
 *
 *  - `_xxh32 ( data seed -- int )`: XXH32 (the frame's checksum; verified against the lz4 CLI).
 *  - `_blocks ( data start independent block-checksum max-block verify -- bytes end )`: decodes the
 *    data blocks of one frame, from `start` up to and including its EndMark; `end` is the offset after
 *    the EndMark (where the content checksum, if any, begins).
 *  - `_legacy ( data start -- bytes end )`: the blocks of a legacy frame (magic 0x184C2102), up to the
 *    end of the data or the next magic number.
 *  - `_encode ( data max-block independent block-checksum level -- bytes )`: the data blocks of a
 *    frame (without the EndMark), by a greedy hash-chain matcher.
 *
 * The output limit of the wave 6 conventions: the decoder grows its output only after checking the new
 * size against `ctx.limits.maxValueBytes` (E_LIMIT_VALUE), before it copies anything, and sizes
 * claimed in the data (the frame's content size) are never used to allocate. The buffer doubles up to
 * that limit, so memory stays under about 3 x the limit for an output that reaches it.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef } from "@forge/lang";
import { bombFailure, coerceFailure, guardResult, rangeFailure } from "../prim-util.js";

// ---- XXH32 ----

const P1 = 2654435761;
const P2 = 2246822519;
const P3 = 3266489917;
const P4 = 668265263;
const P5 = 374761393;

function rotl(x: number, r: number): number {
  return ((x << r) | (x >>> (32 - r))) >>> 0;
}

function read32(d: Uint8Array, p: number): number {
  return (
    ((d[p] as number) |
      ((d[p + 1] as number) << 8) |
      ((d[p + 2] as number) << 16) |
      ((d[p + 3] as number) << 24)) >>>
    0
  );
}

function round(acc: number, input: number): number {
  return Math.imul(rotl((acc + Math.imul(input, P2)) >>> 0, 13), P1) >>> 0;
}

/** XXH32 of `d[from, to)` with a 32-bit seed. */
export function xxh32(d: Uint8Array, seed: number, from = 0, to = d.length): number {
  let p = from;
  let h: number;
  if (to - from >= 16) {
    let v1 = (seed + P1 + P2) >>> 0;
    let v2 = (seed + P2) >>> 0;
    let v3 = seed >>> 0;
    let v4 = (seed - P1) >>> 0;
    const limit = to - 16;
    while (p <= limit) {
      v1 = round(v1, read32(d, p));
      v2 = round(v2, read32(d, p + 4));
      v3 = round(v3, read32(d, p + 8));
      v4 = round(v4, read32(d, p + 12));
      p += 16;
    }
    h = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) >>> 0;
  } else {
    h = (seed + P5) >>> 0;
  }
  h = (h + (to - from)) >>> 0;
  while (p + 4 <= to) {
    h = Math.imul(rotl((h + Math.imul(read32(d, p), P3)) >>> 0, 17), P4) >>> 0;
    p += 4;
  }
  while (p < to) {
    h = Math.imul(rotl((h + Math.imul(d[p] as number, P5)) >>> 0, 11), P1) >>> 0;
    p++;
  }
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, P2) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, P3) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// ---- decoding ----

function corrupt(reason: string) {
  return coerceFailure("LZ4 data", "bytes", reason);
}

/** Output that grows only after the new size has passed the limit check. */
class Out {
  buf: Uint8Array;
  len = 0;

  constructor(private readonly max: number) {
    this.buf = new Uint8Array(Math.min(max, 1 << 16));
  }

  /** Makes room for `n` more bytes, or raises E_LIMIT_VALUE. */
  grow(n: number): void {
    const need = this.len + n;
    if (need > this.max) throw bombFailure(this.max, need);
    if (need <= this.buf.length) return;
    const next = new Uint8Array(Math.min(this.max, Math.max(need, this.buf.length * 2)));
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

/**
 * Decodes one compressed block `src[pos, end)` onto `out`. Matches may reach back to `floor` (the start
 * of the output for dependent blocks, the start of the block for independent ones). The block may not
 * decode to more than `blockMax` bytes.
 */
function decodeBlock(
  src: Uint8Array,
  start: number,
  end: number,
  out: Out,
  floor: number,
  blockMax: number,
): void {
  const blockStart = out.len;
  let pos = start;
  while (pos < end) {
    const token = src[pos++] as number;
    let lit = token >> 4;
    if (lit === 15) {
      let b: number;
      do {
        if (pos >= end) throw corrupt("the block ends inside a literal length");
        b = src[pos++] as number;
        lit += b;
      } while (b === 255);
    }
    if (pos + lit > end) throw corrupt("a literal run goes past the end of its block");
    if (out.len - blockStart + lit > blockMax)
      throw corrupt("a block decodes to more than the frame's block maximum");
    if (lit > 0) {
      out.grow(lit);
      out.buf.set(src.subarray(pos, pos + lit), out.len);
      out.len += lit;
      pos += lit;
    }
    if (pos === end) return;
    if (pos + 2 > end) throw corrupt("the block ends inside a match offset");
    const offset = (src[pos] as number) | ((src[pos + 1] as number) << 8);
    pos += 2;
    if (offset === 0) throw corrupt("a match offset is zero");
    if (out.len - offset < floor)
      throw corrupt("a match offset reaches before the start of the data");
    let mlen = token & 15;
    if (mlen === 15) {
      let b: number;
      do {
        if (pos >= end) throw corrupt("the block ends inside a match length");
        b = src[pos++] as number;
        mlen += b;
      } while (b === 255);
    }
    mlen += 4;
    if (out.len - blockStart + mlen > blockMax)
      throw corrupt("a block decodes to more than the frame's block maximum");
    out.grow(mlen);
    const buf = out.buf;
    let to = out.len;
    let from = to - offset;
    if (offset >= mlen) {
      buf.copyWithin(to, from, from + mlen);
    } else {
      for (let i = 0; i < mlen; i++) buf[to++] = buf[from++] as number;
    }
    out.len += mlen;
  }
}

/** Copies a stored block onto the output. */
function storeBlock(src: Uint8Array, start: number, size: number, out: Out): void {
  out.grow(size);
  out.buf.set(src.subarray(start, start + size), out.len);
  out.len += size;
}

function le32(d: Uint8Array, p: number): number {
  return read32(d, p);
}

/**
 * Decodes the data blocks of the frame whose descriptor ended at `start`, up to the EndMark. Block
 * checksums are skipped when absent and checked when `verify`. Returns the output and the offset just
 * after the EndMark.
 */
export function decodeFrameBlocks(
  data: Uint8Array,
  start: number,
  independent: boolean,
  blockChecksum: boolean,
  blockMax: number,
  verify: boolean,
  maxOut: number,
): { out: Uint8Array; end: number } {
  if (!Number.isInteger(start) || start < 0 || start > data.length)
    throw rangeFailure(`the start index must be 0 to ${data.length}, not ${String(start)}`);
  const out = new Out(maxOut);
  let pos = start;
  for (;;) {
    if (pos + 4 > data.length) throw corrupt("the data ends before the end mark (truncated)");
    const word = le32(data, pos);
    pos += 4;
    if (word === 0) return { out: out.finish(), end: pos };
    const stored = word >= 0x80000000;
    const size = word & 0x7fffffff;
    if (size > blockMax) throw corrupt("a block is larger than the frame's block maximum");
    if (pos + size + (blockChecksum ? 4 : 0) > data.length)
      throw corrupt("the data ends inside a block (truncated)");
    if (blockChecksum && verify && xxh32(data, 0, pos, pos + size) !== le32(data, pos + size))
      throw corrupt(
        "block checksum mismatch: the XXH32 of a block differs from the one stored (corrupt data)",
      );
    if (stored) storeBlock(data, pos, size, out);
    else decodeBlock(data, pos, pos + size, out, independent ? out.len : 0, blockMax);
    pos += size + (blockChecksum ? 4 : 0);
  }
}

const MAGIC_FRAME = 0x184d2204;
const MAGIC_LEGACY = 0x184c2102;
/** Legacy frames cut the input into 8 MiB blocks; a compressed block is at most this many bytes. */
const LEGACY_BLOCK = 8 * 1024 * 1024;
const LEGACY_COMPRESSED_MAX = LEGACY_BLOCK + (LEGACY_BLOCK >> 8) + 16;

function isMagic(word: number): boolean {
  return word === MAGIC_FRAME || word === MAGIC_LEGACY || (word & 0xfffffff0) === 0x184d2a50;
}

/**
 * Decodes the blocks of a legacy frame (after its magic number): each is a 4-byte little-endian
 * compressed size and the block, until the end of the data or the next magic number.
 */
export function decodeLegacyBlocks(
  data: Uint8Array,
  start: number,
  maxOut: number,
): { out: Uint8Array; end: number } {
  if (!Number.isInteger(start) || start < 0 || start > data.length)
    throw rangeFailure(`the start index must be 0 to ${data.length}, not ${String(start)}`);
  const out = new Out(maxOut);
  let pos = start;
  while (pos < data.length) {
    if (pos + 4 > data.length)
      throw corrupt("the data ends inside a legacy block size (truncated)");
    const size = le32(data, pos);
    if (isMagic(size)) break;
    pos += 4;
    if (size > LEGACY_COMPRESSED_MAX)
      throw corrupt("a legacy block is larger than any block LZ4 writes");
    if (pos + size > data.length) throw corrupt("the data ends inside a legacy block (truncated)");
    decodeBlock(data, pos, pos + size, out, out.len, LEGACY_BLOCK);
    pos += size;
  }
  return { out: out.finish(), end: pos };
}

// ---- encoding ----

const HASH_BITS = 16;
const WINDOW = 65_535;
const NICE = 64;

/** The number of chain links a level follows: 1 (a single hash entry) for level 1, doubling after. */
function chainDepth(level: number): number {
  return 1 << (level - 1);
}

function emitLength(dst: Uint8Array, at: number, rest: number): number {
  let n = rest;
  while (n >= 255) {
    dst[at++] = 255;
    n -= 255;
  }
  dst[at++] = n;
  return at;
}

/**
 * One compressed block of `data[bs, be)`, greedily matched. `lo` is the lowest position a match may
 * reach back to; `head` and `prev` are the hash chains, kept across blocks when blocks are dependent.
 */
function encodeBlock(
  data: Uint8Array,
  bs: number,
  be: number,
  lo: number,
  head: Int32Array,
  prev: Int32Array,
  depth: number,
): Uint8Array {
  const size = be - bs;
  const dst = new Uint8Array(size + Math.floor(size / 255) + 32);
  let d = 0;
  let anchor = bs;
  const mfLimit = be - 12;
  const matchLimit = be - 5;
  const mask = prev.length - 1;
  const hash = (p: number) => Math.imul(read32(data, p), 2654435761) >>> (32 - HASH_BITS);
  const insert = (p: number) => {
    const h = hash(p);
    prev[p & mask] = head[h] as number;
    head[h] = p;
  };
  let pos = bs;
  let inserted = bs; // positions below this are in the chains
  while (pos <= mfLimit) {
    while (inserted < pos) {
      if (inserted + 4 <= be) insert(inserted);
      inserted++;
    }
    const h = hash(pos);
    let cand = head[h] as number;
    const minPos = Math.max(lo, pos - WINDOW);
    let best = 0;
    let bestAt = 0;
    const word = read32(data, pos);
    for (let steps = depth; cand >= minPos && steps > 0; steps--) {
      if (read32(data, cand) === word && (best === 0 || data[cand + best] === data[pos + best])) {
        let len = 4;
        while (pos + len < matchLimit && data[cand + len] === data[pos + len]) len++;
        if (len > best) {
          best = len;
          bestAt = cand;
          if (len >= NICE || pos + len >= matchLimit) break;
        }
      }
      const next = prev[cand & mask] as number;
      if (next >= cand) break;
      cand = next;
    }
    insert(pos);
    inserted = pos + 1;
    if (best < 4) {
      pos += 1 + (depth === 1 ? (pos - anchor) >> 6 : 0);
      continue;
    }
    // A sequence: the literals since the anchor, then the match.
    const lit = pos - anchor;
    const ml = best - 4;
    const t = d++;
    dst[t] = (lit >= 15 ? 15 : lit) << 4;
    if (lit >= 15) d = emitLength(dst, d, lit - 15);
    dst.set(data.subarray(anchor, pos), d);
    d += lit;
    const offset = pos - bestAt;
    dst[d++] = offset & 255;
    dst[d++] = offset >> 8;
    if (ml >= 15) {
      dst[t] |= 15;
      d = emitLength(dst, d, ml - 15);
    } else {
      dst[t] |= ml;
    }
    pos += best;
    anchor = pos;
  }
  // The last sequence: literals only.
  const lit = be - anchor;
  const t = d++;
  dst[t] = (lit >= 15 ? 15 : lit) << 4;
  if (lit >= 15) d = emitLength(dst, d, lit - 15);
  dst.set(data.subarray(anchor, be), d);
  d += lit;
  return dst.subarray(0, d);
}

function putLe32(dst: Uint8Array, at: number, v: number): void {
  dst[at] = v & 255;
  dst[at + 1] = (v >>> 8) & 255;
  dst[at + 2] = (v >>> 16) & 255;
  dst[at + 3] = (v >>> 24) & 255;
}

/**
 * The data blocks of an LZ4 frame for `data` (no EndMark). Level 0 stores every block; levels 1 to 9
 * follow up to 2^(level-1) hash chain links per position. A block that does not shrink is stored.
 */
export function encodeBlocks(
  data: Uint8Array,
  blockMax: number,
  independent: boolean,
  blockChecksum: boolean,
  level: number,
  maxOut: number,
): Uint8Array {
  if (!Number.isInteger(level) || level < 0 || level > 9)
    throw rangeFailure(`the compression level must be 0 to 9, not ${String(level)}`);
  if (![65_536, 262_144, 1_048_576, 4_194_304].includes(blockMax))
    throw rangeFailure(
      `the block size must be 65536, 262144, 1048576 or 4194304, not ${String(blockMax)}`,
    );
  const head = new Int32Array(1 << HASH_BITS).fill(-1);
  const prev = new Int32Array(WINDOW + 1);
  const pieces: Uint8Array[] = [];
  let total = 0;
  for (let bs = 0; bs < data.length; bs += blockMax) {
    const be = Math.min(data.length, bs + blockMax);
    let body: Uint8Array | undefined;
    if (level > 0 && be - bs >= 13) {
      if (independent) head.fill(-1);
      body = encodeBlock(data, bs, be, independent ? bs : 0, head, prev, chainDepth(level));
      if (body.length >= be - bs) body = undefined;
    }
    const stored = body === undefined;
    const payload: Uint8Array = body ?? data.subarray(bs, be);
    const piece = new Uint8Array(4 + payload.length + (blockChecksum ? 4 : 0));
    putLe32(piece, 0, (payload.length | (stored ? 0x80000000 : 0)) >>> 0);
    piece.set(payload, 4);
    if (blockChecksum) putLe32(piece, 4 + payload.length, xxh32(payload, 0));
    pieces.push(piece);
    total += piece.length;
    if (total > maxOut) throw bombFailure(maxOut, total);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of pieces) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const toNum = (v: number | bigint): number => Number(v);

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "lz4",
    "_xxh32",
    "( data:bytes seed:int -- int )",
    (data: Uint8Array, seed: number | bigint) => {
      const s = toNum(seed);
      if (!Number.isInteger(s) || s < 0 || s > 0xffffffff)
        throw rangeFailure(`the XXH32 seed must be 0 to 4294967295, not ${String(s)}`);
      return xxh32(data, s);
    },
    {
      doc: "XXH32 of the bytes with a 32-bit seed (private helper of the lz4 frame words).",
      category: "Compression",
    },
  ),
  definePrimitive(
    "lz4",
    "_blocks",
    "( data:bytes start:int independent:bool block-checksum:bool max-block:int verify:bool -- bytes int )",
    (
      data: Uint8Array,
      start: number | bigint,
      independent: boolean,
      blockChecksum: boolean,
      maxBlock: number | bigint,
      verify: boolean,
      ctx: PrimitiveContext,
    ) => {
      const { out, end } = decodeFrameBlocks(
        data,
        toNum(start),
        independent,
        blockChecksum,
        toNum(maxBlock),
        verify,
        ctx.limits.maxValueBytes,
      );
      return [out, end];
    },
    {
      doc: "Decode the data blocks of an LZ4 frame from a byte offset up to its EndMark; gives the bytes and the offset after the EndMark. Stops at the value limit with E_LIMIT_VALUE (private helper of lz4:decompress).",
      category: "Compression",
    },
  ),
  definePrimitive(
    "lz4",
    "_legacy",
    "( data:bytes start:int -- bytes int )",
    (data: Uint8Array, start: number | bigint, ctx: PrimitiveContext) => {
      const { out, end } = decodeLegacyBlocks(data, toNum(start), ctx.limits.maxValueBytes);
      return [out, end];
    },
    {
      doc: "Decode the blocks of a legacy LZ4 frame from a byte offset to the end of the data or the next magic number; gives the bytes and the end offset. Stops at the value limit with E_LIMIT_VALUE (private helper of lz4:decompress).",
      category: "Compression",
    },
  ),
  definePrimitive(
    "lz4",
    "_encode",
    "( data:bytes max-block:int independent:bool block-checksum:bool level:int -- bytes )",
    (
      data: Uint8Array,
      maxBlock: number | bigint,
      independent: boolean,
      blockChecksum: boolean,
      level: number | bigint,
      ctx: PrimitiveContext,
    ) => {
      const out = encodeBlocks(
        data,
        toNum(maxBlock),
        independent,
        blockChecksum,
        toNum(level),
        ctx.limits.maxValueBytes,
      );
      guardResult(ctx, out.length, "compressed data");
      return out;
    },
    {
      doc: "The data blocks of an LZ4 frame for the bytes (no EndMark), level 0 (stored) to 9 (private helper of lz4:compress).",
      category: "Compression",
    },
  ),
];
