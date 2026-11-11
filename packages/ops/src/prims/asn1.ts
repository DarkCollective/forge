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
 * asn1 primitives: the shared DER reader, the object identifier codec and name table, the PEM scanner and
 * the ASN.1 string decoder of the internal `asn1` vocabulary (vocab/asn1.fth builds the FL words around
 * them). Each is a primitive for a measured reason:
 *
 *  - `parse-in ( data start end max-depth -- list )`: the DER reader. A recursive descent over the bytes
 *    that builds a record per element; in FL it costs a few hundred VM steps per element and the growing
 *    lists are quadratic, so a 64 KiB structure would not fit the step budget. It is bounded (see below).
 *  - `oid-decode` / `oid-encode`: sub-identifiers can exceed 2^53 (the 2.25.<UUID> arcs are 128 bits),
 *    so the loops need BigInt accumulators, which FL has but only at one step per byte of work.
 *  - `oid-name`, `oid-short`, `oid-find`: lookups in the name table of src/asn1-oids.ts. FL has no
 *    per-vocabulary constants, so an FL table would be rebuilt on every call.
 *  - `_pem-scan`: finds the PEM blocks in a text (RFC 7468 with the RFC 1421 headers); the Base64 is
 *    decoded by FL through `base64:decode`.
 *  - `_string`: the character sets of the ASN.1 string types (UTF-16BE, UTF-32BE, strict UTF-8).
 *
 * Bounds of the reader (`parse-in`): the nesting depth is at most `max-depth` (the FL words use 64); a
 * length is never trusted to allocate anything (it is only compared with the bytes that are left, and a
 * value is a copy of bytes that exist); the number of elements is bounded by the input (an element is at
 * least two bytes) and the result is stopped with E_LIMIT_VALUE as soon as its estimated size passes
 * `limits.maxValueBytes`, before the records are built in bulk. A length of the indefinite form, an
 * end-of-contents marker, a header that is cut short and a child that runs past its parent are E_COERCE.
 * Non-minimal lengths and tag numbers are accepted (the reader is BER-tolerant for definite lengths, so it
 * can inspect what other tools wrote); the FL writers always produce DER.
 */
import { definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef, Value } from "@forge/lang";
import { OID_TABLE } from "../asn1-oids.js";
import { coerceFailure, limitFailure, rangeFailure } from "../prim-util.js";

const { int, str, bytes, bool, list, record } = valueHelpers;

// The package builds against ES2022 only (no DOM or Node typings), so declare the one global used (as charset.ts does).
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  decode(input?: Uint8Array): string;
}

const CLASSES = ["universal", "application", "context", "private"] as const;

/** The estimated size of one node record: 8 keys (16 each plus the key text) and the small values. */
const NODE_COST = 320;

function fail(to: string, reason: string) {
  return coerceFailure("ASN.1 data", to, reason);
}

/** A safe integer argument, or E_RANGE. */
function intArg(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v))
    throw rangeFailure(`${what} must be an integer that fits in a number`);
  return v;
}

interface Budget {
  nodes: number;
  size: number;
  readonly max: number;
}

function hexAt(n: number): string {
  return `0x${n.toString(16)}`;
}

