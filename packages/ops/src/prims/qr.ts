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
 * qr primitives: a QR Code Model 2 encoder written from ISO/IEC 18004 (no library): numeric, alphanumeric and
 * byte mode (one mode for the whole text, the narrowest that holds it; UTF-8 bytes, no ECI header), versions 1 to
 * 40, error correction L, M, Q and H, Reed-Solomon codes over GF(256) (polynomial 0x11D), the eight masks and the
 * four penalty rules of 7.8.3 (the lowest score wins, the first of equals), format and version information (BCH).
 * The bit and module loops are far too slow in FL (a version 40 symbol has 31,329 modules and each mask is
 * scored in rows and columns), so the encoder and the three writers are primitives; the parameters, the PNG
 * chunks (with the deflate and crc words) and the checks are FL.
 *
 *  - `_svg ( text:str level:str scale:int margin:int -- bytes )`: the SVG document (UTF-8): width and height of
 *    (size + 2 margin) * scale pixels, a white background and one black path of runs of modules.
 *  - `_text ( text:str level:str scale:int margin:int -- bytes )`: one line per module row, two characters per
 *    module (a full block pair for dark, two spaces for light), `scale` ignored; margin in modules.
 *  - `_scanlines ( text:str level:str scale:int margin:int -- bytes width:int height:int )`: the unfiltered
 *    scanlines of a 1-bit greyscale image (each row starts with the filter byte 0; 0 is black, 1 is white) for
 *    the PNG writer, with the size in pixels.
 *  - Empty text, text that does not fit version 40 at the level, a level other than L, M, Q or H, a scale outside
 *    1 to 100, a margin outside 0 to 100 and an image over the value limit are E_RANGE (E_LIMIT_VALUE for the last).
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef } from "@forge/lang";
import { limitFailure, rangeFailure } from "../prim-util.js";

