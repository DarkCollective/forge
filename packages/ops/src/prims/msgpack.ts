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
 * msgpack primitives: the MessagePack reader and writer between bytes and JSON values (the specification at
 * github.com/msgpack/msgpack/blob/master/spec.md, written from it, no library). Like cbor, the element walk is a
 * primitive (a node-by-node reader in FL costs several hundred VM steps an element); the JSON text side and the
 * parameters are FL.
 *
 *  - `_decode ( data:bytes -- any )`: exactly one object. Every format of the spec: nil, booleans, fixints,
 *    uint8 to uint64, int8 to int64, float32 and float64, fixstr/str8/16/32 (strict UTF-8), bin8/16/32,
 *    fixarray/array16/32, fixmap/map16/32, fixext and ext8/16/32. The timestamp extension (type -1, 4, 8 or 12
 *    bytes) is shown as ISO 8601 text; any other extension is {"ext":N,"data":<Buffer>}; a byte string is
 *    {"type":"Buffer","data":[...]} (as CyberChef's JSON.stringify shows a Buffer). A map key that is not text is
 *    written as the text of an integer, float, boolean or null (any other key is E_COERCE); a repeated key, the
 *    never-used code 0xc1, bytes after the object, a truncated object, invalid UTF-8, an invalid timestamp and
 *    nesting deeper than 64 are E_COERCE with the offset. NaN and the infinities are null (as JSON.stringify).
 *  - `_encode ( value:any typed:bool -- bytes )`: the shortest format that holds each value (positive integers as
 *    uint, negative as int, floats as float32 when that is exact, else float64, str8 and the other new formats
 *    are used); maps keep the order of the keys. With `typed`, {"type":"Buffer","data":[...]} is written as bin,
 *    {"ext":N,"data":<Buffer>} as an extension and {"timestamp":"<ISO 8601>"} as a timestamp extension.
 */
import { ForgeError, definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef, Value } from "@forge/lang";
import {
  intValue,
  ByteSink,
  MAX_DEPTH,
  Meter,
  asBuffer,
  bufferValue,
  formatFailure,
  isNullValue,
  isoFromMs,
  nullValue,
  numberKey,
  strictUtf8,
  writeFailure,
} from "../data-format-util.js";

const { int, num, str, bool, list, record } = valueHelpers;

const ISO = /^(-?\d{4,6}|\+\d{6})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,9}))?Z$/;

