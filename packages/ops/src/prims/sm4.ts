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
 * sm4 primitives: the SM4 block cipher (GB/T 32907-2016; also draft-ribose-cfrg-sm4), 128-bit block,
 * 128-bit key, 32 rounds, written from the specification. The S-box and the family keys FK are the
 * constants of the standard (section 7); the constants CK are computed from their definition,
 * ck(i, j) = (4i + j) * 7 mod 256.
 *
 *  - `_check-key`: the key must be 16 bytes (E_RANGE);
 *  - `_encrypt-block` and `_decrypt-block`: one 16-byte block, the block functions of the shared
 *    `blockmode` layer. The round keys of the last key are cached. Words are big-endian.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { checkBlock, getBE32, keyCache, putBE32, rotl32 } from "../cipher-util.js";
import { rangeFailure } from "../prim-util.js";

/** The S-box of GB/T 32907-2016 (section 7.2, figure 1), row-major in the high nibble. */
const SBOX = Uint8Array.from([
  0xd6, 0x90, 0xe9, 0xfe, 0xcc, 0xe1, 0x3d, 0xb7, 0x16, 0xb6, 0x14, 0xc2, 0x28, 0xfb, 0x2c, 0x05,
  0x2b, 0x67, 0x9a, 0x76, 0x2a, 0xbe, 0x04, 0xc3, 0xaa, 0x44, 0x13, 0x26, 0x49, 0x86, 0x06, 0x99,
  0x9c, 0x42, 0x50, 0xf4, 0x91, 0xef, 0x98, 0x7a, 0x33, 0x54, 0x0b, 0x43, 0xed, 0xcf, 0xac, 0x62,
  0xe4, 0xb3, 0x1c, 0xa9, 0xc9, 0x08, 0xe8, 0x95, 0x80, 0xdf, 0x94, 0xfa, 0x75, 0x8f, 0x3f, 0xa6,
  0x47, 0x07, 0xa7, 0xfc, 0xf3, 0x73, 0x17, 0xba, 0x83, 0x59, 0x3c, 0x19, 0xe6, 0x85, 0x4f, 0xa8,
  0x68, 0x6b, 0x81, 0xb2, 0x71, 0x64, 0xda, 0x8b, 0xf8, 0xeb, 0x0f, 0x4b, 0x70, 0x56, 0x9d, 0x35,
  0x1e, 0x24, 0x0e, 0x5e, 0x63, 0x58, 0xd1, 0xa2, 0x25, 0x22, 0x7c, 0x3b, 0x01, 0x21, 0x78, 0x87,
  0xd4, 0x00, 0x46, 0x57, 0x9f, 0xd3, 0x27, 0x52, 0x4c, 0x36, 0x02, 0xe7, 0xa0, 0xc4, 0xc8, 0x9e,
  0xea, 0xbf, 0x8a, 0xd2, 0x40, 0xc7, 0x38, 0xb5, 0xa3, 0xf7, 0xf2, 0xce, 0xf9, 0x61, 0x15, 0xa1,
  0xe0, 0xae, 0x5d, 0xa4, 0x9b, 0x34, 0x1a, 0x55, 0xad, 0x93, 0x32, 0x30, 0xf5, 0x8c, 0xb1, 0xe3,
  0x1d, 0xf6, 0xe2, 0x2e, 0x82, 0x66, 0xca, 0x60, 0xc0, 0x29, 0x23, 0xab, 0x0d, 0x53, 0x4e, 0x6f,
  0xd5, 0xdb, 0x37, 0x45, 0xde, 0xfd, 0x8e, 0x2f, 0x03, 0xff, 0x6a, 0x72, 0x6d, 0x6c, 0x5b, 0x51,
  0x8d, 0x1b, 0xaf, 0x92, 0xbb, 0xdd, 0xbc, 0x7f, 0x11, 0xd9, 0x5c, 0x41, 0x1f, 0x10, 0x5a, 0xd8,
  0x0a, 0xc1, 0x31, 0x88, 0xa5, 0xcd, 0x7b, 0xbd, 0x2d, 0x74, 0xd0, 0x12, 0xb8, 0xe5, 0xb4, 0xb0,
  0x89, 0x69, 0x97, 0x4a, 0x0c, 0x96, 0x77, 0x7e, 0x65, 0xb9, 0xf1, 0x09, 0xc5, 0x6e, 0xc6, 0x84,
  0x18, 0xf0, 0x7d, 0xec, 0x3a, 0xdc, 0x4d, 0x20, 0x79, 0xee, 0x5f, 0x3e, 0xd7, 0xcb, 0x39, 0x48,
]);