/** Per level (L, M, Q, H) and version 1 to 40: [EC codewords per block, blocks, data per block, blocks, data per block]. */
const EC_TABLE: readonly (readonly (readonly number[])[])[] = [
  // L
  [
    [7, 1, 19, 0, 0],
    [10, 1, 34, 0, 0],
    [15, 1, 55, 0, 0],
    [20, 1, 80, 0, 0],
    [26, 1, 108, 0, 0],
    [18, 2, 68, 0, 0],
    [20, 2, 78, 0, 0],
    [24, 2, 97, 0, 0],
    [30, 2, 116, 0, 0],
    [18, 2, 68, 2, 69],
    [20, 4, 81, 0, 0],
    [24, 2, 92, 2, 93],
    [26, 4, 107, 0, 0],
    [30, 3, 115, 1, 116],
    [22, 5, 87, 1, 88],
    [24, 5, 98, 1, 99],
    [28, 1, 107, 5, 108],
    [30, 5, 120, 1, 121],
    [28, 3, 113, 4, 114],
    [28, 3, 107, 5, 108],
    [28, 4, 116, 4, 117],
    [28, 2, 111, 7, 112],
    [30, 4, 121, 5, 122],
    [30, 6, 117, 4, 118],
    [26, 8, 106, 4, 107],
    [28, 10, 114, 2, 115],
    [30, 8, 122, 4, 123],
    [30, 3, 117, 10, 118],
    [30, 7, 116, 7, 117],
    [30, 5, 115, 10, 116],
    [30, 13, 115, 3, 116],
    [30, 17, 115, 0, 0],
    [30, 17, 115, 1, 116],
    [30, 13, 115, 6, 116],
    [30, 12, 121, 7, 122],
    [30, 6, 121, 14, 122],
    [30, 17, 122, 4, 123],
    [30, 4, 122, 18, 123],
    [30, 20, 117, 4, 118],
    [30, 19, 118, 6, 119],
  ],
  // M
  [
    [10, 1, 16, 0, 0],
    [16, 1, 28, 0, 0],
    [26, 1, 44, 0, 0],
    [18, 2, 32, 0, 0],
    [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0],
    [18, 4, 31, 0, 0],
    [22, 2, 38, 2, 39],
    [22, 3, 36, 2, 37],
    [26, 4, 43, 1, 44],
    [30, 1, 50, 4, 51],
    [22, 6, 36, 2, 37],
    [22, 8, 37, 1, 38],
    [24, 4, 40, 5, 41],
    [24, 5, 41, 5, 42],
    [28, 7, 45, 3, 46],
    [28, 10, 46, 1, 47],
    [26, 9, 43, 4, 44],
    [26, 3, 44, 11, 45],
    [26, 3, 41, 13, 42],
    [26, 17, 42, 0, 0],
    [28, 17, 46, 0, 0],
    [28, 4, 47, 14, 48],
    [28, 6, 45, 14, 46],
    [28, 8, 47, 13, 48],
    [28, 19, 46, 4, 47],
    [28, 22, 45, 3, 46],
    [28, 3, 45, 23, 46],
    [28, 21, 45, 7, 46],
    [28, 19, 47, 10, 48],
    [28, 2, 46, 29, 47],
    [28, 10, 46, 23, 47],
    [28, 14, 46, 21, 47],
    [28, 14, 46, 23, 47],
    [28, 12, 47, 26, 48],
    [28, 6, 47, 34, 48],
    [28, 29, 46, 14, 47],
    [28, 13, 46, 32, 47],
    [28, 40, 47, 7, 48],
    [28, 18, 47, 31, 48],
  ],
  // Q
  [
    [13, 1, 13, 0, 0],
    [22, 1, 22, 0, 0],
    [18, 2, 17, 0, 0],
    [26, 2, 24, 0, 0],
    [18, 2, 15, 2, 16],
    [24, 4, 19, 0, 0],
    [18, 2, 14, 4, 15],
    [22, 4, 18, 2, 19],
    [20, 4, 16, 4, 17],
    [24, 6, 19, 2, 20],
    [28, 4, 22, 4, 23],
    [26, 4, 20, 6, 21],
    [24, 8, 20, 4, 21],
    [20, 11, 16, 5, 17],
    [30, 5, 24, 7, 25],
    [24, 15, 19, 2, 20],
    [28, 1, 22, 15, 23],
    [28, 17, 22, 1, 23],
    [26, 17, 21, 4, 22],
    [30, 15, 24, 5, 25],
    [28, 17, 22, 6, 23],
    [30, 7, 24, 16, 25],
    [30, 11, 24, 14, 25],
    [30, 11, 24, 16, 25],
    [30, 7, 24, 22, 25],
    [28, 28, 22, 6, 23],
    [30, 8, 23, 26, 24],
    [30, 4, 24, 31, 25],
    [30, 1, 23, 37, 24],
    [30, 15, 24, 25, 25],
    [30, 42, 24, 1, 25],
    [30, 10, 24, 35, 25],
    [30, 29, 24, 19, 25],
    [30, 44, 24, 7, 25],
    [30, 39, 24, 14, 25],
    [30, 46, 24, 10, 25],
    [30, 49, 24, 10, 25],
    [30, 48, 24, 14, 25],
    [30, 43, 24, 22, 25],
    [30, 34, 24, 34, 25],
  ],
  // H
  [
    [17, 1, 9, 0, 0],
    [28, 1, 16, 0, 0],
    [22, 2, 13, 0, 0],
    [16, 4, 9, 0, 0],
    [22, 2, 11, 2, 12],
    [28, 4, 15, 0, 0],
    [26, 4, 13, 1, 14],
    [26, 4, 14, 2, 15],
    [24, 4, 12, 4, 13],
    [28, 6, 15, 2, 16],
    [24, 3, 12, 8, 13],
    [28, 7, 14, 4, 15],
    [22, 12, 11, 4, 12],
    [24, 11, 12, 5, 13],
    [24, 11, 12, 7, 13],
    [30, 3, 15, 13, 16],
    [28, 2, 14, 17, 15],
    [28, 2, 14, 19, 15],
    [26, 9, 13, 16, 14],
    [28, 15, 15, 10, 16],
    [30, 19, 16, 6, 17],
    [24, 34, 13, 0, 0],
    [30, 16, 15, 14, 16],
    [30, 30, 16, 2, 17],
    [30, 22, 15, 13, 16],
    [30, 33, 16, 4, 17],
    [30, 12, 15, 28, 16],
    [30, 11, 15, 31, 16],
    [30, 19, 15, 26, 16],
    [30, 23, 15, 25, 16],
    [30, 23, 15, 28, 16],
    [30, 19, 15, 35, 16],
    [30, 11, 15, 46, 16],
    [30, 59, 16, 1, 17],
    [30, 22, 15, 41, 16],
    [30, 2, 15, 64, 16],
    [30, 24, 15, 46, 16],
    [30, 42, 15, 32, 16],
    [30, 10, 15, 67, 16],
    [30, 20, 15, 61, 16],
  ],
];

