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
 * File signature matching and carving (vocab/filetype.fth). The table of signatures is data in
 * src/filetype-sigs.ts. Three public primitives (public because other vocabularies call them qualified,
 * as YARA does; none is a catalogue op, because each takes a `list` parameter):
 *  - `filetype:detect-list ( data categories -- list )`: the signatures that match at offset 0;
 *  - `filetype:scan-list ( data categories ignore-weak -- list )`: every offset where a signature matches
 *    (the reusable scanning primitive), sorted by offset and then by table order;
 *  - `filetype:carve ( data categories ignore-failed -- list )`: the files found, cut out with the end
 *    finder of their type.
 * A match is a record: offset, name, extensions, mime, description, category, weak. A carved file is a
 * record: name, offset, size, type (the MIME type) and data.
 *
 * Why primitives and not FL: the matching loop runs every signature over every position. A bare FL loop
 * costs about 5.5 VM steps per byte per signature before it compares anything (a 64 KiB scan against 140
 * signatures would be 50 million steps, five times the default step limit); here the scan is one VM step
 * and takes about 5 ms for 64 KiB (measured in src/filetype.test.ts). It finds the longest exact run of
 * each signature with `String.indexOf` on the Latin-1 text of the data and checks the rest of the magic
 * at each hit. The end finders (`png`, `jpeg`, `zip`, ...) walk the structure of a format with a few
 * integer reads; they are per-byte loops too.
 *
 * Bounds. No size, count or offset read from the data allocates anything: they are compared with the
 * bytes that exist. The number of matches is capped by the value limit (an estimate of 320 bytes a
 * record), the carved bytes by the value limit (the sum of all files; nested files are cut out as well,
 * so the sum can pass the input), and the work of the end finders by a budget of 2^28 bytes examined
 * (`E_LIMIT_VALUE` after that). A cut-short or damaged file fails its extraction, it is never returned
 * short.
 */
import { definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef, Value } from "@forge/lang";
import { CATEGORIES, FILE_SIGNATURES } from "../filetype-sigs.js";
import type { Category, FileSig } from "../filetype-sigs.js";
import { coerceFailure, limitFailure, rangeFailure } from "../prim-util.js";
import { inflateLimited } from "./deflate.js";

const { int, str, bytes, bool, record } = valueHelpers;

/** The bytes of a record in the value limit, estimated. */
const RECORD_BYTES = 320;
/** The most bytes the end finders may examine in one call. */
const WORK_LIMIT = 2 ** 28;

// ---------------------------------------------------------------------------------------------
// reading helpers
// ---------------------------------------------------------------------------------------------

function u16(d: Uint8Array, p: number, le: boolean): number {
  if (p < 0 || p + 2 > d.length) return -1;
  return le
    ? (d[p] as number) | ((d[p + 1] as number) << 8)
    : ((d[p] as number) << 8) | (d[p + 1] as number);
}

function u32(d: Uint8Array, p: number, le: boolean): number {
  if (p < 0 || p + 4 > d.length) return -1;
  const a = d[p] as number;
  const b = d[p + 1] as number;
  const c = d[p + 2] as number;
  const e = d[p + 3] as number;
  return le
    ? (a | (b << 8) | (c << 16) | (e << 24)) >>> 0
    : ((a << 24) | (b << 16) | (c << 8) | e) >>> 0;
}

/** An unsigned 64-bit field as a number, or -1 when it does not fit 2^53 or lies outside the data. */
function u64(d: Uint8Array, p: number, le: boolean): number {
  const lo = u32(d, le ? p : p + 4, le);
  const hi = u32(d, le ? p + 4 : p, le);
  if (lo < 0 || hi < 0 || hi >= 0x200000) return -1;
  return hi * 4294967296 + lo;
}

const CHUNK = 8192;

/** The Latin-1 text of the bytes (one character per byte), for `indexOf`. */
export function latin1Of(d: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < d.length; i += CHUNK)
    parts.push(String.fromCharCode.apply(null, d.subarray(i, i + CHUNK) as unknown as number[]));
  return parts.join("");
}

