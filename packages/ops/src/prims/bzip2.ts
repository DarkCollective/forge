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
 * bzip2 primitives, written from the file format (no library). The format: a stream header "BZh" and
 * a block size digit 1 to 9 (hundreds of kilobytes); blocks that start with the 48-bit magic
 * 0x314159265359, carry the bzip2 CRC-32 (MSB first, polynomial 0x04C11DB7), the randomised bit, the
 * origPtr of the Burrows-Wheeler transform, the symbol map, up to 6 Huffman tables with 50-symbol
 * groups chosen by MTF-coded selectors, delta-coded code lengths, and the MTF / zero-run (RUNA, RUNB)
 * coded symbols of the last BWT column; the input first goes through a run-length step (four equal
 * bytes and a count of 0 to 251 more). The stream ends with the magic 0x177245385090 and the
 * combined CRC. Two private primitives, because the bit-level loops are far too slow in FL:
 *
 *  - `_compress ( data level -- bytes )`: level 1 to 9 is the block size (level * 100,000 bytes).
 *  - `_decompress ( data verify -- bytes )`: one or more concatenated streams; stops at the value
 *    limit (the wave 6 output rule), never trusting the data beyond 100,000 * level per block.
 *
 * The randomised-block table (512 numbers) is a constant of the format; it comes from bzip2/libbzip2
 * 1.0.8 (rNums in randtable.c; see NOTICE) and is used only to decode the deprecated randomised blocks.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef } from "@forge/lang";
import {
  BoundedOutput,
  bombFailure,
  coerceFailure,
  guardResult,
  rangeFailure,
} from "../prim-util.js";
import { msbTable } from "./crc.js";

/** The numbers that say where a randomised block flips the low bit of a byte (a constant of the format). */
const R_NUMS: readonly number[] = [
  619, 720, 127, 481, 931, 816, 813, 233, 566, 247, 985, 724, 205, 454, 863, 491, 741, 242, 949,
  214, 733, 859, 335, 708, 621, 574, 73, 654, 730, 472, 419, 436, 278, 496, 867, 210, 399, 680, 480,
  51, 878, 465, 811, 169, 869, 675, 611, 697, 867, 561, 862, 687, 507, 283, 482, 129, 807, 591, 733,
  623, 150, 238, 59, 379, 684, 877, 625, 169, 643, 105, 170, 607, 520, 932, 727, 476, 693, 425, 174,
  647, 73, 122, 335, 530, 442, 853, 695, 249, 445, 515, 909, 545, 703, 919, 874, 474, 882, 500, 594,
  612, 641, 801, 220, 162, 819, 984, 589, 513, 495, 799, 161, 604, 958, 533, 221, 400, 386, 867,
  600, 782, 382, 596, 414, 171, 516, 375, 682, 485, 911, 276, 98, 553, 163, 354, 666, 933, 424, 341,
  533, 870, 227, 730, 475, 186, 263, 647, 537, 686, 600, 224, 469, 68, 770, 919, 190, 373, 294, 822,
  808, 206, 184, 943, 795, 384, 383, 461, 404, 758, 839, 887, 715, 67, 618, 276, 204, 918, 873, 777,
  604, 560, 951, 160, 578, 722, 79, 804, 96, 409, 713, 940, 652, 934, 970, 447, 318, 353, 859, 672,
  112, 785, 645, 863, 803, 350, 139, 93, 354, 99, 820, 908, 609, 772, 154, 274, 580, 184, 79, 626,
  630, 742, 653, 282, 762, 623, 680, 81, 927, 626, 789, 125, 411, 521, 938, 300, 821, 78, 343, 175,
  128, 250, 170, 774, 972, 275, 999, 639, 495, 78, 352, 126, 857, 956, 358, 619, 580, 124, 737, 594,
  701, 612, 669, 112, 134, 694, 363, 992, 809, 743, 168, 974, 944, 375, 748, 52, 600, 747, 642, 182,
  862, 81, 344, 805, 988, 739, 511, 655, 814, 334, 249, 515, 897, 955, 664, 981, 649, 113, 974, 459,
  893, 228, 433, 837, 553, 268, 926, 240, 102, 654, 459, 51, 686, 754, 806, 760, 493, 403, 415, 394,
  687, 700, 946, 670, 656, 610, 738, 392, 760, 799, 887, 653, 978, 321, 576, 617, 626, 502, 894,
  679, 243, 440, 680, 879, 194, 572, 640, 724, 926, 56, 204, 700, 707, 151, 457, 449, 797, 195, 791,
  558, 945, 679, 297, 59, 87, 824, 713, 663, 412, 693, 342, 606, 134, 108, 571, 364, 631, 212, 174,
  643, 304, 329, 343, 97, 430, 751, 497, 314, 983, 374, 822, 928, 140, 206, 73, 263, 980, 736, 876,
  478, 430, 305, 170, 514, 364, 692, 829, 82, 855, 953, 676, 246, 369, 970, 294, 750, 807, 827, 150,
  790, 288, 923, 804, 378, 215, 828, 592, 281, 565, 555, 710, 82, 896, 831, 547, 261, 524, 462, 293,
  465, 502, 56, 661, 821, 976, 991, 658, 869, 905, 758, 745, 193, 768, 550, 608, 933, 378, 286, 215,
  979, 792, 961, 61, 688, 793, 644, 986, 403, 106, 366, 905, 644, 372, 567, 466, 434, 645, 210, 389,
  550, 919, 135, 780, 773, 635, 389, 707, 100, 626, 958, 165, 504, 920, 176, 193, 713, 857, 265,
  203, 50, 668, 108, 645, 990, 626, 197, 510, 357, 358, 850, 858, 364, 936, 638,
];

