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
 * cbor primitives: the CBOR (RFC 8949) reader and writer between bytes and JSON values. A node-by-node reader in
 * FL costs several hundred VM steps an element (the ASN.1 outline measured 245 steps an element, see the wave 7
 * conventions), which would cap a 64 KiB item near the step limit, so the walk is a primitive; the text side
 * (json:parse, json:stringify) and the parameters are FL.
 *
 *  - `_decode ( data:bytes -- any )`: exactly one data item, all major types, indefinite lengths (strings, arrays,
 *    maps), half, single and double floats, big integers (tags 2 and 3 become exact ints). Trailing bytes, a
 *    reserved additional-information value, a break outside an indefinite item, a chunk of the wrong type, a
 *    simple value below 32 in the two-byte form, invalid UTF-8, a repeated map key and nesting deeper than 64 are
 *    E_COERCE with the offset; a length is compared with the bytes left and nothing is allocated from it.
 *  - `_encode ( value:any typed:bool -- bytes )`: deterministic encoding (RFC 8949 section 4.2.1): shortest integer
 *    heads, shortest floating-point form that keeps the value (half, single or double), definite lengths only, map
 *    keys sorted bytewise by their encoding.
 *
 * How the JSON side looks (CyberChef shows the result of the `cbor` npm package through JSON.stringify):
 * a byte string is {"type":"Buffer","data":[...]}; a tag is {"tag":N,"contents":V}, except tags 0 and 1 (dates, shown
 * as the ISO 8601 text JavaScript's Date.toJSON writes) and 2 and 3 (big integers, shown as exact integers);
 * `undefined` and the non-finite floats (NaN, the infinities) are null, as JSON.stringify writes them; a simple
 * value other than false, true, null and undefined is {"simple":N}; a map key that is not text is written as the
 * text of an integer, boolean, null or float, any other key is E_COERCE. With `typed` set the encoder reads these
 * shapes back (Buffer to byte string, {"tag":N,"contents":V} to a tag, {"simple":N} to a simple value).
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

const TWO64 = 1n << 64n;
const RFC3339 = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/i;

/** The half-precision float at `h` as a number (NaN and the infinities included). */
export function halfToNumber(h: number): number {
  const exp = (h >> 10) & 31;
  const frac = h & 1023;
  const sign = h & 0x8000 ? -1 : 1;
  if (exp === 0) return sign * frac * 2 ** -24;
  if (exp === 31) return frac === 0 ? sign * Infinity : Number.NaN;
  return sign * (1 + frac / 1024) * 2 ** (exp - 15);
}

/** The 16-bit pattern of `x` when half precision holds it exactly, else undefined. */
export function numberToHalf(x: number): number | undefined {
  if (x === 0) return Object.is(x, -0) ? 0x8000 : 0;
  const sign = x < 0 ? 0x8000 : 0;
  const a = Math.abs(x);
  if (!(a <= 65504)) return undefined;
  if (a < 2 ** -14) {
    const k = a * 2 ** 24;
    return Number.isInteger(k) ? sign | k : undefined;
  }
  let e = Math.floor(Math.log2(a));
  if (2 ** e > a) e--;
  if (2 ** (e + 1) <= a) e++;
  const f = (a / 2 ** e - 1) * 1024;
  return Number.isInteger(f) ? sign | ((e + 15) << 10) | f : undefined;
}

// ---------------------------------------------------------------------------------------------
// decode
// ---------------------------------------------------------------------------------------------

function decode(data: Uint8Array, ctx: PrimitiveContext): Value {
  const meter = new Meter(ctx.limits.maxValueBytes, "decoded CBOR value");
  const maxIntBits = ctx.limits.maxIntBits;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let p = 0;

  const fail = (reason: string, at: number = p): ForgeError => formatFailure("CBOR", reason, at);
  const left = () => data.length - p;
  function need(n: number, what: string): void {
    if (n > left()) throw fail(`${what} needs ${n} bytes but only ${left()} are left (truncated)`);
  }

  /** The argument of a head: a number, a bigint above 2^53, or -1 for the indefinite length. */
  function arg(info: number): number | bigint {
    if (info < 24) return info;
    if (info === 24) {
      need(1, "the head");
      return data[p++] as number;
    }
    if (info === 25) {
      need(2, "the head");
      const v = dv.getUint16(p);
      p += 2;
      return v;
    }
    if (info === 26) {
      need(4, "the head");
      const v = dv.getUint32(p);
      p += 4;
      return v;
    }
    if (info === 27) {
      need(8, "the head");
      const v = dv.getBigUint64(p);
      p += 8;
      return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
    }
    if (info === 31) return -1;
    throw fail(`reserved additional information ${info}`, p - 1);
  }

  /** A count or length, compared with what is left before anything is built from it. */
  function length(a: number | bigint, unit: number, what: string): number {
    if (typeof a === "bigint" || a * unit > left())
      throw fail(
        `${what} declares ${String(a)} ${unit === 1 ? "bytes" : "items"} but only ${left()} bytes are left (truncated)`,
      );
    return a;
  }

  /** A byte or text string of major type `major`, definite or in chunks; the pieces as raw byte arrays. */
  function stringPieces(major: number, info: number): Uint8Array[] {
    const a = arg(info);
    if (a !== -1) {
      const n = length(a, 1, major === 2 ? "a byte string" : "a text string");
      const piece = data.subarray(p, p + n);
      p += n;
      return [piece];
    }
    const pieces: Uint8Array[] = [];
    for (;;) {
      need(1, "an indefinite-length string");
      const ib = data[p++] as number;
      if (ib === 0xff) return pieces;
      if (ib >> 5 !== major || (ib & 31) === 31)
        throw fail(
          `a chunk of an indefinite-length ${major === 2 ? "byte" : "text"} string is not a definite ${major === 2 ? "byte" : "text"} string`,
          p - 1,
        );
      const n = length(arg(ib & 31), 1, "a string chunk");
      pieces.push(data.subarray(p, p + n));
      p += n;
      meter.add(8);
    }
  }

  function joined(pieces: Uint8Array[]): Uint8Array {
    if (pieces.length === 1) return pieces[0] as Uint8Array;
    let total = 0;
    for (const x of pieces) total += x.length;
    const out = new Uint8Array(total);
    let at = 0;
    for (const x of pieces) {
      out.set(x, at);
      at += x.length;
    }
    return out;
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
        throw fail("a map key that is not text, a number, a boolean or null has no JSON form", at);
    }
  }

  function bigFromBytes(b: Uint8Array): bigint {
    if (b.length * 8 > maxIntBits + 8)
      throw new ForgeError({
        code: "E_LIMIT_VALUE",
        message: `a big integer of ${b.length * 8} bits exceeds the limit of ${maxIntBits} bits`,
        detail: { limit: "maxIntBits", max: maxIntBits },
      });
    let hex = "";
    for (const x of b) hex += x.toString(16).padStart(2, "0");
    return hex === "" ? 0n : BigInt(`0x${hex}`);
  }

  function item(depth: number): Value {
    if (depth > MAX_DEPTH) throw fail(`nesting deeper than ${MAX_DEPTH} levels`);
    need(1, "a data item");
    const at = p;
    const ib = data[p++] as number;
    const major = ib >> 5;
    const info = ib & 31;
    meter.add(32);
    switch (major) {
      case 0: {
        const a = arg(info);
        if (a === -1) throw fail("an unsigned integer cannot have an indefinite length", at);
        return intValue(a, maxIntBits);
      }
      case 1: {
        const a = arg(info);
        if (a === -1) throw fail("a negative integer cannot have an indefinite length", at);
        return intValue(typeof a === "bigint" ? -1n - a : -1 - a, maxIntBits);
      }
      case 2: {
        const b = joined(stringPieces(2, info));
        return bufferValue(b, meter);
      }
      case 3: {
        const pieces = stringPieces(3, info);
        let s = "";
        for (const piece of pieces) s += strictUtf8(piece, "CBOR", at);
        meter.add(2 * s.length);
        return str(s);
      }
      case 4: {
        const a = arg(info);
        const items: Value[] = [];
        if (a === -1) {
          for (;;) {
            need(1, "an indefinite-length array");
            if (data[p] === 0xff) {
              p++;
              break;
            }
            items.push(item(depth + 1));
            meter.add(8);
          }
        } else {
          const n = length(a, 1, "an array");
          for (let i = 0; i < n; i++) {
            items.push(item(depth + 1));
            meter.add(8);
          }
        }
        return list(items);
      }
      case 5: {
        const a = arg(info);
        const m = new Map<string, Value>();
        const pair = () => {
          const ka = p;
          const k = keyText(item(depth + 1), ka);
          if (m.has(k)) throw fail(`the map key ${JSON.stringify(k)} is repeated`, ka);
          m.set(k, item(depth + 1));
          meter.add(16 + 2 * k.length);
        };
        if (a === -1) {
          for (;;) {
            need(1, "an indefinite-length map");
            if (data[p] === 0xff) {
              p++;
              break;
            }
            pair();
          }
        } else {
          const n = length(a, 2, "a map");
          for (let i = 0; i < n; i++) pair();
        }
        return { tag: "record", v: m };
      }
      case 6: {
        const a = arg(info);
        if (a === -1) throw fail("a tag cannot have an indefinite length", at);
        if ((a === 2 || a === 3) && p < data.length && (data[p] as number) >> 5 === 2) {
          const ib2 = data[p++] as number;
          const raw = joined(stringPieces(2, ib2 & 31));
          const big = bigFromBytes(raw);
          return intValue(a === 2 ? big : -1n - big, maxIntBits);
        }
        const inner = item(depth + 1);
        if (a === 0 && inner.tag === "str") {
          if (!RFC3339.test(inner.v)) throw fail("tag 0 does not hold an RFC 3339 date-time", at);
          const ms = Date.parse(inner.v);
          const iso = Number.isNaN(ms)
            ? undefined
            : isoFromMs(Math.floor(ms / 1000), (((ms % 1000) + 1000) % 1000) * 1e6);
          if (iso === undefined) throw fail("tag 0 holds a date-time out of range", at);
          return str(iso);
        }
        if (a === 1 && (inner.tag === "int" || inner.tag === "num")) {
          const x = Number(inner.v);
          const ms = Math.floor(x * 1000);
          const iso = Number.isFinite(ms)
            ? isoFromMs(Math.floor(ms / 1000), (ms - Math.floor(ms / 1000) * 1000) * 1e6)
            : undefined;
          if (iso === undefined) throw fail("tag 1 holds an epoch time out of range", at);
          return str(iso);
        }
        meter.add(48);
        return record([
          ["tag", intValue(a, maxIntBits)],
          ["contents", inner],
        ]);
      }
      default: {
        // major 7
        if (info === 20) return bool(false);
        if (info === 21) return bool(true);
        if (info === 22 || info === 23) return nullValue();
        if (info < 20) return record([["simple", int(info)]]);
        if (info === 24) {
          need(1, "a simple value");
          const v = data[p++] as number;
          if (v < 32) throw fail(`the simple value ${v} must use the one-byte head`, at);
          return record([["simple", int(v)]]);
        }
        if (info === 25) {
          need(2, "a half-precision float");
          const v = halfToNumber(dv.getUint16(p));
          p += 2;
          return Number.isFinite(v) ? num(v) : nullValue();
        }
        if (info === 26) {
          need(4, "a single-precision float");
          const v = dv.getFloat32(p);
          p += 4;
          return Number.isFinite(v) ? num(v) : nullValue();
        }
        if (info === 27) {
          need(8, "a double-precision float");
          const v = dv.getFloat64(p);
          p += 8;
          return Number.isFinite(v) ? num(v) : nullValue();
        }
        if (info === 31) throw fail("a break outside an indefinite-length item", at);
        throw fail(`reserved additional information ${info}`, at);
      }
    }
  }

  if (data.length === 0) throw fail("the input is empty", 0);
  const v = item(0);
  if (p !== data.length)
    throw fail(`${data.length - p} bytes follow the data item (CBOR sequences are not supported)`);
  return v;
}