// ---------------------------------------------------------------------------------------------
// matching
// ---------------------------------------------------------------------------------------------

/** Does the magic of `sig` match with the file starting at `i`? */
export function magicAt(d: Uint8Array, i: number, sig: FileSig): boolean {
  for (const part of sig.parts) {
    const at = i + part.offset;
    if (at + part.value.length > d.length) return false;
    for (let k = 0; k < part.value.length; k++) {
      const m = part.mask[k] as number;
      if (((d[at + k] as number) & m) !== (part.value[k] as number)) return false;
    }
  }
  return true;
}

/** The checks the magic alone cannot do. */
function verifyAt(d: Uint8Array, i: number, name: string | undefined): boolean {
  if (name === undefined) return true;
  switch (name) {
    case "pe":
      return peHeader(d, i) !== null;
    case "dos":
      return d.length - i >= 28 && peHeader(d, i) === null;
    case "class": {
      const major = u16(d, i + 6, false);
      return major >= 45 && major <= 130;
    }
    case "fat": {
      const n = u32(d, i + 4, false);
      return n >= 1 && n <= 44;
    }
    default:
      throw new Error(`unknown verifier ${name}`);
  }
}

function matches(d: Uint8Array, i: number, sig: FileSig): boolean {
  return magicAt(d, i, sig) && verifyAt(d, i, sig.verify);
}

/** The categories named in a list value, or E_RANGE for a name that is not one. */
export function categoriesOf(items: readonly Value[]): Set<Category> {
  const out = new Set<Category>();
  for (const v of items) {
    const name = v.v as string;
    if (v.tag !== "str" || !(CATEGORIES as readonly string[]).includes(name))
      throw rangeFailure(`unknown file category ${JSON.stringify(name)}`, {
        categories: [...CATEGORIES],
      });
    out.add(name as Category);
  }
  return out;
}

export interface Match {
  readonly offset: number;
  readonly sig: FileSig;
}

/** The signatures that match with the file starting at offset 0, in table order. */
export function detect(d: Uint8Array, cats: ReadonlySet<Category>): Match[] {
  const out: Match[] = [];
  for (const sig of FILE_SIGNATURES) {
    if (cats.has(sig.category) && matches(d, 0, sig)) out.push({ offset: 0, sig });
  }
  return out;
}

/**
 * Every offset where a signature matches, ordered by offset and then by table order. `maxMatches` bounds
 * the result (E_LIMIT_VALUE past it).
 */
export function scan(
  d: Uint8Array,
  cats: ReadonlySet<Category>,
  ignoreWeak: boolean,
  maxMatches: number,
): Match[] {
  const text = latin1Of(d);
  const found: { offset: number; order: number; sig: FileSig }[] = [];
  FILE_SIGNATURES.forEach((sig, order) => {
    if (!cats.has(sig.category) || (ignoreWeak && sig.weak)) return;
    const needle = latin1Of(sig.anchor.bytes);
    let from = 0;
    for (;;) {
      const j = text.indexOf(needle, from);
      if (j < 0) break;
      from = j + 1;
      const i = j - sig.anchor.offset;
      if (i < 0) continue;
      if (matches(d, i, sig)) {
        if (found.length >= maxMatches)
          throw limitFailure(
            "maxValueBytes",
            maxMatches * RECORD_BYTES,
            (found.length + 1) * RECORD_BYTES,
            "the list of matches",
          );
        found.push({ offset: i, order, sig });
      }
    }
  });
  found.sort((a, b) => a.offset - b.offset || a.order - b.order);
  return found.map((m) => ({ offset: m.offset, sig: m.sig }));
}

// ---------------------------------------------------------------------------------------------
// end finders: each gives the end (exclusive, an absolute offset) of the file that starts at `s`, or
// null when the data does not hold a whole file there
// ---------------------------------------------------------------------------------------------

class Work {
  left = WORK_LIMIT;
  charge(n: number): void {
    this.left -= n;
    if (this.left < 0)
      throw limitFailure(
        "work",
        WORK_LIMIT,
        WORK_LIMIT - this.left,
        "the bytes examined while looking for the ends of files",
      );
  }
}