/** The elements of `data[start, end)`, each with its children, as FL records. `depth` is the level of these elements (1 at the top). */
function readElements(
  data: Uint8Array,
  start: number,
  end: number,
  depth: number,
  maxDepth: number,
  budget: Budget,
): Value[] {
  const out: Value[] = [];
  let p = start;
  while (p < end) {
    if (depth > maxDepth)
      throw fail("list", `nested deeper than ${maxDepth} levels (at offset ${p})`);
    const id = data[p] as number;
    const cls = id >> 6;
    const constructed = (id & 0x20) !== 0;
    let tag = id & 0x1f;
    let q = p + 1;
    if (tag === 0x1f) {
      tag = 0;
      let count = 0;
      for (;;) {
        if (q >= end) throw fail("list", `the tag at offset ${p} is cut short`);
        const b = data[q++] as number;
        if (count === 0 && b === 0x80)
          throw fail("list", `the tag number at offset ${p} has a leading zero group`);
        if (++count > 5) throw fail("list", `the tag number at offset ${p} is too long`);
        tag = tag * 128 + (b & 0x7f);
        if ((b & 0x80) === 0) break;
      }
    }
    if (cls === 0 && tag === 0 && !constructed)
      throw fail(
        "list",
        `end-of-contents marker at offset ${p}: not DER (or padding after the data)`,
      );
    if (q >= end) throw fail("list", `the length at offset ${p} is cut short`);
    const first = data[q++] as number;
    let len: number;
    if (first < 0x80) {
      len = first;
    } else if (first === 0x80) {
      throw fail("list", `indefinite length at offset ${p}: not DER`);
    } else if (first === 0xff) {
      throw fail("list", `reserved length byte 0xff at offset ${p}`);
    } else {
      const n = first & 0x7f;
      if (q + n > end) throw fail("list", `the length at offset ${p} is cut short`);
      let big = 0n;
      for (let i = 0; i < n; i++) big = (big << 8n) | BigInt(data[q + i] as number);
      q += n;
      if (big > BigInt(end - q))
        throw fail(
          "list",
          `the element at offset ${p} declares ${big} bytes but only ${end - q} are left (truncated)`,
        );
      len = Number(big);
    }
    if (len > end - q)
      throw fail(
        "list",
        `the element at offset ${p} declares ${len} bytes but only ${end - q} are left (truncated)`,
      );
    budget.nodes++;
    budget.size += NODE_COST + (constructed ? 0 : len);
    if (budget.size > budget.max)
      throw limitFailure("maxValueBytes", budget.max, budget.size, "ASN.1 tree");
    const children = constructed ? readElements(data, q, q + len, depth + 1, maxDepth, budget) : [];
    out.push(
      record([
        ["class", str(CLASSES[cls] as string)],
        ["constructed", bool(constructed)],
        ["tag", int(tag)],
        ["offset", int(p)],
        ["hlen", int(q - p)],
        ["len", int(len)],
        ["value", bytes(constructed ? new Uint8Array(0) : data.slice(q, q + len))],
        ["children", list(children)],
      ]),
    );
    p = q + len;
  }
  return out;
}

/**
 * The elements of `data[start, end)`; offsets in the nodes are offsets into `data`. See the file comment
 * for the bounds.
 */
export function parseIn(
  data: Uint8Array,
  start: number,
  end: number,
  maxDepth: number,
  maxValueBytes: number,
): Value[] {
  if (start < 0 || end < start || end > data.length)
    throw rangeFailure(
      `the window ${start} to ${end} is not inside the ${data.length} bytes of data`,
    );
  if (maxDepth < 1 || maxDepth > 256)
    throw rangeFailure(`the depth limit must be 1 to 256, not ${maxDepth}`);
  return readElements(data, start, end, 1, maxDepth, { nodes: 0, size: 0, max: maxValueBytes });
}

// ---------------------------------------------------------------------------------------------
// Object identifiers
// ---------------------------------------------------------------------------------------------

const MAX_OID_BYTES = 4096;

/** The dotted text of the content bytes of an OBJECT IDENTIFIER. */
export function oidDecode(content: Uint8Array): string {
  if (content.length === 0)
    throw coerceFailure("bytes", "str", "an object identifier has no bytes");
  if (content.length > MAX_OID_BYTES)
    throw coerceFailure(
      "bytes",
      "str",
      `an object identifier longer than ${MAX_OID_BYTES} bytes is refused`,
    );
  const arcs: bigint[] = [];
  let acc = 0n;
  let fresh = true;
  for (let i = 0; i < content.length; i++) {
    const b = content[i] as number;
    if (fresh && b === 0x80)
      throw coerceFailure("bytes", "str", `sub-identifier at byte ${i} has a leading zero group`);
    fresh = false;
    acc = (acc << 7n) | BigInt(b & 0x7f);
    if ((b & 0x80) === 0) {
      arcs.push(acc);
      acc = 0n;
      fresh = true;
    }
  }
  if (!fresh)
    throw coerceFailure("bytes", "str", "the last sub-identifier is cut short (high bit set)");
  const head = arcs[0] as bigint;
  const first = head < 40n ? 0n : head < 80n ? 1n : 2n;
  const second = head - first * 40n;
  return [first, second, ...arcs.slice(1)].map((a) => a.toString()).join(".");
}