function decode(data: Uint8Array, ctx: PrimitiveContext): Value {
  const meter = new Meter(ctx.limits.maxValueBytes, "decoded MessagePack value");
  const maxIntBits = ctx.limits.maxIntBits;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let p = 0;

  const fail = (reason: string, at: number = p): ForgeError =>
    formatFailure("MessagePack", reason, at);
  const left = () => data.length - p;
  function need(n: number, what: string): void {
    if (n > left()) throw fail(`${what} needs ${n} bytes but only ${left()} are left (truncated)`);
  }
  function u(n: number, what: string): number {
    need(n, what);
    const v = n === 1 ? dv.getUint8(p) : n === 2 ? dv.getUint16(p) : dv.getUint32(p);
    p += n;
    return v;
  }

  function keyText(k: Value, at: number): string {
    switch (k.tag) {
      case "str":
        return k.v;
      case "int":
        return String(k.v);
      case "bool":
        return k.v ? "true" : "false";
      case "num":
        return numberKey(k.v);
      default:
        if (isNullValue(k)) return "null";
        throw fail("a map key that is not text, a number, a boolean or nil has no JSON form", at);
    }
  }

  function text(n: number, at: number): Value {
    need(n, "a string");
    const s = strictUtf8(data.subarray(p, p + n), "MessagePack", at);
    p += n;
    meter.add(2 * s.length);
    return str(s);
  }

  function bin(n: number): Value {
    need(n, "a binary string");
    const b = data.slice(p, p + n);
    p += n;
    return bufferValue(b, meter);
  }

  function array(n: number, depth: number): Value {
    if (n > left())
      throw fail(`an array declares ${n} items but only ${left()} bytes are left (truncated)`);
    const items: Value[] = [];
    for (let i = 0; i < n; i++) {
      items.push(item(depth + 1));
      meter.add(8);
    }
    return list(items);
  }

  function map(n: number, depth: number): Value {
    if (2 * n > left())
      throw fail(`a map declares ${n} pairs but only ${left()} bytes are left (truncated)`);
    const m = new Map<string, Value>();
    for (let i = 0; i < n; i++) {
      const ka = p;
      const k = keyText(item(depth + 1), ka);
      if (m.has(k)) throw fail(`the map key ${JSON.stringify(k)} is repeated`, ka);
      m.set(k, item(depth + 1));
      meter.add(16 + 2 * k.length);
    }
    return { tag: "record", v: m };
  }

  function ext(n: number, at: number): Value {
    need(1 + n, "an extension");
    const type = dv.getInt8(p);
    p++;
    const body = data.subarray(p, p + n);
    p += n;
    if (type === -1) {
      let sec: number;
      let nsec: number;
      const bdv = new DataView(body.buffer, body.byteOffset, body.byteLength);
      if (n === 4) {
        sec = bdv.getUint32(0);
        nsec = 0;
      } else if (n === 8) {
        const v = bdv.getBigUint64(0);
        nsec = Number(v >> 34n);
        sec = Number(v & 0x3ffffffffn);
      } else if (n === 12) {
        nsec = bdv.getUint32(0);
        const s = bdv.getBigInt64(4);
        if (s > 8640000000000n || s < -8640000000000n)
          throw fail("a timestamp is outside the range of dates", at);
        sec = Number(s);
      } else throw fail(`a timestamp holds 4, 8 or 12 bytes, not ${n}`, at);
      if (nsec > 999999999) throw fail(`a timestamp has ${nsec} nanoseconds`, at);
      const iso = isoFromMs(sec, nsec);
      if (iso === undefined) throw fail("a timestamp is outside the range of dates", at);
      meter.add(64);
      return str(iso);
    }
    meter.add(64);
    return record([
      ["ext", int(type)],
      ["data", bufferValue(body.slice(), meter)],
    ]);
  }

  function item(depth: number): Value {
    if (depth > MAX_DEPTH) throw fail(`nesting deeper than ${MAX_DEPTH} levels`);
    need(1, "an object");
    const at = p;
    const b = data[p++] as number;
    meter.add(32);
    if (b <= 0x7f) return int(b);
    if (b >= 0xe0) return int(b - 256);
    if (b >= 0xa0 && b <= 0xbf) return text(b & 31, at);
    if (b >= 0x90 && b <= 0x9f) return array(b & 15, depth);
    if (b >= 0x80 && b <= 0x8f) return map(b & 15, depth);
    switch (b) {
      case 0xc0:
        return nullValue();
      case 0xc2:
        return bool(false);
      case 0xc3:
        return bool(true);
      case 0xc4:
        return bin(u(1, "bin 8"));
      case 0xc5:
        return bin(u(2, "bin 16"));
      case 0xc6:
        return bin(u(4, "bin 32"));
      case 0xc7:
        return ext(u(1, "ext 8"), at);
      case 0xc8:
        return ext(u(2, "ext 16"), at);
      case 0xc9:
        return ext(u(4, "ext 32"), at);
      case 0xca: {
        need(4, "a float 32");
        const v = dv.getFloat32(p);
        p += 4;
        return Number.isFinite(v) ? num(v) : nullValue();
      }
      case 0xcb: {
        need(8, "a float 64");
        const v = dv.getFloat64(p);
        p += 8;
        return Number.isFinite(v) ? num(v) : nullValue();
      }
      case 0xcc:
        return int(u(1, "uint 8"));
      case 0xcd:
        return int(u(2, "uint 16"));
      case 0xce:
        return int(u(4, "uint 32"));
      case 0xcf: {
        need(8, "uint 64");
        const v = dv.getBigUint64(p);
        p += 8;
        return intValue(v, maxIntBits);
      }
      case 0xd0: {
        need(1, "int 8");
        return int(dv.getInt8(p++));
      }
      case 0xd1: {
        need(2, "int 16");
        const v = dv.getInt16(p);
        p += 2;
        return int(v);
      }
      case 0xd2: {
        need(4, "int 32");
        const v = dv.getInt32(p);
        p += 4;
        return int(v);
      }
      case 0xd3: {
        need(8, "int 64");
        const v = dv.getBigInt64(p);
        p += 8;
        return intValue(v, maxIntBits);
      }
      case 0xd4:
        return ext(1, at);
      case 0xd5:
        return ext(2, at);
      case 0xd6:
        return ext(4, at);
      case 0xd7:
        return ext(8, at);
      case 0xd8:
        return ext(16, at);
      case 0xd9:
        return text(u(1, "str 8"), at);
      case 0xda:
        return text(u(2, "str 16"), at);
      case 0xdb:
        return text(u(4, "str 32"), at);
      case 0xdc:
        return array(u(2, "array 16"), depth);
      case 0xdd:
        return array(u(4, "array 32"), depth);
      case 0xde:
        return map(u(2, "map 16"), depth);
      case 0xdf:
        return map(u(4, "map 32"), depth);
      default:
        throw fail("the code 0xc1 is never used", at);
    }
  }

  if (data.length === 0) throw fail("the input is empty", 0);
  const v = item(0);
  if (p !== data.length) throw fail(`${data.length - p} bytes follow the object`);
  return v;
}

