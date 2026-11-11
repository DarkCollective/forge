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
 * avro primitives: the Apache Avro 1.11 binary encoding and Object Container File, written from the specification
 * (no library). The container (header, blocks, the codec choice and the deflate codec through the deflate words)
 * is walked here and in FL; the datum decoder is a primitive for the same reason as cbor (a node-by-node reader in
 * FL costs several hundred VM steps an element).
 *
 *  - `_header ( data:bytes -- schema:str codec:str blocks:list )`: the magic "Obj" 0x01, the metadata map (the
 *    avro.schema JSON text and the avro.codec name, "null" when absent), the 16-byte sync marker and every block
 *    as a record `count` (the number of data) and `data` (the still compressed bytes). A block's size is compared
 *    with the bytes that are left, each block must end with the sync marker, and anything else (a cut-short file, a
 *    wrong marker, bytes after the last block) is E_COERCE with the offset.
 *  - `_decode ( data:bytes schema:str count:int -- list )`: exactly `count` data of the schema, filling `data`
 *    exactly. The schema is JSON: the primitive types, record (and error), enum, array, map, fixed, unions and
 *    named references (a record may refer to itself); logical types are ignored (the underlying value is shown).
 *    Values: null as null, a long as an exact integer, float and double as numbers (NaN and the infinities null),
 *    bytes and fixed as {"type":"Buffer","data":[...]} (CyberChef shows the avsc Buffer through JSON.stringify), an
 *    enum as its symbol, a union as the value of its branch (not wrapped in {"type": value}, which avsc does only
 *    when the branch is ambiguous), a map as an object (a repeated key is E_COERCE). Bad varints, an int outside 32
 *    bits, a long outside 64 bits, a boolean that is not 0 or 1, a union or enum index out of range, a negative
 *    length, a cut-short datum, invalid UTF-8, nesting deeper than 64 and bytes left over are E_COERCE with the
 *    offset. A count is only compared with the value budget (a datum of no bytes, like null, is metered).
 */
import { ForgeError, definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef, Value } from "@forge/lang";
import {
  intValue,
  MAX_DEPTH,
  Meter,
  bufferValue,
  formatFailure,
  nullValue,
  strictUtf8,
} from "../data-format-util.js";

const { int, num, str, list, record } = valueHelpers;

type Schema =
  | { kind: "null" | "boolean" | "int" | "long" | "float" | "double" | "bytes" | "string" }
  | { kind: "record"; fields: { name: string; type: Schema }[] }
  | { kind: "enum"; symbols: string[] }
  | { kind: "array"; items: Schema }
  | { kind: "map"; values: Schema }
  | { kind: "union"; branches: Schema[] }
  | { kind: "fixed"; size: number };

const PRIMITIVES = new Set([
  "null",
  "boolean",
  "int",
  "long",
  "float",
  "double",
  "bytes",
  "string",
]);
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function schemaFailure(reason: string): ForgeError {
  return new ForgeError({
    code: "E_COERCE",
    message: `cannot read Avro schema: ${reason}`,
    detail: { from: "str", to: "Avro schema", reason },
  });
}

