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
// Fuzzy search over the catalogue (UI.md section 2.3, WP 3.2). Pure: no DOM, no store.
//
// A query is split into words. Every word must match at least one field of an operation, and an
// operation's score is the sum of its best field match per word. Within a field a match is graded:
// exact, then prefix, then a match at a word start (after `:`, `-`, `_`, `.` or a space), then a plain
// substring. The name outranks the aliases, which outrank the qualified name, the category and the
// doc. As a last resort a word of three or more letters matches the name as a subsequence ("bs64"
// finds "base64"), with a penalty for spread-out matches.

/** The fields the scorer reads. A `CatalogueOp` satisfies it. */
export interface SearchableOp {
  readonly qname: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly doc: string | null;
  readonly category: string | null;
}

interface Tiers {
  readonly exact: number;
  readonly prefix: number;
  readonly word: number;
  readonly substring: number;
}

const NAME: Tiers = { exact: 1000, prefix: 900, word: 800, substring: 600 };
const ALIAS: Tiers = { exact: 900, prefix: 700, word: 650, substring: 400 };
const QNAME: Tiers = { exact: 950, prefix: 850, word: 700, substring: 400 };
const CATEGORY: Tiers = { exact: 150, prefix: 150, word: 150, substring: 120 };
const DOC: Tiers = { exact: 120, prefix: 120, word: 120, substring: 80 };

const FUZZY_MIN_LENGTH = 3;
const FUZZY_BASE = 300;
const FUZZY_FLOOR = 100;
const MAX_TOKENS = 8;
const DEFAULT_LIMIT = 100;

/** Lower case, accents removed, surrounding space trimmed. Applied to queries and to fields alike. */
export function normaliseText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .trim();
}

/** The query's words, normalised, at most eight of them. */
export function tokenise(query: string): string[] {
  return normaliseText(query)
    .split(/\s+/u)
    .filter((t) => t.length > 0)
    .slice(0, MAX_TOKENS);
}

function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}

/** True when `token` occurs in `text` starting at a word boundary. */
function startsWord(text: string, token: string): boolean {
  let at = text.indexOf(token);
  while (at >= 0) {
    if (at === 0 || !isWordChar(text.charAt(at - 1))) return true;
    at = text.indexOf(token, at + 1);
  }
  return false;
}

function tieredScore(text: string, token: string, tiers: Tiers): number {
  if (text === "") return 0;
  if (text === token) return tiers.exact;
  if (text.startsWith(token)) return tiers.prefix;
  if (startsWord(text, token)) return tiers.word;
  if (text.includes(token)) return tiers.substring;
  return 0;
}

/** Length of the span of `text` that holds `token` as a subsequence (greedy), or -1 when it does not. */
export function subsequenceSpan(text: string, token: string): number {
  let first = -1;
  let pos = 0;
  for (const ch of token) {
    const found = text.indexOf(ch, pos);
    if (found < 0) return -1;
    if (first < 0) first = found;
    pos = found + 1;
  }
  return pos - first;
}

function fuzzyScore(name: string, token: string): number {
  if (token.length < FUZZY_MIN_LENGTH) return 0;
  const span = subsequenceSpan(name, token);
  if (span < 0) return 0;
  return Math.max(FUZZY_FLOOR, FUZZY_BASE - (span - token.length) * 10);
}

/** Best score of one query word against one operation (0 when it matches nothing). */
export function scoreToken(op: SearchableOp, token: string): number {
  const name = normaliseText(op.name);
  let best = Math.max(
    tieredScore(name, token, NAME),
    fuzzyScore(name, token),
    tieredScore(normaliseText(op.qname), token, QNAME),
    tieredScore(normaliseText(op.category ?? ""), token, CATEGORY),
    tieredScore(normaliseText(op.doc ?? ""), token, DOC),
  );
  for (const alias of op.aliases) {
    best = Math.max(best, tieredScore(normaliseText(alias), token, ALIAS));
  }
  return best;
}

/** Score of a whole query against one operation: 0 unless every word matches. */
export function scoreOp(op: SearchableOp, tokens: readonly string[]): number {
  if (tokens.length === 0) return 0;
  let total = 0;
  for (const token of tokens) {
    const s = scoreToken(op, token);
    if (s === 0) return 0;
    total += s;
  }
  return total;
}

/**
 * Operations matching `query`, best first. An empty or blank query matches nothing (the caller shows
 * the browse view instead). Ties go to the shorter name, then to the qualified name in code-point
 * order, so the result is deterministic.
 */
export function searchOps<T extends SearchableOp>(
  ops: readonly T[],
  query: string,
  limit: number = DEFAULT_LIMIT,
): T[] {
  const tokens = tokenise(query);
  if (tokens.length === 0) return [];
  const scored: { op: T; score: number }[] = [];
  for (const op of ops) {
    const score = scoreOp(op, tokens);
    if (score > 0) scored.push({ op, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.op.name.length - b.op.name.length ||
      (a.op.qname < b.op.qname ? -1 : a.op.qname > b.op.qname ? 1 : 0),
  );
  return scored.slice(0, Math.max(0, limit)).map((s) => s.op);
}
