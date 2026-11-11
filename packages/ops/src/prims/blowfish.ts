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
 * blowfish primitives: Blowfish (B. Schneier, "Description of a New Variable-Length Key, 64-Bit Block
 * Cipher (Blowfish)", Fast Software Encryption 1993), written from the paper. The initial P-array
 * (18 words) and the four S-boxes (4 x 256 words) are the hexadecimal digits of the fractional part
 * of pi, in order, as in the paper. They are computed here from that definition (Machin's formula in
 * fixed-point BigInt arithmetic, once, on first use) and not stored.
 *
 *  - `_check-key`: the key must be 4 to 56 bytes (32 to 448 bits, CyberChef's range; E_RANGE);
 *  - `_encrypt-block` and `_decrypt-block`: one 8-byte block, the block functions of the shared
 *    `blockmode` layer. The expanded state of the last key is cached. Words are big-endian.
 *
 * Also exported for WP 5.28 (bcrypt, whose EksBlowfish is this cipher with an expensive key schedule):
 * `bfInit`, `bfExpandKey` (with an optional salt), `bfEncryptWords`, `bfEncryptBlock` and
 * `bfDecryptBlock`, all on a {@link BlowfishState}.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { checkBlock, getBE32, keyCache, putBE32 } from "../cipher-util.js";
import { rangeFailure } from "../prim-util.js";

/** The Blowfish state: the 18-word P-array and the four 256-word S-boxes (one array of 1024). */
export interface BlowfishState {
  readonly p: Uint32Array;
  readonly s: Uint32Array;
}

const N_WORDS = 18 + 4 * 256;

/** arctan(1/x) in fixed point with the given scale (a power of two). */
function arctanInv(x: bigint, scale: bigint): bigint {
  const x2 = x * x;
  let term = scale / x;
  let sum = term;
  for (let k = 1n; term !== 0n; k++) {
    term /= x2;
    const t = term / (2n * k + 1n);
    sum += k % 2n === 1n ? -t : t;
  }
  return sum;
}

let initial: { p: Uint32Array; s: Uint32Array } | undefined;

/** The hexadecimal digits of the fractional part of pi, 32 bits at a time: the 1042 initial words. */
function piWords(): { p: Uint32Array; s: Uint32Array } {
  if (initial) return initial;
  const guard = 64n;
  const bits = BigInt(N_WORDS * 32) + guard;
  const scale = 1n << bits;
  // Machin: pi = 16 arctan(1/5) - 4 arctan(1/239).
  const pi = 16n * arctanInv(5n, scale) - 4n * arctanInv(239n, scale);
  const frac = (pi - 3n * scale) >> guard; // N_WORDS * 32 bits of the fraction
  const all = new Uint32Array(N_WORDS);
  for (let i = 0; i < N_WORDS; i++)
    all[i] = Number((frac >> BigInt(32 * (N_WORDS - 1 - i))) & 0xffffffffn);
  initial = { p: all.slice(0, 18), s: all.slice(18) };
  return initial;
}

/** A fresh state holding the digits of pi: Blowfish before any key is mixed in. */
export function bfInit(): BlowfishState {
  const w = piWords();
  return { p: w.p.slice(), s: w.s.slice() };
}

/** The Blowfish round function F. */
function f(s: Uint32Array, x: number): number {
  return (
    (((s[x >>> 24]! + s[256 + ((x >>> 16) & 255)]!) ^ s[512 + ((x >>> 8) & 255)]!) +
      s[768 + (x & 255)]!) >>>
    0
  );
}

/** Encrypts the block (l, r) in place into out[0], out[1]. */
export function bfEncryptWords(st: BlowfishState, l: number, r: number, out: Uint32Array): void {
  const { p, s } = st;
  for (let i = 0; i < 16; i += 2) {
    l = (l ^ p[i]!) >>> 0;
    r = (r ^ f(s, l)) >>> 0;
    r = (r ^ p[i + 1]!) >>> 0;
    l = (l ^ f(s, r)) >>> 0;
  }
  out[0] = (r ^ p[17]!) >>> 0;
  out[1] = (l ^ p[16]!) >>> 0;
}

/** Decrypts the block (l, r) into out[0], out[1]. */
function decryptWords(st: BlowfishState, l: number, r: number, out: Uint32Array): void {
  const { p, s } = st;
  for (let i = 17; i > 1; i -= 2) {
    l = (l ^ p[i]!) >>> 0;
    r = (r ^ f(s, l)) >>> 0;
    r = (r ^ p[i - 1]!) >>> 0;
    l = (l ^ f(s, r)) >>> 0;
  }
  out[0] = (r ^ p[0]!) >>> 0;
  out[1] = (l ^ p[1]!) >>> 0;
}

/**
 * The Blowfish key schedule: XORs the key (read cyclically as big-endian words) into the P-array, then
 * replaces the P-array and the S-boxes by repeated encryption of an all-zero block. With a 16-byte
 * `salt` it is the ExpandKey of bcrypt's EksBlowfish (Provos and Mazieres, 1999): the salt words are
 * XORed into the block before each encryption, alternating between its two halves. The key may be any
 * length from 1 byte (the 4-to-56-byte limit of the word is checked elsewhere).
 */
export function bfExpandKey(st: BlowfishState, key: Uint8Array, salt?: Uint8Array): void {
  const { p, s } = st;
  let pos = 0;
  for (let i = 0; i < 18; i++) {
    let w = 0;
    for (let j = 0; j < 4; j++) {
      w = (w << 8) | key[pos]!;
      pos = (pos + 1) % key.length;
    }
    p[i] = (p[i]! ^ w) >>> 0;
  }
  const sw = salt ? [0, 4, 8, 12].map((o) => getBE32(salt, o)) : [0, 0, 0, 0];
  const out = new Uint32Array(2);
  let l = 0;
  let r = 0;
  let k = 0;
  const step = (): void => {
    bfEncryptWords(st, (l ^ sw[(2 * k) % 4]!) >>> 0, (r ^ sw[(2 * k + 1) % 4]!) >>> 0, out);
    k++;
    l = out[0]!;
    r = out[1]!;
  };
  for (let i = 0; i < 18; i += 2) {
    step();
    p[i] = l;
    p[i + 1] = r;
  }
  for (let i = 0; i < 1024; i += 2) {
    step();
    s[i] = l;
    s[i + 1] = r;
  }
}

/** Encrypts one 8-byte block (big-endian halves) on an expanded state. */
export function bfEncryptBlock(st: BlowfishState, block: Uint8Array): Uint8Array {
  checkBlock(block, 8, "Blowfish");
  const out = new Uint32Array(2);
  bfEncryptWords(st, getBE32(block, 0), getBE32(block, 4), out);
  const res = new Uint8Array(8);
  putBE32(res, 0, out[0]!);
  putBE32(res, 4, out[1]!);
  return res;
}

/** Decrypts one 8-byte block on an expanded state. */
export function bfDecryptBlock(st: BlowfishState, block: Uint8Array): Uint8Array {
  checkBlock(block, 8, "Blowfish");
  const out = new Uint32Array(2);
  decryptWords(st, getBE32(block, 0), getBE32(block, 4), out);
  const res = new Uint8Array(8);
  putBE32(res, 0, out[0]!);
  putBE32(res, 4, out[1]!);
  return res;
}

/** Rejects a key shorter than 4 or longer than 56 bytes (E_RANGE). */
export function checkKey(key: Uint8Array): void {
  if (key.length < 4 || key.length > 56)
    throw rangeFailure(`the Blowfish key must be 4 to 56 bytes, not ${key.length}`, {
      length: key.length,
    });
}

const state = keyCache((key: Uint8Array): BlowfishState => {
  checkKey(key);
  const st = bfInit();
  bfExpandKey(st, key);
  return st;
});

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("blowfish", "_check-key", "( key:bytes -- )", checkKey, {
    doc: "Raise E_RANGE unless the key is 4 to 56 bytes (private helper of blowfish:encrypt).",
    category: "Encryption",
  }),
  definePrimitive(
    "blowfish",
    "_encrypt-block",
    "( block:bytes key:bytes -- bytes )",
    (block: Uint8Array, key: Uint8Array) => bfEncryptBlock(state(key), block),
    {
      doc: "Encrypt one 8-byte block with raw Blowfish (private block function for the blockmode layer).",
      category: "Encryption",
    },
  ),
  definePrimitive(
    "blowfish",
    "_decrypt-block",
    "( block:bytes key:bytes -- bytes )",
    (block: Uint8Array, key: Uint8Array) => bfDecryptBlock(state(key), block),
    {
      doc: "Decrypt one 8-byte block with raw Blowfish (private block function for the blockmode layer).",
      category: "Encryption",
    },
  ),
];
