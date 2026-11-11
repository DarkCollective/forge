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
 * plist primitive: reads an Apple property list, the XML form (the plist 1.0 DTD) and the binary form
 * ("bplist00", read from Apple's CFBinaryPList.c layout), and writes the outline P-list Viewer shows. A character
 * scanner is too slow in FL (5.5 VM steps a character before any state, see json.ts), so the reader is a
 * primitive; it builds the outline text directly.
 *
 *  - `_view ( data:bytes -- str )`: the property list as text in the layout of CyberChef's P-list Viewer: a first line
 *    `plist => ` followed by the root, a last line `/plist`, one tab per level. A dictionary is `{`, one `key => value`
 *    line per entry and `}`; an array is `[`, one `index => item` line per item (from 0) and `]`; an entry whose value
 *    is a dictionary or an array opens it on the same line (`key => {`); an empty dictionary or array is `{}` or `[]`.
 *    A string is shown in double quotes, otherwise as it is (a multi-line string keeps its line breaks), an integer and
 *    a real in decimal, true and false, a date as its ISO 8601 text (a binary date is converted from seconds since
 *    2001-01-01), data as Base64 text, a binary UID as `UID(n)` and a set as an array.
 *    The XML reader accepts the XML declaration, a doctype, comments, processing instructions and CDATA, the
 *    five predefined entities and numeric character references; an unknown element, a key without a value, a
 *    mismatched tag, nesting deeper than 64 levels and anything after the closing plist tag are E_COERCE with the
 *    offset. The binary reader checks the trailer, every offset and every object reference against the table
 *    (a reference cycle is E_COERCE) and compares each count with the bytes that exist.
 */
import { ForgeError, definePrimitive } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef } from "@forge/lang";
import { MAX_DEPTH, Meter, decodeStrict, formatFailure, strictUtf8 } from "../data-format-util.js";

type Node =
  | { k: "dict"; entries: [string, Node][] }
  | { k: "array"; items: Node[] }
  | { k: "text"; text: string; q?: boolean };

const IND = "\t";

function render(root: Node, ctx: PrimitiveContext): string {
  const meter = new Meter(ctx.limits.maxValueBytes, "plist outline");
  const out: string[] = [];
  function emit(n: Node, indent: string, prefix: string): void {
    if (n.k === "text") {
      const shown = n.q ? `"${n.text}"` : n.text;
      meter.add(2 * (indent.length + prefix.length + shown.length) + 16);
      out.push(`${indent}${prefix}${shown}`);
    } else if (n.k === "dict") {
      if (n.entries.length === 0) {
        out.push(`${indent}${prefix}{}`);
        return;
      }
      out.push(`${indent}${prefix}{`);
      for (const [key, v] of n.entries) emit(v, indent + IND, `${key} => `);
      out.push(`${indent}}`);
    } else {
      if (n.items.length === 0) {
        out.push(`${indent}${prefix}[]`);
        return;
      }
      out.push(`${indent}${prefix}[`);
      n.items.forEach((v, i) => emit(v, indent + IND, `${i} => `));
      out.push(`${indent}]`);
    }
  }
  emit(root, "", "plist => ");
  return `${out.join("\n")}\n/plist\n`;
}

// ---------------------------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------------------------

