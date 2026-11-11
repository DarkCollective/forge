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
 * protobuf primitive: the schemaless reader of the Protocol Buffers wire format (varints, 64-bit and 32-bit
 * fixed values, length-delimited fields) that builds a JSON value in CyberChef's layout. A reader that visits
 * every field in FL costs several hundred VM steps a field (the measure of the other data formats, see the
 * wave 7 conventions), which would cap a 64 KiB message far below the value limit, so the walk is a primitive;
 * the JSON text, the parameters and the checks are FL.
 *
 *  - `_decode ( data:bytes types:bool -- any )`: the fields of the message in the bytes as a record keyed by
 *    field number (ascending, as JavaScript orders integer keys, so CyberChef shows them so), a field that
 *    appears again becomes a list of its values in wire order. A varint, a fixed64 and a fixed32 are exact
 *    unsigned integers (a varint up to 64 bits, 10 bytes). A length-delimited field is read as a nested message
 *    if its bytes parse completely as one (CyberChef's guess; an empty field is an empty record), else as text
 *    if they are valid UTF-8, else as their hex digits. With `types` set the keys read
 *    `field #N: VarInt (e.g. int32, bool)` and so on, CyberChef's wire type labels.
 *  - Field number 0 and numbers above 2^29-1 are not fields: the top level refuses them, a nested guess fails
 *    on them (CyberChef accepts field 0). Wire types 3 and 4 (groups) and 6 and 7 are refused at the top level
 *    and make a nested guess fail. Nesting stops at 64 levels (a deeper message stays text or hex). Nothing is
 *    allocated from a length: it is compared with the bytes that are left. The size of the value is held to
 *    `limits.maxValueBytes` while it grows.
 */
import { definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef, Value } from "@forge/lang";
import { Meter, decodeStrict, formatFailure } from "../data-format-util.js";

const { int, str, list, record } = valueHelpers;

/** Nested messages are tried to this depth. */
export const MAX_NESTING = 64;

/** CyberChef's labels of the wire types, shown next to the field number when `types` is set. */
const WIRE_LABEL: Record<number, string> = {
  0: "VarInt (e.g. int32, bool)",
  1: "64-Bit (e.g. fixed64, double)",
  2: "L-delim (e.g. string, message)",
  5: "32-Bit (e.g. fixed32, float)",
};

/** A fault in the wire data, with where it is. A nested guess catches it; the top level reports it. */
class Bad {
  constructor(
    readonly reason: string,
    readonly at: number,
  ) {}
}

/** Not text: the bytes are not valid UTF-8. */
class NotText {}

interface Entry {
  wire: number;
  values: Value[];
}

function decode(data: Uint8Array, types: boolean, ctx: PrimitiveContext): Value {
  const meter = new Meter(ctx.limits.maxValueBytes, "decoded Protobuf value");
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);

  /** The varint at p: a number, or a bigint above 2^53; and the offset after it. */
  function varint(p: number, end: number): [number | bigint, number] {
    let lo = 0;
    let big = 0n;
    for (let i = 0; i < 10; i++) {
      if (p + i >= end) throw new Bad("a varint is cut short (truncated)", p);
      const b = data[p + i] as number;
      if (i === 9 && b > 1) throw new Bad("a varint is more than 64 bits", p);
      if (i < 7) lo += (b & 127) * 2 ** (7 * i);
      else big += BigInt(b & 127) << BigInt(7 * i);
      if (b < 128) {
        if (i < 7) return [lo, p + i + 1];
        const v = BigInt(lo) + big;
        return [v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v, p + i + 1];
      }
      if (i === 9) throw new Bad("a varint is longer than 10 bytes", p);
    }
    throw new Bad("a varint is longer than 10 bytes", p);
  }

  /** A fixed-width unsigned integer, exact. */
  const fixed = (v: bigint): number | bigint => (v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v);

  /** The bytes [p, p+len) as text if valid UTF-8, else as hex digits. */
  function textOrHex(p: number, len: number): Value {
    const b = data.subarray(p, p + len);
    meter.add(64 + 2 * len);
    try {
      return str(
        decodeStrict(b, "utf-8", () => {
          throw new NotText();
        }),
      );
    } catch (e) {
      if (!(e instanceof NotText)) throw e;
      let hex = "";
      for (let i = 0; i < b.length; i++) hex += (b[i] as number).toString(16).padStart(2, "0");
      return str(hex);
    }
  }

  /** The value of a length-delimited field: a message if the bytes parse as one, else text, else hex. */
  function delimited(p: number, len: number, depth: number): Value {
    if (depth < MAX_NESTING) {
      const saved = meter.size;
      try {
        return message(p, p + len, depth + 1);
      } catch (e) {
        if (!(e instanceof Bad)) throw e;
        meter.size = saved;
      }
    }
    return textOrHex(p, len);
  }

  /** The record of the message in [p0, end): throws Bad when the bytes are not a whole message. */
  function message(p0: number, end: number, depth: number): Value {
    const fields = new Map<number, Entry>();
    let p = p0;
    while (p < end) {
      const at = p;
      const [tag, afterTag] = varint(p, end);
      p = afterTag;
      if (typeof tag === "bigint" || tag >= 2 ** 32) throw new Bad("a field number is too large", at);
      const wire = tag % 8;
      const field = Math.floor(tag / 8);
      if (field === 0) throw new Bad("field number 0 is not a field", at);
      let value: Value;
      meter.add(96);
      if (wire === 0) {
        const [v, next] = varint(p, end);
        p = next;
        value = int(v);
      } else if (wire === 1) {
        if (end - p < 8) throw new Bad(`a 64-bit field is cut short: ${end - p} of 8 bytes are left (truncated)`, p);
        value = int(fixed(dv.getBigUint64(p, true)));
        p += 8;
      } else if (wire === 5) {
        if (end - p < 4) throw new Bad(`a 32-bit field is cut short: ${end - p} of 4 bytes are left (truncated)`, p);
        value = int(dv.getUint32(p, true));
        p += 4;
      } else if (wire === 2) {
        const [len, next] = varint(p, end);
        p = next;
        if (typeof len === "bigint" || len > end - p)
          throw new Bad(`a length-delimited field declares ${String(len)} bytes but only ${end - p} are left (truncated)`, at);
        value = delimited(p, len, depth);
        p += len;
      } else {
        throw new Bad(
          `wire type ${wire} (${wire === 3 ? "start group" : wire === 4 ? "end group" : "reserved"}) is not supported`,
          at,
        );
      }
      const e = fields.get(field);
      if (e === undefined) fields.set(field, { wire, values: [value] });
      else e.values.push(value);
    }
    const keys = [...fields.keys()].sort((a, b) => a - b);
    return record(
      keys.map((k): [string, Value] => {
        const e = fields.get(k) as Entry;
        const key = types ? `field #${k}: ${WIRE_LABEL[e.wire] ?? "unknown"}` : String(k);
        return [key, e.values.length === 1 ? (e.values[0] as Value) : list(e.values)];
      }),
    );
  }

  try {
    return message(0, data.length, 0);
  } catch (e) {
    if (e instanceof Bad) throw formatFailure("Protobuf", e.reason, e.at);
    throw e;
  }
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("protobuf", "_decode", "( data:bytes types:bool -- any )", decode, {
    doc: "The fields of a Protocol Buffers message without a schema, as a JSON value keyed by field number (private helper of protobuf:decode).",
    category: "Networking",
  }),
];
