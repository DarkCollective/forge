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
 * tlv primitive: the flat walk over a run of tag-length-value elements. Growing the result list one element at a
 * time in FL is quadratic (the tar and zip walks measured the same), so the walk is a primitive; the parameters,
 * the checks and the JSON text are FL.
 *
 *  - `_parse ( data:bytes tag-bytes:int length-bytes:int ber:bool -- list )`: a record per element with `type`
 *    (the tag bytes as lower-case hex), `length` (an int) and `value` (the value bytes as lower-case hex). The tag
 *    is `tag-bytes` bytes (1 to 16). The length is `length-bytes` bytes (1 to 8), big-endian, or with `ber` the
 *    BER/DER form of X.690 (a byte below 0x80, or 0x80 + n followed by n length bytes, n up to 6; the indefinite
 *    form 0x80 and the reserved 0xff are E_COERCE) and `length-bytes` is not used. A header or value that runs past
 *    the data is E_COERCE with the offset (a length is only compared with the bytes that are left); empty data is
 *    an empty list.
 */
import { definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef, Value } from "@forge/lang";
import { Meter, formatFailure } from "../data-format-util.js";
import { rangeFailure } from "../prim-util.js";

const { int, str, record } = valueHelpers;

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function hex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += HEX[b[i] as number];
  return s;
}

function parse(
  data: Uint8Array,
  tagBytes: number | bigint,
  lengthBytes: number | bigint,
  ber: boolean,
  ctx: PrimitiveContext,
): Value[] {
  const tw = Number(tagBytes);
  const lw = Number(lengthBytes);
  if (!(tw >= 1 && tw <= 16)) throw rangeFailure("the tag width must be 1 to 16 bytes");
  if (!(lw >= 1 && lw <= 8)) throw rangeFailure("the length width must be 1 to 8 bytes");
  const meter = new Meter(ctx.limits.maxValueBytes, "parsed TLV list");
  const out: Value[] = [];
  let p = 0;
  while (p < data.length) {
    const at = p;
    if (data.length - p < tw)
      throw formatFailure(
        "TLV",
        `the tag at offset ${at} needs ${tw} bytes but only ${data.length - p} are left (truncated)`,
        at,
      );
    const type = hex(data.subarray(p, p + tw));
    p += tw;
    let len: number;
    if (ber) {
      if (p >= data.length) throw formatFailure("TLV", "the length is missing (truncated)", p);
      const b = data[p++] as number;
      if (b < 0x80) len = b;
      else {
        const n = b & 0x7f;
        if (b === 0x80)
          throw formatFailure("TLV", "the indefinite BER length is not supported", p - 1);
        if (b === 0xff) throw formatFailure("TLV", "the BER length byte 0xff is reserved", p - 1);
        if (n > 6) throw formatFailure("TLV", `a BER length of ${n} bytes is too long`, p - 1);
        if (data.length - p < n)
          throw formatFailure(
            "TLV",
            `the length needs ${n} bytes but only ${data.length - p} are left (truncated)`,
            p,
          );
        len = 0;
        for (let i = 0; i < n; i++) len = len * 256 + (data[p + i] as number);
        p += n;
      }
    } else {
      if (data.length - p < lw)
        throw formatFailure(
          "TLV",
          `the length needs ${lw} bytes but only ${data.length - p} are left (truncated)`,
          p,
        );
      let big = 0n;
      for (let i = 0; i < lw; i++) big = (big << 8n) | BigInt(data[p + i] as number);
      p += lw;
      if (big > BigInt(data.length - p))
        throw formatFailure(
          "TLV",
          `the value declares ${big} bytes but only ${data.length - p} are left (truncated)`,
          p,
        );
      len = Number(big);
    }
    if (len > data.length - p)
      throw formatFailure(
        "TLV",
        `the value declares ${len} bytes but only ${data.length - p} are left (truncated)`,
        p,
      );
    meter.add(160 + 2 * tw + 4 * len);
    out.push(
      record([
        ["type", str(type)],
        ["length", int(len)],
        ["value", str(hex(data.subarray(p, p + len)))],
      ]),
    );
    p += len;
  }
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "tlv",
    "_parse",
    "( data:bytes tag-bytes:int length-bytes:int ber:bool -- list )",
    parse,
    {
      doc: "The tag-length-value elements of the bytes as records of type, length and value (private helper of tlv:parse).",
      category: "Data format",
    },
  ),
];