function readXml(text: string, ctx: PrimitiveContext): Node {
  const meter = new Meter(ctx.limits.maxValueBytes, "plist value");
  let i = 0;
  const n = text.length;
  const fail = (reason: string, at: number = i): ForgeError =>
    formatFailure("property list", reason, at);

  function skipMisc(): void {
    for (;;) {
      while (i < n && /\s/.test(text[i] as string)) i++;
      if (text.startsWith("<!--", i)) {
        const e = text.indexOf("-->", i + 4);
        if (e < 0) throw fail("an unterminated comment");
        i = e + 3;
      } else if (text.startsWith("<?", i)) {
        const e = text.indexOf("?>", i + 2);
        if (e < 0) throw fail("an unterminated processing instruction");
        i = e + 2;
      } else if (text.startsWith("<!DOCTYPE", i)) {
        // a doctype, possibly with an internal subset in brackets
        let depth = 0;
        let j = i + 9;
        for (; j < n; j++) {
          const c = text[j];
          if (c === "[") depth++;
          else if (c === "]") depth--;
          else if (c === ">" && depth <= 0) break;
        }
        if (j >= n) throw fail("an unterminated doctype");
        i = j + 1;
      } else return;
    }
  }

  function decodeEntities(s: string, at: number): string {
    return s.replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (m, e: string) => {
      if (e === "amp") return "&";
      if (e === "lt") return "<";
      if (e === "gt") return ">";
      if (e === "quot") return '"';
      if (e === "apos") return "'";
      const cp = e[1] === "x" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      if (!(cp >= 0 && cp <= 0x10ffff) || (cp >= 0xd800 && cp <= 0xdfff))
        throw fail(`the character reference ${m} is not a character`, at);
      return String.fromCodePoint(cp);
    });
  }

  /** The tag at i: its name, whether it closes, whether it is empty (`<x/>`); i moves past `>`. */
  function tag(): { name: string; close: boolean; empty: boolean } {
    const at = i;
    if (text[i] !== "<") throw fail("expected a tag");
    const e = text.indexOf(">", i);
    if (e < 0) throw fail("an unterminated tag", at);
    const body = text.slice(i + 1, e);
    i = e + 1;
    const m = /^(\/)?\s*([A-Za-z][A-Za-z0-9_-]*)(?:\s[^>]*?)?(\/)?$/.exec(body);
    if (m === null) throw fail("a malformed tag", at);
    return { name: m[2] as string, close: m[1] !== undefined, empty: m[3] !== undefined };
  }

  /** The text up to the closing tag `</name>`, CDATA sections read as they are. */
  function content(name: string): string {
    let out = "";
    const start = i;
    for (;;) {
      if (i >= n) throw fail(`the element ${name} is not closed`, start);
      if (text.startsWith("<![CDATA[", i)) {
        const e = text.indexOf("]]>", i + 9);
        if (e < 0) throw fail("an unterminated CDATA section");
        out += text.slice(i + 9, e);
        i = e + 3;
      } else if (text.startsWith("<!--", i)) {
        const e = text.indexOf("-->", i + 4);
        if (e < 0) throw fail("an unterminated comment");
        i = e + 3;
      } else if (text[i] === "<") {
        const at = i;
        const t = tag();
        if (!t.close || t.name !== name) throw fail(`expected </${name}>`, at);
        return out;
      } else {
        const e = text.indexOf("<", i);
        const stop = e < 0 ? n : e;
        out += decodeEntities(text.slice(i, stop), i);
        i = stop;
      }
    }
  }

  function value(depth: number): Node {
    if (depth > MAX_DEPTH) throw fail(`nesting deeper than ${MAX_DEPTH} levels`);
    skipMisc();
    const at = i;
    const t = tag();
    if (t.close) throw fail(`an unexpected closing tag </${t.name}>`, at);
    meter.add(48);
    const simple = (f: (s: string) => string): Node => {
      const s = t.empty ? "" : content(t.name);
      meter.add(2 * s.length);
      return { k: "text", text: f(s) };
    };
    switch (t.name) {
      case "true":
      case "false":
        if (!t.empty) content(t.name);
        return { k: "text", text: t.name };
      case "string": {
        const node = simple((s) => s);
        (node as { q?: boolean }).q = true;
        return node;
      }
      case "integer": {
        return simple((s) => {
          const v = s.trim();
          if (!/^[-+]?(\d+|0[xX][0-9A-Fa-f]+)$/.test(v))
            throw fail(`${JSON.stringify(v)} is not an integer`, at);
          return v.replace(/^\+/, "");
        });
      }
      case "real":
        return simple((s) => {
          const v = s.trim();
          if (!/^[-+]?(\d+\.?\d*([eE][-+]?\d+)?|\.\d+([eE][-+]?\d+)?|nan|inf|infinity)$/i.test(v))
            throw fail(`${JSON.stringify(v)} is not a real number`, at);
          return v;
        });
      case "date":
        return simple((s) => s.trim());
      case "data":
        return simple((s) => {
          const v = s.replace(/\s+/g, "");
          if (!/^[A-Za-z0-9+/]*={0,2}$/.test(v) || v.length % 4 === 1)
            throw fail("data is not Base64 text", at);
          return v;
        });
      case "array": {
        const items: Node[] = [];
        if (!t.empty) {
          for (;;) {
            skipMisc();
            if (text.startsWith("</", i)) {
              const c = tag();
              if (c.name !== "array") throw fail("expected </array>", i);
              break;
            }
            if (i >= n) throw fail("the array is not closed", at);
            items.push(value(depth + 1));
            meter.add(8);
          }
        }
        return { k: "array", items };
      }
      case "dict": {
        const entries: [string, Node][] = [];
        if (!t.empty) {
          for (;;) {
            skipMisc();
            if (text.startsWith("</", i)) {
              const c = tag();
              if (c.name !== "dict") throw fail("expected </dict>", i);
              break;
            }
            if (i >= n) throw fail("the dict is not closed", at);
            const ka = i;
            const kt = tag();
            if (kt.close || kt.name !== "key")
              throw fail("a dict holds key elements followed by values", ka);
            const key = kt.empty ? "" : content("key");
            meter.add(16 + 2 * key.length);
            skipMisc();
            if (i >= n || text.startsWith("</", i))
              throw fail(`the key ${JSON.stringify(key)} has no value`, ka);
            entries.push([key, value(depth + 1)]);
          }
        }
        return { k: "dict", entries };
      }
      default:
        throw fail(`unknown element <${t.name}>`, at);
    }
  }

  skipMisc();
  const at = i;
  const open = tag();
  if (open.name !== "plist" || open.close) throw fail("expected the <plist> element", at);
  if (open.empty) throw fail("the <plist> element is empty", at);
  const root = value(0);
  skipMisc();
  const close = tag();
  if (close.name !== "plist" || !close.close) throw fail("expected </plist>", i);
  skipMisc();
  if (i < n) throw fail("text after </plist>");
  return root;
}

