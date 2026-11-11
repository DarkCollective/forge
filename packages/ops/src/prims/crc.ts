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
 * crc primitive: the table-driven per-byte loop of the Rocksoft/Williams CRC model, for the FL words of
 * vocab/crc.fth. In FL the loop costs about 13 VM steps a byte, which capped a checksum near 750 KB under
 * the default step limit (and the CRC-32 of a gunzip or a zip with it). The parameters, the preset
 * table, the metadata and the formatting of the result stay in FL. One private primitive:
 *
 *  - `_crc ( data width poly init refin refout xorout -- int )`: the CRC register of the data as an
 *    integer, for a width of 1 to 82 bits (up to 32 bits in numbers, more in BigInt). Same model as
 *    `crc:custom`: `poly` is the polynomial without its top bit, `refin` reflects each input byte, `refout`
 *    reflects the register before `xorout`.
 *
 * `crcRegister` is also what `generate-all:_crcs` runs for its many presets (src/prims/generate-all.ts).
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { rangeFailure } from "../prim-util.js";

function reflect(v: number, w: number): number {
  let r = 0;
  for (let i = 0; i < w; i++) r = r * 2 + ((v >>> i) & 1);
  return r;
}

const REFLECT8 = Uint8Array.from({ length: 256 }, (_, i) => reflect(i, 8));

function reflectBig(v: bigint, w: number): bigint {
  let r = 0n;
  for (let i = 0; i < w; i++) r = (r << 1n) | ((v >> BigInt(i)) & 1n);
  return r;
}

/**
 * The 256-entry table of the MSB-first algorithm for a register of `wp` bits (8 to 32) and a polynomial
 * already shifted to the top of the register. bzip2's block CRC (src/prims/bzip2.ts) uses the same table.
 */
export function msbTable(wp: number, poly: number): Uint32Array {
  const mask = wp === 32 ? 0xffffffff : (1 << wp) - 1;
  const top = wp - 1;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let reg = (i << (wp - 8)) >>> 0;
    for (let b = 0; b < 8; b++) reg = (((reg << 1) & mask) ^ ((reg >>> top) & 1 ? poly : 0)) >>> 0;
    table[i] = reg;
  }
  return table;
}

/** The register of a CRC of width <= 32 over data, with the Rocksoft model (numbers). */
function crcSmall(
  data: Uint8Array,
  w: number,
  poly: number,
  init: number,
  refin: boolean,
  refout: boolean,
  xorout: number,
): number {
  // A register of at least one byte, so that a byte can be xored in at the top.
  const wp = Math.max(w, 8);
  const shift = wp - w;
  const mask = wp === 32 ? 0xffffffff : (1 << wp) - 1;
  const table = msbTable(wp, (poly << shift) >>> 0);
  let reg = (init << shift) >>> 0;
  const lowShift = wp - 8;
  for (let i = 0; i < data.length; i++) {
    let b = data[i] as number;
    if (refin) b = REFLECT8[b] as number;
    const idx = ((reg >>> lowShift) ^ b) & 255;
    reg = ((((reg << 8) & mask) >>> 0) ^ (table[idx] as number)) >>> 0;
  }
  let out = reg >>> shift;
  if (refout) out = reflect(out, w);
  return (out ^ xorout) >>> 0;
}

/** The same for 33 to 82 bits (BigInt registers). */
function crcBig(
  data: Uint8Array,
  w: number,
  poly: bigint,
  init: bigint,
  refin: boolean,
  refout: boolean,
  xorout: bigint,
): bigint {
  const mask = (1n << BigInt(w)) - 1n;
  const top = BigInt(w - 1);
  const table: bigint[] = [];
  for (let i = 0; i < 256; i++) {
    let reg = BigInt(i) << BigInt(w - 8);
    for (let b = 0; b < 8; b++) reg = ((reg << 1n) & mask) ^ ((reg >> top) & 1n ? poly : 0n);
    table.push(reg);
  }
  let reg = init;
  const low = BigInt(w - 8);
  for (let i = 0; i < data.length; i++) {
    let b = data[i] as number;
    if (refin) b = REFLECT8[b] as number;
    const idx = Number(((reg >> low) ^ BigInt(b)) & 255n);
    reg = ((reg << 8n) & mask) ^ (table[idx] as bigint);
  }
  if (refout) reg = reflectBig(reg, w);
  return reg ^ xorout;
}

/**
 * The CRC of `data` in the Rocksoft model, for a width of 1 to 82 bits. `poly`, `init` and `xorout` must
 * already fit in `width` bits (the FL words mask them).
 */
export function crcRegister(
  data: Uint8Array,
  width: number,
  poly: bigint,
  init: bigint,
  refin: boolean,
  refout: boolean,
  xorout: bigint,
): bigint {
  if (!Number.isInteger(width) || width < 1 || width > 82)
    throw rangeFailure(`the CRC width must be 1 to 82, not ${String(width)}`);
  if (width <= 32)
    return BigInt(crcSmall(data, width, Number(poly), Number(init), refin, refout, Number(xorout)));
  return crcBig(data, width, poly, init, refin, refout, xorout);
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "crc",
    "_crc",
    "( data:bytes width:int poly:int init:int refin:bool refout:bool xorout:int -- int )",
    (
      data: Uint8Array,
      width: number | bigint,
      poly: number | bigint,
      init: number | bigint,
      refin: boolean,
      refout: boolean,
      xorout: number | bigint,
    ) =>
      crcRegister(data, Number(width), BigInt(poly), BigInt(init), refin, refout, BigInt(xorout)),
    {
      doc: "The CRC register of the bytes under the Rocksoft model (width 1 to 82, polynomial without its top bit, init, reflect in, reflect out, xor out), computed byte by byte from a table (private helper of crc:custom and crc:checksum).",
      category: "Hashing",
    },
  ),
];