const MAX_CODE_LEN = 20;
const ENCODE_MAX_LEN = 17;
const GROUP_SIZE = 50;
const MAX_SELECTORS = 18002;

function corrupt(reason: string) {
  return coerceFailure("bzip2 data", "bytes", reason);
}

// ---- CRC-32, MSB first ----

const CRC_TABLE = msbTable(32, 0x04c11db7);

function crcByte(crc: number, b: number): number {
  return ((crc << 8) ^ (CRC_TABLE[((crc >>> 24) ^ b) & 0xff] as number)) >>> 0;
}

// ---- decompression ----

class BitReader {
  pos: number;
  private acc = 0;
  private have = 0;
  constructor(
    private readonly data: Uint8Array,
    start: number,
  ) {
    this.pos = start;
  }
  /** The next n bits (1 to 24), most significant first. */
  get(n: number): number {
    while (this.have < n) {
      if (this.pos >= this.data.length)
        throw corrupt("unexpected EOF: the data ends before the end of the stream (truncated)");
      this.acc = ((this.acc << 8) | (this.data[this.pos++] as number)) >>> 0;
      this.have += 8;
    }
    this.have -= n;
    const v = (this.acc >>> this.have) & ((1 << n) - 1);
    this.acc &= (1 << this.have) - 1;
    return v;
  }
  get32(): number {
    const hi = this.get(16);
    return ((hi << 16) | this.get(16)) >>> 0;
  }
}

interface DecodeTable {
  minLen: number;
  maxLen: number;
  limit: Int32Array;
  base: Int32Array;
  perm: Uint16Array;
}

function makeDecodeTable(lens: Uint8Array, alphaSize: number): DecodeTable {
  let minLen = 32;
  let maxLen = 0;
  for (let i = 0; i < alphaSize; i++) {
    const l = lens[i] as number;
    if (l > maxLen) maxLen = l;
    if (l < minLen) minLen = l;
  }
  const perm = new Uint16Array(alphaSize);
  let pp = 0;
  for (let i = minLen; i <= maxLen; i++)
    for (let j = 0; j < alphaSize; j++) if (lens[j] === i) perm[pp++] = j;
  const base = new Int32Array(MAX_CODE_LEN + 2);
  for (let i = 0; i < alphaSize; i++) base[(lens[i] as number) + 1]!++;
  for (let i = 1; i < base.length; i++) base[i] = (base[i] as number) + (base[i - 1] as number);
  const limit = new Int32Array(MAX_CODE_LEN + 2);
  let vec = 0;
  for (let i = minLen; i <= maxLen; i++) {
    vec += (base[i + 1] as number) - (base[i] as number);
    limit[i] = vec - 1;
    vec <<= 1;
  }
  for (let i = minLen + 1; i <= maxLen; i++)
    base[i] = (((limit[i - 1] as number) + 1) << 1) - (base[i] as number);
  return { minLen, maxLen, limit, base, perm };
}