function compileSchema(text: string): Schema {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw schemaFailure("the schema is not valid JSON");
  }
  const names = new Map<string, Schema>();

  const qualify = (name: string, ns: string): string =>
    name.includes(".") || ns === "" ? name : `${ns}.${name}`;

  function define(obj: Record<string, unknown>, ns: string): { full: string; ns: string } {
    const n = obj.name;
    if (typeof n !== "string" || n === "") throw schemaFailure("a named type has no name");
    const parts = n.split(".");
    for (const part of parts)
      if (!NAME.test(part)) throw schemaFailure(`${JSON.stringify(n)} is not a valid name`);
    let space = ns;
    if (n.includes(".")) space = parts.slice(0, -1).join(".");
    else if (typeof obj.namespace === "string") space = obj.namespace;
    const full = n.includes(".") ? n : space === "" ? n : `${space}.${n}`;
    if (names.has(full)) throw schemaFailure(`the name ${full} is defined twice`);
    return { full, ns: space };
  }

  function go(node: unknown, ns: string, depth: number): Schema {
    if (depth > MAX_DEPTH) throw schemaFailure(`nesting deeper than ${MAX_DEPTH} levels`);
    if (typeof node === "string") {
      if (PRIMITIVES.has(node)) return { kind: node } as Schema;
      const hit = names.get(qualify(node, ns)) ?? names.get(node);
      if (hit === undefined) throw schemaFailure(`the type ${JSON.stringify(node)} is not defined`);
      return hit;
    }
    if (Array.isArray(node)) {
      const branches = node.map((b) => go(b, ns, depth + 1));
      for (const b of branches)
        if (b.kind === "union") throw schemaFailure("a union cannot directly hold a union");
      return { kind: "union", branches };
    }
    if (typeof node !== "object" || node === null)
      throw schemaFailure("a type must be a name, an array or an object");
    const obj = node as Record<string, unknown>;
    const t = obj.type;
    if (typeof t !== "string") {
      if (t === undefined) throw schemaFailure("a type object has no type");
      return go(t, ns, depth + 1);
    }
    if (PRIMITIVES.has(t)) return { kind: t } as Schema;
    switch (t) {
      case "record":
      case "error": {
        const { full, ns: space } = define(obj, ns);
        const out: Schema = { kind: "record", fields: [] };
        names.set(full, out);
        if (!Array.isArray(obj.fields))
          throw schemaFailure(`the record ${full} has no fields array`);
        const seen = new Set<string>();
        for (const f of obj.fields as unknown[]) {
          if (typeof f !== "object" || f === null) throw schemaFailure("a field must be an object");
          const fo = f as Record<string, unknown>;
          if (typeof fo.name !== "string" || !NAME.test(fo.name))
            throw schemaFailure("a field has no valid name");
          if (seen.has(fo.name)) throw schemaFailure(`the field ${fo.name} is repeated in ${full}`);
          seen.add(fo.name);
          out.fields.push({ name: fo.name, type: go(fo.type, space, depth + 1) });
        }
        return out;
      }
      case "enum": {
        const { full } = define(obj, ns);
        if (
          !Array.isArray(obj.symbols) ||
          obj.symbols.some((s) => typeof s !== "string" || !NAME.test(s))
        )
          throw schemaFailure(`the enum ${full} needs an array of valid symbols`);
        const out: Schema = { kind: "enum", symbols: obj.symbols as string[] };
        names.set(full, out);
        return out;
      }
      case "fixed": {
        const { full } = define(obj, ns);
        const size = obj.size;
        if (typeof size !== "number" || !Number.isInteger(size) || size < 0)
          throw schemaFailure(`the fixed ${full} needs a size`);
        const out: Schema = { kind: "fixed", size };
        names.set(full, out);
        return out;
      }
      case "array":
        return { kind: "array", items: go(obj.items, ns, depth + 1) };
      case "map":
        return { kind: "map", values: go(obj.values, ns, depth + 1) };
      default:
        return go(t, ns, depth + 1);
    }
  }
  return go(root, "", 0);
}