interface Ctx {
  readonly d: Uint8Array;
  readonly work: Work;
  readonly maxOut: number;
  text(): string;
}

type Finder = (c: Ctx, s: number) => number | null;

const ascii = (d: Uint8Array, p: number, n: number): string => {
  let out = "";
  for (let k = 0; k < n && p + k < d.length; k++) out += String.fromCharCode(d[p + k] as number);
  return out;
};

const finders: Record<string, Finder> = {
  png(c, s) {
    const { d } = c;
    let p = s + 8;
    if (ascii(d, p + 4, 4) !== "IHDR") return null;
    for (;;) {
      const len = u32(d, p, false);
      if (len < 0 || len > 0x7fffffff) return null;
      const end = p + 12 + len;
      if (end > d.length) return null;
      c.work.charge(12);
      if (ascii(d, p + 4, 4) === "IEND") return end;
      p = end;
    }
  },

  jpeg(c, s) {
    const { d } = c;
    let p = s + 2;
    for (;;) {
      while (p < d.length && d[p] === 0xff && d[p + 1] === 0xff) p++;
      if (p + 2 > d.length || d[p] !== 0xff) return null;
      const m = d[p + 1] as number;
      c.work.charge(4);
      if (m === 0xd9) return p + 2;
      if (m === 0x00 || m === 0x01 || (m >= 0xd0 && m <= 0xd8)) {
        p += 2;
        continue;
      }
      const len = u16(d, p + 2, false);
      if (len < 2 || p + 2 + len > d.length) return null;
      p += 2 + len;
      if (m === 0xda) {
        // entropy-coded data up to the next marker
        for (;;) {
          const f = d.indexOf(0xff, p);
          if (f < 0 || f + 1 >= d.length) return null;
          c.work.charge(f - p + 1);
          const n = d[f + 1] as number;
          if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) {
            p = f + 2;
            continue;
          }
          if (n === 0xff) {
            p = f + 1;
            continue;
          }
          p = f;
          break;
        }
      }
    }
  },

  gif(c, s) {
    const { d } = c;
    let p = s + 6;
    if (p + 7 > d.length) return null;
    const flags = d[p + 4] as number;
    p += 7;
    if (flags & 0x80) p += 3 * (2 << (flags & 7));
    const subBlocks = (): boolean => {
      for (;;) {
        if (p >= d.length) return false;
        const n = d[p] as number;
        p += 1 + n;
        c.work.charge(1 + n);
        if (n === 0) return p <= d.length;
        if (p > d.length) return false;
      }
    };
    for (;;) {
      if (p >= d.length) return null;
      const b = d[p] as number;
      if (b === 0x3b) return p + 1;
      if (b === 0x21) {
        p += 2;
        if (!subBlocks()) return null;
      } else if (b === 0x2c) {
        if (p + 10 > d.length) return null;
        const f = d[p + 9] as number;
        p += 10;
        if (f & 0x80) p += 3 * (2 << (f & 7));
        p += 1;
        if (!subBlocks()) return null;
      } else return null;
    }
  },

  bmp(c, s) {
    const size = u32(c.d, s + 2, true);
    return size >= 26 && s + size <= c.d.length ? s + size : null;
  },

  riff(c, s) {
    const size = u32(c.d, s + 4, true);
    return size >= 4 && s + 8 + size <= c.d.length ? s + 8 + size : null;
  },

  ico(c, s) {
    const { d } = c;
    const n = u16(d, s + 4, true);
    if (n < 1 || s + 6 + 16 * n > d.length) return null;
    let end = s + 6 + 16 * n;
    for (let k = 0; k < n; k++) {
      const size = u32(d, s + 6 + 16 * k + 8, true);
      const off = u32(d, s + 6 + 16 * k + 12, true);
      if (off < 6 + 16 * n || s + off + size > d.length) return null;
      end = Math.max(end, s + off + size);
    }
    return end;
  },

  pdf(c, s) {
    const text = c.text();
    const next = text.indexOf("%PDF-", s + 5);
    const limit = next < 0 ? text.length : next;
    c.work.charge(limit - s);
    const eof = text.lastIndexOf("%%EOF", limit - 5);
    if (eof < s) return null;
    let end = eof + 5;
    if (text[end] === "\r") end++;
    if (text[end] === "\n") end++;
    return Math.min(end, limit);
  },

  rtf(c, s) {
    const { d } = c;
    let depth = 0;
    for (let p = s; p < d.length; p++) {
      const b = d[p] as number;
      if (b === 0x5c) p++;
      else if (b === 0x7b) depth++;
      else if (b === 0x7d && --depth === 0) {
        c.work.charge(p - s);
        return p + 1;
      }
    }
    c.work.charge(d.length - s);
    return null;
  },

  zip(c, s) {
    const { d } = c;
    const text = c.text();
    let from = s;
    for (;;) {
      const idx = text.indexOf("PK\x05\x06", from);
      if (idx < 0) {
        c.work.charge(d.length - from);
        return null;
      }
      c.work.charge(idx - from + 1);
      from = idx + 1;
      if (idx + 22 > d.length) return null;
      const entries = u16(d, idx + 10, true);
      const cdSize = u32(d, idx + 12, true);
      const cdOff = u32(d, idx + 16, true);
      const end = idx + 22 + u16(d, idx + 20, true);
      if (end > d.length) continue;
      const zip64 = cdOff === 0xffffffff || cdSize === 0xffffffff || entries === 0xffff;
      if (!zip64 && s + cdOff + cdSize !== idx) continue;
      if (!zip64 && cdSize > 0 && ascii(d, s + cdOff, 4) !== "PK\x01\x02") continue;
      return end;
    }
  },

  "zip-empty"(c, s) {
    return s + 22 <= c.d.length ? s + 22 : null;
  },

  "7z"(c, s) {
    const off = u64(c.d, s + 12, true);
    const size = u64(c.d, s + 20, true);
    if (off < 0 || size < 0) return null;
    const end = s + 32 + off + size;
    return end <= c.d.length ? end : null;
  },

  gzip(c, s) {
    const { d } = c;
    const flags = d[s + 3] as number;
    if (flags & 0xe0 || s + 10 > d.length) return null;
    let p = s + 10;
    if (flags & 4) {
      const xlen = u16(d, p, true);
      if (xlen < 0) return null;
      p += 2 + xlen;
    }
    for (const bit of [8, 16]) {
      if (flags & bit) {
        const z = d.indexOf(0, p);
        if (z < 0) return null;
        p = z + 1;
      }
    }
    if (flags & 2) p += 2;
    if (p >= d.length) return null;
    try {
      const { out, end } = inflateLimited(d, p, c.maxOut);
      c.work.charge(end - p + (out.length >> 3));
      return end + 8 <= d.length ? end + 8 : null;
    } catch (e) {
      if (e instanceof Error && "code" in e) return null;
      throw e;
    }
  },

  zstd(c, s) {
    const { d } = c;
    const fhd = d[s + 4];
    if (fhd === undefined || fhd & 0x08) return null;
    const single = (fhd & 0x20) !== 0;
    const dictBytes = [0, 1, 2, 4][fhd & 3] as number;
    const fcsFlag = fhd >> 6;
    const fcsBytes = fcsFlag === 0 ? (single ? 1 : 0) : [0, 2, 4, 8][fcsFlag]!;
    let p = s + 5 + (single ? 0 : 1) + dictBytes + fcsBytes;
    for (;;) {
      if (p + 3 > d.length) return null;
      const h = (d[p] as number) | ((d[p + 1] as number) << 8) | ((d[p + 2] as number) << 16);
      const last = h & 1;
      const type = (h >> 1) & 3;
      const size = h >> 3;
      if (type === 3) return null;
      p += 3 + (type === 1 ? 1 : size);
      c.work.charge(4);
      if (p > d.length) return null;
      if (last) break;
    }
    if (fhd & 0x04) p += 4;
    return p <= d.length ? p : null;
  },

  tar(c, s) {
    const { d } = c;
    let p = s;
    let headers = 0;
    for (;;) {
      if (p + 512 > d.length) return headers > 0 && p === d.length ? p : null;
      let zero = true;
      for (let k = 0; k < 512 && zero; k++) if (d[p + k] !== 0) zero = false;
      c.work.charge(512);
      if (zero) {
        if (headers === 0) return null;
        const second = p + 1024 <= d.length && d.subarray(p + 512, p + 1024).every((b) => b === 0);
        return second ? p + 1024 : p + 512;
      }
      let sum = 0;
      for (let k = 0; k < 512; k++) sum += k >= 148 && k < 156 ? 0x20 : (d[p + k] as number);
      const stored = octal(d, p + 148, 8);
      const size = octal(d, p + 124, 12);
      if (stored < 0 || size < 0 || stored !== sum) return null;
      p += 512 + Math.ceil(size / 512) * 512;
      headers++;
      if (p > d.length) return null;
    }
  },

  cab(c, s) {
    const size = u32(c.d, s + 8, true);
    return size >= 36 && s + size <= c.d.length ? s + size : null;
  },

  dex(c, s) {
    const size = u32(c.d, s + 32, true);
    return size >= 0x70 && s + size <= c.d.length ? s + size : null;
  },

  sqlite(c, s) {
    const { d } = c;
    let page = u16(d, s + 16, false);
    if (page === 1) page = 65536;
    if (page < 512 || page > 65536 || (page & (page - 1)) !== 0) return null;
    const pages = u32(d, s + 28, false);
    if (pages < 1 || u32(d, s + 24, false) !== u32(d, s + 92, false)) return null;
    const end = s + page * pages;
    return end <= d.length ? end : null;
  },

  "pcap-le": (c, s) => pcap(c, s, true),
  "pcap-be": (c, s) => pcap(c, s, false),
  "pcapng-le": (c, s) => pcapng(c, s, true),
  "pcapng-be": (c, s) => pcapng(c, s, false),

  der(c, s) {
    const { d } = c;
    const b = d[s + 1] as number;
    let len: number;
    let hlen: number;
    if (b < 0x80) {
      len = b;
      hlen = 2;
    } else if (b === 0x81) {
      len = d[s + 2] as number;
      hlen = 3;
    } else if (b === 0x82) {
      len = u16(d, s + 2, false);
      hlen = 4;
    } else return null;
    const end = s + hlen + len;
    return len >= 0 && end <= d.length ? end : null;
  },

  pem(c, s) {
    const text = c.text();
    const labelEnd = text.indexOf("-----", s + 11);
    if (labelEnd < 0) return null;
    const label = text.slice(s + 11, labelEnd);
    if (label.length > 80 || /[\r\n]/.test(label)) return null;
    const closing = `-----END ${label}-----`;
    const at = text.indexOf(closing, labelEnd + 5);
    c.work.charge((at < 0 ? text.length : at) - s);
    if (at < 0) return null;
    let end = at + closing.length;
    if (text[end] === "\r") end++;
    if (text[end] === "\n") end++;
    return end;
  },

  mp4(c, s) {
    const { d } = c;
    const known = new Set([
      "ftyp",
      "moov",
      "mdat",
      "free",
      "skip",
      "wide",
      "moof",
      "mfra",
      "sidx",
      "styp",
      "pnot",
      "uuid",
      "meta",
      "pdin",
      "ssix",
      "prft",
      "emsg",
      "mvex",
      "cmov",
    ]);
    let p = s;
    let end = -1;
    for (;;) {
      if (p + 8 > d.length) break;
      let size = u32(d, p, false);
      const type = ascii(d, p + 4, 4);
      if (!known.has(type) || (p === s && type !== "ftyp")) break;
      if (size === 1) {
        size = u64(d, p + 8, false);
        if (size < 16) break;
      } else if (size === 0) {
        end = d.length;
        break;
      } else if (size < 8) break;
      if (p + size > d.length) {
        if (end < 0) return null;
        break;
      }
      p += size;
      end = p;
      c.work.charge(8);
    }
    return end > s ? end : null;
  },

  ebml(c, s) {
    const { d } = c;
    const vint = (p: number): [number, number] | null => {
      const b = d[p];
      if (b === undefined || b === 0) return null;
      const n = Math.clz32(b) - 23;
      if (p + n > d.length) return null;
      let v = b & (0xff >> n);
      let allOnes = v === 0xff >> n;
      for (let k = 1; k < n; k++) {
        const x = d[p + k] as number;
        v = v * 256 + x;
        if (x !== 0xff) allOnes = false;
      }
      return allOnes ? [-1, n] : [v, n];
    };
    const head = vint(s + 4);
    if (head === null || head[0] < 0) return null;
    const segAt = s + 4 + head[1] + head[0];
    if (u32(d, segAt, false) !== 0x18538067) return null;
    const seg = vint(segAt + 4);
    if (seg === null || seg[0] < 0) return null;
    const end = segAt + 4 + seg[1] + seg[0];
    return end <= d.length ? end : null;
  },

  ogg(c, s) {
    const { d } = c;
    let p = s;
    let end = -1;
    while (p + 27 <= d.length && ascii(d, p, 4) === "OggS" && d[p + 4] === 0) {
      const n = d[p + 26] as number;
      if (p + 27 + n > d.length) break;
      let body = 0;
      for (let k = 0; k < n; k++) body += d[p + 27 + k] as number;
      const next = p + 27 + n + body;
      if (next > d.length) break;
      c.work.charge(27 + n);
      p = next;
      end = p;
    }
    return end > s ? end : null;
  },

  elf(c, s) {
    const { d } = c;
    const cls = d[s + 4];
    const le = d[s + 5] === 1;
    if ((cls !== 1 && cls !== 2) || (d[s + 5] !== 1 && d[s + 5] !== 2)) return null;
    const w64 = cls === 2;
    const rd = (p: number, n: 2 | 4 | 8): number =>
      n === 2 ? u16(d, s + p, le) : n === 4 ? u32(d, s + p, le) : u64(d, s + p, le);
    const phoff = w64 ? rd(32, 8) : rd(28, 4);
    const shoff = w64 ? rd(40, 8) : rd(32, 4);
    const phentsize = rd(w64 ? 54 : 42, 2);
    const phnum = rd(w64 ? 56 : 44, 2);
    const shentsize = rd(w64 ? 58 : 46, 2);
    const shnum = rd(w64 ? 60 : 48, 2);
    if (phoff < 0 || shoff < 0 || phentsize < 0 || phnum < 0 || shentsize < 0 || shnum < 0)
      return null;
    let end = w64 ? 64 : 52;
    const limit = d.length - s;
    if (phnum > 0) {
      if (phentsize < (w64 ? 56 : 32) || phoff + phnum * phentsize > limit) return null;
      end = Math.max(end, phoff + phnum * phentsize);
      for (let k = 0; k < phnum; k++) {
        const base = phoff + k * phentsize;
        const off = w64 ? rd(base + 8, 8) : rd(base + 4, 4);
        const size = w64 ? rd(base + 32, 8) : rd(base + 16, 4);
        if (off < 0 || size < 0) return null;
        end = Math.max(end, off + size);
      }
      c.work.charge(phnum * 8);
    }
    if (shnum > 0 && shoff > 0) {
      if (shentsize < (w64 ? 64 : 40) || shoff + shnum * shentsize > limit) return null;
      end = Math.max(end, shoff + shnum * shentsize);
      for (let k = 0; k < shnum; k++) {
        const base = shoff + k * shentsize;
        if (rd(base + 4, 4) === 8) continue; // SHT_NOBITS
        const off = w64 ? rd(base + 24, 8) : rd(base + 16, 4);
        const size = w64 ? rd(base + 32, 8) : rd(base + 20, 4);
        if (off < 0 || size < 0) return null;
        end = Math.max(end, off + size);
      }
      c.work.charge(shnum * 8);
    }
    return end <= limit ? s + end : null;
  },

  pe(c, s) {
    const { d } = c;
    const h = peHeader(d, s);
    if (h === null) return null;
    const sections = u16(d, s + h + 6, true);
    const optSize = u16(d, s + h + 20, true);
    const opt = s + h + 24;
    const magic = u16(d, opt, true);
    const dirs = magic === 0x20b ? opt + 112 : opt + 96;
    let end = u32(d, opt + 60, true);
    if (magic !== 0x10b && magic !== 0x20b) return null;
    const table = opt + optSize;
    if (sections < 0 || table + 40 * sections > d.length) return null;
    for (let k = 0; k < sections; k++) {
      const raw = u32(d, table + 40 * k + 16, true);
      const ptr = u32(d, table + 40 * k + 20, true);
      if (raw > 0 && ptr + raw > end) end = ptr + raw;
    }
    const nDirs = u32(d, dirs - 4, true);
    if (nDirs > 4) {
      const certOff = u32(d, dirs + 32, true);
      const certSize = u32(d, dirs + 36, true);
      if (certOff > 0 && certSize > 0 && certOff + certSize > end) end = certOff + certSize;
    }
    c.work.charge(sections * 8);
    return end >= 0x40 && s + end <= d.length ? s + end : null;
  },
};