/** Collects the decompressed bytes in chunks, counting them as they are produced (the bomb rule). */
class Sink {
  private buf = new Uint8Array(1 << 18);
  private fill = 0;
  private produced = 0;
  constructor(
    private readonly out: BoundedOutput,
    private readonly max: number,
  ) {}
  /** `count` copies of byte `b`, checked against the limit before anything is written. */
  put(b: number, count: number): void {
    if (this.produced + count > this.max) throw bombFailure(this.max, this.produced + count);
    this.produced += count;
    while (count > 0) {
      if (this.fill === this.buf.length) this.flush();
      const n = Math.min(count, this.buf.length - this.fill);
      this.buf.fill(b, this.fill, this.fill + n);
      this.fill += n;
      count -= n;
    }
  }
  private flush(): void {
    this.out.push(this.buf.subarray(0, this.fill));
    this.buf = new Uint8Array(1 << 18);
    this.fill = 0;
  }
  finish(): Uint8Array {
    if (this.fill > 0) this.out.push(this.buf.subarray(0, this.fill));
    this.fill = 0;
    return this.out.finish();
  }
}

/** Decodes one block's Huffman and MTF layers into `tt` (low 8 bits of each entry); gives the length. */
function readBlockSymbols(br: BitReader, tt: Uint32Array, counts: Int32Array): number {
  const limitBlock = tt.length;
  const used16 = br.get(16);
  const seqToUnseq: number[] = [];
  for (let i = 0; i < 16; i++) {
    if (used16 & (0x8000 >> i)) {
      const bits = br.get(16);
      for (let j = 0; j < 16; j++) if (bits & (0x8000 >> j)) seqToUnseq.push(i * 16 + j);
    }
  }
  const nInUse = seqToUnseq.length;
  if (nInUse === 0) throw corrupt("invalid block: the symbol map is empty");
  const alphaSize = nInUse + 2;
  const nGroups = br.get(3);
  if (nGroups < 2 || nGroups > 6)
    throw corrupt(`invalid block: ${nGroups} Huffman tables (2 to 6 allowed)`);
  const nSelectorsRaw = br.get(15);
  if (nSelectorsRaw < 1) throw corrupt("invalid block: no selectors");
  const nSelectors = Math.min(nSelectorsRaw, MAX_SELECTORS);
  const selMtf = new Uint8Array(nSelectors);
  for (let i = 0; i < nSelectorsRaw; i++) {
    let j = 0;
    while (br.get(1) === 1) {
      j++;
      if (j >= nGroups) throw corrupt("invalid block: a selector is out of range");
    }
    if (i < MAX_SELECTORS) selMtf[i] = j;
  }
  const order = [0, 1, 2, 3, 4, 5].slice(0, nGroups);
  const selector = new Uint8Array(nSelectors);
  for (let i = 0; i < nSelectors; i++) {
    const v = order.splice(selMtf[i] as number, 1)[0] as number;
    order.unshift(v);
    selector[i] = v;
  }
  const tables: DecodeTable[] = [];
  for (let t = 0; t < nGroups; t++) {
    const lens = new Uint8Array(alphaSize);
    let curr = br.get(5);
    for (let i = 0; i < alphaSize; i++) {
      for (;;) {
        if (curr < 1 || curr > MAX_CODE_LEN)
          throw corrupt("invalid block: a Huffman code length is out of range");
        if (br.get(1) === 0) break;
        if (br.get(1) === 0) curr++;
        else curr--;
      }
      lens[i] = curr;
    }
    tables.push(makeDecodeTable(lens, alphaSize));
  }

  const eob = nInUse + 1;
  const mtf = Uint8Array.from(seqToUnseq);
  let groupNo = -1;
  let groupPos = 0;
  let table = tables[0] as DecodeTable;
  const next = (): number => {
    if (groupPos === 0) {
      groupNo++;
      if (groupNo >= nSelectors) throw corrupt("invalid block: the symbols run past the selectors");
      groupPos = GROUP_SIZE;
      table = tables[selector[groupNo] as number] as DecodeTable;
    }
    groupPos--;
    let zn = table.minLen;
    let zvec = br.get(zn);
    while (zvec > (table.limit[zn] as number)) {
      zn++;
      if (zn > table.maxLen) throw corrupt("invalid block: an invalid Huffman code");
      zvec = (zvec << 1) | br.get(1);
    }
    const idx = zvec - (table.base[zn] as number);
    if (idx < 0 || idx >= alphaSize) throw corrupt("invalid block: an invalid Huffman code");
    return table.perm[idx] as number;
  };

  let nblock = 0;
  let sym = next();
  while (sym !== eob) {
    if (sym <= 1) {
      let es = 0;
      let n = 1;
      while (sym <= 1) {
        es += (sym + 1) * n;
        n <<= 1;
        if (es > limitBlock) throw corrupt("invalid block: a run is longer than the block size");
        sym = next();
      }
      if (nblock + es > limitBlock)
        throw corrupt("invalid block: more symbols than the block size allows");
      const uc = mtf[0] as number;
      counts[uc] = (counts[uc] as number) + es;
      tt.fill(uc, nblock, nblock + es);
      nblock += es;
      continue;
    }
    if (nblock >= limitBlock)
      throw corrupt("invalid block: more symbols than the block size allows");
    const idx = sym - 1;
    const uc = mtf[idx] as number;
    for (let k = idx; k > 0; k--) mtf[k] = mtf[k - 1] as number;
    mtf[0] = uc;
    counts[uc] = (counts[uc] as number) + 1;
    tt[nblock++] = uc;
    sym = next();
  }
  return nblock;
}

