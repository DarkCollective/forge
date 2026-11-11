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
 * of the CRC words and its loop is the shared `crcRegister` of src/prims/crc.ts; what stays here is
 * one call for all 171 presets (the preset table of `util:crc-presets` is parsed and the words are
 * called once per preset otherwise, which is a few thousand VM steps each). The test
 * (generate-all.test.ts) holds the result equal to `crc:checksum` for every preset. Presets with
 * the same parameters are computed once.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { coerceFailure } from "../prim-util.js";
import { crcRegister } from "./crc.js";

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
      const value = crcRegister(
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
