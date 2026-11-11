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
 * packets primitives, two, each justified by measurement:
 *  - `_name ( table key -- str )`: the lookup of a number in the name tables of src/packets-names.ts
 *    (EtherTypes, IP protocols, option kinds, the TLS registries with about 335 cipher suites). FL has no
 *    per-vocabulary constants, so an FL table would be rebuilt on every call; the primitive builds each map
 *    once and a lookup is 2 VM steps (the precedent is `asn1:oid-name`).
 *  - `_walk ( data start end skip width partial -- list )`: the offsets of the items of a sequence in which
 *    every item is `skip` bytes, a big-endian length of `width` bytes, and that many bytes (TLS records,
 *    handshake messages, extensions and the vectors inside them). Each offset depends on the length before
 *    it, and collecting them in FL grows a list one item at a time, which is quadratic and metered as
 *    allocation (the precedent is `tar:_headers`).
 * Everything else in the vocabulary (the header layouts, the option walks, the TLS hello reader, the
 * reports) is FL.
 */
import { definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef } from "@forge/lang";
import { NAME_TABLES, nameOf } from "../packets-names.js";
import { coerceFailure, guardResult, rangeFailure } from "../prim-util.js";

const { int } = valueHelpers;

/** The name of a number in a table, or the empty string. */
export function lookupName(table: unknown, key: unknown): string {
  if (typeof table !== "string") throw rangeFailure("the table must be text");
  if (typeof key !== "number" || !Number.isSafeInteger(key))
    throw rangeFailure("the key must be an integer that fits in a number");
  const name = nameOf(table, key);
  if (name === undefined)
    throw rangeFailure(`unknown name table '${table}' (known: ${NAME_TABLES.join(", ")})`);
  return name;
}

function intArg(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v))
    throw rangeFailure(`${what} must be an integer that fits in a number`);
  return v;
}

/**
 * The offsets of the items of data[start, end): an item is `skip` bytes, then a length of `width` bytes
 * (big-endian), then that many bytes. A length is only compared with the bytes that are left, so nothing is
 * allocated from it. An item whose header or body runs past `end` is `E_COERCE`, except with `partial`: then
 * it is the last offset in the list and the caller looks at what is there (a handshake message that goes on
 * in the next record).
 */
export function walkOffsets(
  data: Uint8Array,
  start: number,
  end: number,
  skip: number,
  width: number,
  partial: boolean,
  what: string,
): number[] {
  if (start < 0 || end < start || end > data.length)
    throw rangeFailure(`the window ${start} to ${end} is outside the ${data.length} bytes of data`);
  if (skip < 0 || skip > 16) throw rangeFailure("the skip must be 0 to 16 bytes");
  if (width < 1 || width > 4) throw rangeFailure("the length width must be 1 to 4 bytes");
  const head = skip + width;
  const out: number[] = [];
  let p = start;
  while (p < end) {
    if (p + head > end) {
      if (partial) {
        out.push(p);
        break;
      }
      throw coerceFailure(
        "packet data",
        "list",
        `${what} at offset ${p} is cut short: its header needs ${head} bytes and ${end - p} are left`,
      );
    }
    let len = 0;
    for (let i = 0; i < width; i++) len = len * 256 + (data[p + skip + i] as number);
    out.push(p);
    if (p + head + len > end) {
      if (partial) break;
      throw coerceFailure(
        "packet data",
        "list",
        `${what} at offset ${p} declares ${len} bytes but only ${end - p - head} are left (truncated)`,
      );
    }
    p += head + len;
  }
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "packets",
    "_walk",
    "( data:bytes start:int end:int skip:int width:int partial:bool what:str -- list )",
    (
      data: Uint8Array,
      start: unknown,
      end: unknown,
      skip: unknown,
      width: unknown,
      partial: boolean,
      what: string,
      ctx: PrimitiveContext,
    ) => {
      const st = intArg(start, "the start");
      const e = intArg(end, "the end");
      const w = intArg(width, "the length width");
      guardResult(
        ctx,
        Math.ceil(Math.max(e - st, 0) / (1 + Math.max(w, 0))) * 8,
        "the item offsets",
      );
      return walkOffsets(data, st, e, intArg(skip, "the skip"), w, partial, what).map((p) =>
        int(p),
      );
    },
    {
      doc: "The offsets of the items of a sequence in data[start, end), each item being skip bytes, a big-endian length of width bytes (1 to 4) and that many bytes; what names the item in the error. An item that runs past the end is E_COERCE, or with partial the last offset of the list (a window outside the data is E_RANGE). Private helper of the packets vocabulary (TLS records, handshake messages, extensions).",
    },
  ),
  definePrimitive("packets", "_name", "( table:str key:int -- str )", lookupName, {
    doc: "The registry name of a number in a named table (ethertype, ip-protocol, ip-option, tcp-option, tls-content, tls-version, tls-handshake, tls-alert, tls-extension, tls-group, tls-signature, tls-point-format, tls-compression, tls-cert-compression, tls-psk-mode, tls-cipher), the empty string when the number has none, GREASE for an RFC 8701 value in the TLS tables that allow it; an unknown table is E_RANGE (private helper of the packets vocabulary).",
  }),
];
