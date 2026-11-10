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
// Pure helpers that map between what the user types and the JSON parameter values of RECIPES.md
// section 3.4. No DOM, no store. The validator (`validateRecipe`) stays the only judge of validity:
// these functions only do the trivial input-type parsing (is this text an integer / a number at
// all?) and otherwise pass text through.
//
// Raw text versus committed value (the contract the form relies on):
//   * `textToValue` always returns something to commit. Text that parses as the field's type gives the
//     canonical JSON value ("007" -> 7, "9007199254740993" -> the decimal string). Text that does not
//     parse ("1e" in an int field) is committed as the raw string, which the validator rejects with a
//     `bad-param` issue; this keeps the recipe honest (a bake is blocked) and the error inline.
//   * Empty text of a numeric field clears the parameter (the catalogue default applies, or
//     `missing-param` is reported). For text-like types ("" is a real value) it commits "".
//   * Because parsing is lossy ("1." -> 1, "007" -> 7, "  5 " -> 5) the form also keeps the raw text
//     as a draft while the field is being edited; see `forge-param-form.ts`.
import type { ParamSpec } from "@forge/lang";

/** The fields of a `ParamSpec` the helpers read (a catalogue `ParamSpec` fits). */
export type FieldSpec = Pick<ParamSpec, "name" | "type" | "options" | "constraint" | "default">;

export interface EncodedValue {
  readonly value: string;
  readonly enc: string;
}

export const ALL_ENCODINGS: readonly string[] = ["utf8", "hex", "latin1", "base64"];

const INT_TEXT = /^[+-]?[0-9]+$/;
const NUM_TEXT = /^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;

const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Is this type edited with a single-line numeric text field? */
export function isNumeric(type: FieldSpec["type"]): boolean {
  return type === "int" || type === "num" || type === "number";
}

function canonicalInt(n: bigint): number | string {
  return n >= MIN_SAFE && n <= MAX_SAFE ? Number(n) : n.toString();
}

/**
 * Text -> int value: a safe integer as a number, a larger one as a canonical decimal string. Leading
 * zeros, a `+` and surrounding space are accepted and normalised. `undefined` when not an integer.
 */
export function parseIntText(text: string): number | string | undefined {
  const t = text.trim();
  if (!INT_TEXT.test(t)) return undefined;
  return canonicalInt(BigInt(t.startsWith("+") ? t.slice(1) : t));
}

/** Text -> finite number (`num` / `number`). `undefined` when not a plain decimal / exponent literal. */
export function parseNumberText(text: string): number | undefined {
  const t = text.trim();
  if (!NUM_TEXT.test(t)) return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  return n === 0 ? 0 : n; // no negative zero
}

/**
 * The value to commit for the text in a field (see the header comment). `enc` is only used for
 * `toggle` / `key`. `undefined` means "clear the parameter". `bool` and `choice` never go through text
 * (they use `boolean` / the option string directly) but are handled for completeness.
 */
export function textToValue(spec: FieldSpec, text: string, enc?: string): unknown {
  switch (spec.type) {
    case "int":
      if (text.trim() === "") return undefined;
      return parseIntText(text) ?? text;
    case "num":
    case "number":
      if (text.trim() === "") return undefined;
      return parseNumberText(text) ?? text;
    case "bool":
      return text === "true" ? true : text === "false" ? false : text;
    case "toggle":
    case "key":
      return { value: text, enc: enc ?? defaultEncoding(spec) };
    default:
      return text;
  }
}

/** The text a field shows for a stored value. Odd shapes (a string in an int) are shown, not hidden. */
export function valueToText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (isEncoded(value)) return value.value;
  return JSON.stringify(value) ?? "";
}

/** The catalogue default as field text ("" when there is none). */
export function defaultText(spec: FieldSpec): string {
  return spec.default === undefined ? "" : valueToText(spec.default);
}

export function isEncoded(value: unknown): value is EncodedValue {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { value?: unknown }).value === "string" &&
    typeof (value as { enc?: unknown }).enc === "string"
  );
}

/** Encodings the picker offers for a `toggle` / `key`: `ParamSpec.options`, or all four when bare. */
export function encodingChoices(spec: FieldSpec): readonly string[] {
  return spec.options !== undefined && spec.options.length > 0 ? spec.options : ALL_ENCODINGS;
}

/** The encoding of the catalogue default, else the first allowed one. */
export function defaultEncoding(spec: FieldSpec): string {
  if (isEncoded(spec.default)) return spec.default.enc;
  return encodingChoices(spec)[0] ?? "utf8";
}

/** The encoding currently selected: the stored value's, else the default's. */
export function encodingOf(spec: FieldSpec, value: unknown): string {
  return isEncoded(value) ? value.enc : defaultEncoding(spec);
}

/**
 * Keyboard stepping (ArrowUp / ArrowDown) for numeric fields. Starts from the default (or the minimum,
 * or 0) when the text is empty; clamps to the constraint's min / max because stepping past the bound is
 * never what the user meant (typed values are still left to the validator). `undefined` when the text
 * is not a number.
 */
export function stepNumberText(spec: FieldSpec, text: string, delta: number): string | undefined {
  const { min, max } = spec.constraint ?? {};
  if (spec.type === "int") {
    let base: bigint;
    if (text.trim() === "") {
      const start = typeof spec.default === "number" ? spec.default : (min ?? 0);
      base = BigInt(Math.trunc(start));
    } else {
      const parsed = parseIntText(text);
      if (parsed === undefined) return undefined;
      base = BigInt(parsed);
    }
    let next = base + BigInt(delta);
    if (min !== undefined && next < BigInt(Math.ceil(min))) next = BigInt(Math.ceil(min));
    if (max !== undefined && next > BigInt(Math.floor(max))) next = BigInt(Math.floor(max));
    return next.toString();
  }
  let base: number;
  if (text.trim() === "") base = typeof spec.default === "number" ? spec.default : (min ?? 0);
  else {
    const parsed = parseNumberText(text);
    if (parsed === undefined) return undefined;
    base = parsed;
  }
  let next = Number((base + delta).toPrecision(15));
  if (min !== undefined && next < min) next = min;
  if (max !== undefined && next > max) next = max;
  return String(next);
}

/** A short plain-text description of the declared constraint, for the help line ("" when none). */
export function constraintHint(spec: FieldSpec): string {
  const c = spec.constraint;
  if (c === undefined) return "";
  const parts: string[] = [];
  if (c.oneOf !== undefined) parts.push(`one of ${c.oneOf.join(", ")}`);
  else if (c.min !== undefined && c.max !== undefined) parts.push(`${c.min} to ${c.max}`);
  else if (c.min !== undefined) parts.push(`at least ${c.min}`);
  else if (c.max !== undefined) parts.push(`at most ${c.max}`);
  const unit =
    spec.type === "bytes" || spec.type === "toggle" || spec.type === "key" ? "bytes" : "characters";
  if (c.lengthOneOf !== undefined) parts.push(`length ${c.lengthOneOf.join(", ")} ${unit}`);
  else if (c.minLength !== undefined && c.maxLength !== undefined) {
    parts.push(`${c.minLength} to ${c.maxLength} ${unit}`);
  } else if (c.minLength !== undefined && c.minLength > 0) {
    parts.push(`at least ${c.minLength} ${unit}`);
  } else if (c.maxLength !== undefined) parts.push(`at most ${c.maxLength} ${unit}`);
  return parts.length === 0 ? "" : `Allowed: ${parts.join("; ")}`;
}
