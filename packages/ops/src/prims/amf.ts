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
 * amf primitives: Action Message Format 0 and 3 (Adobe's AMF0 and AMF3 specifications, written from them, no
 * library), between bytes and JSON values. The value walk (with the string, object and trait reference tables of
 * AMF3) is a primitive for the same reason as cbor (a node-by-node reader in FL costs several hundred VM steps an
 * element); the JSON text side and the parameters are FL.
 *
 *  - `_decode ( data:bytes version:str -- any )`: exactly one value of "AMF0" or "AMF3" (an AMF0 value may switch
 *    to AMF3 with the avmplus marker). Numbers: an AMF0 double or AMF3 double that is a whole number of at most
 *    2^53 in size is an int, any other finite one a num, NaN and the infinities null; an AMF3 integer is an int.
 *    undefined, null and the AMF0 unsupported marker are null; a date is ISO 8601 text; XML is its text; a typed
 *    object, an ECMA array and an AMF3 array with associative keys are records (the class name is dropped; the
 *    dense part of an AMF3 array gets the keys "0", "1", ...); a byte array is {"type":"Buffer","data":[...]}; the
 *    AMF3 vectors are lists and the dictionary is a record (keys must be text or numbers). References to earlier
 *    objects are copied (a reference to an object still being read, a cycle, is E_COERCE, as JSON cannot show
 *    it). The movieclip, recordset and externalizable markers, a bad reference, a truncated value, bytes after
 *    the value, invalid UTF-8, a repeated key and nesting deeper than 64 are E_COERCE with the offset.
 *  - `_encode ( value:any version:str -- bytes )`: a JSON value as one AMF0 or AMF3 value. AMF0: every number as
 *    a double, text as string (long string above 65535 bytes), list as strict array, record as an anonymous
 *    object (an empty key cannot be written), null as null. AMF3: integers from -2^28 to 2^28-1 as AMF3
 *    integers, other numbers as doubles, text as string, list as a dense array, record as a dynamic anonymous
 *    object. No reference table is used on output.
 */
import { ForgeError, definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef, Value } from "@forge/lang";
import {
  ByteSink,
  MAX_DEPTH,
  Meter,
  bufferValue,
  formatFailure,
  isNullValue,
  isoFromMs,
  nullValue,
  numberKey,
  strictUtf8,
  writeFailure,
} from "../data-format-util.js";

const { int, num, str, list } = valueHelpers;

interface Trait {
  name: string;
  members: string[];
  dynamic: boolean;
}

function numberValue(x: number): Value {
  if (!Number.isFinite(x)) return nullValue();
  if (Number.isInteger(x) && Math.abs(x) <= 2 ** 53) return int(x === 0 ? 0 : x);
  return num(x);
}

