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
 * rc6 primitives: the RC6-w/r/b block cipher (R. Rivest, M. Robshaw, R. Sidney, Y. Yin, "The RC6 Block
 * Cipher", v1.1, 1998), written from the paper. The block is four w-bit little-endian words (4 * w / 8
 * bytes), r rounds, a key of b = 0 to 255 bytes. The AES submission is RC6-32/20/b. The magic
 * constants are computed from their definition, P_w = Odd((e - 2) 2^w) and Q_w = Odd((phi - 1) 2^w),
 * with e and the golden ratio phi evaluated in fixed-point BigInt arithmetic (for the nearest odd
 * integer to a fractional value the integer part made odd is the same, so the truncated value is
 * OR-ed with 1).
 *
 * The word size follows CyberChef: any multiple of 8 from 8 to 256, with the data-dependent rotations
 * taking the low floor(log2 w) bits of the amount (and that modulo w, which matters only when w is not
 * a power of two). w = 32 has a fast path on 32-bit integers; every other size runs on BigInt, and the
 * tests hold the two equal at w = 32.
 *
 *  - `_check-key`: the key is at most 255 bytes, w is a multiple of 8 from 8 to 256 and r is 1 to 255
 *    (E_RANGE);
 *  - `_encrypt-block` and `_decrypt-block` `( block key w r -- bytes )`: one block of w / 2 bytes, the
 *    block functions of the shared `blockmode` layer. The key schedule of the last key is cached.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { checkBlock, keyCache, rotl32, rotr32 } from "../cipher-util.js";
import { rangeFailure } from "../prim-util.js";

const PREC = 320n;