const LEVELS = "LMQH";
/** The two format bits of each level, in the order L, M, Q, H. */
const LEVEL_BITS = [1, 0, 3, 2];
const ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

type Mode = "numeric" | "alnum" | "byte";

export interface Qr {
  version: number;
  mask: number;
  size: number;
  /** size * size modules, row by row, 1 for dark. */
  modules: Uint8Array;
}

// ---------------------------------------------------------------------------------------------
// data
// ---------------------------------------------------------------------------------------------

export function chooseMode(text: string): Mode {
  if (/^[0-9]*$/.test(text)) return "numeric";
  let alnum = true;
  for (const ch of text) if (!ALNUM.includes(ch)) alnum = false;
  return alnum ? "alnum" : "byte";
}

function countBits(mode: Mode, version: number): number {
  const i = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  return (mode === "numeric" ? [10, 12, 14] : mode === "alnum" ? [9, 11, 13] : [8, 16, 16])[
    i
  ] as number;
}

/** The number of characters (digits, alphanumerics or bytes) and data bits of the text in the mode. */
function dataSize(text: string, mode: Mode, utf8: Uint8Array): { chars: number; bits: number } {
  if (mode === "byte") return { chars: utf8.length, bits: 8 * utf8.length };
  const n = text.length;
  if (mode === "numeric") return { chars: n, bits: 10 * Math.floor(n / 3) + [0, 4, 7][n % 3]! };
  return { chars: n, bits: 11 * Math.floor(n / 2) + 6 * (n % 2) };
}

function dataCodewordsOf(version: number, level: number): number {
  const g = (EC_TABLE[level] as readonly (readonly number[])[])[version - 1] as readonly number[];
  return (g[1] as number) * (g[2] as number) + (g[3] as number) * (g[4] as number);
}

