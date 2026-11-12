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

/**
 * The maths words and the strict `str>num` of `core` (docs/LANGUAGE-0.2.md section 12), kind P.
 *
 * The transcendental words call the host `Math`. ECMAScript does not require bit-identical results
 * across engines, so `sin`, `exp`, `tanh` and the others may differ in the last digit between
 * browsers; `sqrt` and the arithmetic operators are exact. A result is always a finite `num`:
 * a domain error or an infinite or NaN result is E_RANGE, a `bigint` argument is E_COERCE.
 */
import { CORE_VOCAB } from "../dictionary.js";
import { ForgeError } from "../errors.js";
import { definePrimitive } from "../primitives.js";
import type { PrimitiveDef, Value } from "../types.js";

const NOTE = " The result follows the host Math and may differ in the last digit between browsers.";

function rangeError(message: string, detail: Record<string, unknown>): ForgeError {
  return new ForgeError({ code: "E_RANGE", message, detail });
}

/** The float value of an `int` or `num` argument; a `bigint` beyond +-(2^53-1) is E_COERCE (spec 3.2). */
function toFloat(v: Value): number {
  if (v.tag !== "int" && v.tag !== "num") {
    throw new ForgeError({
      code: "E_TYPE",
      message: `expected number, got ${v.tag}`,
      detail: { expected: "number", actual: v.tag },
    });
  }
  if (typeof v.v === "bigint") {
    throw new ForgeError({
      code: "E_COERCE",
      message: "cannot convert int to num: integer is outside the exactly representable range",
      detail: { from: "int", to: "num" },
    });
  }
  return v.v;
}

/** The result must be finite (spec 3.2): anything else is E_RANGE naming the word. */
function finite(word: string, r: number, args: readonly number[]): number {
  if (!Number.isFinite(r)) {
    throw rangeError(`${word} gives a result that is not finite`, { args: [...args] });
  }
  return r;
}

function unary(
  name: string,
  doc: string,
  fn: (x: number) => number,
  domain?: { readonly ok: (x: number) => boolean; readonly why: string },
): PrimitiveDef {
  return definePrimitive(
    CORE_VOCAB,
    name,
    "( number -- num )",
    (a: Value) => {
      const x = toFloat(a);
      if (domain !== undefined && !domain.ok(x)) {
        throw rangeError(`${name} of ${String(x)}: ${domain.why}`, { value: x });
      }
      return finite(name, fn(x), [x]);
    },
    { category: "arithmetic", doc: doc + NOTE },
  );
}

const positive = { ok: (x: number): boolean => x > 0, why: "the operand must be greater than 0" };
const unit = { ok: (x: number): boolean => Math.abs(x) <= 1, why: "the operand must be -1 to 1" };

/** Matches the number literal grammar of spec 2.5 without "_" and without a "+" sign. */
const NUM_TEXT = /^-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

/** The maths words, `pi` and `str>num`, in the order of docs/LANGUAGE-0.2.md section 12. */
export const NUMERIC_PRIMITIVES: readonly PrimitiveDef[] = Object.freeze([
  unary("ln", "Natural logarithm. An operand of 0 or less is E_RANGE.", Math.log, positive),
  unary("log2", "Base 2 logarithm. An operand of 0 or less is E_RANGE.", Math.log2, positive),
  unary("log10", "Base 10 logarithm. An operand of 0 or less is E_RANGE.", Math.log10, positive),
  unary("exp", "e to the power x. An infinite result is E_RANGE.", Math.exp),
  unary("sin", "Sine of an angle in radians.", Math.sin),
  unary("cos", "Cosine of an angle in radians.", Math.cos),
  unary("tan", "Tangent of an angle in radians.", Math.tan),
  unary("asin", "Arc sine, in radians. An operand outside -1 to 1 is E_RANGE.", Math.asin, unit),
  unary("acos", "Arc cosine, in radians. An operand outside -1 to 1 is E_RANGE.", Math.acos, unit),
  unary("atan", "Arc tangent, in radians.", Math.atan),
  definePrimitive(
    CORE_VOCAB,
    "atan2",
    "( y:number x:number -- num )",
    (y: Value, x: Value) => {
      const fy = toFloat(y);
      const fx = toFloat(x);
      return finite("atan2", Math.atan2(fy, fx), [fy, fx]);
    },
    {
      category: "arithmetic",
      doc: "Angle in radians of the point (x, y), from the x axis: y is the deeper operand." + NOTE,
    },
  ),
  unary("sinh", "Hyperbolic sine. An infinite result is E_RANGE.", Math.sinh),
  unary("cosh", "Hyperbolic cosine. An infinite result is E_RANGE.", Math.cosh),
  unary("tanh", "Hyperbolic tangent.", Math.tanh),
  definePrimitive(
    CORE_VOCAB,
    "fpow",
    "( base:number exp:number -- num )",
    (b: Value, e: Value) => {
      const fb = toFloat(b);
      const fe = toFloat(e);
      return finite("fpow", Math.pow(fb, fe), [fb, fe]);
    },
    {
      category: "arithmetic",
      doc:
        "Power on floats. A NaN or infinite result (a negative base with a fractional exponent, " +
        "zero to a negative power, overflow) is E_RANGE. pow stays the exact integer power." +
        NOTE,
    },
  ),
  definePrimitive(CORE_VOCAB, "pi", "( -- num )", () => Math.PI, {
    category: "arithmetic",
    doc: "The constant pi, 3.141592653589793.",
  }),
  definePrimitive(
    CORE_VOCAB,
    "str>num",
    "( str -- num )",
    (s: string) => {
      if (!NUM_TEXT.test(s)) {
        throw new ForgeError({
          code: "E_COERCE",
          message: "cannot convert str to num: not a decimal number",
          detail: { from: "str", to: "num" },
        });
      }
      const r = Number(s);
      if (!Number.isFinite(r)) {
        throw new ForgeError({
          code: "E_COERCE",
          message: "cannot convert str to num: the value is too large",
          detail: { from: "str", to: "num" },
        });
      }
      return r;
    },
    {
      category: "conversion",
      doc:
        "Parse the whole string as -?digits[.digits][e[+-]digits] into a num: no spaces, no +, " +
        "no .5 or 5., no hex, no NaN or Infinity, no _. Anything else, or a value that " +
        "overflows, is E_COERCE.",
    },
  ),
]);