/** Inverse BWT and the run-length step of one block, written to the sink; gives the block's CRC. */
function emitBlock(
  tt: Uint32Array,
  nblock: number,
  origPtr: number,
  counts: Int32Array,
  randomised: boolean,
  sink: Sink,
): number {
  const cf = new Int32Array(256);
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    cf[i] = sum;
    sum += counts[i] as number;
  }
  for (let i = 0; i < nblock; i++) {
    const uc = (tt[i] as number) & 0xff;
    const at = cf[uc] as number;
    cf[uc] = at + 1;
    tt[at] = (tt[at] as number) | (i << 8);
  }
  let tPos = (tt[origPtr] as number) >>> 8;
  let crc = 0xffffffff;
  let prev = -1;
  let run = 0;
  let rToGo = 0;
  let rPos = 0;
  for (let i = 0; i < nblock; i++) {
    tPos = tt[tPos] as number;
    let c = tPos & 0xff;
    tPos >>>= 8;
    if (randomised) {
      if (rToGo === 0) {
        rToGo = R_NUMS[rPos] as number;
        rPos = (rPos + 1) & 511;
      }
      rToGo--;
      if (rToGo === 1) c ^= 1;
    }
    if (run === 4) {
      if (c > 0) {
        sink.put(prev, c);
        for (let k = 0; k < c; k++) crc = crcByte(crc, prev);
      }
      run = 0;
      continue;
    }
    if (c === prev) run++;
    else {
      prev = c;
      run = 1;
    }
    sink.put(c, 1);
    crc = crcByte(crc, c);
  }
  return ~crc >>> 0;
}

/** One stream starting at `start`; gives the offset after it (its padding bits included). */
function decodeStream(data: Uint8Array, start: number, sink: Sink, verify: boolean): number {
  const br = new BitReader(data, start);
  if (br.get(8) !== 0x42 || br.get(8) !== 0x5a || br.get(8) !== 0x68)
    throw corrupt("not bzip2 data: the magic number BZh is missing");
  const digit = br.get(8) - 0x30;
  if (digit < 1 || digit > 9) throw corrupt("not bzip2 data: the block size digit is not 1 to 9");
  const tt = new Uint32Array(digit * 100_000);
  const counts = new Int32Array(256);
  let combined = 0;
  for (;;) {
    const hi = br.get(24);
    const lo = br.get(24);
    if (hi === 0x177245 && lo === 0x385090) {
      const stored = br.get32();
      if (verify && stored !== combined)
        throw corrupt(
          "bzip2 checksum mismatch: the combined CRC differs from the trailer (corrupt data)",
        );
      return br.pos;
    }
    if (hi !== 0x314159 || lo !== 0x265359)
      throw corrupt("invalid block header: neither the block magic nor the end-of-stream magic");
    const blockCrc = br.get32();
    const randomised = br.get(1) === 1;
    const origPtr = br.get(24);
    counts.fill(0);
    tt.fill(0);
    const nblock = readBlockSymbols(br, tt, counts);
    if (nblock === 0 || origPtr >= nblock)
      throw corrupt("invalid block: the origin pointer is outside the block");
    const crc = emitBlock(tt, nblock, origPtr, counts, randomised, sink);
    if (verify && crc !== blockCrc)
      throw corrupt(
        "bzip2 checksum mismatch: the block CRC differs from the stored one (corrupt data)",
      );
    combined = (((combined << 1) | (combined >>> 31)) ^ (verify ? blockCrc : crc)) >>> 0;
  }
}