class Bits {
  readonly bits: number[] = [];
  push(value: number, n: number): void {
    for (let i = n - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
}

/** The data codewords: segment, terminator, padding to a byte, and the pad bytes 0xEC and 0x11. */
export function dataCodewords(
  text: string,
  mode: Mode,
  utf8: Uint8Array,
  version: number,
  level: number,
): Uint8Array {
  const total = dataCodewordsOf(version, level);
  const b = new Bits();
  const { chars } = dataSize(text, mode, utf8);
  b.push(mode === "numeric" ? 1 : mode === "alnum" ? 2 : 4, 4);
  b.push(chars, countBits(mode, version));
  if (mode === "numeric") {
    for (let i = 0; i < text.length; i += 3) {
      const part = text.slice(i, i + 3);
      b.push(Number(part), part.length * 3 + 1);
    }
  } else if (mode === "alnum") {
    for (let i = 0; i < text.length; i += 2) {
      if (i + 1 < text.length)
        b.push(ALNUM.indexOf(text[i] as string) * 45 + ALNUM.indexOf(text[i + 1] as string), 11);
      else b.push(ALNUM.indexOf(text[i] as string), 6);
    }
  } else for (const x of utf8) b.push(x, 8);
  const cap = total * 8;
  b.push(0, Math.min(4, cap - b.bits.length));
  b.push(0, (8 - (b.bits.length % 8)) % 8);
  const out = new Uint8Array(total);
  for (let i = 0; i < b.bits.length; i++)
    out[i >> 3] = (out[i >> 3] as number) | ((b.bits[i] as number) << (7 - (i & 7)));
  for (let i = b.bits.length >> 3, pad = 0xec; i < total; i++, pad ^= 0xec ^ 0x11) out[i] = pad;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Reed-Solomon
// ---------------------------------------------------------------------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255] as number;
}
const gmul = (a: number, b: number): number =>
  a === 0 || b === 0 ? 0 : (EXP[(LOG[a] as number) + (LOG[b] as number)] as number);

/** The generator polynomial of degree `deg` (coefficients without the leading 1, highest power first). */
function generator(deg: number): Uint8Array {
  let g = new Uint8Array([1]);
  for (let i = 0; i < deg; i++) {
    const next = new Uint8Array(g.length + 1);
    for (let j = 0; j < g.length; j++) {
      next[j] = (next[j] as number) ^ (g[j] as number);
      next[j + 1] = (next[j + 1] as number) ^ gmul(g[j] as number, EXP[i] as number);
    }
    g = next;
  }
  return g.subarray(1);
}

/** The Reed-Solomon remainder of the data block for `deg` error correction codewords. */
export function remainder(data: Uint8Array, deg: number): Uint8Array {
  const gen = generator(deg);
  const rem = new Uint8Array(deg);
  for (const d of data) {
    const factor = d ^ (rem[0] as number);
    rem.copyWithin(0, 1);
    rem[deg - 1] = 0;
    for (let i = 0; i < deg; i++) rem[i] = (rem[i] as number) ^ gmul(gen[i] as number, factor);
  }
  return rem;
}

/** Data blocks, their error correction, interleaved as ISO/IEC 18004 section 7.6 says. */
export function interleave(data: Uint8Array, version: number, level: number): Uint8Array {
  const g = (EC_TABLE[level] as readonly (readonly number[])[])[version - 1] as readonly number[];
  const [ecLen, n1, d1, n2, d2] = g as [number, number, number, number, number];
  const blocks: Uint8Array[] = [];
  const ecs: Uint8Array[] = [];
  let at = 0;
  for (let i = 0; i < n1 + n2; i++) {
    const len = i < n1 ? d1 : d2;
    const block = data.subarray(at, at + len);
    at += len;
    blocks.push(block);
    ecs.push(remainder(block, ecLen));
  }
  const out: number[] = [];
  for (let i = 0; i < d2 || i < d1; i++)
    for (const b of blocks) if (i < b.length) out.push(b[i] as number);
  for (let i = 0; i < ecLen; i++) for (const e of ecs) out.push(e[i] as number);
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------------------------
// the matrix
// ---------------------------------------------------------------------------------------------

function rawModules(version: number): number {
  let r = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const n = Math.floor(version / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (version >= 7) r -= 36;
  }
  return r;
}

export function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const n = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (n * 2 - 2)) * 2;
  const pos = [6];
  for (let p = version * 4 + 10, i = 0; i < n - 1; i++, p -= step) pos.splice(1, 0, p);
  return pos;
}

function bit(x: number, i: number): number {
  return (x >>> i) & 1;
}

/** The 15 format information bits (BCH(15,5), masked with 0x5412) of a level index (L, M, Q, H) and a mask. */
export function formatBits(level: number, mask: number): number {
  const data = ((LEVEL_BITS[level] as number) << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** The 18 version information bits (BCH(18,6)) of a version from 7 to 40. */
export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

function buildMatrix(codewords: Uint8Array, version: number, level: number): Qr {
  const size = version * 4 + 17;
  const m = new Uint8Array(size * size);
  const fn = new Uint8Array(size * size);
  /** The format information, version information and dark module, which are not in the symbol that is scored. */
  const info = new Uint8Array(size * size);
  let isInfo = false;
  const setFn = (x: number, y: number, dark: number) => {
    m[y * size + x] = dark;
    fn[y * size + x] = 1;
    if (isInfo) info[y * size + x] = 1;
  };

  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0 ? 1 : 0);
    setFn(i, 6, i % 2 === 0 ? 1 : 0);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFn(x, y, dist !== 2 && dist !== 4 ? 1 : 0);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const pos = alignmentPositions(version);
  for (let i = 0; i < pos.length; i++)
    for (let j = 0; j < pos.length; j++) {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === pos.length - 1) ||
        (i === pos.length - 1 && j === 0)
      )
        continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          setFn(
            (pos[i] as number) + dx,
            (pos[j] as number) + dy,
            Math.max(Math.abs(dx), Math.abs(dy)) !== 1 ? 1 : 0,
          );
    }