function decode(data: Uint8Array, version: string, ctx: PrimitiveContext): Value {
  if (version !== "AMF0" && version !== "AMF3")
    throw new ForgeError({
      code: "E_RANGE",
      message: `the format must be AMF0 or AMF3, not ${version}`,
    });
  const meter = new Meter(ctx.limits.maxValueBytes, "decoded AMF value");
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let p = 0;
  const fail = (reason: string, at: number = p): ForgeError => formatFailure("AMF", reason, at);
  const left = () => data.length - p;
  function need(n: number, what: string): void {
    if (n > left()) throw fail(`${what} needs ${n} bytes but only ${left()} are left (truncated)`);
  }
  function u8(what: string): number {
    need(1, what);
    return data[p++] as number;
  }
  function u16(what: string): number {
    need(2, what);
    const v = dv.getUint16(p);
    p += 2;
    return v;
  }
  function u32(what: string): number {
    need(4, what);
    const v = dv.getUint32(p);
    p += 4;
    return v;
  }
  function f64(what: string): number {
    need(8, what);
    const v = dv.getFloat64(p);
    p += 8;
    return v;
  }
  function utf(n: number, what: string): string {
    need(n, what);
    const s = strictUtf8(data.subarray(p, p + n), "AMF", p);
    p += n;
    meter.add(2 * s.length);
    return s;
  }
  function date(ms: number, at: number): Value {
    if (!Number.isFinite(ms)) throw fail("a date is not a finite number", at);
    const t = Math.floor(ms);
    const sec = Math.floor(t / 1000);
    const iso = isoFromMs(sec, (t - sec * 1000) * 1e6);
    if (iso === undefined) throw fail("a date is outside the range of dates", at);
    return str(iso);
  }
  function setKey(m: Map<string, Value>, k: string, v: Value, at: number): void {
    if (m.has(k)) throw fail(`the key ${JSON.stringify(k)} is repeated`, at);
    m.set(k, v);
    meter.add(16 + 2 * k.length);
  }

  // ---- AMF0 ----
  const refs0: { v: Value | undefined; size: number }[] = [];

  function ref0(i: number, at: number): Value {
    const r = refs0[i];
    if (r === undefined) throw fail(`the reference ${i} does not exist`, at);
    if (r.v === undefined)
      throw fail("a reference to an object that is still being read (a cycle)", at);
    meter.add(r.size);
    return r.v;
  }

  function props0(m: Map<string, Value>, depth: number): void {
    for (;;) {
      const at = p;
      const n = u16("a property name");
      if (n === 0) {
        if (u8("the object end marker") !== 9)
          throw fail("an empty property name must be followed by the object end marker (9)", p - 1);
        return;
      }
      const k = utf(n, "a property name");
      setKey(m, k, value0(depth + 1), at);
    }
  }

  function tracked(build: () => Value): Value {
    const slot: { v: Value | undefined; size: number } = { v: undefined, size: 0 };
    refs0.push(slot);
    const before = meter.size;
    slot.v = build();
    slot.size = meter.size - before;
    return slot.v;
  }

  function value0(depth: number): Value {
    if (depth > MAX_DEPTH) throw fail(`nesting deeper than ${MAX_DEPTH} levels`);
    const at = p;
    const t = u8("a value marker");
    meter.add(32);
    switch (t) {
      case 0:
        return numberValue(f64("a number"));
      case 1:
        return { tag: "bool", v: u8("a boolean") !== 0 };
      case 2:
        return str(utf(u16("a string length"), "a string"));
      case 3:
        return tracked(() => {
          const m = new Map<string, Value>();
          props0(m, depth);
          return { tag: "record", v: m };
        });
      case 5:
      case 6:
      case 13:
        return nullValue();
      case 7:
        return ref0(u16("a reference"), at);
      case 8:
        return tracked(() => {
          u32("an array count"); // the count is advisory
          const m = new Map<string, Value>();
          props0(m, depth);
          return { tag: "record", v: m };
        });
      case 10:
        return tracked(() => {
          const n = u32("an array count");
          if (n > left())
            throw fail(
              `an array declares ${n} items but only ${left()} bytes are left (truncated)`,
            );
          const items: Value[] = [];
          for (let i = 0; i < n; i++) {
            items.push(value0(depth + 1));
            meter.add(8);
          }
          return list(items);
        });
      case 11: {
        need(10, "a date");
        const ms = dv.getFloat64(p);
        p += 10; // the 16-bit time zone is reserved and ignored
        return date(ms, at);
      }
      case 12:
        return str(utf(u32("a long string length"), "a long string"));
      case 15:
        return str(utf(u32("an XML document length"), "an XML document"));
      case 16:
        return tracked(() => {
          utf(u16("a class name length"), "a class name"); // the class name is dropped
          const m = new Map<string, Value>();
          props0(m, depth);
          return { tag: "record", v: m };
        });
      case 17:
        return value3(depth + 1);
      case 4:
        throw fail("the movieclip marker is reserved and not supported", at);
      case 14:
        throw fail("the recordset marker is reserved and not supported", at);
      case 9:
        throw fail("an object end marker outside an object", at);
      default:
        throw fail(`unknown AMF0 marker ${t}`, at);
    }
  }

  // ---- AMF3 ----
  const strings: string[] = [];
  const objects: { v: Value | undefined; size: number }[] = [];
  const traits: Trait[] = [];

  function u29(): number {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = u8("an integer");
      if (i === 3) return v * 256 + b;
      v = v * 128 + (b & 0x7f);
      if ((b & 0x80) === 0) return v;
    }
    return v;
  }

  function str3(): string {
    const at = p;
    const h = u29();
    if ((h & 1) === 0) {
      const s = strings[h >> 1];
      if (s === undefined) throw fail(`the string reference ${h >> 1} does not exist`, at);
      return s;
    }
    const s = utf(h >> 1, "a string");
    if (s !== "") strings.push(s);
    return s;
  }

  function track3(build: (slot: { v: Value | undefined; size: number }) => Value): Value {
    const slot: { v: Value | undefined; size: number } = { v: undefined, size: 0 };
    objects.push(slot);
    const before = meter.size;
    slot.v = build(slot);
    slot.size = meter.size - before;
    return slot.v;
  }

  function ref3(h: number, at: number): Value {
    const r = objects[h >> 1];
    if (r === undefined) throw fail(`the object reference ${h >> 1} does not exist`, at);
    if (r.v === undefined)
      throw fail("a reference to an object that is still being read (a cycle)", at);
    meter.add(r.size);
    return r.v;
  }

  function keyText3(v: Value, at: number): string {
    if (v.tag === "str") return v.v;
    if (v.tag === "int") return String(v.v);
    if (v.tag === "num") return numberKey(v.v);
    if (v.tag === "bool") return v.v ? "true" : "false";
    throw fail("a dictionary key that is not text or a number has no JSON form", at);
  }

  function value3(depth: number): Value {
    if (depth > MAX_DEPTH) throw fail(`nesting deeper than ${MAX_DEPTH} levels`);
    const at = p;
    const t = u8("a value marker");
    meter.add(32);
    switch (t) {
      case 0:
      case 1:
        return nullValue();
      case 2:
        return { tag: "bool", v: false };
      case 3:
        return { tag: "bool", v: true };
      case 4: {
        const v = u29();
        return int(v >= 0x10000000 ? v - 0x20000000 : v);
      }
      case 5:
        return numberValue(f64("a double"));
      case 6:
        return str(str3());
      case 7:
      case 11: {
        const h = u29();
        if ((h & 1) === 0) return ref3(h, at);
        return track3(() => str(utf(h >> 1, "an XML document")));
      }
      case 8: {
        const h = u29();
        if ((h & 1) === 0) return ref3(h, at);
        return track3(() => date(f64("a date"), at));
      }
      case 9: {
        const h = u29();
        if ((h & 1) === 0) return ref3(h, at);
        return track3(() => {
          const n = h >> 1;
          const m = new Map<string, Value>();
          for (;;) {
            const ka = p;
            const k = str3();
            if (k === "") break;
            setKey(m, k, value3(depth + 1), ka);
          }
          if (n > left())
            throw fail(
              `an array declares ${n} items but only ${left()} bytes are left (truncated)`,
            );
          if (m.size === 0) {
            const items: Value[] = [];
            for (let i = 0; i < n; i++) {
              items.push(value3(depth + 1));
              meter.add(8);
            }
            return list(items);
          }
          for (let i = 0; i < n; i++) setKey(m, String(i), value3(depth + 1), p);
          return { tag: "record", v: m };
        });
      }
      case 10: {
        const h = u29();
        if ((h & 1) === 0) return ref3(h, at);
        let trait: Trait;
        if ((h & 2) === 0) {
          const tr = traits[h >> 2];
          if (tr === undefined) throw fail(`the trait reference ${h >> 2} does not exist`, at);
          trait = tr;
        } else {
          if ((h & 4) !== 0)
            throw fail("an externalizable object cannot be read without its class", at);
          const count = h >> 4;
          if (count > left())
            throw fail(
              `an object declares ${count} members but only ${left()} bytes are left (truncated)`,
            );
          const name = str3();
          const members: string[] = [];
          for (let i = 0; i < count; i++) members.push(str3());
          trait = { name, members, dynamic: (h & 8) !== 0 };
          traits.push(trait);
        }
        return track3(() => {
          const m = new Map<string, Value>();
          for (const k of trait.members) setKey(m, k, value3(depth + 1), p);
          if (trait.dynamic) {
            for (;;) {
              const ka = p;
              const k = str3();
              if (k === "") break;
              setKey(m, k, value3(depth + 1), ka);
            }
          }
          return { tag: "record", v: m };
        });
      }
      case 12: {
        const h = u29();
        if ((h & 1) === 0) return ref3(h, at);
        return track3(() => {
          const n = h >> 1;
          need(n, "a byte array");
          const b = data.slice(p, p + n);
          p += n;
          return bufferValue(b, meter);
        });
      }
      case 13:
      case 14:
      case 15: {
        const h = u29();
        if ((h & 1) === 0) return ref3(h, at);
        return track3(() => {
          const n = h >> 1;
          const width = t === 15 ? 8 : 4;
          u8("the fixed flag");
          if (n * width > left())
            throw fail(
              `a vector declares ${n} items but only ${left()} bytes are left (truncated)`,
            );
          const items: Value[] = [];
          for (let i = 0; i < n; i++) {
            if (t === 13) items.push(int(dv.getInt32(p)));
            else if (t === 14) items.push(int(dv.getUint32(p)));
            else items.push(numberValue(dv.getFloat64(p)));
            p += width;
            meter.add(16);
          }
          return list(items);
        });
      }
      case 16: {
        const h = u29();
        if ((h & 1) === 0) return ref3(h, at);
        return track3(() => {
          const n = h >> 1;
          u8("the fixed flag");
          str3(); // the element type name
          if (n > left())
            throw fail(
              `a vector declares ${n} items but only ${left()} bytes are left (truncated)`,
            );
          const items: Value[] = [];
          for (let i = 0; i < n; i++) {
            items.push(value3(depth + 1));
            meter.add(8);
          }
          return list(items);
        });
      }
      case 17: {
        const h = u29();
        if ((h & 1) === 0) return ref3(h, at);
        return track3(() => {
          const n = h >> 1;
          u8("the weak-keys flag");
          if (2 * n > left())
            throw fail(
              `a dictionary declares ${n} pairs but only ${left()} bytes are left (truncated)`,
            );
          const m = new Map<string, Value>();
          for (let i = 0; i < n; i++) {
            const ka = p;
            const k = keyText3(value3(depth + 1), ka);
            setKey(m, k, value3(depth + 1), ka);
          }
          return { tag: "record", v: m };
        });
      }
      default:
        throw fail(`unknown AMF3 marker ${t}`, at);
    }
  }

  if (data.length === 0) throw fail("the input is empty", 0);
  const v = version === "AMF0" ? value0(0) : value3(0);
  if (p !== data.length) throw fail(`${data.length - p} bytes follow the value`);
  return v;
}