function decodeData(
  data: Uint8Array,
  schemaText: string,
  count: number | bigint,
  ctx: PrimitiveContext,
): Value[] {
  const schema = compileSchema(schemaText);
  const meter = new Meter(ctx.limits.maxValueBytes, "decoded Avro data");
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let p = 0;
  const fail = (reason: string, at: number = p): ForgeError => formatFailure("Avro", reason, at);
  const left = () => data.length - p;
  function need(n: number, what: string): void {
    if (n > left()) throw fail(`${what} needs ${n} bytes but only ${left()} are left (truncated)`);
  }

  /** A zig-zag varint of at most `maxBytes` bytes: a number, or a bigint above 2^53. */
  function zigzag(maxBytes: number, what: string): number | bigint {
    const at = p;
    let small = 0;
    let big = 0n;
    let useBig = false;
    for (let i = 0; i < maxBytes; i++) {
      need(1, what);
      const b = data[p++] as number;
      if (!useBig && i < 7) small += (b & 0x7f) * 2 ** (7 * i);
      else {
        if (!useBig) {
          big = BigInt(small);
          useBig = true;
        }
        big |= BigInt(b & 0x7f) << BigInt(7 * i);
      }
      if ((b & 0x80) === 0) {
        if (maxBytes === 10 && i === 9 && b > 1) throw fail(`${what} does not fit in 64 bits`, at);
        if (!useBig) return small % 2 === 0 ? small / 2 : -(small + 1) / 2;
        return big % 2n === 0n ? normal(big / 2n) : normal(-(big + 1n) / 2n);
      }
    }
    throw fail(`${what} is a varint of more than ${maxBytes} bytes`, at);
  }
  const normal = (b: bigint): number | bigint =>
    b >= BigInt(Number.MIN_SAFE_INTEGER) && b <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(b) : b;

  function length(what: string): number {
    const at = p;
    const n = zigzag(10, what);
    if (typeof n === "bigint" || n < 0) throw fail(`${what} is negative or too large`, at);
    return n;
  }

  function numberValue(x: number): Value {
    return Number.isFinite(x) ? num(x) : nullValue();
  }

  function datum(s: Schema, depth: number): Value {
    if (depth > MAX_DEPTH) throw fail(`nesting deeper than ${MAX_DEPTH} levels`);
    meter.add(24);
    switch (s.kind) {
      case "null":
        return nullValue();
      case "boolean": {
        need(1, "a boolean");
        const b = data[p++] as number;
        if (b > 1) throw fail(`a boolean must be 0 or 1, not ${b}`, p - 1);
        return { tag: "bool", v: b === 1 };
      }
      case "int": {
        const at = p;
        const v = zigzag(5, "an int");
        if (typeof v === "bigint" || v < -2147483648 || v > 2147483647)
          throw fail("an int does not fit in 32 bits", at);
        return int(v);
      }
      case "long":
        return intValue(zigzag(10, "a long"), ctx.limits.maxIntBits);
      case "float": {
        need(4, "a float");
        const v = dv.getFloat32(p, true);
        p += 4;
        return numberValue(v);
      }
      case "double": {
        need(8, "a double");
        const v = dv.getFloat64(p, true);
        p += 8;
        return numberValue(v);
      }
      case "bytes": {
        const n = length("a length");
        need(n, "a byte string");
        const b = data.slice(p, p + n);
        p += n;
        return bufferValue(b, meter);
      }
      case "string": {
        const at = p;
        const n = length("a length");
        need(n, "a string");
        const t = strictUtf8(data.subarray(p, p + n), "Avro", at);
        p += n;
        meter.add(2 * t.length);
        return str(t);
      }
      case "fixed": {
        need(s.size, "a fixed value");
        const b = data.slice(p, p + s.size);
        p += s.size;
        return bufferValue(b, meter);
      }
      case "enum": {
        const at = p;
        const i = zigzag(5, "an enum index");
        const sym = typeof i === "number" ? s.symbols[i] : undefined;
        if (sym === undefined) throw fail(`the enum index ${String(i)} is out of range`, at);
        return str(sym);
      }
      case "union": {
        const at = p;
        const i = zigzag(5, "a union index");
        const b = typeof i === "number" ? s.branches[i] : undefined;
        if (b === undefined) throw fail(`the union index ${String(i)} is out of range`, at);
        return datum(b, depth + 1);
      }
      case "record": {
        const m = new Map<string, Value>();
        for (const f of s.fields) {
          m.set(f.name, datum(f.type, depth + 1));
          meter.add(16 + 2 * f.name.length);
        }
        return { tag: "record", v: m };
      }
      case "array": {
        const items: Value[] = [];
        for (;;) {
          const at = p;
          let n = zigzag(10, "a block count");
          if (typeof n === "bigint") throw fail("a block count is too large", at);
          if (n === 0) break;
          if (n < 0) {
            n = -n;
            zigzag(10, "a block size");
          }
          for (let i = 0; i < n; i++) {
            items.push(datum(s.items, depth + 1));
            meter.add(8);
          }
        }
        return list(items);
      }
      case "map": {
        const m = new Map<string, Value>();
        for (;;) {
          const at = p;
          let n = zigzag(10, "a block count");
          if (typeof n === "bigint") throw fail("a block count is too large", at);
          if (n === 0) break;
          if (n < 0) {
            n = -n;
            zigzag(10, "a block size");
          }
          for (let i = 0; i < n; i++) {
            const ka = p;
            const kl = length("a length");
            need(kl, "a map key");
            const k = strictUtf8(data.subarray(p, p + kl), "Avro", ka);
            p += kl;
            if (m.has(k)) throw fail(`the map key ${JSON.stringify(k)} is repeated`, ka);
            m.set(k, datum(s.values, depth + 1));
            meter.add(16 + 2 * k.length);
          }
        }
        return { tag: "record", v: m };
      }
    }
  }

  if (typeof count === "bigint")
    throw new ForgeError({
      code: "E_LIMIT_VALUE",
      message: "an Avro block declares too many data",
      detail: { limit: "maxValueBytes" },
    });
  const out: Value[] = [];
  for (let i = 0; i < count; i++) {
    out.push(datum(schema, 0));
    meter.add(8);
  }
  if (p !== data.length) throw fail(`${data.length - p} bytes are left over after ${count} data`);
  return out;
}