  const drawFormat = (mask: number) => {
    isInfo = true;
    const bits = formatBits(level, mask);
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(bits, i));
    setFn(8, 7, bit(bits, 6));
    setFn(8, 8, bit(bits, 7));
    setFn(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(bits, i));
    setFn(8, size - 8, 1);
    isInfo = false;
  };
  drawFormat(0);
  if (version >= 7) {
    isInfo = true;
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFn(a, b, bit(bits, i));
      setFn(b, a, bit(bits, i));
    }
    isInfo = false;
  }

  // codewords, in the zigzag of 7.7.3
  let k = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (fn[y * size + x] === 0 && k < totalBits) {
          m[y * size + x] = bit(codewords[k >> 3] as number, 7 - (k & 7));
          k++;
        }
      }
  }

  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        let flip: boolean;
        switch (mask) {
          case 0:
            flip = (x + y) % 2 === 0;
            break;
          case 1:
            flip = y % 2 === 0;
            break;
          case 2:
            flip = x % 3 === 0;
            break;
          case 3:
            flip = (x + y) % 3 === 0;
            break;
          case 4:
            flip = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
            break;
          case 5:
            flip = ((x * y) % 2) + ((x * y) % 3) === 0;
            break;
          case 6:
            flip = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
            break;
          default:
            flip = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
            break;
        }
        if (flip && fn[y * size + x] === 0) m[y * size + x] = (m[y * size + x] as number) ^ 1;
      }
  };

  let best = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask);
    // ISO/IEC 18004:2015 7.8: the format and version information are put in after the masks are scored (the
    // dark module with them), so they are light here, as segno and python-qrcode also do.
    const seen = m.slice();
    for (let i = 0; i < seen.length; i++) if (info[i] === 1) seen[i] = 0;
    const s = penalty(seen, size);
    if (s < bestScore) {
      bestScore = s;
      best = mask;
    }
    applyMask(mask);
  }
  applyMask(best);
  drawFormat(best);
  return { version, mask: best, size, modules: m };
}

/** The penalty of ISO/IEC 18004 7.8.3 over the whole symbol: runs, 2x2 blocks, finder-like patterns, balance. */
export function penalty(m: Uint8Array, size: number): number {
  let n1 = 0;
  let n2 = 0;
  let n3 = 0;
  let dark = 0;
  const at = (x: number, y: number) => m[y * size + x] as number;
  // N3: the 11-module windows 1011101 + 0000 and 0000 + 1011101 inside the symbol, rows and columns
  const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let i = 0; i < size; i++) {
    let rowRun = 0;
    let colRun = 0;
    let rowPrev = -1;
    let colPrev = -1;
    for (let j = 0; j < size; j++) {
      const r = at(j, i);
      const c = at(i, j);
      dark += r;
      if (r === rowPrev) rowRun++;
      else {
        if (rowRun >= 5) n1 += rowRun - 2;
        rowRun = 1;
      }
      if (c === colPrev) colRun++;
      else {
        if (colRun >= 5) n1 += colRun - 2;
        colRun = 1;
      }
      if (i > 0 && j > 0 && r === rowPrev && r === at(j, i - 1) && r === at(j - 1, i - 1)) n2 += 3;
      rowPrev = r;
      colPrev = c;
    }
    if (rowRun >= 5) n1 += rowRun - 2;
    if (colRun >= 5) n1 += colRun - 2;
    for (let j = 0; j + 11 <= size; j++) {
      let ra = true;
      let rb = true;
      let ca = true;
      let cb = true;
      for (let k = 0; k < 11; k++) {
        const r = at(j + k, i);
        const c = at(i, j + k);
        if (r !== A[k]) ra = false;
        if (r !== B[k]) rb = false;
        if (c !== A[k]) ca = false;
        if (c !== B[k]) cb = false;
      }
      n3 += 40 * (Number(ra) + Number(rb) + Number(ca) + Number(cb));
    }
  }
  const total = size * size;
  const n4 = 10 * Math.floor(Math.abs(dark * 100 - total * 50) / (5 * total));
  return n1 + n2 + n3 + n4;
}

export function encodeQr(text: string, levelName: string): Qr {
  const level = LEVELS.indexOf(levelName);
  if (levelName.length !== 1 || level < 0)
    throw rangeFailure("the error correction level must be L, M, Q or H");
  if (text === "") throw rangeFailure("there is nothing to encode: the text is empty");
  const utf8 = new TextEncoder().encode(text);
  const mode = chooseMode(text);
  const { chars, bits } = dataSize(text, mode, utf8);
  let version = 0;
  for (let v = 1; v <= 40; v++) {
    const need = 4 + countBits(mode, v) + bits;
    if (chars < 2 ** countBits(mode, v) && need <= dataCodewordsOf(v, level) * 8) {
      version = v;
      break;
    }
  }
  if (version === 0)
    throw rangeFailure(
      `the text is too long for a QR code at level ${levelName} (version 40 holds fewer characters)`,
    );
  const data = dataCodewords(text, mode, utf8, version, level);
  const all = interleave(data, version, level);
  if (all.length !== Math.floor(rawModules(version) / 8))
    throw new Error("QR codeword count mismatch");
  return buildMatrix(all, version, level);
}

