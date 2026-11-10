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
 * generate-all primitive. Only `_crcs` is a primitive: the CRC of the same data under many presets
 * at once, for `generate-all:checksums`. The FL `crc` vocabulary (vocab/crc.fth) is the definition
 * of the CRC words; it takes about 0.9 to 1.3 million VM steps for 64 KiB per preset and rebuilds
 * its table on every call, so 171 presets would be about 200 million steps against a limit of 10
 * million. This is the one place where the model is written a second time, for speed only; the
 * test (generate-all.test.ts) holds it equal to `crc:checksum` for every preset. Presets with
 * the same parameters are computed once.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { coerceFailure } from "../prim-util.js";

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
  const top = wp - 1;
  const p = (poly << shift) >>> 0;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let reg = (i << (wp - 8)) >>> 0;
    for (let b = 0; b < 8; b++) reg = (((reg << 1) & mask) ^ ((reg >>> top) & 1 ? p : 0)) >>> 0;
    table[i] = reg;
  }
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
 * For each line "name width poly init refin refout xorout" (hex numbers, T or F flags) the CRC of
 * `data` as hex text of ceil(width / 4) digits, one result per line.
 */
export function crcs(data: Uint8Array, lines: string): string {
  const cache = new Map<string, string>();
  const out: string[] = [];
  for (const line of lines.split("\n")) {
    if (line === "") continue;
    const f = line.split(" ");
    if (f.length !== 7) throw coerceFailure("CRC preset", "text", `bad preset line: ${line}`);
    const [, ws, poly, init, rin, rout, xo] = f as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const key = f.slice(1).join(" ");
    let hex = cache.get(key);
    if (hex === undefined) {
      const w = Number(ws);
      if (!Number.isInteger(w) || w < 1 || w > 82)
        throw coerceFailure("CRC preset", "text", `bad width in: ${line}`);
      const digits = Math.ceil(w / 4);
      const refin = rin === "T";
      const refout = rout === "T";
      const value =
        w <= 32
          ? BigInt(
              crcSmall(
                data,
                w,
                parseInt(poly, 16),
                parseInt(init, 16),
                refin,
                refout,
                parseInt(xo, 16),
              ),
            )
          : crcBig(
              data,
              w,
              BigInt(`0x${poly}`),
              BigInt(`0x${init}`),
              refin,
              refout,
              BigInt(`0x${xo}`),
            );
      hex = value.toString(16).padStart(digits, "0");
      cache.set(key, hex);
    }
    out.push(hex);
  }
  return out.join("\n");
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("generate-all", "_crcs", "( data:bytes lines:str -- str )", crcs, {
    doc: "The CRC of the data under each preset line, as hex text, one per line (private helper of generate-all:checksums).",
    category: "Hashing",
  }),
];
