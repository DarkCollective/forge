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
// The content tier of the Operations pane (UI.md section 2.3, WP 6.28): what the data looks like (6.23a's
// identification) against what each operation expects (6.23's input checks), over the same bytes as the
// type fit of WP 6.21. Pure: no DOM, no store, no loading (the evaluator is passed in, checks-data.ts).
//
// Combination rules (`contentLevel`), on top of the 6.21 level:
//   - red stays red: a type that cannot convert is never changed by a check;
//   - no checks, or an `unknown` result, or no content at all: the 6.21 level;
//   - checks that pass: the 6.21 level (a green stays green; an amber conversion stays amber);
//   - checks that fail: amber, never red.
// The checks and the identification look at the first 4 KiB only (WP 6.23), so the cost does not grow with
// the data; the whole-data UTF-8 result is the one WP 6.21 already has, handed to the view.
import type { MagicCheck } from "@forge/lang";
import type { Identification } from "@forge/ops/checks";
import type { ChecksIndex, Evaluator } from "./checks-data.js";
import { dataLine, lastActive } from "./fit.js";
import type { DataFacts, DataTypeInput, FitLevel, Utf8State } from "./fit.js";

/** How one op's input checks came out on the data: `none` when it has no input check. */
export type NoteResult = "pass" | "fail" | "unknown" | "none";

/** What a row says about the content: the result and the sentence (empty when there is nothing to say). */
export interface RowNote {
  readonly result: NoteResult;
  readonly text: string;
}

/** The content tier for one piece of data. */
export interface ContentView {
  /** What the data is, as far as the pane may claim it (never a low-certainty identification), or null. */
  readonly identification: Identification | null;
  /** Per qname, only for ops that expect something (a name or input checks). */
  readonly rows: ReadonlyMap<string, RowNote>;
}

/** What the content tier works on: the bytes (whole, never copied) and WP 6.21's UTF-8 result for them. */
export interface ContentSource {
  readonly bytes: Uint8Array;
  readonly utf8: Utf8State;
}

/**
 * The bytes the content tier looks at: the output of the last successful, non-stale bake when it is
 * bytes, else the input itself when the recipe has no active step (then the input is the data, as in
 * WP 6.21). In every other case the bytes at the end of the recipe are not known, so there are none.
 */
export function contentBytesAtEnd(input: DataTypeInput): Uint8Array | null {
  const { bake, recipe } = input;
  if (bake.result !== null && bake.result.ok && !bake.stale) {
    const output = bake.result.output;
    return output.kind === "bytes" ? output.bytes : null;
  }
  if (input.inputBytes !== undefined && lastActive(recipe.steps) === undefined) {
    return input.inputBytes;
  }
  return null;
}

/** Same source (the same array and the same UTF-8 state), for the store selector. */
export function sameSource(a: ContentSource | null, b: ContentSource | null): boolean {
  if (a === null || b === null) return a === b;
  return a.bytes === b.bytes && a.utf8 === b.utf8;
}

/** The identification the pane may state: medium or high certainty only. */
export function claimable(ident: Identification | null): Identification | null {
  return ident !== null && ident.certainty !== "low" ? ident : null;
}

/** A name for what a check wants, when the op has no `expects` text and no signature name. */
function checkNoun(check: MagicCheck): string | undefined {
  switch (check.test.kind) {
    case "binary":
      return "binary data";
    case "utf8":
      return "UTF-8 text";
    default:
      return undefined;
  }
}

/** The plain name of a text identification for "this is ...": the line-ending note is left out. */
function textName(ident: Identification): string | null {
  if (ident.id === "ascii-text") return "ASCII text";
  if (ident.id === "utf8-text") return "UTF-8 text";
  return null;
}

/**
 * What the data is, from the side of a failed check: "this is UTF-8 text" for a failed `binary` check
 * (the data is valid text), "this looks like PNG image" for any other identification, nothing when the
 * data is not identified.
 */
function seenSide(failed: MagicCheck, ident: Identification | null): string | undefined {
  const text = ident === null ? null : textName(ident);
  if (failed.test.kind === "binary") {
    if (text !== null) return `this is ${text}`;
    return ident === null ? "this is UTF-8 text" : `this looks like ${ident.name}`;
  }
  if (ident === null) return undefined;
  return text !== null ? `this is ${text}` : `this looks like ${ident.name}`;
}

/**
 * The sentence of a row. `expected` is what the op expects (6.23's `expectedName`), `failed` the first
 * failing check when the result is `fail`, `ident` what the data is (claimable only). The expected side
 * alone when the data is not identified or the result is not a failure; both sides on a failure.
 */
export function noteText(
  expected: string | undefined,
  result: NoteResult,
  failed: MagicCheck | undefined,
  ident: Identification | null,
): string {
  if (result === "fail" && failed !== undefined) {
    const want = expected ?? checkNoun(failed) ?? "other data";
    const seen = seenSide(failed, ident);
    return seen === undefined ? `Expects ${want}` : `Expects ${want}; ${seen}`;
  }
  return expected === undefined ? "" : `Expects ${expected}`;
}

/**
 * The content tier over `source` for the ops that have a clause in `index`. One shared view of the data
 * serves the identification and every op (so it is looked at once); the first 4 KiB are all that is read,
 * apart from `source.utf8`, which is reused and not decoded again (an unknown one is left to the view,
 * which gives up above its own cap).
 */
export function analyseContent(
  source: ContentSource,
  index: ChecksIndex,
  evaluator: Evaluator,
): ContentView {
  const view = evaluator.view(source.bytes, source.utf8);
  const ident = claimable(evaluator.identifyData(view));
  const rows = new Map<string, RowNote>();
  for (const [qname, op] of index.entries()) {
    const firstInput = op.checks.find((c) => c.scope === "input");
    const expected =
      evaluator.expectedName(op) ?? (firstInput === undefined ? undefined : checkNoun(firstInput));
    if (firstInput === undefined) {
      if (expected !== undefined) rows.set(qname, { result: "none", text: `Expects ${expected}` });
      continue;
    }
    const evaluation = evaluator.evaluateChecks(op.checks, view, "input");
    rows.set(qname, {
      result: evaluation.result,
      text: noteText(expected, evaluation.result, evaluation.failed, ident),
    });
  }
  return { identification: ident, rows };
}

/** The level of a row once the checks are taken into account (see the rules at the top). */
export function contentLevel(level: FitLevel, note: RowNote | undefined): FitLevel {
  if (level === "no" || note === undefined) return level;
  return note.result === "fail" ? "converts" : level;
}

/**
 * The hint of a row: the content sentence first, then the 6.21 hint when there is one ("Expects gzip data.
 * Text only if valid UTF-8"). With no content sentence the 6.21 hint is returned unchanged.
 */
export function contentHint(note: RowNote | undefined, fitHint: string): string {
  const text = note?.text ?? "";
  if (text === "") return fitHint;
  if (fitHint === "") return text;
  return `${text}. ${fitHint.charAt(0).toUpperCase()}${fitHint.slice(1)}`;
}

/** The header's wording: "bytes (gzip data)" when the bytes are identified, else the 6.1 text. */
export function headerLine(facts: DataFacts, content: ContentView | null): string {
  const ident = content?.identification ?? null;
  if (facts.type === "bytes" && ident !== null) return `bytes (${ident.name})`;
  return dataLine(facts);
}
