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
 * whose block cipher tables are private to it; the S-box tables below are a copy of that file's (src/gost-mac.test.ts
 * checks, for every S-box, that this MAC equals the CEK_MAC of the `gost28147:wrap-key` words, which uses that file's).
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { fromHex } from "../hash-util.js";
import { getLE32 } from "../cipher-util.js";
import { rangeFailure } from "../prim-util.js";
import { SBOXES as DIGEST_SBOXES } from "./gost.js";

/** RFC 4357 section 11.1: the 64-byte cipher S-boxes. */
const CIPHER_SBOXES: Readonly<Record<string, string>> = {
  "E-TEST":
    "4cde389c2989efb6ffeb56c55ec29b029875613b113f896003970c798aa1d55de210ad43375db38eb42c77e7cd46cafad66a201f70f41ea4ab03f22165b844d8",
  "E-A":
    "93eeb31b67475ada3e6a1d2f292c9c9588bd8170ba31d2ac1fd3f06e70890b08a5c0e78642f245c2e65b2943fca43459cb0fc8f104787f37dd15aebd519666e4",
  "E-B":
    "80e7285041c57324b200c2ab1aadf6be349b94985d265d1305d1aec79cb2bb3129731c7ae75a4142a38c07d9cfffdf06db346a6f686e80fd7619e985fe4835ec",
  "E-C":
    "10838ca7b126d994c750bb602d0101859b4548dad49d5ee205fa122ff2a8240e483b97fc5e7233368fc9c651ecd7e5bba96e6a4d7aeff019661cafc333b47d78",
  "E-D":
    "fb110831c6c5c00a23be8f66a40c93f86cfad21f4fe725eb5e60ae90025dbb2477a671dc9dd23a83e84b64c5d084574915994cb7ba33e9ad897ffd523128167e",
};

/** RFC 8891 section 4.1, pi'_0..pi'_7: the id-tc26-gost-28147-param-Z set, one array per nibble position. */
const PI_Z: readonly (readonly number[])[] = [
  [12, 4, 6, 2, 10, 5, 11, 9, 14, 8, 13, 7, 0, 3, 15, 1],
  [6, 8, 2, 3, 9, 10, 5, 12, 1, 14, 4, 7, 11, 13, 0, 15],
  [11, 3, 5, 8, 2, 15, 10, 13, 14, 1, 7, 4, 12, 9, 6, 0],
  [12, 8, 2, 1, 13, 4, 15, 6, 7, 0, 10, 5, 3, 14, 9, 11],
  [7, 15, 5, 10, 8, 1, 6, 13, 0, 9, 3, 14, 11, 4, 2, 12],
  [5, 13, 15, 6, 9, 2, 12, 10, 11, 7, 8, 1, 4, 3, 14, 0],
  [8, 14, 2, 5, 6, 9, 1, 12, 15, 4, 11, 0, 13, 10, 3, 7],
  [1, 7, 14, 13, 0, 5, 8, 3, 4, 15, 10, 6, 9, 12, 11, 2],
];

/** The S-box as nibble substitutions: sub[16 * j + v] for nibble position j (0 = lowest) and value v. */
function substitutions(name: string): Uint8Array {
  const sub = new Uint8Array(128);
  if (name === "E-Z") {
    for (let j = 0; j < 8; j++) for (let v = 0; v < 16; v++) sub[16 * j + v] = PI_Z[j]![v]!;
    return sub;
  }
  const hex =
    name === "D-TEST"
      ? DIGEST_SBOXES.test
      : name === "D-A"
        ? DIGEST_SBOXES.cryptopro
        : Object.hasOwn(CIPHER_SBOXES, name)
          ? CIPHER_SBOXES[name]
          : undefined;
  if (hex === undefined) throw rangeFailure(`unknown GOST S-box '${name.slice(0, 20)}'`);
  const b = fromHex(hex);
  for (let j = 0; j < 8; j++)
    for (let v = 0; v < 16; v++) {
      const byte = b[4 * v + (j >> 1)]!;
      sub[16 * j + v] = j & 1 ? byte & 15 : byte >> 4;
    }
  return sub;
}

/** Four 256-entry tables: the substitution of byte p of the sum, already rotated left by 11. */
function makeTables(name: string): Uint32Array[] {
  const sub = substitutions(name);
  const tables: Uint32Array[] = [];
  for (let p = 0; p < 4; p++) {
    const t = new Uint32Array(256);
    for (let x = 0; x < 256; x++) {
      const v = ((sub[16 * (2 * p + 1) + (x >> 4)]! << 4) | sub[16 * 2 * p + (x & 15)]!) << (8 * p);
      t[x] = ((v << 11) | (v >>> 21)) >>> 0;
    }
    tables.push(t);
  }
  return tables;
}

const tableCache = new Map<string, Uint32Array[]>();

function tablesFor(name: string): Uint32Array[] {
  let t = tableCache.get(name);
  if (t === undefined) {
    t = makeTables(name);
    tableCache.set(name, t);
  }
  return t;
}

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
