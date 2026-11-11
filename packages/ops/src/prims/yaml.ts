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
 * yaml primitives: the YAML 1.2 reader and writer behind `yaml:to-json` and `yaml:from-json`. YAML cannot be read
 * by a short FL loop (indentation, flow and block styles, anchors, block scalars), so the scan is the `yaml`
 * library of Eemeli Aro (ISC), imported here only, so its code stays in the lazy chunk of this vocabulary. The
 * library is synchronous, parses with no `eval` and no `Function`, and expands no entity from a document type.
 * Everything around it is FL.
 *
 *  - `_parse ( text:str -- any )`: one YAML document, read with the YAML 1.2 core schema (`!!str`, `!!int`,
 *    `!!float`, `!!bool`, `!!null`; merge keys `<<` as js-yaml reads them), to a value: mapping -> record,
 *    sequence -> list, integer -> int (exact, big integers kept), float -> num, null (`null`, `~`, an empty
 *    value) -> the json null sentinel. An empty stream is null. More than one document, a syntax error, a
 *    repeated key, a tag the core schema does not know (the tag is ignored with its text kept as a string) are
 *    handled as the op documents. Mapping keys other than strings are written as text (`1`, `true`, `null`); a
 *    collection as a key, two keys that become the same text, `.inf` and `.nan` are E_COERCE.
 *  - `_dump ( value:any -- str )`: a value as YAML text (2-space indent, block style, single quotes, the
 *    layout of js-yaml's dump with its defaults), quoting every string that YAML 1.1 or 1.2 would read as another
 *    type (`'yes'`, `'1e3'`, `'2001-01-01'`).
 *
 * Bounds. Aliases are not expanded by the library (an alias is a shared reference); the expansion happens when the
 * parsed tree is turned into a value, and that is charged against `ctx.limits.maxValueBytes` node by node, so a
 * billion-laughs document stops with E_LIMIT_VALUE after about the limit's worth of nodes. An alias that refers
 * to a collection containing it is E_COERCE. Nesting deeper than 512 levels is E_LIMIT_VALUE, as in the json
 * words; the library's own stack guard (RESOURCE_EXHAUSTION) is E_LIMIT_VALUE too.
 */
import { ForgeError, definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef, Value } from "@forge/lang";
import { Scalar, parseAllDocuments, stringify } from "yaml";
import { MAX_DEPTH, depthFailure, hasLoneSurrogate, isNullValue, nullValue } from "../json-js.js";
import { markRegexPrimitive } from "../regex-engine.js";
import { coerceFailure, limitFailure } from "../prim-util.js";

const { num, str, bool, list, normaliseInt } = valueHelpers;

/** Line and column (from 1, in code points) of a UTF-16 offset. */
function place(text: string, at: number): { offset: number; line: number; column: number } {
  let cp = 0;
  let line = 1;
  let col = 1;
  for (let k = 0; k < at && k < text.length; k++) {
    const c = text.charCodeAt(k);
    if (c >= 0xd800 && c <= 0xdbff && k + 1 < at) k++;
    cp++;
    if (c === 0x0a) {
      line++;
      col = 1;
    } else col++;
  }
  return { offset: cp, line, column: col };
}

function yamlFailure(text: string, at: number, reason: string): ForgeError {
  const p = place(text, at);
  return new ForgeError({
    code: "E_COERCE",
    message: `cannot convert str to YAML value: ${reason} at offset ${p.offset} (line ${p.line}, column ${p.column})`,
    detail: { from: "str", to: "yaml", reason, offset: p.offset, line: p.line, column: p.column },
  });
}

/** The text a scalar mapping key becomes in JSON. */
function keyText(k: unknown): string | undefined {
  switch (typeof k) {
    case "string":
      return k;
    case "bigint":
      return k.toString();
    case "number":
      return String(k);
    case "boolean":
      return k ? "true" : "false";
    default:
      return k === null ? "null" : undefined;
  }
}

function parse(text: string, ctx: PrimitiveContext): Value {
  const max = ctx.limits.maxValueBytes;
  const maxIntBits = ctx.limits.maxIntBits;
  let docs;
  try {
    docs = parseAllDocuments(text, {
      schema: "core",
      version: "1.2",
      merge: true,
      resolveKnownTags: false,
      intAsBigInt: true,
      uniqueKeys: true,
      prettyErrors: false,
    });
  } catch (e) {
    if (e instanceof RangeError) throw depthFailure("YAML text");
    throw e;
  }
  for (const d of docs) {
    const err = d.errors[0];
    if (err !== undefined) {
      if (err.code === "RESOURCE_EXHAUSTION") throw depthFailure("YAML text");
      throw yamlFailure(text, err.pos[0], err.message);
    }
  }
  if (docs.length > 1) {
    throw coerceFailure(
      "str",
      "YAML value",
      `expected a single document in the stream, but found ${docs.length}`,
    );
  }
  const doc = docs[0];
  if (doc === undefined) return nullValue();
  let js: unknown;
  try {
    js = doc.toJS({ mapAsMap: true, maxAliasCount: -1 });
  } catch (e) {
    if (e instanceof RangeError) throw depthFailure("YAML text");
    // an alias to an anchor that was never set, and the like: the library throws a plain Error
    throw coerceFailure("str", "YAML value", e instanceof Error ? e.message : String(e));
  }

  let size = 0;
  const account = (n: number): void => {
    size += n;
    if (size > max) throw limitFailure("maxValueBytes", max, size, "parsed YAML value");
  };
  const path = new Set<unknown>();
  function checkText(s: string): void {
    if (hasLoneSurrogate(s)) {
      throw coerceFailure(
        "str",
        "YAML value",
        "a string holds a lone surrogate, which no UTF-8 text can hold",
      );
    }
  }
  function conv(v: unknown, depth: number): Value {
    switch (typeof v) {
      case "string":
        checkText(v);
        account(2 * v.length);
        return str(v);
      case "bigint": {
        const bits = (v < 0n ? -v : v).toString(2).length;
        if (bits > maxIntBits)
          throw limitFailure("maxIntBits", maxIntBits, bits, "YAML integer bits");
        account(Math.ceil(bits / 8) + 1);
        return { tag: "int", v: normaliseInt(v) };
      }
      case "number":
        if (!Number.isFinite(v)) {
          throw coerceFailure(
            "YAML value",
            "JSON",
            ".inf, -.inf and .nan have no JSON form and are refused rather than turned into null",
          );
        }
        account(8);
        return num(v);
      case "boolean":
        account(1);
        return bool(v);
      case "object": {
        if (v === null) {
          account(40);
          return nullValue();
        }
        if (depth >= MAX_DEPTH) throw depthFailure("YAML value");
        if (path.has(v)) {
          throw coerceFailure(
            "YAML value",
            "JSON",
            "an alias refers to a collection that contains it",
          );
        }
        path.add(v);
        try {
          if (Array.isArray(v)) {
            const items: Value[] = [];
            for (const item of v) {
              account(8);
              items.push(conv(item, depth + 1));
            }
            return list(items);
          }
          if (v instanceof Map) {
            const m = new Map<string, Value>();
            account(16);
            for (const [k, item] of v as Map<unknown, unknown>) {
              const key = keyText(k);
              if (key === undefined) {
                throw coerceFailure(
                  "YAML value",
                  "JSON",
                  "a mapping key is a collection; JSON keys are text",
                );
              }
              if (typeof k === "number" && !Number.isFinite(k)) {
                throw coerceFailure("YAML value", "JSON", "a mapping key is .inf or .nan");
              }
              checkText(key);
              if (m.has(key)) {
                throw coerceFailure(
                  "YAML value",
                  "JSON",
                  `two mapping keys both become the JSON key ${JSON.stringify(key)}`,
                );
              }
              account(16 + 2 * key.length);
              m.set(key, conv(item, depth + 1));
            }
            return { tag: "record", v: m };
          }
          throw coerceFailure("YAML value", "JSON", "the document holds a value with no JSON form");
        } finally {
          path.delete(v);
        }
      }
      default:
        throw coerceFailure("YAML value", "JSON", `a ${typeof v} has no JSON form`);
    }
  }
  return conv(js, 0);
}

/**
 * A string as the writer should print it: YAML 1.1 readers take the plain strings `<<` and `=` for the merge and value
 * tags (the library, which writes for 1.2, leaves them plain), and a tab in a plain scalar is read differently by
 * different parsers, so those are quoted, as js-yaml does.
 */
function stringNode(s: string): unknown {
  if (s === "<<" || s === "=") {
    const n = new Scalar(s);
    n.type = "QUOTE_SINGLE";
    return n;
  }
  if (s.includes("\t")) {
    const n = new Scalar(s);
    n.type = "QUOTE_DOUBLE";
    return n;
  }
  return s;
}

function dump(value: Value, ctx: PrimitiveContext): string {
  const max = ctx.limits.maxValueBytes;
  function conv(v: Value, depth: number): unknown {
    switch (v.tag) {
      case "str":
        return stringNode(v.v as string);
      case "int":
        return v.v;
      case "num": {
        const n = v.v as number;
        if (Number.isInteger(n) || Object.is(n, -0)) {
          // keep a float a float: 1.0 stays 1.0 (js-yaml writes 1 and the reader then sees an integer)
          const s = new Scalar(n);
          s.minFractionDigits = 1;
          return s;
        }
        return n;
      }
      case "bool":
        return v.v as boolean;
      case "list": {
        if (depth >= MAX_DEPTH) throw depthFailure("value");
        return (v.v as readonly Value[]).map((item) => conv(item, depth + 1));
      }
      case "record": {
        if (isNullValue(v)) return null;
        if (depth >= MAX_DEPTH) throw depthFailure("value");
        const m = new Map<unknown, unknown>();
        for (const [k, item] of v.v as ReadonlyMap<string, Value>)
          m.set(stringNode(k), conv(item, depth + 1));
        return m;
      }
      default:
        throw new ForgeError({
          code: "E_TYPE",
          message: `a ${v.tag} has no YAML form (convert bytes to hex or base64 text first)`,
          detail: { tag: v.tag },
        });
    }
  }
  const js = conv(value, 0);
  let out: string;
  try {
    out = stringify(js, {
      schema: "core",
      version: "1.2",
      compat: "yaml-1.1",
      singleQuote: true,
      indent: 2,
      aliasDuplicateObjects: false,
    });
  } catch (e) {
    if (e instanceof RangeError) throw depthFailure("value");
    throw e;
  }
  if (out.length * 2 > max) throw limitFailure("maxValueBytes", max, out.length * 2, "YAML text");
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  markRegexPrimitive(
    definePrimitive("yaml", "_parse", "( text:str -- any )", parse, {
      doc: "Private. One YAML 1.2 document (core schema) to a value: mapping to record, sequence to list, integer to int (exact), float to num, null to json:null. An empty stream is null; more than one document, a syntax error, a repeated key, .inf and .nan are E_COERCE with the position; nesting deeper than 512 and an alias expansion past the value limit are E_LIMIT_VALUE.",
    }),
  ),
  markRegexPrimitive(
    definePrimitive("yaml", "_dump", "( value:any -- str )", dump, {
      doc: "Private. A value as YAML text: block style, 2-space indent, single quotes, every string that YAML 1.1 or 1.2 would read as another type quoted. bytes, quotations and files have no YAML form (E_TYPE).",
    }),
  ),
];
