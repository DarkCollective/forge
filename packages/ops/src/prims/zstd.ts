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
 * Zstandard decompression (RFC 8878) over `fzstd` (MIT, pinned to an exact version), the one private
 * primitive of vocab/zstd.fth: `_decompress ( data verify -- bytes )`.
 *
 * Why the framing is here and not in FL. fzstd's streaming `Decompress` does the block decoding, but
 * it does not expose frame boundaries, it ignores the dictionary ID of a frame (it would decode a
 * dictionary frame to wrong bytes), it allocates each frame's window (up to about 2 GiB, from the
 * header) and it skips the content checksum without checking it. So this file walks the frame
 * headers and block headers first (a few steps per block, cheap in FL too, but the checksum below
 * forces a TypeScript pass anyway), refuses what fzstd cannot do safely, feeds each frame to fzstd
 * in small chunks, and checks the XXH64 checksum of the content (the low 32 bits, RFC 8878 3.1.1).
 *
 * The output limit of the wave 6 conventions (packages/ops/README.md): the output of every frame goes
 * into `BoundedOutput`, so the chunk that would pass `ctx.limits.maxValueBytes` raises E_LIMIT_VALUE.
 * A declared content size or window over the limit is refused before any decoding (declared sizes
 * only reject early).
 */
import { Decompress } from "fzstd";
import { ForgeError, definePrimitive } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef } from "@forge/lang";
import { BoundedOutput, coerceFailure, limitFailure } from "../prim-util.js";

/** The frame magic 0xFD2FB528, little-endian. */
const FRAME_MAGIC = 0xfd2fb528n;
/** The skippable frame magics 0x184D2A50 to 0x184D2A5F (the high 28 bits). */
const SKIP_MAGIC_BASE = 0x184d2a50n;
/** Block_Maximum_Size of RFC 8878 3.1.1.2.3 (the smaller of the window and 128 KiB; the window is checked too). */
const MAX_BLOCK = 128 * 1024;
/** Input pushed to fzstd at a time. */
const CHUNK = 64 * 1024;

function fault(reason: string): ForgeError {
  return coerceFailure("zstd data", "bytes", reason);
}

/** Unsigned little-endian integer of n bytes at p, exact (bigint). */
function le(data: Uint8Array, p: number, n: number): bigint {
  let v = 0n;
  for (let i = n - 1; i >= 0; i--) v = (v << 8n) | BigInt(data[p + i] as number);
  return v;
}

/* ---- XXH64 (the content checksum of a zstd frame, seed 0), streaming ---- */

const M64 = (1n << 64n) - 1n;
const P1 = 0x9e3779b185ebca87n;
const P2 = 0xc2b2ae3d27d4eb4fn;
const P3 = 0x165667b19e3779f9n;
const P4 = 0x85ebca77c2b2ae63n;
const P5 = 0x27d4eb2f165667c5n;

function rotl(x: bigint, r: bigint): bigint {
  return ((x << r) | (x >> (64n - r))) & M64;
}

function round(acc: bigint, input: bigint): bigint {
  const a = rotl((acc + input * P2) & M64, 31n);
  return (a * P1) & M64;
}

function merge(acc: bigint, val: bigint): bigint {
  return ((acc ^ round(0n, val)) * P1 + P4) & M64;
}

/** XXH64 with seed 0, fed in pieces of any size. */
export class Xxh64 {
  private readonly v: bigint[] = [(P1 + P2) & M64, P2, 0n, (0n - P1) & M64];
  private total = 0;
  private readonly mem = new Uint8Array(32);
  private memSize = 0;

  update(p: Uint8Array): void {
    this.total += p.length;
    if (this.memSize + p.length < 32) {
      this.mem.set(p, this.memSize);
      this.memSize += p.length;
      return;
    }
    let at = 0;
    if (this.memSize > 0) {
      const take = 32 - this.memSize;
      this.mem.set(p.subarray(0, take), this.memSize);
      this.stripe(this.mem, 0);
      at = take;
      this.memSize = 0;
    }
    while (p.length - at >= 32) {
      this.stripe(p, at);
      at += 32;
    }
    if (at < p.length) {
      this.mem.set(p.subarray(at));
      this.memSize = p.length - at;
    }
  }

