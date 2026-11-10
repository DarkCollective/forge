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
// Multi-line input assembly, the same rule as packages/lang/scripts/repl.ts: a line that leaves a
// colon definition open continues on the next line until its `;`.
import { read, type Token } from "@forge/lang";

/** Net number of colon definitions left open by `source`: each `:` word opens one, each `;` closes one. */
export function openDefinitions(
  source: string,
  tokenize: (s: string) => readonly Token[] = read,
): number {
  let tokens: readonly Token[];
  try {
    tokens = tokenize(source);
  } catch {
    // A lexical error is reported when the text is run, so treat the text as complete here.
    return 0;
  }
  let depth = 0;
  for (const token of tokens) {
    if (token.kind !== "word") continue;
    if (token.text === ":") depth++;
    else if (token.text === ";") depth--;
  }
  return depth;
}

/** What `submitLine` decides to do with a line typed at the prompt. */
export type LineAction =
  | { readonly kind: "meta"; readonly command: string; readonly args: string }
  | { readonly kind: "continue"; readonly pending: string }
  | { readonly kind: "run"; readonly source: string };

export const META_COMMANDS = [".help", ".clear", ".reset"] as const;

/**
 * Decide what a typed line means given the unfinished definition text `pending` ("" when none).
 * Meta commands are recognised only when nothing is pending.
 */
export function classifyLine(
  line: string,
  pending: string,
  tokenize?: (s: string) => readonly Token[],
): LineAction {
  const trimmed = line.trim();
  const command = trimmed.split(/\s+/)[0] ?? "";
  if (pending === "" && (META_COMMANDS as readonly string[]).includes(command)) {
    return { kind: "meta", command, args: trimmed.slice(command.length).trim() };
  }
  const source = pending === "" ? line : `${pending}\n${line}`;
  return openDefinitions(source, tokenize) > 0
    ? { kind: "continue", pending: source }
    : { kind: "run", source };
}