// ---------------------------------------------------------------------------------------------
// encode
// ---------------------------------------------------------------------------------------------

function encode(value: Value, typed: boolean, ctx: PrimitiveContext): Uint8Array {
  const max = ctx.limits.maxValueBytes;

  function head(out: ByteSink, major: number, a: number | bigint): void {
    const m = major << 5;
    if (typeof a === "number" ? a < 24 : a < 24n) out.byte(m | Number(a));
    else if (a < 256) {
      out.byte(m | 24);
      out.byte(Number(a));
    } else if (a < 65536) {
      out.byte(m | 25);
      out.be(a, 2);
    } else if (a < 4294967296) {
      out.byte(m | 26);
      out.be(a, 4);
    } else {
      out.byte(m | 27);
      out.be(a, 8);
    }
  }

  function writeInt(out: ByteSink, n: number | bigint): void {
    const b = BigInt(n);
    if (b >= 0n && b < TWO64) head(out, 0, b);
    else if (b < 0n && b >= -TWO64) head(out, 1, -1n - b);
    else {
      const mag = b >= 0n ? b : -1n - b;
      let hex = mag.toString(16);
      if (hex.length % 2) hex = `0${hex}`;
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++)
        bytes[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
      head(out, 6, b >= 0n ? 2 : 3);
      head(out, 2, bytes.length);
      out.bytes(bytes);
    }
  }

  function writeFloat(out: ByteSink, x: number): void {
    const h = numberToHalf(x);
    if (h !== undefined) {
      out.byte(0xf9);
      out.be(h, 2);
    } else if (Math.fround(x) === x) {
      const t = new DataView(new ArrayBuffer(4));
      t.setFloat32(0, x);
      out.byte(0xfa);
      out.bytes(new Uint8Array(t.buffer));
    } else {
      const t = new DataView(new ArrayBuffer(8));
      t.setFloat64(0, x);
      out.byte(0xfb);
      out.bytes(new Uint8Array(t.buffer));
    }
  }

  function writeText(out: ByteSink, s: string): void {
    const b = new TextEncoder().encode(s);
    head(out, 3, b.length);
    out.bytes(b);
  }

  function intKey(v: Value | undefined, lo: bigint, hi: bigint): bigint | undefined {
    if (v === undefined || v.tag !== "int") return undefined;
    const b = BigInt(v.v);
    return b >= lo && b <= hi ? b : undefined;
  }

  function write(out: ByteSink, v: Value, depth: number): void {
    if (depth > MAX_DEPTH) throw writeFailure("CBOR", `nesting deeper than ${MAX_DEPTH} levels`);
    switch (v.tag) {
      case "int":
        writeInt(out, v.v);
        return;
      case "num":
        writeFloat(out, v.v);
        return;
      case "str":
        writeText(out, v.v);
        return;
      case "bool":
        out.byte(v.v ? 0xf5 : 0xf4);
        return;
      case "list": {
        const items = v.v as readonly Value[];
        head(out, 4, items.length);
        for (const x of items) write(out, x, depth + 1);
        return;
      }
      case "record": {
        if (isNullValue(v)) {
          out.byte(0xf6);
          return;
        }
        const m = v.v as ReadonlyMap<string, Value>;
        if (typed) {
          const buf = asBuffer(v);
          if (buf !== undefined) {
            head(out, 2, buf.length);
            out.bytes(buf);
            return;
          }
          if (m.size === 2 && m.has("tag") && m.has("contents")) {
            const t = intKey(m.get("tag"), 0n, TWO64 - 1n);
            if (t !== undefined) {
              head(out, 6, t);
              write(out, m.get("contents") as Value, depth + 1);
              return;
            }
          }
          if (m.size === 1 && m.has("simple")) {
            const s = intKey(m.get("simple"), 0n, 255n);
            if (s !== undefined && !(s >= 24n && s < 32n)) {
              if (s < 24n) out.byte(0xe0 | Number(s));
              else {
                out.byte(0xf8);
                out.byte(Number(s));
              }
              return;
            }
          }
        }
        const entries: [Uint8Array, Value][] = [];
        for (const [k, x] of m) {
          const kb = new ByteSink(max);
          writeText(kb, k);
          entries.push([kb.finish(), x]);
        }
        entries.sort((a, b) => cmpBytes(a[0], b[0]));
        head(out, 5, entries.length);
        for (const [kb, x] of entries) {
          out.bytes(kb);
          write(out, x, depth + 1);
        }
        return;
      }
      default:
        throw writeFailure("CBOR", `a ${v.tag} has no JSON form`);
    }
  }

  const out = new ByteSink(max);
  write(out, value, 0);
  return out.finish();
}

function cmpBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] as number) - (b[i] as number);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("cbor", "_decode", "( data:bytes -- any )", decode, {
    doc: "The one CBOR data item (RFC 8949) in the bytes, as a JSON value (private helper of cbor:decode).",
    category: "Data format",
  }),
  definePrimitive("cbor", "_encode", "( value:any typed:bool -- bytes )", encode, {
    doc: "A JSON value as deterministic CBOR (RFC 8949 section 4.2.1) (private helper of cbor:encode).",
    category: "Data format",
  }),
];