// ---------------------------------------------------------------------------------------------
// writers
// ---------------------------------------------------------------------------------------------

function checkLayout(scale: number | bigint, margin: number | bigint): { s: number; g: number } {
  const s = Number(scale);
  const g = Number(margin);
  if (!(s >= 1 && s <= 100)) throw rangeFailure("the module size must be 1 to 100 pixels");
  if (!(g >= 0 && g <= 100)) throw rangeFailure("the margin must be 0 to 100 modules");
  return { s, g };
}

function svg(
  text: string,
  level: string,
  scale: number | bigint,
  margin: number | bigint,
): Uint8Array {
  const { s, g } = checkLayout(scale, margin);
  const q = encodeQr(text, level);
  const w = q.size + 2 * g;
  let d = "";
  for (let y = 0; y < q.size; y++) {
    let x = 0;
    while (x < q.size) {
      if (q.modules[y * q.size + x] === 1) {
        let e = x;
        while (e < q.size && q.modules[y * q.size + e] === 1) e++;
        d += `M${x + g} ${y + g}h${e - x}v1h-${e - x}z`;
        x = e;
      } else x++;
    }
  }
  const px = w * s;
  return new TextEncoder().encode(
    `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 ${w} ${w}" width="${px}" height="${px}" shape-rendering="crispEdges"><rect width="${w}" height="${w}" fill="#ffffff"/><path d="${d}" fill="#000000"/></svg>\n`,
  );
}

function textArt(
  text: string,
  level: string,
  _scale: number | bigint,
  margin: number | bigint,
  ctx: PrimitiveContext,
): Uint8Array {
  const { g } = checkLayout(1, margin);
  const q = encodeQr(text, level);
  const w = q.size + 2 * g;
  if (w * w * 6 > ctx.limits.maxValueBytes)
    throw limitFailure("maxValueBytes", ctx.limits.maxValueBytes, w * w * 6, "QR text");
  const lines: string[] = [];
  for (let y = -g; y < q.size + g; y++) {
    let line = "";
    for (let x = -g; x < q.size + g; x++) {
      const dark = x >= 0 && y >= 0 && x < q.size && y < q.size && q.modules[y * q.size + x] === 1;
      line += dark ? "██" : "  ";
    }
    lines.push(line);
  }
  return new TextEncoder().encode(`${lines.join("\n")}\n`);
}

function scanlines(
  text: string,
  level: string,
  scale: number | bigint,
  margin: number | bigint,
  ctx: PrimitiveContext,
): [Uint8Array, number, number] {
  const { s, g } = checkLayout(scale, margin);
  const q = encodeQr(text, level);
  const px = (q.size + 2 * g) * s;
  const rowBytes = 1 + Math.ceil(px / 8);
  if (rowBytes * px > ctx.limits.maxValueBytes)
    throw limitFailure("maxValueBytes", ctx.limits.maxValueBytes, rowBytes * px, "QR image");
  const out = new Uint8Array(rowBytes * px).fill(0xff);
  for (let y = 0; y < px; y++) {
    out[y * rowBytes] = 0;
    const my = Math.floor(y / s) - g;
    if (my < 0 || my >= q.size) continue;
    for (let x = 0; x < px; x++) {
      const mx = Math.floor(x / s) - g;
      if (mx >= 0 && mx < q.size && q.modules[my * q.size + mx] === 1) {
        const at = y * rowBytes + 1 + (x >> 3);
        out[at] = (out[at] as number) & ~(0x80 >> (x & 7));
      }
    }
    // the bits past the right edge are padding: leave them white (1)
  }
  return [out, px, px];
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("qr", "_svg", "( text:str level:str scale:int margin:int -- bytes )", svg, {
    doc: "The QR Code of the text as an SVG document (private helper of qr:generate).",
    category: "Data format",
  }),
  definePrimitive("qr", "_text", "( text:str level:str scale:int margin:int -- bytes )", textArt, {
    doc: "The QR Code of the text as lines of block characters (private helper of qr:generate).",
    category: "Data format",
  }),
  definePrimitive(
    "qr",
    "_scanlines",
    "( text:str level:str scale:int margin:int -- bytes width:int height:int )",
    scanlines,
    {
      doc: "The 1-bit greyscale scanlines of the QR Code of the text, for the PNG writer (private helper of qr:generate).",
      category: "Data format",
    },
  ),
];