// ---------------------------------------------------------------------------------------------
// binary
// ---------------------------------------------------------------------------------------------

function readBinary(d: Uint8Array, ctx: PrimitiveContext): Node {
  const meter = new Meter(ctx.limits.maxValueBytes, "plist value");
  const fail = (reason: string, at: number): ForgeError =>
    formatFailure("binary property list", reason, at);
  if (d.length < 8 + 32) throw fail("the data is too short for a binary property list", 0);
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const t = d.length - 32;
  const offSize = d[t + 6] as number;
  const refSize = d[t + 7] as number;
  const numObjects = dv.getBigUint64(t + 8);
  const top = dv.getBigUint64(t + 16);
  const tableAt = dv.getBigUint64(t + 24);
  if (offSize < 1 || offSize > 8) throw fail(`the offset size ${offSize} is not 1 to 8`, t + 6);
  if (refSize < 1 || refSize > 8)
    throw fail(`the object reference size ${refSize} is not 1 to 8`, t + 7);
  if (numObjects === 0n || numObjects > BigInt(d.length))
    throw fail("the object count is not plausible", t + 8);
  if (top >= numObjects) throw fail("the top object is not in the table", t + 16);
  const count = Number(numObjects);
  if (tableAt < 8n || tableAt + BigInt(count * offSize) > BigInt(t))
    throw fail("the offset table lies outside the data", t + 24);
  const tbl = Number(tableAt);

  function uint(p: number, size: number): number {
    if (p + size > t) throw fail("a value runs into the trailer", p);
    let v = 0n;
    for (let i = 0; i < size; i++) v = (v << 8n) | BigInt(d[p + i] as number);
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw fail("a number is too large", p);
    return Number(v);
  }
  function offsetOf(idx: number): number {
    const o = uint(tbl + idx * offSize, offSize);
    if (o < 8 || o >= tbl)
      throw fail(`the offset of object ${idx} lies outside the objects`, tbl + idx * offSize);
    return o;
  }

  const active = new Set<number>();
  function lengthAt(p: number, info: number): { len: number; p: number } {
    if (info !== 0xf) return { len: info, p };
    const m = d[p] as number | undefined;
    if (m === undefined || m >> 4 !== 1) throw fail("a length is not an integer object", p);
    const size = 1 << (m & 15);
    if (size > 8) throw fail("a length integer is too large", p);
    return { len: uint(p + 1, size), p: p + 1 + size };
  }

  function obj(idx: number, depth: number): Node {
    if (depth > MAX_DEPTH) throw fail(`nesting deeper than ${MAX_DEPTH} levels`, 0);
    if (idx >= count) throw fail(`the object reference ${idx} is outside the table`, 0);
    const at = offsetOf(idx);
    const b = d[at] as number;
    const hi = b >> 4;
    const lo = b & 15;
    meter.add(48);
    const text = (s: string): Node => {
      meter.add(2 * s.length);
      return { k: "text", text: s };
    };
    const quoted = (s: string): Node => {
      meter.add(2 * s.length);
      return { k: "text", text: s, q: true };
    };
    switch (hi) {
      case 0:
        if (b === 0x08) return text("false");
        if (b === 0x09) return text("true");
        if (b === 0x00) return text("null");
        throw fail(`the object marker 0x${b.toString(16)} is not known`, at);
      case 1: {
        const size = 1 << lo;
        if (size > 16 || at + 1 + size > t) throw fail("an integer runs into the trailer", at);
        if (size === 8) return text(dv.getBigInt64(at + 1).toString());
        if (size === 16) return text(dv.getBigUint64(at + 9).toString());
        return text(String(uint(at + 1, size)));
      }
      case 2: {
        if (lo === 2 && at + 5 <= t) return text(String(dv.getFloat32(at + 1)));
        if (lo === 3 && at + 9 <= t) return text(String(dv.getFloat64(at + 1)));
        throw fail("a real is not 4 or 8 bytes", at);
      }
      case 3: {
        if (b !== 0x33 || at + 9 > t) throw fail("a date is not an 8-byte double", at);
        const secs = dv.getFloat64(at + 1);
        const ms = Math.round((secs + 978307200) * 1000);
        const dt = new Date(ms);
        if (!Number.isFinite(secs) || Number.isNaN(dt.getTime()))
          throw fail("a date is outside the range of dates", at);
        return text(dt.toISOString().replace(/\.000Z$/, "Z"));
      }
      case 4: {
        const { len, p } = lengthAt(at + 1, lo);
        if (len > t - p)
          throw fail(`data declares ${len} bytes but only ${t - p} are left (truncated)`, at);
        return text(toBase64(d.subarray(p, p + len)));
      }
      case 5: {
        const { len, p } = lengthAt(at + 1, lo);
        if (len > t - p)
          throw fail(`a string declares ${len} bytes but only ${t - p} are left (truncated)`, at);
        for (let i = 0; i < len; i++)
          if ((d[p + i] as number) > 0x7f)
            throw fail("an ASCII string holds a byte above 127", p + i);
        return quoted(String.fromCharCode(...d.subarray(p, p + len)));
      }
      case 6: {
        const { len, p } = lengthAt(at + 1, lo);
        if (len * 2 > t - p)
          throw fail(
            `a string declares ${len} characters but only ${t - p} bytes are left (truncated)`,
            at,
          );
        const be = d.subarray(p, p + len * 2);
        const le = new Uint8Array(be.length);
        for (let i = 0; i < be.length; i += 2) {
          le[i] = be[i + 1] as number;
          le[i + 1] = be[i] as number;
        }
        return quoted(strictUtf8Utf16(le, p));
      }
      case 8:
        return text(`UID(${uint(at + 1, lo + 1)})`);
      case 0xa:
      case 0xc: {
        const { len, p } = lengthAt(at + 1, lo);
        if (len * refSize > t - p)
          throw fail(
            `an array declares ${len} items but only ${t - p} bytes are left (truncated)`,
            at,
          );
        if (active.has(idx)) throw fail("an array or set contains itself", at);
        active.add(idx);
        const items: Node[] = [];
        for (let i = 0; i < len; i++) {
          items.push(obj(uint(p + i * refSize, refSize), depth + 1));
          meter.add(8);
        }
        active.delete(idx);
        return { k: "array", items };
      }
      case 0xd: {
        const { len, p } = lengthAt(at + 1, lo);
        if (2 * len * refSize > t - p)
          throw fail(
            `a dictionary declares ${len} entries but only ${t - p} bytes are left (truncated)`,
            at,
          );
        if (active.has(idx)) throw fail("a dictionary contains itself", at);
        active.add(idx);
        const entries: [string, Node][] = [];
        for (let i = 0; i < len; i++) {
          const k = obj(uint(p + i * refSize, refSize), depth + 1);
          if (k.k !== "text") throw fail("a dictionary key is not a string", p + i * refSize);
          entries.push([k.text, obj(uint(p + (len + i) * refSize, refSize), depth + 1)]);
          meter.add(16);
        }
        active.delete(idx);
        return { k: "dict", entries };
      }
      default:
        throw fail(`the object marker 0x${b.toString(16)} is not known`, at);
    }
  }

  return obj(Number(top), 0);
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function toBase64(b: Uint8Array): string {
  let out = "";
  for (let i = 0; i < b.length; i += 3) {
    const n =
      ((b[i] as number) << 16) | (((b[i + 1] ?? 0) as number) << 8) | ((b[i + 2] ?? 0) as number);
    out += B64[(n >> 18) & 63] as string;
    out += B64[(n >> 12) & 63] as string;
    out += i + 1 < b.length ? (B64[(n >> 6) & 63] as string) : "=";
    out += i + 2 < b.length ? (B64[n & 63] as string) : "=";
  }
  return out;
}

function strictUtf8Utf16(le: Uint8Array, at: number): string {
  return decodeStrict(le, "utf-16le", () => {
    throw formatFailure("binary property list", "a UTF-16 string is not valid", at);
  });
}

function view(data: Uint8Array, ctx: PrimitiveContext): string {
  const isBinary = data.length >= 8 && String.fromCharCode(...data.subarray(0, 8)) === "bplist00";
  if (isBinary) return render(readBinary(data, ctx), ctx);
  let start = 0;
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) start = 3;
  const text = strictUtf8(data.subarray(start), "property list", start);
  if (text.trim() === "") throw formatFailure("property list", "the input is empty", 0);
  return render(readXml(text, ctx), ctx);
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("plist", "_view", "( data:bytes -- str )", view, {
    doc: "The outline of an XML or binary Apple property list (private helper of plist:view).",
    category: "Data format",
  }),
];
