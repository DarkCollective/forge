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
import { extShape, extTypeText, kindNoun, kindRepairs } from "../io/viewers.js";

/**
 * The runtime tags a value can carry (LANGUAGE.md section 4.2 rows). `ext` alone is an extension value
 * whose kind is not known; one whose kind is known is an `ExtType`.
 */
export type ValueType =
  "bytes" | "str" | "int" | "num" | "bool" | "list" | "quot" | "record" | "file" | "ext";

/** An extension value of a known kind: `ext{table}`, `ext{relation}` (UI-TOOLKIT.md section 2.1). */
export type ExtType = `ext{${string}}`;

/** A value type, an extension type, or `unknown` when it cannot be told (so nothing is ruled out). */
export type DataType = ValueType | ExtType | "unknown";

/** The kind inside an `ExtType`, or undefined for any other data type. */
export function extKindOf(data: DataType): string | undefined {
  return data.startsWith("ext{") && data.endsWith("}") ? data.slice(4, -1) : undefined;
}

/** What an operation's data input needs: its type and, for `ext`, its kind (`CatalogueOp.input` and `inputKind`). */
export interface Need {
  readonly type: ParamType;
  readonly kind?: string | undefined;
}

/**
 * A conversion between kinds that the recipe compiler can insert (RECIPES-1.2.md section 6.9). `lift` is true
 * when it cannot fail and does no work (the `table` to `relation` lift): it is green. Otherwise it is amber.
 */
export interface KindConversion {
  readonly from: string;
  readonly to: string;
  readonly lift: boolean;
  /** The amber hint, for example "runs the query first". */
  readonly hint?: string;
}

/** The need of a catalogue operation: its data input, with its kind when the catalogue carries one. */
export function needOf(op: CatalogueOp): Need {
  const kind = (op as { readonly inputKind?: unknown }).inputKind;
  return typeof kind === "string" ? { type: op.input, kind } : { type: op.input };
}

function normaliseNeed(need: ParamType | Need): Need {
  return typeof need === "string" ? { type: need } : need;
}

/** Whether bytes are well-formed UTF-8: known to be, known not to be, or not known. */
export type Utf8State = "valid" | "invalid" | "unknown";