/** Octal number field; -1 for anything else (also the base-256 form). */
function octal(d: Uint8Array, p: number, n: number): number {
  let v = 0;
  let digits = 0;
  for (let k = 0; k < n && p + k < d.length; k++) {
    const b = d[p + k] as number;
    if (b === 0) break;
    if (b === 0x20) continue;
    if (b < 0x30 || b > 0x37) return -1;
    v = v * 8 + (b - 0x30);
    digits++;
  }
  return digits === 0 && n > 0 ? 0 : v;
}

/** The offset of the PE header ("PE\0\0") of an MZ file, or null. */
function peHeader(d: Uint8Array, i: number): number | null {
  const lfanew = u32(d, i + 0x3c, true);
  if (lfanew < 0x40 || i + lfanew + 24 > d.length) return null;
  return d[i + lfanew] === 0x50 &&
    d[i + lfanew + 1] === 0x45 &&
    d[i + lfanew + 2] === 0 &&
    d[i + lfanew + 3] === 0
    ? lfanew
    : null;
}

function pcap(c: Ctx, s: number, le: boolean): number | null {
  const { d } = c;
  if (s + 24 > d.length) return null;
  const nano = d[s + (le ? 1 : 2)] === 0x3c;
  const snap = u32(d, s + 16, le);
  let p = s + 24;
  for (;;) {
    if (p + 16 > d.length) break;
    const frac = u32(d, p + 4, le);
    const incl = u32(d, p + 8, le);
    const orig = u32(d, p + 12, le);
    if (
      frac >= (nano ? 1_000_000_000 : 1_000_000) ||
      incl > orig ||
      (snap > 0 && incl > snap) ||
      p + 16 + incl > d.length
    )
      break;
    p += 16 + incl;
    c.work.charge(16);
  }
  return p;
}

