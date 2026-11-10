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
// Pure helpers for the output pane: turning an OutputValue into bytes or text, choosing a view,
// naming a download, labelling the failing step.
import type { Recipe } from "@forge/recipe";
import type { OutputValue } from "@forge/worker";
import { getStep } from "../state/recipe-ops.js";

export type OutputView = "text" | "hex";

/** Bytes a value can be saved or moved to the input as, or null for structured values. */
export function outputBytes(value: OutputValue): Uint8Array | null {
  switch (value.kind) {
    case "bytes":
      return value.bytes;
    case "str":
    case "int":
      return new TextEncoder().encode(value.text);
    case "num":
      return new TextEncoder().encode(String(value.value));
    case "bool":
      return new TextEncoder().encode(String(value.value));
    default:
      return null;
  }
}

/** The text view of a value, or null when it has none (non-UTF-8 bytes). */
export function outputText(value: OutputValue): string | null {
  switch (value.kind) {
    case "bytes":
      return value.text;
    case "str":
    case "int":
      return value.text;
    case "num":
    case "bool":
      return String(value.value);
    case "other":
      return value.repr;
    case "list":
    case "record":
      return describeValue(value);
  }
}

/** A readable multi-line rendering of a structured value (copy and download of lists and records). */
export function describeValue(value: OutputValue, indent = ""): string {
  switch (value.kind) {
    case "bytes":
      return value.text !== null ? JSON.stringify(value.text) : `<${value.bytes.length} bytes>`;
    case "str":
      return JSON.stringify(value.text);
    case "int":
      return value.text;
    case "num":
    case "bool":
      return String(value.value);
    case "other":
      return `<${value.tag}> ${value.repr}`;
    case "list": {
      if (value.items.length === 0) return "[]";
      const inner = `${indent}  `;
      const lines = value.items.map((v) => `${inner}${describeValue(v, inner)}`);
      if (value.total > value.items.length) {
        lines.push(`${inner}... ${value.total - value.items.length} more`);
      }
      return `[\n${lines.join("\n")}\n${indent}]`;
    }
    case "record": {
      if (value.entries.length === 0) return "{}";
      const inner = `${indent}  `;
      const lines = value.entries.map(
        (e) => `${inner}${JSON.stringify(e.key)}: ${describeValue(e.value, inner)}`,
      );
      if (value.total > value.entries.length) {
        lines.push(`${inner}... ${value.total - value.entries.length} more`);
      }
      return `{\n${lines.join("\n")}\n${indent}}`;
    }
  }
}

/** First view to show for a value: text when it has text, hex otherwise; `preferred` wins when possible. */
export function chooseView(value: OutputValue, preferred: OutputView | null): OutputView {
  if (value.kind !== "bytes") return "text";
  if (value.text === null) return "hex";
  return preferred ?? "text";
}

export interface DownloadSpec {
  readonly filename: string;
  readonly mime: string;
}

export function downloadSpec(value: OutputValue): DownloadSpec | null {
  switch (value.kind) {
    case "bytes":
      return value.text !== null
        ? { filename: "forge-output.txt", mime: "text/plain;charset=utf-8" }
        : { filename: "forge-output.bin", mime: "application/octet-stream" };
    case "str":
    case "int":
    case "num":
    case "bool":
      return { filename: "forge-output.txt", mime: "text/plain;charset=utf-8" };
    case "list":
    case "record":
    case "other":
      return { filename: "forge-output.txt", mime: "text/plain;charset=utf-8" };
  }
}

/** The bytes a download of `value` contains (structured values are saved as their text rendering). */
export function downloadBytes(value: OutputValue): Uint8Array {
  return outputBytes(value) ?? new TextEncoder().encode(outputText(value) ?? "");
}

/** "Step 3: base64-decode" for a top-level step, "Step 2.1: ..." style for nested ones. */
export function stepLabel(recipe: Recipe, path: string): string {
  const tokens = path.split("/").slice(1);
  const numbers: number[] = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const n = Number(tokens[i + 1]);
    if (Number.isInteger(n)) numbers.push(n + 1);
  }
  const prefix = numbers.length > 0 ? `Step ${numbers.join(".")}` : "Step";
  let what = "";
  try {
    const step = getStep(recipe, path) as { kind?: string; op?: string } | undefined;
    if (step !== undefined) what = step.kind === "op" ? (step.op ?? "op") : (step.kind ?? "");
  } catch {
    what = "";
  }
  return what === "" ? prefix : `${prefix}: ${what}`;
}

/** Text of an error-detail value for a key/value list (always plain text). */
export function detailText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return String(value);
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[unprintable]";
    }
  }
  return String(value);
}
