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
// Promote a recipe to a user word (UI.md section 5.1): pure text generation, no DOM, no store.
import { compileRecipe } from "@forge/recipe";
import type { CatalogueView } from "@forge/recipe";

export const USER_VOCAB = "user";
export const USER_HEADER = "IN: user";
export const DEFAULT_CATEGORY = "User recipes";
export const WORD_NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
export const MAX_DOC_CHARS = 500;

export type PromoteResult =
  | { readonly ok: true; readonly source: string; readonly word: string }
  | { readonly ok: false; readonly error: string };

const fail = (error: string): PromoteResult => ({ ok: false, error });

/** FL string literal (RECIPES section 5.2). Callers refuse control characters first. */
export function flString(s: string): string {
  let out = '"';
  for (const ch of s) {
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else out += ch;
  }
  return out + '"';
}

function hasControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) return true;
  }
  return false;
}

/** Names of the words a user source defines with `: name`. */
export function definedWords(source: string): Set<string> {
  const names = new Set<string>();
  for (const m of source.matchAll(/(?:^|\s):\s+(\S+)/g)) names.add(m[1] as string);
  return names;
}

/** An error message, or null when `name` is a usable new word name. */
export function checkWordName(name: string, userSource: string): string | null {
  if (!WORD_NAME_PATTERN.test(name)) {
    return "Use lowercase letters, digits and hyphens, starting with a letter (at most 64 characters).";
  }
  if (definedWords(userSource).has(name))
    return `The word "${name}" is already defined in your words.`;
  return null;
}

/** Everything is checked here so the dialog can show one message. */
export function promoteToWord(input: {
  readonly recipe: unknown;
  readonly catalogue: CatalogueView;
  readonly name: string;
  readonly doc: string;
  readonly category?: string;
  readonly userSource: string;
}): PromoteResult {
  const { name, userSource } = input;
  const doc = input.doc.trim();
  const category = (input.category ?? "").trim() || DEFAULT_CATEGORY;
  const nameError = checkWordName(name, userSource);
  if (nameError !== null) return fail(nameError);
  if (doc === "") return fail("Describe the word in one line.");
  if (doc.length > MAX_DOC_CHARS)
    return fail(`The description is longer than ${MAX_DOC_CHARS} characters.`);
  if (hasControl(doc) || hasControl(category)) {
    return fail("The description and category cannot contain control characters or line breaks.");
  }
  if (userSource.trim() !== "" && !/^IN:[ \t]+user[ \t]*$/m.test(userSource)) {
    return fail(
      `Your words do not start with "${USER_HEADER}". Fix them in the My words tab first.`,
    );
  }
  if (input.catalogue.ops.some((o) => o.qname === `${USER_VOCAB}:${name}`)) {
    return fail(`The word "${name}" already exists.`);
  }

  const compiled = compileRecipe(input.recipe, input.catalogue, { word: name, vocab: USER_VOCAB });
  if (!compiled.ok) {
    const first = compiled.issues.find((i) => i.severity === "error") ?? compiled.issues[0];
    return fail(`The recipe cannot be compiled${first === undefined ? "." : `: ${first.message}`}`);
  }

  const lines = compiled.text.split("\n");
  const headerAt = lines.findIndex((l) => l.startsWith(`: ${name} `) || l === `: ${name}`);
  if (headerAt < 0) return fail("The compiled recipe has an unexpected shape.");
  lines.splice(headerAt + 1, 0, `  ${flString(doc)} doc`, `  ${flString(category)} category`);
  const unit = lines.join("\n");

  const base = userSource.trim() === "" ? `${USER_HEADER}\n` : userSource;
  const separator = base.endsWith("\n") ? "\n" : "\n\n";
  const source = `${base}${separator}${unit.endsWith("\n") ? unit : `${unit}\n`}`;
  return { ok: true, source, word: `${USER_VOCAB}:${name}` };
}