function pcapng(c: Ctx, s: number, le: boolean): number | null {
  const { d } = c;
  let p = s;
  let end = -1;
  for (;;) {
    const len = u32(d, p + 4, le);
    if (len < 12 || len % 4 !== 0 || p + len > d.length || u32(d, p + len - 4, le) !== len) break;
    if (p === s && u32(d, p, le) !== 0x0a0d0d0a) return null;
    p += len;
    end = p;
    c.work.charge(12);
  }
  return end > s ? end : null;
}

/** The end of the file that starts at `s`, or a reason it cannot be cut out. */
function endOf(c: Ctx, sig: FileSig, s: number): { end: number } | { reason: string } {
  if (sig.end === undefined)
    return { reason: `no extraction algorithm is available for ${sig.mime} files` };
  const finder = finders[sig.end];
  if (finder === undefined) throw new Error(`no end finder ${sig.end}`);
  const end = finder(c, s);
  if (end === null || end <= s)
    return { reason: `the ${sig.name} at this offset is damaged or cut short` };
  return { end };
}

export interface Carved {
  readonly name: string;
  readonly offset: number;
  readonly size: number;
  readonly mime: string;
  readonly data: Uint8Array;
}

/**
 * Cut out every file found by `scan`. A file that cannot be cut out is left out when `ignoreFailed`,
 * otherwise `E_COERCE` names it. The sum of the sizes is bounded by `maxBytes` (`E_LIMIT_VALUE`).
 */
