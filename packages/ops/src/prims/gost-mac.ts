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
 * gost-mac primitives: the GOST 28147-89 MAC ("imitovstavka", IMIT, RFC 5830 section 8) with a MAC of 1 to 8 bytes,
 * for vocab/gost-mac.fth (CyberChef's GOST Sign and GOST Verify, which are this MAC and the MACs of the 2015
 * ciphers, not a public key signature). The IMIT is the cipher's round function run 16 times (the keys K1 to K8
 * twice) over each block of the data, zero-padded, xor-ed into a register that starts as the IV; the MAC is the first
 * bytes of the final register, N1 then N2, little-endian. The 4-byte form is also inside src/prims/gost28147.ts,
 * whose round-function tables (tablesFor) this file uses; src/gost-mac.test.ts checks, for every S-box, that this MAC
 * equals the CEK_MAC of the `gost28147:wrap-key` words.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { getLE32 } from "../cipher-util.js";
import { rangeFailure } from "../prim-util.js";
import { tablesFor } from "./gost28147.js";

/**
 * The IMIT of `data` under the 32-byte `key` and S-box set `sbox`, starting from the 8-byte register `iv`, as the
 * first `size` bytes (1 to 8) of the final register.
 */
export function imit(
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  sbox: string,
  size: number,
): Uint8Array {
  if (!(key instanceof Uint8Array) || key.length !== 32)
    throw rangeFailure(
      `the GOST 28147-89 key must be 32 bytes, not ${(key as Uint8Array)?.length}`,
    );
  if (!(iv instanceof Uint8Array) || iv.length !== 8)
    throw rangeFailure(`the GOST 28147-89 IV must be 8 bytes, not ${(iv as Uint8Array)?.length}`);
  if (!Number.isInteger(size) || size < 1 || size > 8)
    throw rangeFailure(`the MAC length must be 1 to 8 bytes, not ${String(size)}`);
  const t = tablesFor(sbox);
  const k = new Uint32Array(8);
  for (let i = 0; i < 8; i++) k[i] = getLE32(key, 4 * i);
  let n1 = getLE32(iv, 0);
  let n2 = getLE32(iv, 4);
  const blocks = Math.ceil(data.length / 8);
  const padded = new Uint8Array(blocks * 8);
  padded.set(data);
  for (let b = 0; b < blocks; b++) {
    n1 = (n1 ^ getLE32(padded, 8 * b)) >>> 0;
    n2 = (n2 ^ getLE32(padded, 8 * b + 4)) >>> 0;
    for (let r = 0; r < 16; r++) {
      const x = (n1 + k[r & 7]!) >>> 0;
      const f =
        (t[0]![x & 255]! |
          t[1]![(x >>> 8) & 255]! |
          t[2]![(x >>> 16) & 255]! |
          t[3]![x >>> 24]!) >>>
        0;
      const nf = (f ^ n2) >>> 0;
      n2 = n1;
      n1 = nf;
    }
  }
  const reg = new Uint8Array(8);
  for (let i = 0; i < 4; i++) {
    reg[i] = (n1 >>> (8 * i)) & 255;
    reg[4 + i] = (n2 >>> (8 * i)) & 255;
  }
  return reg.slice(0, size);
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "gost-mac",
    "_imit",
    "( data:bytes key:bytes iv:bytes sbox:str size:int -- bytes )",
    imit,
    {
      doc: "The GOST 28147-89 IMIT of the data, the first size bytes (1 to 8) of the register (private helper of gost-mac:sign).",
      category: "Encryption",
    },
  ),
];
