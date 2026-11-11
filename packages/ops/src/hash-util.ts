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
 * Helpers shared by the hash primitives in `prims/` (md4, sha0, ripemd, sm3, has160, whirlpool,
 * snefru, gost, streebog). Private to the package. This is not a primitive module (it sits in src/,
 * not src/prims/), so the vocabulary loaders ignore it.
 */

/** Rotate a 32-bit word left by `n` (0 to 31). */
export function rotl32(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

/**
 * Merkle-Damgard padding shared by MD4, SHA-0 and RIPEMD (RFC 1320 sections 3.1 and 3.2): the
 * message, one 0x80 byte, zeros up to 56 mod 64, then the message length in bits as a 64-bit
 * integer, little-endian (MD4, RIPEMD) or big-endian (SHA-0).
 */
export function padMessage(data: Uint8Array, bigEndianLength: boolean): Uint8Array {
  const n = data.length;
  const total = (((n + 8) >> 6) + 1) << 6;
  const out = new Uint8Array(total);
  out.set(data);
  out[n] = 0x80;
  new DataView(out.buffer).setBigUint64(total - 8, BigInt(n) * 8n, !bigEndianLength);
  return out;
}

/** The 16 words of the 64-byte block at `off`, little-endian or big-endian. */
export function readWords(block: Uint8Array, off: number, little: boolean): Uint32Array {
  const view = new DataView(block.buffer, block.byteOffset + off, 64);
  const w = new Uint32Array(16);
  for (let i = 0; i < 16; i++) w[i] = view.getUint32(i * 4, little);
  return w;
}

/** The words as bytes, little-endian or big-endian. */
export function wordsToBytes(words: ArrayLike<number>, little: boolean): Uint8Array {
  const out = new Uint8Array(words.length * 4);
  const view = new DataView(out.buffer);
  for (let i = 0; i < words.length; i++) view.setUint32(i * 4, words[i] as number, little);
  return out;
}

/**
 * Merkle-Damgard padding: the message, a 0x80 byte, zeros, then the bit length in `lenBytes`
 * bytes (8 for the 512-bit-block hashes, 32 for Whirlpool), big- or little-endian, so that the
 * total is a multiple of `block` bytes. The length is far below 2^53 bits (a value is bounded by
 * the runtime's limits), so it is written from a number.
 */
export function mdPad(
  data: Uint8Array,
  block: number,
  lenBytes: number,
  bigEndian: boolean,
): Uint8Array {
  const total = Math.ceil((data.length + 1 + lenBytes) / block) * block;
  const out = new Uint8Array(total);
  out.set(data);
  out[data.length] = 0x80;
  let bits = data.length * 8;
  for (let i = 0; i < 8; i++) {
    out[bigEndian ? total - 1 - i : total - lenBytes + i] = bits % 256;
    bits = Math.floor(bits / 256);
  }
  return out;
}

/** Lower-case hex of bytes (used to decode table constants written as hex strings). */
export function fromHex(s: string): Uint8Array {
  const out = new Uint8Array(s.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
}