function startsStream(data: Uint8Array, p: number): boolean {
  return (
    p + 4 <= data.length &&
    data[p] === 0x42 &&
    data[p + 1] === 0x5a &&
    data[p + 2] === 0x68 &&
    (data[p + 3] as number) >= 0x31 &&
    (data[p + 3] as number) <= 0x39
  );
}

/**
 * Decompresses every concatenated bzip2 stream at the start of `data`; bytes after the last stream
 * that do not begin another one are ignored (as `bzip2 -d` and Python's `bz2` do). Stops with
 * `E_LIMIT_VALUE` as soon as the output would pass `maxOut`.
 */
export function bunzip2(data: Uint8Array, maxOut: number, verify = true): Uint8Array {
  const sink = new Sink(new BoundedOutput(maxOut), maxOut);
  let pos = decodeStream(data, 0, sink, verify);
  while (startsStream(data, pos)) pos = decodeStream(data, pos, sink, verify);
  return sink.finish();
}

// ---- compression ----

class BitWriter {
  private buf = new Uint8Array(1 << 16);
  private len = 0;
  private acc = 0;
  private nacc = 0;
  /** n bits (0 to 24) of v, most significant first. */
  put(n: number, v: number): void {
    this.acc = (this.acc << n) | (v & ((1 << n) - 1));
    this.nacc += n;
    while (this.nacc >= 8) {
      this.nacc -= 8;
      this.byte((this.acc >>> this.nacc) & 0xff);
    }
    this.acc &= (1 << this.nacc) - 1;
  }
  put32(v: number): void {
    this.put(16, v >>> 16);
    this.put(16, v & 0xffff);
  }
  private byte(b: number): void {
    if (this.len === this.buf.length) {
      const bigger = new Uint8Array(this.buf.length * 2);
      bigger.set(this.buf);
      this.buf = bigger;
    }
    this.buf[this.len++] = b;
  }
  finish(): Uint8Array {
    if (this.nacc > 0) this.put(8 - this.nacc, 0);
    return this.buf.slice(0, this.len);
  }
}

/**
 * The cyclic rotations of `s` in sorted order, by prefix doubling with counting sorts: O(n log n),
 * and a periodic input (all zeros) stops as soon as the partition stops changing. Equal rotations
 * come in any order, which is harmless: they give the same last column.
 */
function sortRotations(s: Uint8Array, n: number): Int32Array {
  const sa = new Int32Array(n);
  const sa2 = new Int32Array(n);
  let rank = new Int32Array(n);
  let tmp = new Int32Array(n);
  const cnt = new Int32Array(Math.max(256, n) + 2);
  const seen = new Uint8Array(256);
  for (let i = 0; i < n; i++) seen[s[i] as number] = 1;
  const classOf = new Int32Array(256);
  let classes = 0;
  for (let c = 0; c < 256; c++) if (seen[c]) classOf[c] = classes++;
  for (let i = 0; i < n; i++) rank[i] = classOf[s[i] as number] as number;
  // `cnt[c]` becomes where class c starts in the sorted order
  const starts = (): void => {
    cnt.fill(0, 0, classes + 1);
    for (let i = 0; i < n; i++) cnt[(rank[i] as number) + 1]!++;
    for (let c = 1; c <= classes; c++) cnt[c] = (cnt[c] as number) + (cnt[c - 1] as number);
  };
  starts();
  for (let i = 0; i < n; i++) sa[cnt[rank[i] as number]!++] = i;
  for (let k = 1; k < n && classes < n; k <<= 1) {
    for (let i = 0; i < n; i++) {
      const p = sa[i] as number;
      sa2[i] = p >= k ? p - k : p - k + n;
    }
    starts();
    for (let i = 0; i < n; i++) {
      const q = sa2[i] as number;
      sa[cnt[rank[q] as number]!++] = q;
    }
    let c = 0;
    tmp[sa[0] as number] = 0;
    for (let i = 1; i < n; i++) {
      const a = sa[i - 1] as number;
      const b = sa[i] as number;
      const a2 = a + k >= n ? a + k - n : a + k;
      const b2 = b + k >= n ? b + k - n : b + k;
      if (rank[a] !== rank[b] || rank[a2] !== rank[b2]) c++;
      tmp[b] = c;
    }
    const swap = rank;
    rank = tmp;
    tmp = swap;
    if (c + 1 === classes) break;
    classes = c + 1;
  }
  return sa;
}