/** The content bytes of an OBJECT IDENTIFIER written in dotted form. */
export function oidEncode(text: string): Uint8Array {
  const t = text.trim();
  const parts = t.split(".");
  if (t === "" || parts.length < 2)
    throw coerceFailure(
      "str",
      "bytes",
      "an object identifier needs at least two arcs, such as 1.2",
    );
  for (const p of parts)
    if (!/^(0|[1-9][0-9]*)$/.test(p))
      throw coerceFailure(
        "str",
        "bytes",
        `'${p.slice(0, 20)}' is not an arc (digits, no leading zero)`,
      );
  const arcs = parts.map((p) => BigInt(p));
  const a = arcs[0] as bigint;
  const b = arcs[1] as bigint;
  if (a > 2n) throw coerceFailure("str", "bytes", `the first arc must be 0, 1 or 2, not ${a}`);
  if (a < 2n && b > 39n)
    throw coerceFailure(
      "str",
      "bytes",
      `the second arc must be 0 to 39 below the root ${a}, not ${b}`,
    );
  const sub: bigint[] = [a * 40n + b, ...arcs.slice(2)];
  const out: number[] = [];
  for (const v of sub) {
    const groups: number[] = [];
    let x = v;
    do {
      groups.push(Number(x & 0x7fn));
      x >>= 7n;
    } while (x > 0n);
    for (let i = groups.length - 1; i >= 0; i--)
      out.push((groups[i] as number) | (i > 0 ? 0x80 : 0));
    if (out.length > MAX_OID_BYTES)
      throw coerceFailure(
        "str",
        "bytes",
        `an object identifier longer than ${MAX_OID_BYTES} bytes is refused`,
      );
  }
  return Uint8Array.from(out);
}

let byOid: Map<string, readonly [string, string | undefined]> | undefined;
let byName: Map<string, string> | undefined;
let byShort: Map<string, string> | undefined;
let byLower: Map<string, string> | undefined;

function tables(): void {
  if (byOid !== undefined) return;
  byOid = new Map();
  byName = new Map();
  byShort = new Map();
  byLower = new Map();
  for (const e of OID_TABLE) {
    byOid.set(e[0], [e[1], e[2]]);
    if (!byName.has(e[1])) byName.set(e[1], e[0]);
    if (!byLower.has(e[1].toLowerCase())) byLower.set(e[1].toLowerCase(), e[0]);
    if (e[2] !== undefined && !byShort.has(e[2])) byShort.set(e[2], e[0]);
  }
}

/** The name of a dotted OID from the table, or the empty string. */
export function oidName(dotted: string): string {
  tables();
  return (byOid as NonNullable<typeof byOid>).get(dotted.trim())?.[0] ?? "";
}

/** The distinguished-name abbreviation of an attribute type OID (CN, O, C, ...), or the empty string. */
export function oidShort(dotted: string): string {
  tables();
  return (byOid as NonNullable<typeof byOid>).get(dotted.trim())?.[1] ?? "";
}

/** The dotted OID of a name or abbreviation (exact first, then any case), or the empty string. */
export function oidFind(name: string): string {
  tables();
  const n = name.trim();
  return (
    (byName as NonNullable<typeof byName>).get(n) ??
    (byShort as NonNullable<typeof byShort>).get(n) ??
    (byLower as NonNullable<typeof byLower>).get(n.toLowerCase()) ??
    ""
  );
}

