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
 * jsonata primitive: the JSONata query language behind `jsonata:query`, the library jsonata of IBM (MIT), imported
 * here only. JSONata is far too large a language to write in FL. Version 2 evaluates asynchronously, so the
 * primitive is async (the effect label `+async`, spec section 10.10); the library has no `eval` and no `Function`
 * (its `$eval` runs the JSONata parser, not JavaScript). Safe use of the library:
 *
 *  - `$random`, `$shuffle`, `$now` and `$millis` are replaced by functions that raise an error: Forge ops are
 *    deterministic and the only source of randomness and time is the `random` and `clock` vocabularies.
 *  - `$base64encode` and `$base64decode` are replaced by `btoa` and `atob` (the library falls back to a Node
 *    `Buffer` that a Worker does not have, which is why CyberChef replaces them too), with the same
 *    byte-per-character meaning.
 *  - `$pad` is rewritten with a width limit (the library builds the padding in an array of the requested width).
 *  - Evaluation is counted: a step is one evaluation of an expression node, and more than `MAX_STEPS` of them is
 *    E_LIMIT_STEPS; the library's own guards stop an expression nested deeper than `MAX_STACK` (D1011) and a
 *    sequence longer than `MAX_SEQUENCE` (D2015), the range operator has a limit of its own (D2014). The
 *    library's wall-clock `timeout` option is not used (results must not depend on the clock). A regular
 *    expression is ECMAScript's and cannot be interrupted, so the primitive is marked for the bake's hard kill,
 *    like the regex words.
 *
 *  - `_query ( value:any query:str -- any )`: the result of the query over the JSON value; no result at all (the
 *    expression selects nothing) is the empty string, as CyberChef does (it writes JSON.stringify of ""). A
 *    syntax or evaluation error is E_COERCE with the library's code and message and the position; a result that
 *    is a function is E_COERCE. A number with an integral value in the result is an int, as in JSON.stringify.
 */
import { ForgeError, definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef, Value } from "@forge/lang";
import jsonata from "jsonata";
import { MAX_DEPTH, fromJs, toJs } from "../json-js.js";
import { coerceFailure, rangeFailure } from "../prim-util.js";
import { markRegexPrimitive } from "../regex-engine.js";

const { str } = valueHelpers;

/** Evaluation steps (expression nodes evaluated) allowed per query. */
export const MAX_STEPS = 3_000_000;
/** Deepest nesting of evaluation the library allows (D1011). */
export const MAX_STACK = 1000;
/** Longest sequence the library allows (D2015). */
export const MAX_SEQUENCE = 1_000_000;
/** The longest query accepted, in characters. */
export const MAX_QUERY = 16_384;
/** The widest `$pad` result, in characters. */
export const MAX_PAD = 1_000_000;

const ENTRY = Symbol.for("jsonata.__evaluate_entry");

interface JsonataError {
  code?: unknown;
  message?: unknown;
  position?: unknown;
  token?: unknown;
  value?: unknown;
}

class StepLimit extends Error {}

function unavailable(name: string): () => never {
  return () => {
    throw {
      code: "FL001",
      message: `$${name} is not available: Forge ops are deterministic, they take no randomness or time from the query`,
    };
  };
}

function pad(text: string | undefined, width: number, ch?: string): string | undefined {
  if (text === undefined) return undefined;
  const fill = ch === undefined || ch.length === 0 ? " " : ch;
  const w = Math.trunc(width);
  if (Math.abs(w) > MAX_PAD) {
    throw { code: "FL002", message: `$pad: the width ${w} is more than ${MAX_PAD}` };
  }
  const have = Array.from(text).length;
  const padLength = Math.abs(w) - have;
  if (padLength <= 0) return text;
  const fillChars = Array.from(fill);
  let padding = "";
  for (let i = 0; i < padLength; i++) padding += fillChars[i % fillChars.length] as string;
  return w > 0 ? text + padding : padding + text;
}

async function query(value: Value, text: string, ctx: PrimitiveContext): Promise<Value> {
  if (text.length > MAX_QUERY) {
    throw rangeFailure(`the Jsonata query is longer than ${MAX_QUERY} characters`, {
      length: text.length,
    });
  }
  const doc = toJs(value, false);
  let steps = 0;
  try {
    const expression = jsonata(text, { stack: MAX_STACK, sequence: MAX_SEQUENCE });
    expression.assign(ENTRY as unknown as string, () => {
      if (++steps > MAX_STEPS) throw new StepLimit();
    });
    expression.registerFunction("random", unavailable("random"), "<:n>");
    expression.registerFunction("shuffle", unavailable("shuffle"), "<a:a>");
    expression.registerFunction("now", unavailable("now"), "<s?s?:s>");
    expression.registerFunction("millis", unavailable("millis"), "<:n>");
    expression.registerFunction(
      "base64encode",
      (s?: string) => (s === undefined ? undefined : btoa(s)),
      "<s-:s>",
    );
    expression.registerFunction(
      "base64decode",
      (s?: string) => (s === undefined ? undefined : atob(s)),
      "<s-:s>",
    );
    expression.registerFunction("pad", pad, "<s-ns?:s>");
    const result: unknown = await expression.evaluate(doc);
    if (result === undefined) return str("");
    return fromJs(result, ctx);
  } catch (e) {
    if (e instanceof ForgeError) throw e;
    if (e instanceof StepLimit) {
      throw new ForgeError({
        code: "E_LIMIT_STEPS",
        message: `the Jsonata query needed more than ${MAX_STEPS} evaluation steps`,
        detail: { limit: "jsonataSteps", max: MAX_STEPS },
      });
    }
    if (e instanceof RangeError) {
      throw new ForgeError({
        code: "E_LIMIT_VALUE",
        message: "the Jsonata query went deeper than the stack allows",
        detail: { limit: "jsonDepth", max: MAX_DEPTH },
      });
    }
    const err = (e ?? {}) as JsonataError;
    const code = typeof err.code === "string" ? err.code : undefined;
    if (code === "D1011" || code === "D2015" || code === "D2014") {
      throw new ForgeError({
        code: "E_LIMIT_VALUE",
        message: `Jsonata ${code}: ${String(err.message)}`,
        detail: { limit: "jsonata", code },
      });
    }
    const where = typeof err.position === "number" ? ` (at position ${err.position})` : "";
    const message = typeof err.message === "string" ? err.message : String(e);
    throw coerceFailure(
      "str",
      "Jsonata result",
      `${code === undefined ? "" : `${code}: `}${message}${where}`,
    );
  }
}

export const primitives: readonly PrimitiveDef[] = [
  markRegexPrimitive(
    definePrimitive("jsonata", "_query", "( value:any query:str -- any )", query, {
      effects: ["+async"],
      doc: "Private. The result of a JSONata query over a JSON value; no result is the empty string. $random, $shuffle, $now and $millis raise an error (ops are deterministic). A syntax or evaluation error is E_COERCE with the code and position; more than 3,000,000 evaluation steps is E_LIMIT_STEPS; a stack, sequence or range overflow and a result past the value limit are E_LIMIT_VALUE.",
    }),
  ),
];
