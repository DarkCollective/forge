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
 * rabbit primitive. The Rabbit stream cipher of RFC 4503 (Boesgaard, Vesterager, Zenner; section numbers
 * below are that RFC's): eight 32-bit state variables X and counters C with a carry bit, the key setup of
 * section 2.4 (subkeys K0..K7 of 16 bits, K0 the least significant), the optional 64-bit IV setup of
 * section 2.5, the counter constants A of section 2.2 and the extraction scheme of section 2.7. The RFC
 * writes every 128-bit value most significant byte first, which is what `little` false does ("big
 * endian", the default). `little` true reverses the key, the IV and each 16-byte key stream block, which is
 * the little-endian byte order of Crypto++ (the convention CyberChef names). A short last block takes the
 * low-order end of the key stream block in big-endian order (the rightmost bytes) and the leading bytes of
 * the reversed block in little-endian order. The word `rabbit:crypt` (vocab/rabbit.fth) holds the metadata.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { getBE32 } from "../cipher-util.js";
import { rangeFailure } from "../prim-util.js";

/** Section 2.2: the counter constants A0..A7. */
const A = [
  0x4d34d34d, 0xd34d34d3, 0x34d34d34, 0x4d34d34d, 0xd34d34d3, 0x34d34d34, 0x4d34d34d, 0xd34d34d3,
];

const rotl = (x: number, n: number): number => ((x << n) | (x >>> (32 - n))) >>> 0;

/** Section 2.6: g(u, v) = the high 32 bits of ((u + v) mod 2^32)^2 xor the low 32 bits. */
function g(u: number, v: number): number {
  const x = (u + v) >>> 0;
  const a = x >>> 16;
  const b = x & 0xffff;
  const lo = Math.imul(x, x) >>> 0;
  const mid = 2 * a * b;
  const lowPart = (mid % 65536) * 65536 + b * b;
  const hi = (a * a + Math.floor(mid / 65536) + Math.floor(lowPart / 4294967296)) >>> 0;
  return (hi ^ lo) >>> 0;
}

class Rabbit {
  readonly x = new Uint32Array(8);
  readonly c = new Uint32Array(8);
  private carry = 0;

  /** Section 2.3: the counter system. */
  private counterUpdate(): void {
    let b = this.carry;
    for (let j = 0; j < 8; j++) {
      const t = this.c[j]! + A[j]! + b;
      b = t >= 4294967296 ? 1 : 0;
      this.c[j] = t >>> 0;
    }
    this.carry = b;
  }

  /** Section 2.5: the next-state function, after the counter update. */
  private nextState(): void {
    const gg = new Uint32Array(8);
    for (let j = 0; j < 8; j++) gg[j] = g(this.x[j]!, this.c[j]!);
    const x = this.x;
    x[0] = (gg[0]! + rotl(gg[7]!, 16) + rotl(gg[6]!, 16)) >>> 0;
    x[1] = (gg[1]! + rotl(gg[0]!, 8) + gg[7]!) >>> 0;
    x[2] = (gg[2]! + rotl(gg[1]!, 16) + rotl(gg[0]!, 16)) >>> 0;
    x[3] = (gg[3]! + rotl(gg[2]!, 8) + gg[1]!) >>> 0;
    x[4] = (gg[4]! + rotl(gg[3]!, 16) + rotl(gg[2]!, 16)) >>> 0;
    x[5] = (gg[5]! + rotl(gg[4]!, 8) + gg[3]!) >>> 0;
    x[6] = (gg[6]! + rotl(gg[5]!, 16) + rotl(gg[4]!, 16)) >>> 0;
    x[7] = (gg[7]! + rotl(gg[6]!, 8) + gg[5]!) >>> 0;
  }

  private iterate(): void {
    this.counterUpdate();
    this.nextState();
  }

  /** Section 2.4, key `key` as 16 bytes, most significant first. */
  constructor(key: Uint8Array, iv: Uint8Array | undefined) {
    const k: number[] = [];
    for (let i = 0; i < 8; i++) k.push((key[14 - 2 * i]! << 8) | key[15 - 2 * i]!);
    for (let j = 0; j < 8; j++) {
      if (j % 2 === 0) {
        this.x[j] = ((k[(j + 1) % 8]! << 16) | k[j]!) >>> 0;
        this.c[j] = ((k[(j + 4) % 8]! << 16) | k[(j + 5) % 8]!) >>> 0;
      } else {
        this.x[j] = ((k[(j + 5) % 8]! << 16) | k[(j + 4) % 8]!) >>> 0;
        this.c[j] = ((k[j]! << 16) | k[(j + 1) % 8]!) >>> 0;
      }
    }
    for (let i = 0; i < 4; i++) this.iterate();
    for (let j = 0; j < 8; j++) this.c[j] = (this.c[j]! ^ this.x[(j + 4) % 8]!) >>> 0;
    if (iv !== undefined) {
      const hi = getBE32(iv, 0); // IV[63..32]
      const lo = getBE32(iv, 4); // IV[31..0]
      const mixA = ((hi & 0xffff0000) | (lo >>> 16)) >>> 0; // IV[63..48] || IV[31..16]
      const mixB = (((hi & 0xffff) << 16) | (lo & 0xffff)) >>> 0; // IV[47..32] || IV[15..0]
      const iv32 = [lo, mixA, hi, mixB, lo, mixA, hi, mixB];
      for (let j = 0; j < 8; j++) this.c[j] = (this.c[j]! ^ iv32[j]!) >>> 0;
      for (let i = 0; i < 4; i++) this.iterate();
    }
  }

  /** Section 2.7: the next 16 key stream bytes, S[127..120] first. */
  block(out: Uint8Array): void {
    this.iterate();
    const x = this.x;
    const s = [
      (x[0]! ^ (x[5]! >>> 16)) & 0xffff,
      ((x[0]! >>> 16) ^ x[3]!) & 0xffff,
      (x[2]! ^ (x[7]! >>> 16)) & 0xffff,
      ((x[2]! >>> 16) ^ x[5]!) & 0xffff,
      (x[4]! ^ (x[1]! >>> 16)) & 0xffff,
      ((x[4]! >>> 16) ^ x[7]!) & 0xffff,
      (x[6]! ^ (x[3]! >>> 16)) & 0xffff,
      ((x[6]! >>> 16) ^ x[1]!) & 0xffff,
    ];
    for (let p = 0; p < 8; p++) {
      out[2 * p] = s[7 - p]! >>> 8;
      out[2 * p + 1] = s[7 - p]! & 0xff;
    }
  }
}

/** Rabbit of `data`: encrypts and decrypts alike. `iv` is empty (no IV setup) or 8 bytes. */
export function crypt(
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  little: boolean,
): Uint8Array {
  if (key.length !== 16)
    throw rangeFailure(`the Rabbit key must be 16 bytes, not ${key.length}`, {
      length: key.length,
    });
  if (iv.length !== 0 && iv.length !== 8)
    throw rangeFailure(`the Rabbit IV must be 0 or 8 bytes, not ${iv.length}`, {
      length: iv.length,
    });
  const k = little ? Uint8Array.from(key).reverse() : key;
  const v = iv.length === 0 ? undefined : little ? Uint8Array.from(iv).reverse() : iv;
  const rabbit = new Rabbit(k, v);
  const out = new Uint8Array(data.length);
  const s = new Uint8Array(16);
  for (let off = 0; off < data.length; off += 16) {
    rabbit.block(s);
    if (little) s.reverse();
    const n = Math.min(16, data.length - off);
    const from = little ? 0 : 16 - n;
    for (let j = 0; j < n; j++) out[off + j] = data[off + j]! ^ s[from + j]!;
  }
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "rabbit",
    "_crypt",
    "( data:bytes key:bytes iv:bytes little:bool -- bytes )",
    crypt,
    {
      doc: "The Rabbit key stream (RFC 4503) XORed into the bytes (private helper of rabbit:crypt).",
      category: "Encryption",
    },
  ),
];
