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
 * xxtea primitives. Corrected Block TEA (Needham and Wheeler, "Correction to xtea", Computer Laboratory,
 * University of Cambridge, October 1998), the btea routine: the whole message of n >= 2 32-bit words is one
 * block, with 6 + 52/n cycles over the words, each word updated from both neighbours by
 * MX = ((z>>5 ^ y<<2) + (y>>3 ^ z<<4)) ^ ((sum ^ y) + (k[(p&3) ^ e] ^ z)) and delta = 0x9E3779B9.
 *
 * Byte conventions (CyberChef's, which are the usual XXTEA library ones): words are little-endian; the key
 * is up to 16 bytes, zero-padded; encryption zero-pads the data to whole words and appends the byte length as
 * one more word before the cipher, so the ciphertext is 4 bytes more than the data rounded up to words;
 * decryption reads that word back and trims (the length must lie in the last word group, else the key is
 * wrong, E_COERCE). An empty input is an empty output. The words `xxtea:encrypt` and `decrypt`
 * (vocab/xxtea.fth) hold the metadata.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { le32, putLe32 } from "../cipher-util-b.js";
import { coerceFailure, rangeFailure } from "../prim-util.js";

const DELTA = 0x9e3779b9;

function keyWords(key: Uint8Array): Uint32Array {
  if (key.length > 16)
    throw rangeFailure(`the XXTEA key must be at most 16 bytes, not ${key.length}`, {
      length: key.length,
    });
  const padded = new Uint8Array(16);
  padded.set(key);
  const k = new Uint32Array(4);
  for (let i = 0; i < 4; i++) k[i] = le32(padded, 4 * i);
  return k;
}

function mx(sum: number, y: number, z: number, p: number, e: number, k: Uint32Array): number {
  return (
    ((((z >>> 5) ^ (y << 2)) + ((y >>> 3) ^ (z << 4))) ^ ((sum ^ y) + (k[(p & 3) ^ e]! ^ z))) >>> 0
  );
}

function encryptWords(v: Uint32Array, k: Uint32Array): void {
  const n = v.length;
  let rounds = 6 + Math.floor(52 / n);
  let sum = 0;
  let z = v[n - 1]!;
  while (rounds-- > 0) {
    sum = (sum + DELTA) >>> 0;
    const e = (sum >>> 2) & 3;
    let y: number;
    for (let p = 0; p < n - 1; p++) {
      y = v[p + 1]!;
      v[p] = v[p]! + mx(sum, y, z, p, e, k);
      z = v[p]!;
    }
    y = v[0]!;
    v[n - 1] = v[n - 1]! + mx(sum, y, z, n - 1, e, k);
    z = v[n - 1]!;
  }
}

function decryptWords(v: Uint32Array, k: Uint32Array): void {
  const n = v.length;
  let rounds = 6 + Math.floor(52 / n);
  let sum = Math.imul(rounds, DELTA) >>> 0;
  let y = v[0]!;
  while (rounds-- > 0) {
    const e = (sum >>> 2) & 3;
    let z: number;
    for (let p = n - 1; p > 0; p--) {
      z = v[p - 1]!;
      v[p] = v[p]! - mx(sum, y, z, p, e, k);
      y = v[p]!;
    }
    z = v[n - 1]!;
    v[0] = v[0]! - mx(sum, y, z, 0, e, k);
    y = v[0]!;
    sum = (sum - DELTA) >>> 0;
  }
}

/** XXTEA encryption: data padded to words, the length appended as a word, one block. */
export function encrypt(data: Uint8Array, key: Uint8Array): Uint8Array {
  const k = keyWords(key);
  if (data.length === 0) return new Uint8Array(0);
  const n = Math.ceil(data.length / 4);
  const padded = new Uint8Array(4 * (n + 1));
  padded.set(data);
  putLe32(padded, 4 * n, data.length);
  const v = new Uint32Array(n + 1);
  for (let i = 0; i <= n; i++) v[i] = le32(padded, 4 * i);
  encryptWords(v, k);
  const out = new Uint8Array(4 * (n + 1));
  for (let i = 0; i <= n; i++) putLe32(out, 4 * i, v[i]!);
  return out;
}

/** XXTEA decryption; E_COERCE when the input is not whole words of at least 8 bytes or the length word is not plausible. */
export function decrypt(data: Uint8Array, key: Uint8Array): Uint8Array {
  const k = keyWords(key);
  if (data.length === 0) return new Uint8Array(0);
  if (data.length % 4 !== 0 || data.length < 8)
    throw coerceFailure(
      "bytes",
      "bytes",
      "an XXTEA ciphertext is a whole number of 4-byte words, at least two",
    );
  const w = data.length / 4;
  const v = new Uint32Array(w);
  for (let i = 0; i < w; i++) v[i] = le32(data, 4 * i);
  decryptWords(v, k);
  const m = v[w - 1]!;
  const max = 4 * (w - 1);
  if (m < max - 3 || m > max)
    throw coerceFailure(
      "bytes",
      "bytes",
      "unable to decrypt using this key (the length word is wrong)",
    );
  const out = new Uint8Array(4 * (w - 1));
  for (let i = 0; i < w - 1; i++) putLe32(out, 4 * i, v[i]!);
  return out.slice(0, m);
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("xxtea", "_encrypt", "( data:bytes key:bytes -- bytes )", encrypt, {
    doc: "XXTEA (Corrected Block TEA) encryption with the length word appended (private helper of xxtea:encrypt).",
    category: "Encryption",
  }),
  definePrimitive("xxtea", "_decrypt", "( data:bytes key:bytes -- bytes )", decrypt, {
    doc: "XXTEA decryption, trimmed to the stored length (private helper of xxtea:decrypt).",
    category: "Encryption",
  }),
];