export function carve(
  d: Uint8Array,
  cats: ReadonlySet<Category>,
  ignoreFailed: boolean,
  maxBytes: number,
): Carved[] {
  const found = scan(d, cats, false, Math.floor(maxBytes / RECORD_BYTES));
  let textCache: string | undefined;
  const ctx: Ctx = {
    d,
    work: new Work(),
    maxOut: maxBytes,
    text: () => (textCache ??= latin1Of(d)),
  };
  const out: Carved[] = [];
  let total = 0;
  for (const m of found) {
    const r = endOf(ctx, m.sig, m.offset);
    if ("reason" in r) {
      if (ignoreFailed) continue;
      throw coerceFailure(`the ${m.sig.name} at offset ${m.offset}`, "a file", r.reason);
    }
    const size = r.end - m.offset;
    total += size + RECORD_BYTES;
    if (total > maxBytes)
      throw limitFailure("maxValueBytes", maxBytes, total, "the extracted files");
    const ext = (m.sig.extensions.split(",")[0] as string) || "bin";
    out.push({
      name: `extracted_at_0x${m.offset.toString(16)}.${ext}`,
      offset: m.offset,
      size,
      mime: m.sig.mime,
      data: d.slice(m.offset, r.end),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------------------------

function matchRecord(m: Match): Value {
  return record([
    ["offset", int(m.offset)],
    ["name", str(m.sig.name)],
    ["extensions", str(m.sig.extensions)],
    ["mime", str(m.sig.mime)],
    ["description", str(m.sig.description)],
    ["category", str(m.sig.category)],
    ["weak", bool(m.sig.weak)],
  ]);
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "filetype",
    "detect-list",
    "( data:bytes categories:list -- list )",
    (d: Uint8Array, cats: Value[]) => detect(d, categoriesOf(cats)).map(matchRecord),
    {
      doc: "The file signatures that match at offset 0 of the data, as records of offset, name, extensions, mime, description, category and weak, in table order; categories is a list of category names (Images, Video, Audio, Documents, Applications, Archives, Miscellaneous). Shared word of the filetype vocabulary.",
    },
  ),
  definePrimitive(
    "filetype",
    "scan-list",
    "( data:bytes categories:list ignore-weak:bool -- list )",
    (d: Uint8Array, cats: Value[], ignoreWeak: boolean, ctx: PrimitiveContext) =>
      scan(
        d,
        categoriesOf(cats),
        ignoreWeak,
        Math.floor(ctx.limits.maxValueBytes / RECORD_BYTES),
      ).map(matchRecord),
    {
      doc: "Every offset of the data where a file signature matches (the file would start there), as records of offset, name, extensions, mime, description, category and weak, ordered by offset and then by table order. Signatures with a name offset (tar at 257) are reported at the start of the file. With ignore-weak the short signatures that occur by chance (MZ, ICO, MP3 frames, a shebang, ...) are left out. More matches than the value limit allows is E_LIMIT_VALUE. Shared word of the filetype vocabulary: the signature scanner that other vocabularies (YARA) reuse.",
    },
  ),
  definePrimitive(
    "filetype",
    "carve",
    "( data:bytes categories:list ignore-failed:bool -- list )",
    (d: Uint8Array, cats: Value[], ignoreFailed: boolean, ctx: PrimitiveContext) =>
      carve(d, categoriesOf(cats), ignoreFailed, ctx.limits.maxValueBytes).map((f) =>
        record([
          ["name", str(f.name)],
          ["offset", int(f.offset)],
          ["size", int(f.size)],
          ["type", str(f.mime)],
          ["data", bytes(f.data)],
        ]),
      ),
    {
      doc: "The files found by file signature, cut out with the end finder of their type, as records of name (extracted_at_0x<offset>.<extension>), offset, size, type (MIME) and data, in order of offset. A type with no end finder, or a file that is damaged or cut short, is left out with ignore-failed and E_COERCE otherwise. The sum of the sizes is bounded by the value limit (E_LIMIT_VALUE). Shared word of the filetype vocabulary.",
    },
  ),
];