/** Code lengths of a Huffman code for the weights, none longer than `maxLen` (weights halved until they fit). */
function codeLengths(freq: ArrayLike<number>, alphaSize: number, maxLen: number): Uint8Array {
  let w: number[] = Array.from({ length: alphaSize }, (_, i) => Math.max(freq[i] as number, 1));
  for (;;) {
    const leaves = Array.from({ length: alphaSize }, (_, i) => i).sort(
      (a, b) => (w[a] as number) - (w[b] as number) || a - b,
    );
    const total = 2 * alphaSize - 1;
    const weight = new Float64Array(total);
    const parent = new Int32Array(total).fill(-1);
    // node ids: leaves 0..alphaSize-1 in sorted order, internal nodes after them in creation order
    for (let i = 0; i < alphaSize; i++) weight[i] = w[leaves[i] as number] as number;
    let li = 0;
    let ii = alphaSize;
    let made = alphaSize;
    const pick = (): number => {
      if (li < alphaSize && (ii >= made || (weight[li] as number) <= (weight[ii] as number)))
        return li++;
      return ii++;
    };
    while (made < total) {
      const a = pick();
      const b = pick();
      weight[made] = (weight[a] as number) + (weight[b] as number);
      parent[a] = made;
      parent[b] = made;
      made++;
    }
    const depth = new Uint8Array(total);
    let max = 0;
    for (let i = total - 2; i >= 0; i--) {
      depth[i] = (depth[parent[i] as number] as number) + 1;
      if (i < alphaSize && (depth[i] as number) > max) max = depth[i] as number;
    }
    if (max <= maxLen) {
      const lens = new Uint8Array(alphaSize);
      for (let i = 0; i < alphaSize; i++) lens[leaves[i] as number] = depth[i] as number;
      return lens;
    }
    w = w.map((x) => 1 + (x >> 1));
  }
}