function encode(value: Value, typed: boolean, ctx: PrimitiveContext): Uint8Array {
  const out = new ByteSink(ctx.limits.maxValueBytes);

  function sized(n: number, bits: readonly [number, number, number], what: string): void {
    // n up to 2^32-1: choose the 8, 16 or 32-bit form (codes in bits; 0 means the form does not exist)
    if (n < 256 && bits[0] !== 0) {
      out.byte(bits[0]);
      out.byte(n);
    } else if (n < 65536) {
      out.byte(bits[1]);
      out.be(n, 2);
    } else if (n < 4294967296) {
      out.byte(bits[2]);
      out.be(n, 4);
    } else throw writeFailure("MessagePack", `${what} too long`);
  }

  function writeInt(n: number | bigint): void {
    const b = BigInt(n);
    if (b >= 0n) {
      if (b < 128n) out.byte(Number(b));
      else if (b < 256n) {
        out.byte(0xcc);
        out.byte(Number(b));
      } else if (b < 65536n) {
        out.byte(0xcd);
        out.be(b, 2);
      } else if (b < 4294967296n) {
        out.byte(0xce);
        out.be(b, 4);
      } else if (b < 1n << 64n) {
        out.byte(0xcf);
        out.be(b, 8);
      } else throw writeFailure("MessagePack", "an integer above 2^64-1 has no MessagePack form");
    } else if (b >= -32n) out.byte(0x100 + Number(b));
    else if (b >= -128n) {
      out.byte(0xd0);
      out.byte(0x100 + Number(b));
    } else if (b >= -32768n) {
      out.byte(0xd1);
      out.be(b + 65536n, 2);
    } else if (b >= -2147483648n) {
      out.byte(0xd2);
      out.be(b + 4294967296n, 4);
    } else if (b >= -(1n << 63n)) {
      out.byte(0xd3);
      out.be(b + (1n << 64n), 8);
    } else throw writeFailure("MessagePack", "an integer below -2^63 has no MessagePack form");
  }

  function writeExt(type: number, body: Uint8Array): void {
    const fix: Record<number, number> = { 1: 0xd4, 2: 0xd5, 4: 0xd6, 8: 0xd7, 16: 0xd8 };
    const code = fix[body.length];
    if (code !== undefined) {
      out.byte(code);
    } else if (body.length < 256) {
      out.byte(0xc7);
      out.byte(body.length);
    } else if (body.length < 65536) {
      out.byte(0xc8);
      out.be(body.length, 2);
    } else {
      out.byte(0xc9);
      out.be(body.length, 4);
    }
    out.byte(type < 0 ? 256 + type : type);
    out.bytes(body);
  }

  function timestamp(text: string): Uint8Array {
    const m = ISO.exec(text);
    if (m === null)
      throw writeFailure("MessagePack", `${JSON.stringify(text)} is not an ISO 8601 UTC date-time`);
    const [, y, mo, d, h, mi, s, frac] = m as unknown as string[];
    const base = Date.parse(
      `${(y as string).startsWith("-") || (y as string).startsWith("+") ? y : (y as string).padStart(4, "0")}-${mo}-${d}T${h}:${mi}:${s}.000Z`,
    );
    if (Number.isNaN(base))
      throw writeFailure("MessagePack", `${JSON.stringify(text)} is not a valid date`);
    const sec = base / 1000;
    const nsec = frac === undefined ? 0 : Number(frac.padEnd(9, "0"));
    const t = new ByteSink(16);
    if (nsec === 0 && sec >= 0 && sec < 2 ** 32) t.be(sec, 4);
    else if (sec >= 0 && sec < 2 ** 34) t.be((BigInt(nsec) << 34n) | BigInt(sec), 8);
    else {
      t.be(nsec, 4);
      t.be(BigInt.asUintN(64, BigInt(sec)), 8);
    }
    return t.finish();
  }

  function write(v: Value, depth: number): void {
    if (depth > MAX_DEPTH)
      throw writeFailure("MessagePack", `nesting deeper than ${MAX_DEPTH} levels`);
    switch (v.tag) {
      case "int":
        writeInt(v.v);
        return;
      case "num": {
        if (Math.fround(v.v) === v.v) {
          const t = new DataView(new ArrayBuffer(4));
          t.setFloat32(0, v.v);
          out.byte(0xca);
          out.bytes(new Uint8Array(t.buffer));
        } else {
          const t = new DataView(new ArrayBuffer(8));
          t.setFloat64(0, v.v);
          out.byte(0xcb);
          out.bytes(new Uint8Array(t.buffer));
        }
        return;
      }
      case "str": {
        const b = new TextEncoder().encode(v.v);
        if (b.length < 32) out.byte(0xa0 | b.length);
        else sized(b.length, [0xd9, 0xda, 0xdb], "a string");
        out.bytes(b);
        return;
      }
      case "bool":
        out.byte(v.v ? 0xc3 : 0xc2);
        return;
      case "list": {
        const items = v.v as readonly Value[];
        if (items.length < 16) out.byte(0x90 | items.length);
        else sized(items.length, [0, 0xdc, 0xdd], "an array");
        for (const x of items) write(x, depth + 1);
        return;
      }
      case "record": {
        if (isNullValue(v)) {
          out.byte(0xc0);
          return;
        }
        const m = v.v as ReadonlyMap<string, Value>;
        if (typed) {
          const buf = asBuffer(v);
          if (buf !== undefined) {
            sized(buf.length, [0xc4, 0xc5, 0xc6], "a binary string");
            out.bytes(buf);
            return;
          }
          const ex = m.get("ext");
          const bd = m.get("data");
          if (m.size === 2 && ex !== undefined && bd !== undefined) {
            const raw = asBuffer(bd);
            if (
              ex.tag === "int" &&
              typeof ex.v === "number" &&
              ex.v >= -128 &&
              ex.v <= 127 &&
              raw !== undefined
            ) {
              writeExt(ex.v, raw);
              return;
            }
          }
          const ts = m.get("timestamp");
          if (m.size === 1 && ts !== undefined && ts.tag === "str") {
            writeExt(-1, timestamp(ts.v));
            return;
          }
        }
        if (m.size < 16) out.byte(0x80 | m.size);
        else sized(m.size, [0, 0xde, 0xdf], "a map");
        for (const [k, x] of m) {
          write(str(k), depth + 1);
          write(x, depth + 1);
        }
        return;
      }
      default:
        throw writeFailure("MessagePack", `a ${v.tag} has no JSON form`);
    }
  }

  write(value, 0);
  return out.finish();
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("msgpack", "_decode", "( data:bytes -- any )", decode, {
    doc: "The one MessagePack object in the bytes, as a JSON value (private helper of msgpack:decode).",
    category: "Data format",
  }),
  definePrimitive("msgpack", "_encode", "( value:any typed:bool -- bytes )", encode, {
    doc: "A JSON value as MessagePack (private helper of msgpack:encode).",
    category: "Data format",
  }),
];
