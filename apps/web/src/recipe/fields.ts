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
// Pure helpers for the container fields of the recipe pane.

/**
 * A single-line text input cannot hold a newline, so text values (a fork's split and join) are shown
 * with backslash escapes: `\n`, `\r`, `\t` and `\\`.
 */
export function escapeText(value: string): string {
  let out = "";
  for (const ch of value) {
    if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else out += ch;
  }
  return out;
}

/** The inverse of `escapeText`. An unknown escape (`\q`) and a trailing backslash stay as typed. */
export function unescapeText(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    const next = text[i + 1];
    if (ch === "\\" && next !== undefined) {
      if (next === "n") out += "\n";
      else if (next === "r") out += "\r";
      else if (next === "t") out += "\t";
      else if (next === "\\") out += "\\";
      else out += ch + next;
      i += 1;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Whether a value of this encoding is shown with escapes (text encodings only). */
export function usesEscapes(enc: string): boolean {
  return enc === "utf8" || enc === "latin1";
}

const FLAG_ORDER = ["i", "m", "s"] as const;

/** Flags as the recipe stores them: a subset of `ims` in that order, or undefined when empty. */
export function toggleFlag(
  flags: string | undefined,
  flag: string,
  on: boolean,
): string | undefined {
  const set = new Set((flags ?? "").split(""));
  if (on) set.add(flag);
  else set.delete(flag);
  const out = FLAG_ORDER.filter((f) => set.has(f)).join("");
  return out === "" ? undefined : out;
}
