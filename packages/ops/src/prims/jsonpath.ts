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
 * jsonpath primitive: the JSONPath (RFC 9535) engine behind `jsonpath:query`, the library json-p3 of James Prior
 * (MIT; `iregexp-check` for the I-Regexp of `match` and `search`, MIT), imported here only. It is synchronous,
 * uses no `eval` and no `Function`, and passes the whole JSONPath Compliance Test Suite (715 cases, valid and
 * invalid queries). CyberChef's JPath expression uses jsonpath-plus (Goessner's dialect, which evaluates script
 * expressions); that library needs `new Function` or its own script interpreter and does not accept the RFC's
 * filter syntax, so the standard was chosen (see the op's documentation for what differs).
 *
 *  - `_query ( value:any query:str -- list )`: the values of the nodes the query selects, in the order the RFC
 *    gives (a node list may hold the same value twice). A malformed query is E_COERCE with the library's message
 *    (which names the position).
 *
 * Bounds. The query is held to 4,096 characters (E_RANGE). Descent into the document stops at 512 levels, the depth
 * of the json words (E_LIMIT_VALUE: the library throws a recursion error). Filters nest at most 30 deep (the
 * library's default). The results are held to the value limit while they are collected. A query over a large
 * document can still take long (nested filters and `..` multiply), and a regular expression of `match` is
 * ECMAScript's: neither can be interrupted from here, so the primitive is marked for the bake's hard kill, like
 * the regex words.
 */
import { ForgeError, definePrimitive } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef, Value } from "@forge/lang";
import { JSONPathEnvironment } from "json-p3";
import type { JSONValue } from "json-p3";
import { MAX_DEPTH, fromJs, toJs } from "../json-js.js";
import { coerceFailure, limitFailure, rangeFailure } from "../prim-util.js";
import { markRegexPrimitive } from "../regex-engine.js";

/** The longest query accepted, in characters. */
export const MAX_QUERY = 4096;

const env = new JSONPathEnvironment({
  strict: true,
  maxRecursionDepth: MAX_DEPTH + 1,
});

function query(value: Value, path: string, ctx: PrimitiveContext): readonly Value[] {
  if (path.length > MAX_QUERY) {
    throw rangeFailure(`the JSONPath query is longer than ${MAX_QUERY} characters`, {
      length: path.length,
    });
  }
  const doc = toJs(value, true) as JSONValue;
  const max = ctx.limits.maxValueBytes;
  const found: unknown[] = [];
  try {
    for (const node of env.findIter(path, doc)) {
      found.push(node.value);
      if (found.length * 8 > max) {
        throw limitFailure("maxValueBytes", max, found.length * 8, "JSONPath result");
      }
    }
  } catch (e) {
    if (e instanceof ForgeError) throw e;
    if (e instanceof RangeError) {
      throw new ForgeError({
        code: "E_LIMIT_VALUE",
        message: "the JSONPath query went deeper than the stack allows",
        detail: { limit: "jsonDepth", max: MAX_DEPTH },
      });
    }
    const name = e instanceof Error ? e.constructor.name : "";
    const message = e instanceof Error ? e.message : String(e);
    if (name === "JSONPathRecursionError") {
      throw new ForgeError({
        code: "E_LIMIT_VALUE",
        message: `the JSONPath query nests filters deeper than 30 levels or descends deeper than ${MAX_DEPTH} levels`,
        detail: { limit: "jsonDepth", max: MAX_DEPTH },
      });
    }
    throw coerceFailure("str", "JSONPath query", message);
  }
  return fromJs(found, ctx).v as readonly Value[];
}

export const primitives: readonly PrimitiveDef[] = [
  markRegexPrimitive(
    definePrimitive("jsonpath", "_query", "( value:any query:str -- list )", query, {
      doc: "Private. The values selected by a JSONPath (RFC 9535) query over a JSON value, as a list in the RFC's order. A malformed query is E_COERCE with the position; a query longer than 4096 characters is E_RANGE; nesting deeper than 512 and a result past the value limit are E_LIMIT_VALUE.",
    }),
  ),
];