// ---------------------------------------------------------------------------------------------
// ASN.1 string types
// ---------------------------------------------------------------------------------------------

/** The text of the content bytes of a string type (by universal tag number). */
export function stringOf(tag: number, v: Uint8Array): string {
  switch (tag) {
    case 12: // UTF8String
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(v);
      } catch {
        throw coerceFailure("bytes", "str", "the UTF8String is not valid UTF-8");
      }
    case 30: {
      // BMPString: UTF-16BE
      if (v.length % 2 !== 0)
        throw coerceFailure("bytes", "str", "a BMPString has an odd number of bytes");
      let s = "";
      for (let i = 0; i < v.length; i += 2)
        s += String.fromCharCode(((v[i] as number) << 8) | (v[i + 1] as number));
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (
          c >= 0xd800 &&
          c <= 0xdbff &&
          s.charCodeAt(i + 1) >= 0xdc00 &&
          s.charCodeAt(i + 1) <= 0xdfff
        )
          i++;
        else if (c >= 0xd800 && c <= 0xdfff)
          throw coerceFailure("bytes", "str", "the BMPString has an unpaired surrogate");
      }
      return s;
    }
    case 28: {
      // UniversalString: UTF-32BE
      if (v.length % 4 !== 0)
        throw coerceFailure("bytes", "str", "a UniversalString length is not a multiple of 4");
      let s = "";
      for (let i = 0; i < v.length; i += 4) {
        const cp =
          (((v[i] as number) << 24) |
            ((v[i + 1] as number) << 16) |
            ((v[i + 2] as number) << 8) |
            (v[i + 3] as number)) >>>
          0;
        if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff))
          throw coerceFailure(
            "bytes",
            "str",
            `the UniversalString has an invalid code point ${hexAt(cp)}`,
          );
        s += String.fromCodePoint(cp);
      }
      return s;
    }
    default: {
      // Printable, Numeric, IA5, Visible, Teletex, Graphic, General, times: one byte per character
      let s = "";
      for (let i = 0; i < v.length; i += 8192) s += String.fromCharCode(...v.subarray(i, i + 8192));
      return s;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// PEM
// ---------------------------------------------------------------------------------------------

const BEGIN = /^-----BEGIN ([\x20-\x7e]*?)-----$/;
const END = /^-----END ([\x20-\x7e]*?)-----$/;

/**
 * The PEM blocks of a text (RFC 7468, with the RFC 1421 header lines of old encrypted keys): for each, the
 * label, the headers (name to value) and the Base64 body as ASCII bytes. Text outside the blocks is
 * ignored; a block that is not closed, closed with another label or nested is `E_COERCE`.
 */
export function pemScan(data: Uint8Array): Value[] {
  let text = "";
  for (let i = 0; i < data.length; i += 8192)
    text += String.fromCharCode(...data.subarray(i, i + 8192));
  const lines = text.split(/\r\n|\r|\n/);
  const out: Value[] = [];
  let label: string | undefined;
  let headers: [string, Value][] = [];
  let inHeaders = true;
  let body: string[] = [];
  let lastHeader = -1;
  for (const raw of lines) {
    const line = raw.trim();
    if (label === undefined) {
      const m = BEGIN.exec(line);
      if (m !== null) {
        label = m[1] as string;
        headers = [];
        inHeaders = true;
        body = [];
        lastHeader = -1;
      }
      continue;
    }
    const e = END.exec(line);
    if (e !== null) {
      if (e[1] !== label)
        throw coerceFailure("str", "list", `the PEM block '${label}' is closed by 'END ${e[1]}'`);
      out.push(
        record([
          ["label", str(label)],
          ["headers", record(headers)],
          ["body", bytes(Uint8Array.from(body.join(""), (c) => c.charCodeAt(0) & 0xff))],
        ]),
      );
      label = undefined;
      continue;
    }
    if (BEGIN.test(line))
      throw coerceFailure(
        "str",
        "list",
        `the PEM block '${label}' is not closed before the next BEGIN`,
      );
    if (inHeaders) {
      if (line === "") {
        if (headers.length > 0) inHeaders = false;
        continue;
      }
      const colon = line.indexOf(":");
      if ((raw.startsWith(" ") || raw.startsWith("\t")) && lastHeader >= 0) {
        const h = headers[lastHeader] as [string, Value];
        headers[lastHeader] = [h[0], str(`${String(h[1].v)} ${line}`)];
        continue;
      }
      if (colon > 0 && !/[^A-Za-z0-9-]/.test(line.slice(0, colon))) {
        headers.push([line.slice(0, colon), str(line.slice(colon + 1).trim())]);
        lastHeader = headers.length - 1;
        continue;
      }
      inHeaders = false;
    }
    body.push(line);
  }
  if (label !== undefined)
    throw coerceFailure("str", "list", `the PEM block '${label}' has no END line (truncated)`);
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "asn1",
    "parse-in",
    "( data:bytes start:int end:int max-depth:int -- list )",
    (d: Uint8Array, start: unknown, end: unknown, maxDepth: unknown, ctx: PrimitiveContext) =>
      parseIn(
        d,
        intArg(start, "the start"),
        intArg(end, "the end"),
        intArg(maxDepth, "the depth limit"),
        ctx.limits.maxValueBytes,
      ),
    {
      doc: "The DER (BER with definite lengths) elements found in data from start to end, as a list of node records: class (universal, application, context, private), constructed, tag, offset and hlen (where the element and its content start, in data), len (content bytes), value (the content of a primitive element; empty for a constructed one) and children (a list of nodes; empty for a primitive one). Nesting deeper than max-depth, an indefinite length, an end-of-contents marker, a cut-short header and a child that runs past its parent are E_COERCE; a window outside the data is E_RANGE; a tree whose records would pass the value limit stops with E_LIMIT_VALUE. Shared word of the asn1 vocabulary.",
    },
  ),
  definePrimitive("asn1", "oid-decode", "( content:bytes -- str )", oidDecode, {
    doc: "The dotted text of the content bytes of an OBJECT IDENTIFIER (no tag and length): 2a864886f70d010101 is 1.2.840.113549.1.1.1. Arcs may be any size (2.25.<128-bit number> works). Empty, cut-short, non-minimal or longer than 4096 bytes is E_COERCE.",
  }),
  definePrimitive("asn1", "oid-encode", "( dotted:str -- bytes )", oidEncode, {
    doc: "The content bytes of an OBJECT IDENTIFIER written in dotted form (surrounding white space ignored). At least two arcs, the first 0, 1 or 2, the second below 40 under 0 and 1, digits only without leading zeros; anything else is E_COERCE.",
  }),
  definePrimitive("asn1", "oid-name", "( dotted:str -- str )", oidName, {
    doc: "The name of a known object identifier (OpenSSL's, such as sha256WithRSAEncryption or subjectAltName), or the empty string when it is not in the table.",
  }),
  definePrimitive("asn1", "oid-short", "( dotted:str -- str )", oidShort, {
    doc: "The abbreviation a distinguished name prints for an attribute type (2.5.4.3 is CN, 2.5.4.10 is O), or the empty string.",
  }),
  definePrimitive("asn1", "oid-find", "( name:str -- str )", oidFind, {
    doc: "The dotted OID of a name or abbreviation of the table (exact match first, then ignoring case), or the empty string.",
  }),
  definePrimitive(
    "asn1",
    "_string",
    "( tag:int value:bytes -- str )",
    (tag: unknown, v: Uint8Array) => stringOf(intArg(tag, "the tag"), v),
    {
      doc: "The text of the content of an ASN.1 string type by its universal tag (private helper of asn1:text).",
    },
  ),
  definePrimitive("asn1", "_pem-scan", "( data:bytes -- list )", pemScan, {
    doc: "The PEM blocks of a text as records of label, headers and the Base64 body as ASCII bytes (private helper of asn1:pem-decode).",
  }),
];
