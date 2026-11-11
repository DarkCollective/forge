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
 * cmac primitive: CMAC (NIST SP 800-38B, RFC 4493) over AES or Triple DES. One private primitive,
 * `_mac ( data key algorithm -- bytes )`, because the block functions of the aes and triple-des
 * vocabularies are private words that FL cannot call, whereas this module can import the TypeScript
 * block functions directly. The CMAC construction itself is a short loop (the two subkeys, then
 * CBC-MAC with the last block masked by K1 or K2), so one primitive that holds it is smaller than a
 * block-function primitive plus the byte shifting and XOR words that FL would need.
 *
 * AES takes a 16, 24 or 32-byte key and has a 16-byte block (Rb = 0x87); Triple DES takes 16 or 24
 * bytes (the two-key form repeats K1, as the triple-des vocabulary does) with an 8-byte block
 * (Rb = 0x1B). The tag is the whole block (16 or 8 bytes). A bad key length or algorithm is E_RANGE.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { rangeFailure } from "../prim-util.js";
import { blockEncrypt, checkKey as checkAesKey } from "./aes.js";
import { checkKey as checkTdesKey, tdesEncryptBlock } from "./triple-des.js";

type BlockFn = (block: Uint8Array) => Uint8Array;

/** Doubling in GF(2^n): shift left by one bit, and XOR Rb into the last byte when a bit fell off. */
function dbl(a: Uint8Array, rb: number): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++)
    out[i] = ((a[i]! << 1) | (i + 1 < a.length ? a[i + 1]! >> 7 : 0)) & 0xff;
  if (a[0]! & 0x80) out[out.length - 1] = out[out.length - 1]! ^ rb;
  return out;
}

/** CMAC (SP 800-38B section 6.2) of `data` with block function `enc` of `bs` bytes and constant `rb`. */
function cmacWith(data: Uint8Array, enc: BlockFn, bs: number, rb: number): Uint8Array {
  const k1 = dbl(enc(new Uint8Array(bs)), rb);
  const k2 = dbl(k1, rb);
  const n = Math.max(1, Math.ceil(data.length / bs));
  const complete = data.length > 0 && data.length % bs === 0;
  const last = new Uint8Array(bs);
  const from = (n - 1) * bs;
  last.set(data.subarray(from));
  if (!complete) last[data.length - from] = 0x80;
  const mask = complete ? k1 : k2;
  for (let i = 0; i < bs; i++) last[i] = last[i]! ^ mask[i]!;
  let x: Uint8Array = new Uint8Array(bs);
  const y = new Uint8Array(bs);
  for (let b = 0; b < n - 1; b++) {
    for (let i = 0; i < bs; i++) y[i] = x[i]! ^ data[b * bs + i]!;
    x = enc(y);
  }
  for (let i = 0; i < bs; i++) y[i] = x[i]! ^ last[i]!;
  return enc(y);
}

/** The CMAC tag of `data` under `key` with the block cipher `algorithm` ("AES" or "TDES"). */
export function cmac(data: Uint8Array, key: Uint8Array, algorithm: string): Uint8Array {
  if (algorithm === "AES") {
    checkAesKey(key);
    return cmacWith(data, (b) => blockEncrypt(b, key), 16, 0x87);
  }
  if (algorithm === "TDES") {
    checkTdesKey(key);
    return cmacWith(data, (b) => tdesEncryptBlock(b, key), 8, 0x1b);
  }
  throw rangeFailure(`unknown CMAC cipher '${algorithm.slice(0, 20)}'`);
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("cmac", "_mac", "( data:bytes key:bytes algorithm:str -- bytes )", cmac, {
    doc: "CMAC (SP 800-38B) over AES or Triple DES (private helper of cmac:digest).",
    category: "Hashing",
  }),
];
