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
// What the Magic dialog shows for a result (WP 6.30). Pure (no DOM, no store), so it is unit tested.
import type { MagicCandidate, MagicResult } from "@forge/worker/magic";
import { showControls } from "../ops/help-view.js";

/** Characters of a candidate's output shown in the list (PLAN.md WP 6.30). */
export const PREVIEW_CHARS = 80;

/** Bytes Magic works on per operation run (the engine's `maxValueBytes`); a larger input finds nothing. */
export const MAGIC_INPUT_NOTE_BYTES = 4 * 1024 * 1024;

export interface CandidateView {
  readonly index: number;
  /** The qualified names, in order. */
  readonly ops: readonly string[];
  /** The steps in one line, for the heading. */
  readonly chain: string;
  /** The first 80 characters of the output as text (control characters made visible), or the first bytes in hex. */
  readonly preview: string;
  /** What `preview` is. */
  readonly previewKind: "text" | "bytes";
  /** True when the output is longer than the preview. */
  readonly cut: boolean;
  readonly outputLength: number;
  readonly score: string;
  readonly reasons: readonly string[];
}

const decoder = new TextDecoder("utf-8", { fatal: false });

/** Is `bytes` (the kept prefix of an output) text? A cut in the middle of a character is not a reason to say no. */
function looksLikeText(bytes: Uint8Array, whole: boolean): boolean {
  const end = whole ? bytes.length : bytes.length - Math.min(3, bytes.length);
  return !decoder.decode(bytes.subarray(0, end)).includes("�");
}

/** The first `PREVIEW_CHARS` characters of an output, on one line. */
export function previewOutput(
  bytes: Uint8Array,
  outputLength: number,
): { text: string; kind: "text" | "bytes"; cut: boolean } {
  const whole = bytes.length >= outputLength;
  if (looksLikeText(bytes, whole)) {
    const chars = [...decoder.decode(bytes)];
    const shown = chars.slice(0, PREVIEW_CHARS).join("");
    const cut = chars.length > PREVIEW_CHARS || !whole;
    return { text: showControls(shown).replace(/\n/g, "\\n"), kind: "text", cut };
  }
  const n = Math.min(bytes.length, 24);
  const hex = Array.from(bytes.subarray(0, n), (b) => b.toString(16).padStart(2, "0")).join(" ");
  return { text: hex, kind: "bytes", cut: outputLength > n };
}

export function viewCandidate(c: MagicCandidate, index: number): CandidateView {
  const p = previewOutput(c.output, c.outputLength);
  return {
    index,
    ops: c.ops,
    chain: c.ops.join(" → "),
    preview: p.text,
    previewKind: p.kind,
    cut: p.cut,
    outputLength: c.outputLength,
    score: c.score.toFixed(2),
    reasons: c.reasons,
  };
}

/** The one-line summary after a run, which is also what is announced. */
export function summarise(result: Pick<MagicResult, "candidates" | "stopped">): string {
  const n = result.candidates.length;
  const found =
    n === 0
      ? "Magic found no candidate"
      : `Magic found ${n} ${n === 1 ? "candidate" : "candidates"}`;
  if (result.stopped === "deadline") return `${found}; the search stopped at its time limit`;
  if (result.stopped === "max-tried")
    return `${found}; the search stopped at its limit of operation runs`;
  return found;
}