function header(data: Uint8Array, ctx: PrimitiveContext): [string, string, Value[]] {
  const meter = new Meter(ctx.limits.maxValueBytes, "Avro blocks");
  let p = 0;
  const fail = (reason: string, at: number = p): ForgeError => formatFailure("Avro", reason, at);
  const left = () => data.length - p;
  function need(n: number, what: string): void {
    if (n > left()) throw fail(`${what} needs ${n} bytes but only ${left()} are left (truncated)`);
  }
  function long(what: string): number {
    const at = p;
    let v = 0n;
    for (let i = 0; i < 10; i++) {
      need(1, what);
      const b = data[p++] as number;
      v |= BigInt(b & 0x7f) << BigInt(7 * i);
      if ((b & 0x80) === 0) {
        if (i === 9 && b > 1) throw fail(`${what} does not fit in 64 bits`, at);
        const z = v % 2n === 0n ? v / 2n : -(v + 1n) / 2n;
        if (z > BigInt(Number.MAX_SAFE_INTEGER) || z < BigInt(Number.MIN_SAFE_INTEGER))
          throw fail(`${what} is too large`, at);
        return Number(z);
      }
    }
    throw fail(`${what} is a varint of more than 10 bytes`, at);
  }
  const magic = [0x4f, 0x62, 0x6a, 0x01];
  if (data.length < 4 || magic.some((b, i) => data[i] !== b))
    throw fail('not an Avro Object Container File (it does not start with "Obj" and 0x01)', 0);
  p = 4;
  const meta = new Map<string, Uint8Array>();
  for (;;) {
    let n = long("a metadata block count");
    if (n === 0) break;
    if (n < 0) {
      n = -n;
      long("a metadata block size");
    }
    for (let i = 0; i < n; i++) {
      const ka = p;
      const kl = long("a metadata key length");
      if (kl < 0) throw fail("a metadata key length is negative", ka);
      need(kl, "a metadata key");
      const k = strictUtf8(data.subarray(p, p + kl), "Avro", ka);
      p += kl;
      const vl = long("a metadata value length");
      if (vl < 0) throw fail("a metadata value length is negative", p);
      need(vl, "a metadata value");
      if (meta.has(k)) throw fail(`the metadata key ${JSON.stringify(k)} is repeated`, ka);
      meta.set(k, data.subarray(p, p + vl));
      p += vl;
    }
  }
  need(16, "the sync marker");
  const sync = data.subarray(p, p + 16);
  p += 16;
  const schemaBytes = meta.get("avro.schema");
  if (schemaBytes === undefined) throw fail("the metadata has no avro.schema", 4);
  const schema = strictUtf8(schemaBytes, "Avro", 4);
  const codecBytes = meta.get("avro.codec");
  const codec = codecBytes === undefined ? "null" : strictUtf8(codecBytes, "Avro", 4);
  const blocks: Value[] = [];
  while (p < data.length) {
    const at = p;
    const count = long("a block's data count");
    const size = long("a block size");
    if (count < 0 || size < 0) throw fail("a block count or size is negative", at);
    need(size + 16, "a block");
    const body = data.slice(p, p + size);
    p += size;
    for (let i = 0; i < 16; i++)
      if (data[p + i] !== sync[i]) throw fail("a block does not end with the sync marker", p);
    p += 16;
    meter.add(64 + size);
    blocks.push(
      record([
        ["count", int(count)],
        ["data", { tag: "bytes", v: body }],
      ]),
    );
  }
  return [schema, codec, blocks];
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("avro", "_header", "( data:bytes -- schema:str codec:str blocks:list )", header, {
    doc: "The schema text, the codec name and the blocks (count and still compressed data) of an Avro Object Container File (private helper of avro:to-json).",
    category: "Data format",
  }),
  definePrimitive("avro", "_decode", "( data:bytes schema:str count:int -- list )", decodeData, {
    doc: "Exactly count Avro data of the schema in the bytes, as JSON values (private helper of avro:to-json).",
    category: "Data format",
  }),
];
