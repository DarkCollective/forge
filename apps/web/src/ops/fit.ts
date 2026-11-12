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
// Which operations can work on the data at the end of the recipe (UI.md section 2.3, WP 6.1).
// Pure: no DOM, no store. The drawer feeds it the recipe, the bake state and the catalogue.
import type { CatalogueOp } from "@forge/ops";
import type { ParamType } from "@forge/lang";
import type { Recipe, Step } from "@forge/recipe";
import type { BakeState } from "../state/types.js";

/** The runtime tags a value can carry (LANGUAGE.md section 4.2 rows). */
export type ValueType =
  "bytes" | "str" | "int" | "num" | "bool" | "list" | "quot" | "record" | "file";

/** A value type, or `unknown` when it cannot be told (so nothing is ruled out). */
export type DataType = ValueType | "unknown";

const VALUE_TYPES: readonly string[] = [
  "bytes",
  "str",
  "int",
  "num",
  "bool",
  "list",
  "quot",
  "record",
  "file",
];

function isValueType(tag: string): tag is ValueType {
  return VALUE_TYPES.includes(tag);
}

/**
 * The runtime type behind a declared type (LANGUAGE.md section 5.6): `choice`, `regex` and `charset`
 * carry `str`; `toggle` and `key` carry `bytes`. `any` and `number` have no single tag.
 */
function runtimeType(type: ParamType): ValueType | "any" | "number" {
  switch (type) {
    case "any":
    case "number":
      return type;
    case "choice":
    case "regex":
    case "charset":
      return "str";
    case "toggle":
    case "key":
      return "bytes";
    default:
      return type;
  }
}

/** Tag of a bake output (`OutputValue.kind`, with `other` carrying its own tag), or unknown. */
function outputType(output: { readonly kind: string; readonly tag?: string }): DataType {
  if (output.kind === "other") {
    return output.tag !== undefined && isValueType(output.tag) ? output.tag : "unknown";
  }
  return isValueType(output.kind) ? output.kind : "unknown";
}

/** Last step that changes the data: skips comments and disabled steps (a disabled container is skipped whole). */
function lastActive(steps: readonly Step[]): Step | undefined {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step === undefined || step.kind === "comment" || step.disabled === true) continue;
    return step;
  }
  return undefined;
}

export interface DataTypeInput {
  readonly recipe: Recipe;
  readonly bake: Pick<BakeState, "result" | "stale">;
  /** The catalogue's operations, or null while it is not loaded. */
  readonly ops: readonly CatalogueOp[] | null;
}

/**
 * The type of the data where a new step would be added (the end of the recipe).
 * A finished, successful, non-stale bake gives the real type of its output. Otherwise it is inferred
 * from the last active step: none gives `bytes` (the input, RECIPES.md R3); an op gives its declared
 * output; `fork`, `subsection` and `repeat` give `bytes` (R3); `if` (it returns what its branch
 * returns), an op the catalogue does not know, and an output of `any` give `unknown`.
 */
export function dataTypeAtEnd(input: DataTypeInput): DataType {
  const { recipe, bake, ops } = input;
  if (bake.result !== null && bake.result.ok && !bake.stale) return outputType(bake.result.output);
  const last = lastActive(recipe.steps);
  if (last === undefined) return "bytes";
  switch (last.kind) {
    case "fork":
    case "subsection":
    case "repeat":
      return "bytes";
    case "op": {
      const op = ops?.find((o) => o.qname === last.op);
      if (op === undefined) return "unknown";
      const out = runtimeType(op.output);
      return out === "any" || out === "number" ? "unknown" : out;
    }
    default:
      return "unknown";
  }
}

/**
 * Whether a value of type `data` can be given to an operation whose data input is `opInput`.
 * True when the data type is unknown, the input is `any`, the types are equal, or LANGUAGE.md section
 * 4.2 has a coercion from one to the other. From the table of section 4.2 (rows are the value, columns
 * the declared input; every other cell is "-", no coercion):
 *   `bytes` -> `str` ("co"), `str` -> `bytes` ("co"),
 *   `int` -> `num` ("co"), `num` -> `int` ("co"),
 *   `int` -> `number` ("ok"), `num` -> `number` ("ok"),
 *   every row -> `any` ("ok"), and every row -> its own column ("ok").
 * A "co" can still fail at run time (`E_COERCE`, for example invalid UTF-8): it fits all the same.
 * Not coercions, by design: str<->int, bool<->anything, list<->bytes, int->str.
 */
export function fits(opInput: ParamType, data: DataType): boolean {
  if (data === "unknown") return true;
  const want = runtimeType(opInput);
  if (want === "any" || want === data) return true;
  if (want === "number") return data === "int" || data === "num";
  switch (data) {
    case "bytes":
      return want === "str";
    case "str":
      return want === "bytes";
    case "int":
      return want === "num";
    case "num":
      return want === "int";
    default:
      return false;
  }
}

const NOUN: Readonly<Record<ValueType, string>> = {
  bytes: "bytes",
  str: "text",
  int: "whole number",
  num: "number",
  bool: "true or false",
  list: "list",
  quot: "quotation",
  record: "record",
  file: "file",
};

/** The data type in plain words, as in "Data here: text". */
export function dataLabel(data: DataType): string {
  return data === "unknown" ? "any" : NOUN[data];
}

/** The same with an article where English wants one: "bytes", "text", "a list". */
function withArticle(type: ValueType | "number"): string {
  if (type === "number") return "a number";
  const noun = NOUN[type];
  return type === "bytes" || type === "str" || type === "bool" ? noun : `a ${noun}`;
}

/** Why an operation does not fit, for example "needs a list, the data here is text". Empty when it fits. */
export function whyNotFit(opInput: ParamType, data: DataType): string {
  if (fits(opInput, data)) return "";
  const want = runtimeType(opInput);
  if (want === "any" || data === "unknown") return "";
  return `needs ${withArticle(want)}, the data here is ${withArticle(data)}`;
}