function encode(value: Value, version: string, ctx: PrimitiveContext): Uint8Array {
  if (version !== "AMF0" && version !== "AMF3")
    throw new ForgeError({
      code: "E_RANGE",
      message: `the format must be AMF0 or AMF3, not ${version}`,
    });
  const out = new ByteSink(ctx.limits.maxValueBytes);
  const enc = new TextEncoder();
  const f64 = (x: number) => {
    const t = new DataView(new ArrayBuffer(8));
    t.setFloat64(0, x);
    out.bytes(new Uint8Array(t.buffer));
  };
  const asNumber = (v: Value & { tag: "int" | "num" }): number => {
    const x = Number(v.v);
    if (!Number.isFinite(x)) throw writeFailure("AMF", "an integer is too large for a double");
    return x;
  };

  function write0(v: Value, depth: number): void {
    if (depth > MAX_DEPTH) throw writeFailure("AMF", `nesting deeper than ${MAX_DEPTH} levels`);
    switch (v.tag) {
      case "int":
      case "num":
        out.byte(0);
        f64(asNumber(v));
        return;
      case "bool":
        out.byte(1);
        out.byte(v.v ? 1 : 0);
        return;
      case "str": {
        const b = enc.encode(v.v);
        if (b.length < 65536) {
          out.byte(2);
          out.be(b.length, 2);
        } else {
          out.byte(12);
          out.be(b.length, 4);
        }
        out.bytes(b);
        return;
      }
      case "list": {
        const items = v.v as readonly Value[];
        out.byte(10);
        out.be(items.length, 4);
        for (const x of items) write0(x, depth + 1);
        return;
      }
      case "record": {
        if (isNullValue(v)) {
          out.byte(5);
          return;
        }
        out.byte(3);
        for (const [k, x] of v.v as ReadonlyMap<string, Value>) {
          const kb = enc.encode(k);
          if (kb.length === 0)
            throw writeFailure("AMF", "AMF0 cannot write an object property with an empty name");
          if (kb.length > 65535)
            throw writeFailure("AMF", "an AMF0 property name is longer than 65535 bytes");
          out.be(kb.length, 2);
          out.bytes(kb);
          write0(x, depth + 1);
        }
        out.byte(0);
        out.byte(0);
        out.byte(9);
        return;
      }
      default:
        throw writeFailure("AMF", `a ${v.tag} has no JSON form`);
    }
  }

  function u29(n: number): void {
    if (n < 0 || n > 0x1fffffff)
      throw writeFailure("AMF", "a length or integer does not fit in 29 bits");
    if (n < 0x80) out.byte(n);
    else if (n < 0x4000) {
      out.byte(0x80 | (n >> 7));
      out.byte(n & 0x7f);
    } else if (n < 0x200000) {
      out.byte(0x80 | (n >> 14));
      out.byte(0x80 | ((n >> 7) & 0x7f));
      out.byte(n & 0x7f);
    } else {
      out.byte(0x80 | (n >> 22));
      out.byte(0x80 | ((n >> 15) & 0x7f));
      out.byte(0x80 | ((n >> 8) & 0x7f));
      out.byte(n & 0xff);
    }
  }

  function s3(s: string): void {
    const b = enc.encode(s);
    u29((b.length << 1) | 1);
    out.bytes(b);
  }

  function write3(v: Value, depth: number): void {
    if (depth > MAX_DEPTH) throw writeFailure("AMF", `nesting deeper than ${MAX_DEPTH} levels`);
    switch (v.tag) {
      case "int": {
        if (v.v >= -0x10000000 && v.v <= 0x0fffffff) {
          out.byte(4);
          u29(Number(v.v) & 0x1fffffff);
        } else {
          out.byte(5);
          f64(asNumber(v));
        }
        return;
      }
      case "num":
        out.byte(5);
        f64(v.v);
        return;
      case "bool":
        out.byte(v.v ? 3 : 2);
        return;
      case "str":
        out.byte(6);
        s3(v.v);
        return;
      case "list": {
        const items = v.v as readonly Value[];
        out.byte(9);
        u29((items.length << 1) | 1);
        out.byte(1);
        for (const x of items) write3(x, depth + 1);
        return;
      }
      case "record": {
        if (isNullValue(v)) {
          out.byte(1);
          return;
        }
        out.byte(10);
        out.byte(0x0b);
        out.byte(1);
        for (const [k, x] of v.v as ReadonlyMap<string, Value>) {
          if (k === "")
            throw writeFailure("AMF", "AMF3 cannot write an object property with an empty name");
          s3(k);
          write3(x, depth + 1);
        }
        out.byte(1);
        return;
      }
      default:
        throw writeFailure("AMF", `a ${v.tag} has no JSON form`);
    }
  }

  if (version === "AMF0") write0(value, 0);
  else write3(value, 0);
  return out.finish();
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("amf", "_decode", "( data:bytes version:str -- any )", decode, {
    doc: "The one AMF0 or AMF3 value in the bytes, as a JSON value (private helper of amf:decode).",
    category: "Data format",
  }),
  definePrimitive("amf", "_encode", "( value:any version:str -- bytes )", encode, {
    doc: "A JSON value as one AMF0 or AMF3 value (private helper of amf:encode).",
    category: "Data format",
  }),
];
