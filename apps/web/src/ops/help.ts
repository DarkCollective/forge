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
// Help text for an operation, built from its catalogue metadata (UI.md section 2.3, WP 3.2). Pure.
// Every string here is rendered as text by the component: nothing in it is HTML or Markdown (CSP
// rule 6), so the functions only produce plain strings and lists of them.
import type { CatalogueOp } from "@forge/ops";
import type { Constraint, ParamDefault, ParamSpec } from "@forge/lang";

export interface ParamHelp {
  readonly name: string;
  readonly type: string;
  /** One line: type, whether it is required or its default, and the constraint in words. */
  readonly summary: string;
  readonly doc: string | null;
}

export interface OpHelp {
  readonly qname: string;
  readonly effect: string;
  readonly doc: string | null;
  /** "Input bytes, output any." */
  readonly signature: string;
  readonly aliases: string;
  readonly seeAlso: string;
  readonly params: readonly ParamHelp[];
}

/** The constraint of a parameter in words, one phrase per bound ("min 1", "length 2 to 8", ...). */
export function describeConstraint(constraint: Constraint | undefined): string[] {
  if (constraint === undefined) return [];
  const parts: string[] = [];
  const { min, max, oneOf, minLength, maxLength, lengthOneOf, pattern } = constraint;
  if (min !== undefined && max !== undefined) parts.push(`from ${min} to ${max}`);
  else if (min !== undefined) parts.push(`at least ${min}`);
  else if (max !== undefined) parts.push(`at most ${max}`);
  if (oneOf !== undefined && oneOf.length > 0) parts.push(`one of ${oneOf.join(", ")}`);
  if (minLength !== undefined && maxLength !== undefined) {
    parts.push(`length ${minLength} to ${maxLength}`);
  } else if (minLength !== undefined) {
    parts.push(`length at least ${minLength}`);
  } else if (maxLength !== undefined) {
    parts.push(`length at most ${maxLength}`);
  }
  if (lengthOneOf !== undefined && lengthOneOf.length > 0) {
    parts.push(`length ${lengthOneOf.join(" or ")}`);
  }
  if (pattern !== undefined) parts.push(`matches ${pattern}`);
  return parts;
}

/** The default of a parameter as shown to the user, or null when it has none. */
export function describeDefault(value: ParamDefault | undefined): string | null {
  if (value === undefined) return null;
  if (typeof value === "object") return `${JSON.stringify(value.value)} as ${value.enc}`;
  return JSON.stringify(value);
}

/** Help for one parameter. Required parameters say so; optional ones show their default. */
export function describeParam(param: ParamSpec): ParamHelp {
  const bits: string[] = [param.type];
  if (param.required) bits.push("required");
  const fallback = describeDefault(param.default);
  if (!param.required && fallback !== null) bits.push(`default ${fallback}`);
  if (param.options !== undefined && param.options.length > 0) {
    bits.push(`options ${param.options.join(", ")}`);
  }
  bits.push(...describeConstraint(param.constraint));
  return {
    name: param.name,
    type: param.type,
    summary: bits.join(", "),
    doc: param.doc ?? null,
  };
}

/** The whole help of an operation, ready to render as text. */
export function helpFor(op: CatalogueOp): OpHelp {
  return {
    qname: op.qname,
    effect: op.effect,
    doc: op.doc,
    signature: `Input ${op.input}, output ${op.output}.`,
    aliases: op.aliases.join(", "),
    seeAlso: op.seeAlso.join(", "),
    params: op.params.map(describeParam),
  };
}