  private stripe(b: Uint8Array, o: number): void {
    for (let i = 0; i < 4; i++) {
      this.v[i] = round(this.v[i] as bigint, readU64(b, o + 8 * i));
    }
  }

  /** The 64-bit digest of everything fed so far. */
  digest(): bigint {
    let h: bigint;
    if (this.total >= 32) {
      const [v1, v2, v3, v4] = this.v as [bigint, bigint, bigint, bigint];
      h = (rotl(v1, 1n) + rotl(v2, 7n) + rotl(v3, 12n) + rotl(v4, 18n)) & M64;
      h = merge(h, v1);
      h = merge(h, v2);
      h = merge(h, v3);
      h = merge(h, v4);
    } else {
      h = P5;
    }
    h = (h + BigInt(this.total)) & M64;
    const p = this.mem;
    let o = 0;
    let rem = this.memSize;
    while (rem >= 8) {
      h ^= round(0n, readU64(p, o));
      h = (rotl(h, 27n) * P1 + P4) & M64;
      o += 8;
      rem -= 8;
    }
    if (rem >= 4) {
      h ^= (BigInt(new DataView(p.buffer, p.byteOffset + o, 4).getUint32(0, true)) * P1) & M64;
      h = (rotl(h, 23n) * P2 + P3) & M64;
      o += 4;
      rem -= 4;
    }
    while (rem > 0) {
      h ^= (BigInt(p[o] as number) * P5) & M64;
      h = (rotl(h, 11n) * P1) & M64;
      o += 1;
      rem -= 1;
    }
    h ^= h >> 33n;
    h = (h * P2) & M64;
    h ^= h >> 29n;
    h = (h * P3) & M64;
    h ^= h >> 32n;
    return h;
  }

  /** The low 32 bits of the digest, the value a zstd frame stores. */
  digest32(): number {
    return Number(this.digest() & 0xffffffffn);
  }
}

function readU64(b: Uint8Array, o: number): bigint {
  return new DataView(b.buffer, b.byteOffset + o, 8).getBigUint64(0, true);
}

/* ---- frame walk ---- */

interface Frame {
  /** A skippable frame carries metadata and no content. */
  readonly skip: boolean;
  /** The offset just after the frame (after its checksum, when it has one). */
  readonly end: number;
  /** Whether the frame stores a content checksum; the value is read from the last 4 bytes of the frame. */
  readonly checksum: boolean;
}

/**
 * Reads the frame that begins at p without decoding it: the header (the window, the dictionary ID and
 * the declared content size are checked here) and every block header, which gives the frame's end.
 * Structural faults are E_COERCE; a window or declared size over `max` is E_LIMIT_VALUE.
 */