/** What is known about the data at the end of the recipe. `utf8` only means something for `bytes`. */
export interface DataFacts {
  readonly type: DataType;
  readonly utf8: Utf8State;
  /** For an extension value, the viewer's few words on its shape ("4 columns, 12,408 rows"), when known. */
  readonly shape?: string;
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
  "ext",
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
function outputType(output: {
  readonly kind: string;
  readonly tag?: string;
  readonly extKind?: string;
}): DataType {
  if (output.kind === "ext") {
    return output.extKind === undefined ? "ext" : (extTypeText(output.extKind) as ExtType);
  }
  if (output.kind === "other") {
    return output.tag !== undefined && isValueType(output.tag) ? output.tag : "unknown";
  }
  return isValueType(output.kind) ? output.kind : "unknown";
}

/** The type an operation leaves: its declared output, with the kind of an `ext` output when the catalogue carries it. */
export function opOutputType(op: CatalogueOp): DataType {
  const out = runtimeType(op.output);
  if (out === "any" || out === "number") return "unknown";
  if (out === "ext") {
    const kind = (op as { readonly outputKind?: unknown }).outputKind;
    return typeof kind === "string" ? (extTypeText(kind) as ExtType) : "unknown";
  }
  return out;
}

/**
 * Last step that changes the data: skips comments, disabled steps (a disabled container is skipped whole)
 * and registers. A register is transparent: the data leaves it as it entered (RECIPES-1.1.md section 2.2),
 * so the data type after it is the data type before it. A register-fed parameter changes nothing here
 * either: fit looks at the data an operation takes, never at where its parameters come from.
 */
export function lastActive(steps: readonly Step[]): Step | undefined {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (
      step === undefined ||
      step.kind === "comment" ||
      step.kind === "register" ||
      step.disabled === true
    ) {
      continue;
    }
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
  // An enabled return in the root list ends the recipe there: the steps after it do not run, so there is
  // no data type to show at the end (RECIPES-1.1.md section 4.12).
  if (recipe.steps.some((s) => s.kind === "return" && s.disabled !== true)) return "unknown";
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
      return opOutputType(op);
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
    if (output.kind === "ext") {
      const shape = extShape(output);
      return shape === null ? { type, utf8: "unknown" } : { type, utf8: "unknown", shape };
    }
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
  return a.type === b.type && a.utf8 === b.utf8 && a.shape === b.shape;
}

/**
 * How well an operation whose data input is `need` takes data of type `data`, from LANGUAGE.md section 4.2
 * (rows are the value, columns the declared input; every other cell is "-"):
 *   "ok" cells give `fits` (green): unknown data, an `any` input, equal types, `int` or `num` into
 *     `number`.
 *   "co" cells give `converts` (amber): `bytes`->`str`, `str`->`bytes`, `int`->`num`, `num`->`int`. The
 *     conversion can fail at run time (`E_COERCE`), so it is not a plain fit.
 *   "-" cells give `no` (red): str<->int, bool<->anything, list<->bytes, int->str and so on.
 * With `utf8` known, `bytes`->`str` is refined: valid gives `fits`, invalid gives `no` (the conversion
 * will certainly fail), unknown stays `converts`.
 *
 * Extension values are compared by kind (UI-TOOLKIT.md section 2.2): `ext{k}` fits an input of `ext{k}` (and
 * `any`); another kind fits only through a declared conversion, green when it is a lift and amber otherwise;
 * a tag never fits an `ext{k}` input and an extension value never fits a typed input. An `ext` input whose
 * kind is not known takes any extension value.
 */
export function fitLevel(
  need: ParamType | Need,
  data: DataType,
  utf8: Utf8State = "unknown",
  conversions: readonly KindConversion[] = [],
): FitLevel {
  if (data === "unknown") return "fits";
  const n = normaliseNeed(need);
  const want = runtimeType(n.type);
  if (want === "any") return "fits";
  const dataKind = extKindOf(data);
  if (want === "ext") {
    if (data === "ext") return "fits";
    if (dataKind === undefined) return "no";
    if (n.kind === undefined || n.kind === dataKind) return "fits";
    const conv = conversions.find((c) => c.from === dataKind && c.to === n.kind);
    if (conv === undefined) return "no";
    return conv.lift ? "fits" : "converts";
  }
  if (data === "ext" || dataKind !== undefined) return "no";
  if (want === data) return "fits";
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
export function fits(need: ParamType | Need, data: DataType): boolean {
  return fitLevel(need, data) !== "no";
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
  ext: "extension value",
};

/**
 * The data type in plain words, as in "Data here: text". An extension value takes the noun its viewer
 * registered ("table"), and "<kind> extension value" when the kind has no viewer.
 */
export function dataLabel(data: DataType): string {
  if (data === "unknown") return "any";
  const kind = extKindOf(data);
  return kind === undefined ? NOUN[data as ValueType] : kindNoun(kind);
}

/**
 * The pane header's wording: the type, "(valid text)" for bytes known to be well-formed UTF-8, and the shape
 * of an extension value when its viewer states one: "table (4 columns, 12,408 rows)", "relation (lazy)".
 */
export function dataLine(facts: DataFacts): string {
  const label = dataLabel(facts.type);
  if (facts.type === "bytes" && facts.utf8 === "valid") return `${label} (valid text)`;
  if (extKindOf(facts.type) !== undefined && facts.shape !== undefined) {
    return `${label} (${facts.shape})`;
  }
  return label;
}

/** "a table", "an extension value", "a list"; `bytes`, `text` and `true or false` take none. */
function withIndefinite(noun: string): string {
  if (noun === "bytes" || noun === "text" || noun === "true or false") return noun;
  return `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
}

/** The same with an article where English wants one: "bytes", "text", "a list". */
function withArticle(type: ValueType | "number"): string {
  if (type === "number") return "a number";
  return withIndefinite(NOUN[type]);
}

/**
 * Why an operation is red, for example "needs a list" (the pane header says what the data is). Empty when it is
 * not red. For kinds: "needs a table; this is a relation", "needs a table. Add Parse CSV first." (when the kind
 * registers a repair from the data's type), "needs text; this is a table".
 */
export function whyNotFit(
  need: ParamType | Need,
  data: DataType,
  utf8: Utf8State = "unknown",
  conversions: readonly KindConversion[] = [],
): string {
  if (fitLevel(need, data, utf8, conversions) !== "no") return "";
  const n = normaliseNeed(need);
  const want = runtimeType(n.type);
  if (want === "any") return "";
  const dataKind = extKindOf(data);
  if (want === "ext") {
    if (n.kind === undefined) return "needs an extension value";
    const wanted = `needs ${withIndefinite(kindNoun(n.kind))}`;
    if (dataKind !== undefined) return `${wanted}; this is ${withIndefinite(kindNoun(dataKind))}`;
    const repair = kindRepairs(n.kind).find((r) => r.from === data);
    return repair === undefined ? wanted : `${wanted}. Add ${repair.label} first.`;
  }
  if (dataKind !== undefined) {
    return `needs ${withArticle(want)}; this is ${withIndefinite(kindNoun(dataKind))}`;
  }
  if (data === "ext") return `needs ${withArticle(want)}; this is an extension value`;
  if (data === "bytes" && want === "str" && utf8 === "invalid") return "needs valid text";
  return `needs ${withArticle(want)}`;
}

/** The short hint an amber row shows, for example "text only if valid UTF-8". Empty unless amber. */
export function convertHint(
  need: ParamType | Need,
  data: DataType,
  utf8: Utf8State = "unknown",
  conversions: readonly KindConversion[] = [],
): string {
  if (fitLevel(need, data, utf8, conversions) !== "converts") return "";
  const n = normaliseNeed(need);
  if (n.type === "ext") {
    const dataKind = extKindOf(data);
    const conv = conversions.find((c) => c.from === dataKind && c.to === n.kind);
    return (
      conv?.hint ?? (n.kind === undefined ? "" : `converts to ${withIndefinite(kindNoun(n.kind))}`)
    );
  }
  switch (runtimeType(n.type)) {
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

/**
 * The output badge of a step card (UI-TOOLKIT.md section 2.4) for an extension value: the noun and, when it is
 * known, the shape: "table", "table, 4 columns", "relation, lazy". Null for every other type, so a recipe with no
 * extension value shows no new badge. `reported` is what a bake left at the step, when it is known.
 */
export function outputBadge(
  declared: DataType,
  reported?: { readonly kind: string; readonly shape?: string | null },
): string | null {
  const kind = reported?.kind ?? extKindOf(declared);
  if (kind === undefined) return null;
  const shape = reported?.shape ?? null;
  const noun = kindNoun(kind);
  return shape === null || shape === "" ? noun : `${noun}, ${shape}`;
}

/** The input mark of a step card: shown only when an extension kind is involved and the level is not green. */
export interface InputMark {
  readonly level: Exclude<FitLevel, "fits">;
  readonly text: string;
}

export function inputMark(
  need: ParamType | Need,
  dataAbove: DataType,
  utf8: Utf8State = "unknown",
  conversions: readonly KindConversion[] = [],
): InputMark | null {
  const n = normaliseNeed(need);
  const involved = n.type === "ext" || dataAbove === "ext" || extKindOf(dataAbove) !== undefined;
  if (!involved) return null;
  const level = fitLevel(n, dataAbove, utf8, conversions);
  if (level === "fits") return null;
  const text =
    level === "no"
      ? whyNotFit(n, dataAbove, utf8, conversions)
      : convertHint(n, dataAbove, utf8, conversions);
  return { level, text: text === "" ? "does not fit the data above" : text };
}

/**
 * The type the data has entering step `index` of a list of steps, from the declared outputs alone (no bake):
 * the output of the last active step before it, `bytes` for the first step of the root list (the input), and
 * `unknown` anywhere else. Used for the input mark of a card.
 */
export function dataAboveStatic(
  steps: readonly Step[],
  index: number,
  ops: readonly CatalogueOp[] | null,
  isRoot: boolean,
): DataType {
  const before = lastActive(steps.slice(0, index));
  if (before === undefined) return isRoot ? "bytes" : "unknown";
  if (before.kind !== "op") {
    return before.kind === "fork" || before.kind === "subsection" || before.kind === "repeat"
      ? "bytes"
      : "unknown";
  }
  const op = ops?.find((o) => o.qname === before.op);
  return op === undefined ? "unknown" : opOutputType(op);
}
