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
 * Small helpers shared by the national hash primitives in `prims/` (sm3, has160, whirlpool, snefru,
 * gost, streebog). Private to the package. Not in `prims/`: every file there is a vocabulary's
 * primitive module.
 */

/** 32-bit rotate left by `n` (0 to 31). */
export function rotl32(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
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