function writeBlock(
  bw: BitWriter,
  blk: Uint8Array,
  n: number,
  blockCrc: number,
  randomised: boolean,
): void {
  const sa = sortRotations(blk, n);
  const last = new Uint8Array(n);
  let origPtr = 0;
  for (let i = 0; i < n; i++) {
    const p = sa[i] as number;
    if (p === 0) origPtr = i;
    last[i] = blk[p === 0 ? n - 1 : p - 1] as number;
  }
  // symbol map
  const inUse = new Uint8Array(256);
  for (let i = 0; i < n; i++) inUse[last[i] as number] = 1;
  const unseqToSeq = new Int32Array(256);
  let nInUse = 0;
  for (let i = 0; i < 256; i++) if (inUse[i]) unseqToSeq[i] = nInUse++;
  const alphaSize = nInUse + 2;
  const eob = nInUse + 1;
  // MTF and zero runs
  const syms = new Uint16Array(n + 1);
  const freq = new Int32Array(alphaSize);
  let nMtf = 0;
  const yy = new Uint8Array(nInUse);
  for (let i = 0; i < nInUse; i++) yy[i] = i;
  let zPend = 0;
  const flushRun = (): void => {
    if (zPend === 0) return;
    zPend--;
    for (;;) {
      const s = zPend & 1;
      syms[nMtf++] = s;
      freq[s]!++;
      if (zPend < 2) break;
      zPend = (zPend - 2) >> 1;
    }
    zPend = 0;
  };
  for (let i = 0; i < n; i++) {
    const j = unseqToSeq[last[i] as number] as number;
    if (yy[0] === j) {
      zPend++;
      continue;
    }
    flushRun();
    let k = 1;
    let t = yy[0] as number;
    for (;;) {
      const u = yy[k] as number;
      yy[k] = t;
      if (u === j) break;
      t = u;
      k++;
    }
    yy[0] = j;
    syms[nMtf++] = k + 1;
    freq[k + 1]!++;
  }
  flushRun();
  syms[nMtf++] = eob;
  freq[eob]!++;

  // Huffman tables and selectors, refined in four rounds as bzip2 does
  const nGroups = nMtf < 200 ? 2 : nMtf < 600 ? 3 : nMtf < 1200 ? 4 : nMtf < 2400 ? 5 : 6;
  const lens: Uint8Array[] = Array.from({ length: nGroups }, () => new Uint8Array(alphaSize));
  {
    let remF = nMtf;
    let gs = 0;
    for (let nPart = nGroups; nPart > 0; nPart--) {
      const tFreq = Math.floor(remF / nPart);
      let ge = gs - 1;
      let aFreq = 0;
      while (aFreq < tFreq && ge < alphaSize - 1) {
        ge++;
        aFreq += freq[ge] as number;
      }
      if (ge > gs && nPart !== nGroups && nPart !== 1 && (nGroups - nPart) % 2 === 1) {
        aFreq -= freq[ge] as number;
        ge--;
      }
      const l = lens[nPart - 1] as Uint8Array;
      for (let v = 0; v < alphaSize; v++) l[v] = v >= gs && v <= ge ? 1 : 15;
      remF -= aFreq;
      gs = ge + 1;
    }
  }
  const nSel = Math.ceil(nMtf / GROUP_SIZE);
  const selector = new Uint8Array(nSel);
  for (let iter = 0; iter < 4; iter++) {
    const rfreq = Array.from({ length: nGroups }, () => new Int32Array(alphaSize));
    for (let g = 0; g < nSel; g++) {
      const from = g * GROUP_SIZE;
      const to = Math.min(nMtf, from + GROUP_SIZE);
      let best = 0;
      let bestCost = Infinity;
      for (let t = 0; t < nGroups; t++) {
        const l = lens[t] as Uint8Array;
        let cost = 0;
        for (let i = from; i < to; i++) cost += l[syms[i] as number] as number;
        if (cost < bestCost) {
          bestCost = cost;
          best = t;
        }
      }
      selector[g] = best;
      const rf = rfreq[best] as Int32Array;
      for (let i = from; i < to; i++) rf[syms[i] as number]!++;
    }
    for (let t = 0; t < nGroups; t++)
      lens[t] = codeLengths(rfreq[t] as Int32Array, alphaSize, ENCODE_MAX_LEN);
  }
  // canonical codes, as bzip2 assigns them: by length, then by symbol
  const codes = lens.map((l) => {
    const code = new Int32Array(alphaSize);
    let minL = 32;
    let maxL = 0;
    for (let i = 0; i < alphaSize; i++) {
      if ((l[i] as number) > maxL) maxL = l[i] as number;
      if ((l[i] as number) < minL) minL = l[i] as number;
    }
    let vec = 0;
    for (let len = minL; len <= maxL; len++) {
      for (let i = 0; i < alphaSize; i++) if (l[i] === len) code[i] = vec++;
      vec <<= 1;
    }
    return code;
  });

  bw.put(24, 0x314159);
  bw.put(24, 0x265359);
  bw.put32(blockCrc);
  bw.put(1, randomised ? 1 : 0);
  bw.put(24, origPtr);
  let used16 = 0;
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 16; j++) if (inUse[i * 16 + j]) used16 |= 0x8000 >> i;
  }
  bw.put(16, used16);
  for (let i = 0; i < 16; i++) {
    if (!(used16 & (0x8000 >> i))) continue;
    let bits = 0;
    for (let j = 0; j < 16; j++) if (inUse[i * 16 + j]) bits |= 0x8000 >> j;
    bw.put(16, bits);
  }
  bw.put(3, nGroups);
  bw.put(15, nSel);
  const order = [0, 1, 2, 3, 4, 5].slice(0, nGroups);
  for (let g = 0; g < nSel; g++) {
    const at = order.indexOf(selector[g] as number);
    order.splice(at, 1);
    order.unshift(selector[g] as number);
    for (let k = 0; k < at; k++) bw.put(1, 1);
    bw.put(1, 0);
  }
  for (let t = 0; t < nGroups; t++) {
    const l = lens[t] as Uint8Array;
    let curr = l[0] as number;
    bw.put(5, curr);
    for (let i = 0; i < alphaSize; i++) {
      while (curr < (l[i] as number)) {
        bw.put(2, 2);
        curr++;
      }
      while (curr > (l[i] as number)) {
        bw.put(2, 3);
        curr--;
      }
      bw.put(1, 0);
    }
  }
  for (let g = 0; g < nSel; g++) {
    const t = selector[g] as number;
    const l = lens[t] as Uint8Array;
    const c = codes[t] as Int32Array;
    const to = Math.min(nMtf, (g + 1) * GROUP_SIZE);
    for (let i = g * GROUP_SIZE; i < to; i++) {
      const s = syms[i] as number;
      bw.put(l[s] as number, c[s] as number);
    }
  }
}

