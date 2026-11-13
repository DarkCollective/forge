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
// Which operations can work on the data at the end of the recipe (UI.md section 2.3, WP 6.1, WP 6.21).
// Three levels, a traffic light: fits (green), converts (amber), no (red).
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

/** Whether bytes are well-formed UTF-8: known to be, known not to be, or not known. */
export type Utf8State = "valid" | "invalid" | "unknown";

/** What is known about the data at the end of the recipe. `utf8` only means something for `bytes`. */
export interface DataFacts {
  readonly type: DataType;
  readonly utf8: Utf8State;
}

/** The three levels of fit (the traffic light): green, amber, red. */
export type FitLevel = "fits" | "converts" | "no";

/**
 * Size above which the worker builds no UTF-8 view of a bytes output (`RENDER_LIMITS.maxTextBytes` in
 * @forge/worker, 16 MiB; a test keeps the two equal). Copied so that the pane does not load the worker package.
 */
export const MAX_TEXT_BYTES = 16 * 1024 * 1024;

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
  /**
   * The bytes of the active input tab (the whole data, never a prefix), when known. Used only when the
   * recipe has no active step, so that the input itself is the data (an empty recipe still bakes, and
   * its output is the input).
   */
  readonly inputBytes?: Uint8Array | undefined;
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });
const utf8Memo = new WeakMap<Uint8Array, Utf8State>();

/** Strict UTF-8 test of the whole data; `unknown` over the render limit. Remembered per array. */
function utf8Of(bytes: Uint8Array): Utf8State {
  if (bytes.length > MAX_TEXT_BYTES) return "unknown";
  const known = utf8Memo.get(bytes);
  if (known !== undefined) return known;
  let state: Utf8State = "valid";
  try {
    strictUtf8.decode(bytes);
  } catch {
    state = "invalid";
  }
  utf8Memo.set(bytes, state);
  return state;
}

/** The type inferred from the last active step, with no bake to go by. */
function staticType(recipe: Recipe, ops: readonly CatalogueOp[] | null): DataType {
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
 * What is known about the data where a new step would be added (the end of the recipe).
 * A finished, successful, non-stale bake gives the real type of its output, and for bytes whether they
 * are valid UTF-8: `text` is the strict decoding, null when invalid or over the render limit, so null
 * with a length within the limit means invalid. Otherwise the type is inferred from the last active
 * step: none gives `bytes` (the input, RECIPES.md R3), whose UTF-8 state is read from `inputBytes` when
 * given; an op gives its declared output; `fork`, `subsection` and `repeat` give `bytes` (R3); `if` (it
 * returns what its branch returns), an op the catalogue does not know, and an output of `any` give
 * `unknown`.
 */
export function dataFactsAtEnd(input: DataTypeInput): DataFacts {
  const { recipe, bake, ops } = input;
  if (bake.result !== null && bake.result.ok && !bake.stale) {
    const output = bake.result.output;
    const type = outputType(output);
    if (output.kind === "bytes") {
      let utf8: Utf8State = "unknown";
      if (output.text !== null) utf8 = "valid";
      else if (output.bytes.length <= MAX_TEXT_BYTES) utf8 = "invalid";
      return { type, utf8 };
    }
    return { type, utf8: "unknown" };
  }
  const type = staticType(recipe, ops);
  if (
    type === "bytes" &&
    input.inputBytes !== undefined &&
    lastActive(recipe.steps) === undefined
  ) {
    return { type, utf8: utf8Of(input.inputBytes) };
  }
  return { type, utf8: "unknown" };
}

/** The type of the data at the end of the recipe (see `dataFactsAtEnd`). */
export function dataTypeAtEnd(input: DataTypeInput): DataType {
  return dataFactsAtEnd(input).type;
}

/** Equality of two facts, for the store selector. */
export function sameFacts(a: DataFacts, b: DataFacts): boolean {
  return a.type === b.type && a.utf8 === b.utf8;
}

/**
 * How well an operation whose data input is `opInput` takes data of type `data`, from LANGUAGE.md
 * section 4.2 (rows are the value, columns the declared input; every other cell is "-"):
 *   "ok" cells give `fits` (green): unknown data, an `any` input, equal types, `int` or `num` into
 *     `number`.
 *   "co" cells give `converts` (amber): `bytes`->`str`, `str`->`bytes`, `int`->`num`, `num`->`int`. The
 *     conversion can fail at run time (`E_COERCE`), so it is not a plain fit.
 *   "-" cells give `no` (red): str<->int, bool<->anything, list<->bytes, int->str and so on.
 * With `utf8` known, `bytes`->`str` is refined: valid gives `fits`, invalid gives `no` (the conversion
 * will certainly fail), unknown stays `converts`.
 */
export function fitLevel(
  opInput: ParamType,
  data: DataType,
  utf8: Utf8State = "unknown",
): FitLevel {
  if (data === "unknown") return "fits";
  const want = runtimeType(opInput);
  if (want === "any" || want === data) return "fits";
  if (want === "number") return data === "int" || data === "num" ? "fits" : "no";
  switch (data) {
    case "bytes":
      if (want !== "str") return "no";
      if (utf8 === "valid") return "fits";
      return utf8 === "invalid" ? "no" : "converts";
    case "str":
      return want === "bytes" ? "converts" : "no";
    case "int":
      return want === "num" ? "converts" : "no";
    case "num":
      return want === "int" ? "converts" : "no";
    default:
      return "no";
  }
}

/** Whether the operation is not ruled out (green or amber). */
export function fits(opInput: ParamType, data: DataType): boolean {
  return fitLevel(opInput, data) !== "no";
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

/** The pane header's wording: the type, and "(valid text)" for bytes known to be well-formed UTF-8. */
export function dataLine(facts: DataFacts): string {
  const label = dataLabel(facts.type);
  return facts.type === "bytes" && facts.utf8 === "valid" ? `${label} (valid text)` : label;
}

/** The same with an article where English wants one: "bytes", "text", "a list". */
function withArticle(type: ValueType | "number"): string {
  if (type === "number") return "a number";
  const noun = NOUN[type];
  return type === "bytes" || type === "str" || type === "bool" ? noun : `a ${noun}`;
}

/** Why an operation is red, for example "needs a list" (the pane header says what the data is). Empty when it is not red. */
export function whyNotFit(opInput: ParamType, data: DataType, utf8: Utf8State = "unknown"): string {
  if (fitLevel(opInput, data, utf8) !== "no") return "";
  const want = runtimeType(opInput);
  if (want === "any") return "";
  if (data === "bytes" && want === "str" && utf8 === "invalid") return "needs valid text";
  return `needs ${withArticle(want)}`;
}

/** The short hint an amber row shows, for example "text only if valid UTF-8". Empty unless amber. */
export function convertHint(
  opInput: ParamType,
  data: DataType,
  utf8: Utf8State = "unknown",
): string {
  if (fitLevel(opInput, data, utf8) !== "converts") return "";
  switch (runtimeType(opInput)) {
    case "str":
      return "text only if valid UTF-8";
    case "bytes":
      return "converts to bytes";
    case "num":
      return "converts to a number";
    case "int":
      return "converts to a whole number";
    default:
      return "";
  }
}
