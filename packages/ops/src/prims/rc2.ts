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
 * rc2 primitives: the RC2 block cipher (R. Rivest; RFC 2268, "A Description of the RC2(r) Encryption
 * Algorithm"), 64-bit block, a key of 1 to 128 bytes and an "effective key bits" parameter, written
 * from the RFC. PITABLE is the table of section 2 of the RFC (a permutation of 0 to 255 built from the
 * digits of pi). The key expansion is the RFC's: L is filled from the key, extended to 128 bytes
 * through PITABLE, reduced to the effective length T8 and TM, and read as 64 little-endian 16-bit
 * subkeys K.
 *
 *  - `_check-key`: the key must be 1 to 128 bytes and the effective bits 1 to 1024 (E_RANGE);
 *  - `_encrypt-block` and `_decrypt-block` `( block key bits -- bytes )`: one 8-byte block, the block
 *    functions of the shared `blockmode` layer. The key schedule of the last key and bits is cached.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { checkBlock, keyCache } from "../cipher-util.js";
import { rangeFailure } from "../prim-util.js";

/** PITABLE of RFC 2268 section 2. */
const PITABLE = Uint8Array.from([
  0xd9, 0x78, 0xf9, 0xc4, 0x19, 0xdd, 0xb5, 0xed, 0x28, 0xe9, 0xfd, 0x79, 0x4a, 0xa0, 0xd8, 0x9d,
  0xc6, 0x7e, 0x37, 0x83, 0x2b, 0x76, 0x53, 0x8e, 0x62, 0x4c, 0x64, 0x88, 0x44, 0x8b, 0xfb, 0xa2,
  0x17, 0x9a, 0x59, 0xf5, 0x87, 0xb3, 0x4f, 0x13, 0x61, 0x45, 0x6d, 0x8d, 0x09, 0x81, 0x7d, 0x32,
  0xbd, 0x8f, 0x40, 0xeb, 0x86, 0xb7, 0x7b, 0x0b, 0xf0, 0x95, 0x21, 0x22, 0x5c, 0x6b, 0x4e, 0x82,
  0x54, 0xd6, 0x65, 0x93, 0xce, 0x60, 0xb2, 0x1c, 0x73, 0x56, 0xc0, 0x14, 0xa7, 0x8c, 0xf1, 0xdc,
  0x12, 0x75, 0xca, 0x1f, 0x3b, 0xbe, 0xe4, 0xd1, 0x42, 0x3d, 0xd4, 0x30, 0xa3, 0x3c, 0xb6, 0x26,
  0x6f, 0xbf, 0x0e, 0xda, 0x46, 0x69, 0x07, 0x57, 0x27, 0xf2, 0x1d, 0x9b, 0xbc, 0x94, 0x43, 0x03,
  0xf8, 0x11, 0xc7, 0xf6, 0x90, 0xef, 0x3e, 0xe7, 0x06, 0xc3, 0xd5, 0x2f, 0xc8, 0x66, 0x1e, 0xd7,
  0x08, 0xe8, 0xea, 0xde, 0x80, 0x52, 0xee, 0xf7, 0x84, 0xaa, 0x72, 0xac, 0x35, 0x4d, 0x6a, 0x2a,
  0x96, 0x1a, 0xd2, 0x71, 0x5a, 0x15, 0x49, 0x74, 0x4b, 0x9f, 0xd0, 0x5e, 0x04, 0x18, 0xa4, 0xec,
  0xc2, 0xe0, 0x41, 0x6e, 0x0f, 0x51, 0xcb, 0xcc, 0x24, 0x91, 0xaf, 0x50, 0xa1, 0xf4, 0x70, 0x39,
  0x99, 0x7c, 0x3a, 0x85, 0x23, 0xb8, 0xb4, 0x7a, 0xfc, 0x02, 0x36, 0x5b, 0x25, 0x55, 0x97, 0x31,
  0x2d, 0x5d, 0xfa, 0x98, 0xe3, 0x8a, 0x92, 0xae, 0x05, 0xdf, 0x29, 0x10, 0x67, 0x6c, 0xba, 0xc9,
  0xd3, 0x00, 0xe6, 0xcf, 0xe1, 0x9e, 0xa8, 0x2c, 0x63, 0x16, 0x01, 0x3f, 0x58, 0xe2, 0x89, 0xa9,
  0x0d, 0x38, 0x34, 0x1b, 0xab, 0x33, 0xff, 0xb0, 0xbb, 0x48, 0x0c, 0x5f, 0xb9, 0xb1, 0xcd, 0x2e,
  0xc5, 0xf3, 0xdb, 0x47, 0xe5, 0xa5, 0x9c, 0x77, 0x0a, 0xa6, 0x20, 0x68, 0xfe, 0x7f, 0xc1, 0xad,
]);

/** The rotation of each of the four words in a mixing round. */
const S = [1, 2, 3, 5];

/** Rejects a key outside 1 to 128 bytes or effective bits outside 1 to 1024 (E_RANGE). */
export function checkKey(key: Uint8Array, bits: number): void {
  if (key.length < 1 || key.length > 128)
    throw rangeFailure(`the RC2 key must be 1 to 128 bytes, not ${key.length}`, {
      length: key.length,
    });
  if (!Number.isInteger(bits) || bits < 1 || bits > 1024)
    throw rangeFailure(`the RC2 effective key bits must be 1 to 1024, not ${bits}`, { bits });
}

/** The 64 16-bit subkeys of a key and its effective key length in bits (RFC 2268 section 2). */
export function rc2KeySchedule(key: Uint8Array, bits: number): Uint16Array {
  checkKey(key, bits);
  const t = key.length;
  const t8 = (bits + 7) >> 3;
  const tm = 255 >> (8 * t8 - bits);
  const l = new Uint8Array(128);
  l.set(key);
  for (let i = t; i < 128; i++) l[i] = PITABLE[(l[i - 1]! + l[i - t]!) & 255]!;
  l[128 - t8] = PITABLE[l[128 - t8]! & tm]!;
  for (let i = 127 - t8; i >= 0; i--) l[i] = PITABLE[l[i + 1]! ^ l[i + t8]!]!;
  const k = new Uint16Array(64);
  for (let i = 0; i < 64; i++) k[i] = l[2 * i]! | (l[2 * i + 1]! << 8);
  return k;
}

const schedule = keyCache(rc2KeySchedule);

const rol16 = (x: number, n: number) => ((x << n) | (x >>> (16 - n))) & 0xffff;
const ror16 = (x: number, n: number) => ((x >>> n) | (x << (16 - n))) & 0xffff;

/** Encrypts one 8-byte block (RFC 2268 section 3). */
export function rc2EncryptBlock(block: Uint8Array, key: Uint8Array, bits: number): Uint8Array {
  checkBlock(block, 8, "RC2");
  const k = schedule(key, bits);
  const r = [0, 1, 2, 3].map((i) => block[2 * i]! | (block[2 * i + 1]! << 8));
  let j = 0;
  const mix = () => {
    for (let i = 0; i < 4; i++) {
      const a = r[(i + 3) & 3]!;
      const v = r[i]! + k[j]! + (a & r[(i + 2) & 3]!) + (~a & r[(i + 1) & 3]!);
      j++;
      r[i] = rol16(v & 0xffff, S[i]!);
    }
  };
  const mash = () => {
    for (let i = 0; i < 4; i++) r[i] = (r[i]! + k[r[(i + 3) & 3]! & 63]!) & 0xffff;
  };
  for (let n = 0; n < 5; n++) mix();
  mash();
  for (let n = 0; n < 6; n++) mix();
  mash();
  for (let n = 0; n < 5; n++) mix();
  const out = new Uint8Array(8);
  for (let i = 0; i < 4; i++) {
    out[2 * i] = r[i]!;
    out[2 * i + 1] = r[i]! >>> 8;
  }
  return out;
}

/** Decrypts one 8-byte block (RFC 2268 section 3, the inverse). */
export function rc2DecryptBlock(block: Uint8Array, key: Uint8Array, bits: number): Uint8Array {
  checkBlock(block, 8, "RC2");
  const k = schedule(key, bits);
  const r = [0, 1, 2, 3].map((i) => block[2 * i]! | (block[2 * i + 1]! << 8));
  let j = 63;
  const unmix = () => {
    for (let i = 3; i >= 0; i--) {
      const a = r[(i + 3) & 3]!;
      const v = ror16(r[i]!, S[i]!) - k[j]! - (a & r[(i + 2) & 3]!) - (~a & r[(i + 1) & 3]!);
      j--;
      r[i] = v & 0xffff;
    }
  };
  const unmash = () => {
    for (let i = 3; i >= 0; i--) r[i] = (r[i]! - k[r[(i + 3) & 3]! & 63]!) & 0xffff;
  };
  for (let n = 0; n < 5; n++) unmix();
  unmash();
  for (let n = 0; n < 6; n++) unmix();
  unmash();
  for (let n = 0; n < 5; n++) unmix();
  const out = new Uint8Array(8);
  for (let i = 0; i < 4; i++) {
    out[2 * i] = r[i]!;
    out[2 * i + 1] = r[i]! >>> 8;
  }
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("rc2", "_check-key", "( key:bytes bits:int -- )", checkKey, {
    doc: "Raise E_RANGE unless the key is 1 to 128 bytes and the effective bits 1 to 1024 (private helper of rc2:encrypt).",
    category: "Encryption",
  }),
  definePrimitive(
    "rc2",
    "_encrypt-block",
    "( block:bytes key:bytes bits:int -- bytes )",
    rc2EncryptBlock,
    {
      doc: "Encrypt one 8-byte block with raw RC2 (private block function for the blockmode layer).",
      category: "Encryption",
    },
  ),
  definePrimitive(
    "rc2",
    "_decrypt-block",
    "( block:bytes key:bytes bits:int -- bytes )",
    rc2DecryptBlock,
    {
      doc: "Decrypt one 8-byte block with raw RC2 (private block function for the blockmode layer).",
      category: "Encryption",
    },
  ),
];
