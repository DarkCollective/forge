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
// Pure text helpers of the bake controls: status line, step labels, one-line value summaries.
import type { BakeResult, OutputValue } from "@forge/worker";
import type { BakeState } from "../state/types.js";

/** "/steps/2" -> "3", "/steps/1/steps/0" -> "2.1", "/steps/2/then/0" -> "3.then.1". */
export function stepLabel(path: string): string {
  const tokens = path.split("/").slice(1);
  const parts: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] as string;
    if (token === "steps") continue;
    if (token === "then" || token === "else") {
      parts.push(token);
      continue;
    }
    const n = Number(token);
    parts.push(Number.isInteger(n) ? String(n + 1) : token);
  }
  return parts.join(".") || path;
}

function clip(text: string, max: number): string {
  const flat = Array.from(text, (c) => {
    const code = c.codePointAt(0) as number;
    return code < 32 || code === 127 ? " " : c;
  }).join("");
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function hexOf(bytes: Uint8Array, max: number): string {
  let out = "";
  for (let i = 0; i < Math.min(bytes.length, max); i += 1) {
    out += (bytes[i] as number).toString(16).padStart(2, "0");
  }
  return out;
}

/** A short text for the value entering a step (the paused data). Plain text, never HTML. */
export function describeValue(value: OutputValue, max = 60): string {
  switch (value.kind) {
    case "bytes": {
      const size = `${value.bytes.length} byte${value.bytes.length === 1 ? "" : "s"}`;
      if (value.bytes.length === 0) return "empty bytes";
      const preview =
        value.text !== null ? `"${clip(value.text, max)}"` : `hex ${hexOf(value.bytes, 16)}`;
      return `${size}: ${preview}`;
    }
    case "str":
      return `str "${clip(value.text, max)}"`;
    case "int":
      return `int ${clip(value.text, max)}`;
    case "num":
      return `num ${String(value.value)}`;
    case "bool":
      return `bool ${String(value.value)}`;
    case "list":
      return `list of ${value.total}`;
    case "record":
      return `record with ${value.total} ${value.total === 1 ? "entry" : "entries"}`;
    case "other":
      return `${value.tag}: ${clip(value.repr, max)}`;
  }
}

export function isAborted(result: BakeResult): boolean {
  return !result.ok && result.error.code === "E_ABORTED";
}

export function formatMs(ms: number): string {
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

/** The status-bar text (UI.md WP 3.6). */
export function statusText(bake: BakeState, hint?: { readonly autoBake: boolean }): string {
  switch (bake.status) {
    case "idle":
      return hint?.autoBake === false ? "Ready. Press Bake." : "Ready";
    case "queued":
      return "Waiting to bake…";
    case "baking": {
      const where =
        bake.progress !== null && bake.progress.total > 0
          ? ` (${Math.min(bake.progress.done + 1, bake.progress.total)} of ${bake.progress.total})`
          : "";
      return `Baking…${where}`;
    }
    case "paused":
      return bake.paused === null ? "Paused" : `Paused at step ${stepLabel(bake.paused.path)}`;
    case "cancelled":
      return "Cancelled";
    case "failed": {
      const code = bake.result !== null && !bake.result.ok ? bake.result.error.code : "error";
      return `Failed: ${code}`;
    }
    case "done":
      return bake.elapsedMs === null ? "Baked" : `Baked in ${formatMs(bake.elapsedMs)}`;
  }
}

export type ShortcutAction = "step" | "continue" | null;

/** F10 steps and F8 continues, only while paused and not typing in a field. */
export function shortcutAction(key: string, paused: boolean, inTextField: boolean): ShortcutAction {
  if (!paused || inTextField) return null;
  if (key === "F10") return "step";
  if (key === "F8") return "continue";
  return null;
}
