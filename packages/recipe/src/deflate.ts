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
/**
 * Deflate-raw helpers for the share codec (RECIPES.md section 7).
 *
 * `deflateStreamLength` finds where a deflate-raw stream ends without producing any output. The Compression
 * Streams standard says a decompressor must reject data after the end of the stream, but not every platform
 * does (Node 20 silently ignores it), so the decoder checks it itself and the behaviour is the same everywhere.
 */

const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** A canonical Huffman code in the "count per length, symbols in code order" form. */
interface Huffman {
  readonly count: Uint16Array;
  readonly symbol: Uint16Array;
}

/** Null when the lengths describe an over-subscribed code. Incomplete codes are accepted. */
function buildHuffman(lengths: readonly number[]): Huffman | null {
  const count = new Uint16Array(16);
  for (const len of lengths) count[len] = (count[len] as number) + 1;
  let left = 1;
  for (let len = 1; len <= 15; len++) {
    left = (left << 1) - (count[len] as number);
    if (left < 0) return null;
  }
  const offs = new Uint16Array(16);
  for (let len = 1; len < 15; len++) offs[len + 1] = (offs[len] as number) + (count[len] as number);
  const symbol = new Uint16Array(lengths.length);
  lengths.forEach((len, sym) => {
    if (len !== 0) {
      symbol[offs[len] as number] = sym;
      offs[len] = (offs[len] as number) + 1;
    }
  });
  return { count, symbol };
}

let fixedTables: { lit: Huffman; dist: Huffman } | undefined;

function fixed(): { lit: Huffman; dist: Huffman } {
  if (fixedTables === undefined) {
    const lit: number[] = [];
    for (let i = 0; i < 288; i++) lit.push(i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8);
    fixedTables = {
      lit: buildHuffman(lit) as Huffman,
      dist: buildHuffman(new Array<number>(30).fill(5)) as Huffman,
    };
  }
  return fixedTables;
}

class Truncated extends Error {}

/**
 * The number of bytes the deflate-raw stream at the start of `data` occupies, or -1 if the data is not a
 * well-formed stream (bad block, bad code, or it ends early).
 */
export function deflateStreamLength(data: Uint8Array): number {
  const totalBits = data.length * 8;
  let pos = 0;

  const bit = (): number => {
    if (pos >= totalBits) throw new Truncated();
    const b = ((data[pos >> 3] as number) >> (pos & 7)) & 1;
    pos++;
    return b;
  };
  const bits = (n: number): number => {
    let v = 0;
    for (let i = 0; i < n; i++) v |= bit() << i;
    return v;
  };
  const decode = (h: Huffman): number => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= 15; len++) {
      code |= bit();
      const count = h.count[len] as number;
      if (code - count < first) return h.symbol[index + (code - first)] as number;
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    return -1;
  };
  /** The symbols of one block, up to its end-of-block code. */
  const codes = (lit: Huffman, dist: Huffman): boolean => {
    for (;;) {
      let sym = decode(lit);
      if (sym < 0) return false;
      if (sym < 256) continue;
      if (sym === 256) return true;
      sym -= 257;
      if (sym >= LENGTH_EXTRA.length) return false;
      bits(LENGTH_EXTRA[sym] as number);
      const d = decode(dist);
      if (d < 0 || d >= DIST_EXTRA.length) return false;
      bits(DIST_EXTRA[d] as number);
    }
  };
  /** Reads the code length tables of a dynamic block. */
  const dynamic = (): { lit: Huffman; dist: Huffman } | null => {
    const nlen = bits(5) + 257;
    const ndist = bits(5) + 1;
    const ncode = bits(4) + 4;
    if (nlen > 286 || ndist > 30) return null;
    const clens = new Array<number>(19).fill(0);
    for (let i = 0; i < ncode; i++) clens[CODE_LENGTH_ORDER[i] as number] = bits(3);
    const clh = buildHuffman(clens);
    if (clh === null) return null;
    const lengths: number[] = [];
    while (lengths.length < nlen + ndist) {
      const sym = decode(clh);
      if (sym < 0) return null;
      if (sym < 16) {
        lengths.push(sym);
        continue;
      }
      let repeat: number;
      let value = 0;
      if (sym === 16) {
        if (lengths.length === 0) return null;
        value = lengths[lengths.length - 1] as number;
        repeat = 3 + bits(2);
      } else if (sym === 17) {
        repeat = 3 + bits(3);
      } else {
        repeat = 11 + bits(7);
      }
      if (lengths.length + repeat > nlen + ndist) return null;
      for (let i = 0; i < repeat; i++) lengths.push(value);
    }
    if (lengths[256] === 0) return null;
    const lit = buildHuffman(lengths.slice(0, nlen));
    const dist = buildHuffman(lengths.slice(nlen));
    return lit === null || dist === null ? null : { lit, dist };
  };

  try {
    let last: number;
    do {
      last = bit();
      const type = bits(2);
      if (type === 0) {
        pos = (pos + 7) & ~7;
        const len = bits(16);
        const nlen = bits(16);
        if ((len ^ 0xffff) !== nlen) return -1;
        pos += len * 8;
        if (pos > totalBits) return -1;
      } else if (type === 1) {
        const t = fixed();
        if (!codes(t.lit, t.dist)) return -1;
      } else if (type === 2) {
        const t = dynamic();
        if (t === null || !codes(t.lit, t.dist)) return -1;
      } else {
        return -1;
      }
    } while (last === 0);
  } catch (e) {
    if (e instanceof Truncated) return -1;
    throw e;
  }
  return (pos + 7) >> 3;
}

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Compresses with deflate-raw. The read loop runs while the write is pending, so back-pressure cannot stall it. */
export async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const written = (async () => {
    await writer.write(data);
    await writer.close();
  })();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    const chunk = r.value as Uint8Array;
    chunks.push(chunk);
    total += chunk.length;
  }
  await written;
  return concat(chunks, total);
}

export type InflateResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly reason: "too-large" | "bad-compression" };

/**
 * Inflates a deflate-raw stream into at most `budget` bytes. The stream must be well-formed and end exactly at
 * the end of `data`. The output is counted as it arrives and the stream is cancelled as soon as the budget is
 * exceeded, so no more than the budget plus one chunk is ever held.
 */
export async function inflateRaw(data: Uint8Array, budget: number): Promise<InflateResult> {
  if (deflateStreamLength(data) !== data.length) return { ok: false, reason: "bad-compression" };
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const written = (async () => {
    await writer.write(data);
    await writer.close();
  })();
  // A failure of the write also shows on the read side; this only keeps it from being reported twice.
  written.catch(() => undefined);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      const chunk = r.value as Uint8Array;
      total += chunk.length;
      if (total > budget) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too-large" };
      }
      chunks.push(chunk);
    }
    await written;
  } catch {
    return { ok: false, reason: "bad-compression" };
  }
  return { ok: true, bytes: concat(chunks, total) };
}
