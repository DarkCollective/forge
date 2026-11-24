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
 * json primitives: the `json` vocabulary of @forge/ops, now thin wrappers over the core words `json>value` and
 * `value>json` (LANGUAGE-0.3.md section 7; the one implementation is `jsonToValue` and `valueToJson` in
 * `@forge/lang`, `vocab/json.ts`). The words are shared: other vocabularies call them qualified (`json:parse`,
 * `json:stringify`, `json:null`, `json:null?`), and none of them is a catalogue op (`json` is in INTERNAL_VOCABS).
 *
 *  - `parse ( text:str -- any )` is `json>value`, with one difference: JSON null reads as the null sentinel below.
 *  - `stringify ( value:any indent:int -- str )` is `value>json`; the sentinel (and `ext{null}`) is written as `null`.
 *  - `null ( -- record )` and `null? ( any -- bool )`: the null sentinel and its test.
 *
 * Null: the ten data-format vocabularies that read and write through these words still hold null as a sentinel,
 * the record with the one key NULL_KEY (a lone low surrogate followed by "null") whose value is true. L12 moves
 * them to `ext{null}` (the core words `null` and `null?`) and then removes the sentinel and these four words;
 * until then this file is the only place that converts, at the boundary of the one implementation.
 */
import {
  JSON_MAX_DEPTH,
  JSON_MAX_INDENT,
  definePrimitive,
  jsonToValue,
  valueHelpers,
  valueToJson,
} from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef, Value } from "@forge/lang";

const { bool, record } = valueHelpers;

/** Containers nested deeper than this are E_LIMIT_VALUE, in `parse` and in `stringify`. */
export const MAX_DEPTH = JSON_MAX_DEPTH;
/** The largest indent `stringify` accepts. */
export const MAX_INDENT = JSON_MAX_INDENT;
/** The key of the null sentinel record. */
export const NULL_KEY = "\udfffnull";

const nullValue = (): Value => record([[NULL_KEY, bool(true)]]);

function isNull(v: Value): boolean {
  if (v.tag !== "record") return false;
  const m = v.v as ReadonlyMap<string, Value>;
  return m.size === 1 && m.has(NULL_KEY);
}

const parse = (text: string, ctx: PrimitiveContext): Value => jsonToValue(text, ctx, nullValue);
const stringify = (value: Value, indent: bigint | number, ctx: PrimitiveContext): string =>
  valueToJson(value, indent, ctx, isNull);

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("json", "parse", "( text:str -- any )", parse, {
    doc: "Strict RFC 8259 JSON text to a value: object to record (keys in the order written; a repeated key is E_COERCE), array to list, string to str, a number written without fraction or exponent to int (exact, big integers kept), any other number to num (out of range is E_COERCE), true and false to bool, null to the json:null sentinel. Surrounding white space is allowed; a byte order mark, a comment, a trailing comma, a lone surrogate or any text after the value is E_COERCE naming the offset, line and column. Nesting deeper than 512 is E_LIMIT_VALUE. Shared word: call it qualified from any vocabulary.",
  }),
  definePrimitive("json", "stringify", "( value:any indent:int -- str )", stringify, {
    doc: "A value as JSON text: compact for an indent of 0, else indented by that many spaces per level (0 to 32; E_RANGE otherwise), with a space after each colon. int is exact; num is the shortest text that reads back as the same number and always has a fraction or an exponent (100.0, -0.0, 1e+21); json:null is null. bytes, quotations and files have no JSON form (E_TYPE), a lone surrogate in a string is E_COERCE, and nesting deeper than 512 is E_LIMIT_VALUE. Shared word: call it qualified from any vocabulary.",
  }),
  definePrimitive("json", "null", "( -- record )", () => nullValue().v, {
    doc: "The value that stands for JSON null: a record with the one key U+DFFF followed by null, which json:parse never produces from real data. FL has no null of its own. Shared word: call it qualified from any vocabulary.",
  }),
  definePrimitive("json", "null?", "( any -- bool )", isNull, {
    doc: "True if the value is the json:null sentinel. Shared word: call it qualified from any vocabulary.",
  }),
];