/** The mask of a randomised block, applied to the sequence the BWT sees (test use only). */
function randomiseBlock(blk: Uint8Array, n: number): void {
  let toGo = 0;
  let pos = 0;
  for (let i = 0; i < n; i++) {
    if (toGo === 0) {
      toGo = R_NUMS[pos] as number;
      pos = (pos + 1) & 511;
    }
    toGo--;
    if (toGo === 1) blk[i] = (blk[i] as number) ^ 1;
  }
}

/**
 * A bzip2 stream of `data`; `level` 1 to 9 is the block size in hundreds of kilobytes. `randomise`
 * writes the deprecated randomised-block form (it exists to test the decoder against `bzip2 -d`).
 */
export function bzip2Compress(data: Uint8Array, level: number, randomise = false): Uint8Array {
  if (!Number.isInteger(level) || level < 1 || level > 9)
    throw rangeFailure(`the block size must be 1 to 9, not ${String(level)}`);
  const bw = new BitWriter();
  bw.put(8, 0x42);
  bw.put(8, 0x5a);
  bw.put(8, 0x68);
  bw.put(8, 0x30 + level);
  const nMax = 100_000 * level - 19;
  const blk = new Uint8Array(100_000 * level + 8);
  let combined = 0;
  let i = 0;
  while (i < data.length) {
    let n = 0;
    let crc = 0xffffffff;
    while (i < data.length && n < nMax) {
      const ch = data[i] as number;
      let len = 1;
      while (len < 255 && i + len < data.length && data[i + len] === ch) len++;
      i += len;
      for (let k = 0; k < len; k++) crc = crcByte(crc, ch);
      if (len < 4) for (let k = 0; k < len; k++) blk[n++] = ch;
      else {
        blk[n++] = ch;
        blk[n++] = ch;
        blk[n++] = ch;
        blk[n++] = ch;
        blk[n++] = len - 4;
      }
    }
    crc = ~crc >>> 0;
    combined = (((combined << 1) | (combined >>> 31)) ^ crc) >>> 0;
    if (randomise) randomiseBlock(blk, n);
    writeBlock(bw, blk, n, crc, randomise);
  }
  bw.put(24, 0x177245);
  bw.put(24, 0x385090);
  bw.put32(combined);
  return bw.finish();
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "bzip2",
    "_compress",
    "( data:bytes level:int -- bytes )",
    (data: Uint8Array, level: number | bigint, ctx: PrimitiveContext) => {
      const out = bzip2Compress(data, Number(level));
      guardResult(ctx, out.length, "bzip2 data");
      return out;
    },
    {
      doc: "A bzip2 stream of the bytes; level 1 to 9 is the block size in hundreds of kilobytes (private helper of bzip2:compress).",
      category: "Compression",
    },
  ),
  definePrimitive(
    "bzip2",
    "_decompress",
    "( data:bytes verify:bool -- bytes )",
    (data: Uint8Array, verify: boolean, ctx: PrimitiveContext) =>
      bunzip2(data, ctx.limits.maxValueBytes, verify),
    {
      doc: "Decompress the bzip2 streams at the start of the bytes; with verify the block and stream CRCs must match. Stops at the value limit with E_LIMIT_VALUE (private helper of bzip2:decompress).",
      category: "Compression",
    },
  ),
];