function scanFrame(data: Uint8Array, p: number, max: number): Frame {
  const need = (end: number, what: string) => {
    if (end > data.length) throw fault(`unexpected EOF: ${what} is cut short`);
  };
  need(p + 4, "the zstd frame");
  const magic = le(data, p, 4);
  if ((magic & 0xfffffff0n) === SKIP_MAGIC_BASE) {
    need(p + 8, "a skippable frame");
    const end = p + 8 + Number(le(data, p + 4, 4));
    need(end, "a skippable frame");
    return { skip: true, end, checksum: false };
  }
  if (magic !== FRAME_MAGIC) throw fault("not zstd data: the magic number 28 b5 2f fd is missing");
  need(p + 5, "the zstd frame header");
  const fhd = data[p + 4] as number;
  if (fhd & 0x08) throw fault("the zstd frame header descriptor has its reserved bit set");
  const single = (fhd >> 5) & 1;
  const checksum = ((fhd >> 2) & 1) === 1;
  const dictFlag = fhd & 3;
  const fcsFlag = fhd >> 6;
  let q = p + 5;
  if (!single) {
    need(q + 1, "the zstd window descriptor");
    const wd = data[q] as number;
    q += 1;
    const base = 2 ** (10 + (wd >> 3));
    const window = base + (base / 8) * (wd & 7);
    if (window > max) throw limitFailure("maxValueBytes", max, window, "the zstd frame window");
  }
  const dictBytes = [0, 1, 2, 4][dictFlag] as number;
  need(q + dictBytes, "the zstd frame header");
  const dictId = le(data, q, dictBytes);
  q += dictBytes;
  if (dictId !== 0n)
    throw fault(
      `the zstd frame uses a dictionary (ID ${String(dictId)}), which is not supported (decompress it with the dictionary elsewhere)`,
    );
  const fcsBytes = fcsFlag === 0 ? single : 1 << fcsFlag;
  need(q + fcsBytes, "the zstd frame header");
  if (fcsBytes > 0) {
    let size = le(data, q, fcsBytes);
    if (fcsBytes === 2) size += 256n;
    q += fcsBytes;
    if (size > BigInt(max))
      throw limitFailure("maxValueBytes", max, Number(size), "the zstd declared content size");
  }
  for (;;) {
    need(q + 3, "a zstd block header");
    const b = le(data, q, 3);
    const last = Number(b & 1n);
    const type = Number((b >> 1n) & 3n);
    const size = Number(b >> 3n);
    if (type === 3) throw fault("invalid zstd block type 3 (reserved)");
    if (size > MAX_BLOCK) throw fault("a zstd block is larger than 128 KiB");
    q += 3;
    if (type === 1) {
      need(q + 1, "a zstd block");
      q += 1;
    } else {
      need(q + size, "a zstd block");
      q += size;
    }
    if (last) break;
  }
  if (checksum) {
    need(q + 4, "the zstd checksum");
    q += 4;
  }
  return { skip: false, end: q, checksum };
}

/** Decodes one frame (data[p..end)) into `out`, and feeds `hash` with what it emits. */
function decodeFrame(
  data: Uint8Array,
  p: number,
  end: number,
  out: BoundedOutput,
  hash: Xxh64 | undefined,
): void {
  const dec = new Decompress((chunk) => {
    hash?.update(chunk);
    out.push(chunk);
  });
  try {
    for (let at = p; at < end; at += CHUNK) {
      const next = Math.min(end, at + CHUNK);
      dec.push(data.subarray(at, next), next === end);
    }
  } catch (e) {
    if (e instanceof ForgeError) throw e;
    if (e instanceof Error && "code" in e && typeof e.code === "number") throw fault(e.message);
    throw e;
  }
}

/**
 * Decompresses a zstd stream: one or more frames (concatenated, with skippable frames allowed). With
 * `verify`, each frame's content checksum must match. Corrupt data is E_COERCE; output past `max` is
 * E_LIMIT_VALUE. An input of no bytes is E_COERCE (there is no frame).
 */
export function zstdDecompress(data: Uint8Array, verify: boolean, max: number): Uint8Array {
  if (data.length === 0) throw fault("unexpected EOF: there is no zstd frame in the input");
  const out = new BoundedOutput(max);
  let p = 0;
  while (p < data.length) {
    const frame = scanFrame(data, p, max);
    if (!frame.skip) {
      const hash = verify && frame.checksum ? new Xxh64() : undefined;
      decodeFrame(data, p, frame.end, out, hash);
      if (hash && hash.digest32() !== Number(le(data, frame.end - 4, 4)))
        throw fault(
          "zstd checksum mismatch: the XXH64 of the output differs from the frame's checksum (corrupt data)",
        );
    }
    p = frame.end;
  }
  return out.finish();
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "zstd",
    "_decompress",
    "( data:bytes verify:bool -- bytes )",
    (data: Uint8Array, verify: boolean, ctx: PrimitiveContext) =>
      zstdDecompress(data, verify, ctx.limits.maxValueBytes),
    {
      doc: "Decompress a zstd stream (every frame, skippable frames skipped), checking each frame's content checksum when verify is true. Stops at the value limit with E_LIMIT_VALUE (private helper of zstd:decompress).",
      category: "Compression",
    },
  ),
];