/** The family keys FK (section 7.3.1). */
const FK = [0xa3b1bac6, 0x56aa3350, 0x677d9197, 0xb27022dc];

/** The constant keys CK (section 7.3.2): byte j of CK[i] is (4i + j) * 7 mod 256. */
const CK = Array.from({ length: 32 }, (_, i) => {
  let w = 0;
  for (let j = 0; j < 4; j++) w = (w << 8) | (((4 * i + j) * 7) & 255);
  return w >>> 0;
});

/** tau: the S-box applied to each byte of a word. */
function tau(a: number): number {
  return (
    ((SBOX[a >>> 24]! << 24) |
      (SBOX[(a >>> 16) & 255]! << 16) |
      (SBOX[(a >>> 8) & 255]! << 8) |
      SBOX[a & 255]!) >>>
    0
  );
}

/** T = L o tau, the round transform. */
function t(a: number): number {
  const b = tau(a);
  return (b ^ rotl32(b, 2) ^ rotl32(b, 10) ^ rotl32(b, 18) ^ rotl32(b, 24)) >>> 0;
}

/** T' = L' o tau, the key schedule transform. */
function tKey(a: number): number {
  const b = tau(a);
  return (b ^ rotl32(b, 13) ^ rotl32(b, 23)) >>> 0;
}

/** Rejects a key that is not 16 bytes (E_RANGE). */
export function checkKey(key: Uint8Array): void {
  if (key.length !== 16)
    throw rangeFailure(`the SM4 key must be 16 bytes, not ${key.length}`, { length: key.length });
}

/** The 32 round keys of a 16-byte key. */
export function sm4KeySchedule(key: Uint8Array): Uint32Array {
  checkKey(key);
  const k = [0, 1, 2, 3].map((i) => (getBE32(key, 4 * i) ^ FK[i]!) >>> 0);
  const rk = new Uint32Array(32);
  for (let i = 0; i < 32; i++) {
    const n = (k[0]! ^ tKey((k[1]! ^ k[2]! ^ k[3]! ^ CK[i]!) >>> 0)) >>> 0;
    rk[i] = n;
    k[0] = k[1]!;
    k[1] = k[2]!;
    k[2] = k[3]!;
    k[3] = n;
  }
  return rk;
}

const schedule = keyCache(sm4KeySchedule);

function run(block: Uint8Array, key: Uint8Array, decrypt: boolean): Uint8Array {
  checkBlock(block, 16, "SM4");
  const rk = schedule(key);
  let x0 = getBE32(block, 0);
  let x1 = getBE32(block, 4);
  let x2 = getBE32(block, 8);
  let x3 = getBE32(block, 12);
  for (let i = 0; i < 32; i++) {
    const n = (x0 ^ t((x1 ^ x2 ^ x3 ^ rk[decrypt ? 31 - i : i]!) >>> 0)) >>> 0;
    x0 = x1;
    x1 = x2;
    x2 = x3;
    x3 = n;
  }
  // The output is the last four words in reverse order.
  const out = new Uint8Array(16);
  putBE32(out, 0, x3);
  putBE32(out, 4, x2);
  putBE32(out, 8, x1);
  putBE32(out, 12, x0);
  return out;
}

/** Encrypts one 16-byte block with a 16-byte key. */
export function sm4EncryptBlock(block: Uint8Array, key: Uint8Array): Uint8Array {
  return run(block, key, false);
}

/** Decrypts one 16-byte block with a 16-byte key. */
export function sm4DecryptBlock(block: Uint8Array, key: Uint8Array): Uint8Array {
  return run(block, key, true);
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("sm4", "_check-key", "( key:bytes -- )", checkKey, {
    doc: "Raise E_RANGE unless the key is 16 bytes (private helper of sm4:encrypt).",
    category: "Encryption",
  }),
  definePrimitive("sm4", "_encrypt-block", "( block:bytes key:bytes -- bytes )", sm4EncryptBlock, {
    doc: "Encrypt one 16-byte block with raw SM4 (private block function for the blockmode layer).",
    category: "Encryption",
  }),
  definePrimitive("sm4", "_decrypt-block", "( block:bytes key:bytes -- bytes )", sm4DecryptBlock, {
    doc: "Decrypt one 16-byte block with raw SM4 (private block function for the blockmode layer).",
    category: "Encryption",
  }),
];