function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt((n.toString(2).length + 1) >> 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

let consts: { e: bigint; phi: bigint } | undefined;

/** e and phi as fixed-point numbers with PREC fractional bits. */
function constants(): { e: bigint; phi: bigint } {
  if (consts) return consts;
  const one = 1n << PREC;
  let e = 0n;
  let term = one;
  for (let k = 1n; term !== 0n; k++) {
    e += term;
    term /= k;
  }
  const phi = (isqrt(5n << (2n * PREC)) + one) >> 1n;
  consts = { e, phi };
  return consts;
}

/** P_w and Q_w: the fraction bits of e - 2 and phi - 1, made odd. */
export function magic(w: number): { p: bigint; q: bigint } {
  const { e, phi } = constants();
  const one = 1n << PREC;
  const sh = PREC - BigInt(w);
  return { p: ((e - 2n * one) >> sh) | 1n, q: ((phi - one) >> sh) | 1n };
}

/** Rejects a key over 255 bytes, a word size that is not a multiple of 8 from 8 to 256, or rounds outside 1 to 255 (E_RANGE). */
export function checkKey(key: Uint8Array, w: number, r: number): void {
  if (key.length > 255)
    throw rangeFailure(`the RC6 key must be at most 255 bytes, not ${key.length}`, {
      length: key.length,
    });
  if (!Number.isInteger(w) || w < 8 || w > 256 || w % 8 !== 0)
    throw rangeFailure(`the RC6 word size must be a multiple of 8 from 8 to 256, not ${w}`, {
      wordSize: w,
    });
  if (!Number.isInteger(r) || r < 1 || r > 255)
    throw rangeFailure(`the RC6 rounds must be 1 to 255, not ${r}`, { rounds: r });
}

/** Rotation by an amount reduced to the low floor(log2 w) bits, then modulo w. */
function rotBig(x: bigint, n: bigint, w: number, lgw: number): bigint {
  const mask = (1n << BigInt(w)) - 1n;
  const s = BigInt(Number(n & ((1n << BigInt(lgw)) - 1n)) % w);
  return ((x << s) | (x >> (BigInt(w) - s))) & mask;
}

function rotRightBig(x: bigint, n: bigint, w: number, lgw: number): bigint {
  const mask = (1n << BigInt(w)) - 1n;
  const s = BigInt(Number(n & ((1n << BigInt(lgw)) - 1n)) % w);
  return ((x >> s) | (x << (BigInt(w) - s))) & mask;
}

/** The 2r + 4 round keys S of the key schedule (paper, section 3). */
export function rc6Schedule(key: Uint8Array, w: number, r: number): bigint[] {
  checkKey(key, w, r);
  const u = w / 8;
  const mask = (1n << BigInt(w)) - 1n;
  const lgw = Math.floor(Math.log2(w));
  const c = Math.max(1, Math.ceil(key.length / u));
  const l: bigint[] = Array.from({ length: c }, () => 0n);
  for (let i = 0; i < key.length; i++)
    l[Math.floor(i / u)]! |= BigInt(key[i]!) << BigInt(8 * (i % u));
  const t = 2 * r + 4;
  const { p, q } = magic(w);
  const s: bigint[] = [p & mask];
  for (let i = 1; i < t; i++) s.push((s[i - 1]! + q) & mask);
  let a = 0n;
  let b = 0n;
  let i = 0;
  let j = 0;
  for (let n = 0; n < 3 * Math.max(c, t); n++) {
    a = s[i] = rotBig((s[i]! + a + b) & mask, 3n, w, lgw);
    b = l[j] = rotBig((l[j]! + a + b) & mask, a + b, w, lgw);
    i = (i + 1) % t;
    j = (j + 1) % c;
  }
  return s;
}

interface Schedule {
  readonly w: number;
  readonly r: number;
  readonly big: bigint[];
  /** The round keys as 32-bit words when w is 32. */
  readonly s32: Uint32Array | undefined;
}

const schedule = keyCache((key: Uint8Array, w: number, r: number): Schedule => {
  const big = rc6Schedule(key, w, r);
  return { w, r, big, s32: w === 32 ? Uint32Array.from(big, (x) => Number(x)) : undefined };
});

function readWords(block: Uint8Array, w: number): bigint[] {
  const u = w / 8;
  return [0, 1, 2, 3].map((i) => {
    let x = 0n;
    for (let j = u - 1; j >= 0; j--) x = (x << 8n) | BigInt(block[i * u + j]!);
    return x;
  });
}

function writeWords(words: bigint[], w: number): Uint8Array {
  const u = w / 8;
  const out = new Uint8Array(4 * u);
  words.forEach((x, i) => {
    for (let j = 0; j < u; j++) out[i * u + j] = Number((x >> BigInt(8 * j)) & 255n);
  });
  return out;
}

/** Encrypts one block of w / 2 bytes on BigInt words (any word size). */
export function rc6EncryptBlockBig(
  block: Uint8Array,
  key: Uint8Array,
  w: number,
  r: number,
): Uint8Array {
  checkBlock(block, w / 2, "RC6");
  const { big: s } = schedule(key, w, r);
  const mask = (1n << BigInt(w)) - 1n;
  const lgw = Math.floor(Math.log2(w));
  const lg = BigInt(lgw);
  let [a, b, c, d] = readWords(block, w) as [bigint, bigint, bigint, bigint];
  b = (b + s[0]!) & mask;
  d = (d + s[1]!) & mask;
  for (let i = 1; i <= r; i++) {
    const t = rotBig((b * ((2n * b + 1n) & mask)) & mask, lg, w, lgw);
    const u = rotBig((d * ((2n * d + 1n) & mask)) & mask, lg, w, lgw);
    a = (rotBig(a ^ t, u, w, lgw) + s[2 * i]!) & mask;
    c = (rotBig(c ^ u, t, w, lgw) + s[2 * i + 1]!) & mask;
    [a, b, c, d] = [b, c, d, a];
  }
  a = (a + s[2 * r + 2]!) & mask;
  c = (c + s[2 * r + 3]!) & mask;
  return writeWords([a, b, c, d], w);
}

/** Decrypts one block of w / 2 bytes on BigInt words. */
export function rc6DecryptBlockBig(
  block: Uint8Array,
  key: Uint8Array,
  w: number,
  r: number,
): Uint8Array {
  checkBlock(block, w / 2, "RC6");
  const { big: s } = schedule(key, w, r);
  const mask = (1n << BigInt(w)) - 1n;
  const lgw = Math.floor(Math.log2(w));
  const lg = BigInt(lgw);
  let [a, b, c, d] = readWords(block, w) as [bigint, bigint, bigint, bigint];
  c = (c - s[2 * r + 3]!) & mask;
  a = (a - s[2 * r + 2]!) & mask;
  for (let i = r; i >= 1; i--) {
    [a, b, c, d] = [d, a, b, c];
    const u = rotBig((d * ((2n * d + 1n) & mask)) & mask, lg, w, lgw);
    const t = rotBig((b * ((2n * b + 1n) & mask)) & mask, lg, w, lgw);
    c = rotRightBig((c - s[2 * i + 1]!) & mask, t, w, lgw) ^ u;
    a = rotRightBig((a - s[2 * i]!) & mask, u, w, lgw) ^ t;
  }
  d = (d - s[1]!) & mask;
  b = (b - s[0]!) & mask;
  return writeWords([a, b, c, d], w);
}

function load32(b: Uint8Array, i: number): number {
  return ((b[i + 3]! << 24) | (b[i + 2]! << 16) | (b[i + 1]! << 8) | b[i]!) >>> 0;
}

function store32(b: Uint8Array, i: number, v: number): void {
  b[i] = v;
  b[i + 1] = v >>> 8;
  b[i + 2] = v >>> 16;
  b[i + 3] = v >>> 24;
}

/** Encrypts one block of w / 2 bytes (16 bytes for the standard w = 32, on 32-bit integers). */
export function rc6EncryptBlock(
  block: Uint8Array,
  key: Uint8Array,
  w: number,
  r: number,
): Uint8Array {
  const sc = schedule(key, w, r);
  const s = sc.s32;
  if (!s) return rc6EncryptBlockBig(block, key, w, r);
  checkBlock(block, 16, "RC6");
  let a = load32(block, 0);
  let b = (load32(block, 4) + s[0]!) >>> 0;
  let c = load32(block, 8);
  let d = (load32(block, 12) + s[1]!) >>> 0;
  for (let i = 1; i <= r; i++) {
    const t = rotl32(Math.imul(b, (2 * b + 1) | 0) >>> 0, 5);
    const u = rotl32(Math.imul(d, (2 * d + 1) | 0) >>> 0, 5);
    const na = (rotl32((a ^ t) >>> 0, u & 31) + s[2 * i]!) >>> 0;
    const nc = (rotl32((c ^ u) >>> 0, t & 31) + s[2 * i + 1]!) >>> 0;
    a = b;
    b = nc;
    c = d;
    d = na;
  }
  a = (a + s[2 * r + 2]!) >>> 0;
  c = (c + s[2 * r + 3]!) >>> 0;
  const out = new Uint8Array(16);
  store32(out, 0, a);
  store32(out, 4, b);
  store32(out, 8, c);
  store32(out, 12, d);
  return out;
}

/** Decrypts one block of w / 2 bytes. */
export function rc6DecryptBlock(
  block: Uint8Array,
  key: Uint8Array,
  w: number,
  r: number,
): Uint8Array {
  const sc = schedule(key, w, r);
  const s = sc.s32;
  if (!s) return rc6DecryptBlockBig(block, key, w, r);
  checkBlock(block, 16, "RC6");
  let a = load32(block, 0);
  let b = load32(block, 4);
  let c = load32(block, 8);
  let d = load32(block, 12);
  c = (c - s[2 * r + 3]!) >>> 0;
  a = (a - s[2 * r + 2]!) >>> 0;
  for (let i = r; i >= 1; i--) {
    const na = d;
    const nb = a;
    const nc = b;
    const nd = c;
    a = na;
    b = nb;
    c = nc;
    d = nd;
    const u = rotl32(Math.imul(d, (2 * d + 1) | 0) >>> 0, 5);
    const t = rotl32(Math.imul(b, (2 * b + 1) | 0) >>> 0, 5);
    c = (rotr32((c - s[2 * i + 1]!) >>> 0, t & 31) ^ u) >>> 0;
    a = (rotr32((a - s[2 * i]!) >>> 0, u & 31) ^ t) >>> 0;
  }
  d = (d - s[1]!) >>> 0;
  b = (b - s[0]!) >>> 0;
  const out = new Uint8Array(16);
  store32(out, 0, a);
  store32(out, 4, b);
  store32(out, 8, c);
  store32(out, 12, d);
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("rc6", "_check-key", "( key:bytes w:int r:int -- )", checkKey, {
    doc: "Raise E_RANGE unless the key is at most 255 bytes, the word size a multiple of 8 from 8 to 256 and the rounds 1 to 255 (private helper of rc6:encrypt).",
    category: "Encryption",
  }),
  definePrimitive(
    "rc6",
    "_encrypt-block",
    "( block:bytes key:bytes w:int r:int -- bytes )",
    rc6EncryptBlock,
    {
      doc: "Encrypt one block (w / 2 bytes) with raw RC6-w/r (private block function for the blockmode layer).",
      category: "Encryption",
    },
  ),
  definePrimitive(
    "rc6",
    "_decrypt-block",
    "( block:bytes key:bytes w:int r:int -- bytes )",
    rc6DecryptBlock,
    {
      doc: "Decrypt one block (w / 2 bytes) with raw RC6-w/r (private block function for the blockmode layer).",
      category: "Encryption",
    },
  ),
];
