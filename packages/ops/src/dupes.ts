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

/*
 * Duplicate-helper detection over the `vocab/*.fth` sources. Pure functions over `SourceFile`s;
 * used by `dupes.test.ts` (which fails on an exact duplicate across vocabularies) and by
 * `scripts/dupes.ts` (`npm run dupes -w @forge/ops`, a readable report). Not exported from
 * `index.ts`, so it never reaches the browser bundle.
 *
 * Why: private (`_`) words cannot be called across vocabularies, so parallel authors copy small
 * helpers. The shared place for them is `vocab/util.fth` (an internal vocabulary).
 *
 * Normalisation of a definition body, so that `b 32 =` and `code 32 =` match:
 *   - comments are already gone (the reader drops them);
 *   - the stack-effect header is not part of the body, but gives the parameter names;
 *   - the pairs `"text" doc` and `"text" category` are dropped;
 *   - each input name of the header becomes `$0`, `$1`, ... by position;
 *   - a word defined in the same vocabulary, and a qualified word, both become `vocab:name`;
 *   - every other token keeps its kind and text (`i:32`, `s:...`, `w:swap`, `[`, `]`).
 *
 * Exact duplicate: two or more definitions in different vocabularies with the same input and
 * output types and identical normalised bodies.
 *
 * Near duplicate: a pair in different vocabularies with the same input and output arity whose
 * normalised bodies have Jaccard similarity >= 0.8 over their token bigrams (|A and B| / |A or B|
 * of the sets of adjacent token pairs), and which is not already an exact duplicate.
 *
 * Bodies shorter than MIN_TOKENS tokens are ignored: too short to say anything.
 */
import { read } from "@forge/lang";
import type { Token } from "@forge/lang";
import type { SourceFile } from "./types.js";

/** Bodies with fewer normalised tokens than this are not compared. */
export const MIN_TOKENS = 4;
/** The default near-duplicate threshold. */
export const NEAR_THRESHOLD = 0.8;

export interface Definition {
  readonly vocab: string;
  readonly name: string;
  readonly qname: string;
  /** Input types (names and defaults removed), e.g. `["str", "int"]`. */
  readonly inputs: readonly string[];
  /** Output types. */
  readonly outputs: readonly string[];
  /** The normalised body tokens. */
  readonly tokens: readonly string[];
}

export interface ExactGroup {
  readonly shape: string;
  readonly members: readonly Definition[];
}

export interface NearPair {
  readonly a: Definition;
  readonly b: Definition;
  readonly similarity: number;
}

export interface DupesResult {
  readonly exact: readonly ExactGroup[];
  readonly near: readonly NearPair[];
}

export interface DupesOptions {
  readonly minTokens?: number;
  readonly threshold?: number;
}

/** Splits a header text at white space outside brackets, braces and strings. */
function headerItems(text: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const c of text) {
    if (quoted) {
      if (c === '"') quoted = false;
    } else if (c === '"') {
      quoted = true;
    } else if (c === "{" || c === "[") {
      depth++;
    } else if (c === "}" || c === "]") {
      depth--;
    } else if (depth === 0 && /\s/.test(c)) {
      if (current !== "") items.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  if (current !== "") items.push(current);
  return items;
}

interface HeaderItem {
  readonly name: string | null;
  readonly type: string;
}

function parseItem(item: string): HeaderItem {
  const colon = item.indexOf(":");
  const head = colon > 0 ? item.slice(0, colon) : "";
  const hasName = head !== "" && !/[{[=]/.test(head);
  const rest = hasName ? item.slice(colon + 1) : item;
  return { name: hasName ? head : null, type: rest.split(/[{[=]/, 1)[0] as string };
}

function parseEffect(text: string): { inputs: HeaderItem[]; outputs: HeaderItem[] } {
  const items = headerItems(text);
  const dash = items.indexOf("--");
  const side = (xs: string[]): HeaderItem[] => xs.map(parseItem);
  return dash < 0
    ? { inputs: side(items), outputs: [] }
    : { inputs: side(items.slice(0, dash)), outputs: side(items.slice(dash + 1)) };
}

function tokenText(
  t: Token,
  locals: ReadonlyMap<string, number>,
  own: ReadonlySet<string>,
  vocab: string,
): string {
  switch (t.kind) {
    case "word": {
      const local = locals.get(t.text);
      if (local !== undefined) return `$${local}`;
      return own.has(t.text) ? `w:${vocab}:${t.text}` : `w:${t.text}`;
    }
    case "qword":
      return `w:${t.vocab}:${t.name}`;
    case "lbracket":
    case "rbracket":
    case "lbrace":
    case "rbrace":
      return t.text;
    case "str":
      return `s:${t.value}`;
    default:
      return `${t.kind}:${t.text}`;
  }
}

/** Every colon definition of the given `.fth` files, normalised. A file the reader rejects throws. */
export function extractDefinitions(files: readonly SourceFile[]): Definition[] {
  const out: Definition[] = [];
  for (const file of files) {
    if (!file.name.endsWith(".fth")) continue;
    const vocab = file.name.slice(0, -".fth".length);
    const tokens = read(file.text);
    // pass 1: the names defined in this vocabulary
    const own = new Set<string>();
    for (let i = 0; i + 1 < tokens.length; i++) {
      const t = tokens[i] as Token;
      const n = tokens[i + 1] as Token;
      if (t.kind === "word" && t.text === ":" && n.kind === "word") own.add(n.text);
    }
    // pass 2: the bodies
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i] as Token;
      if (t.kind !== "word" || t.text !== ":") continue;
      const nameTok = tokens[i + 1] as Token;
      const headerTok = tokens[i + 2] as Token | undefined;
      if (nameTok.kind !== "word" || headerTok === undefined || headerTok.kind !== "header")
        continue;
      const effect = parseEffect(headerTok.headerText);
      const locals = new Map<string, number>();
      effect.inputs.forEach((item, k) => {
        if (item.name !== null) locals.set(item.name, k);
      });
      const body: string[] = [];
      let j = i + 3;
      for (; j < tokens.length; j++) {
        const b = tokens[j] as Token;
        if (b.kind === "eof" || (b.kind === "word" && b.text === ";")) break;
        const after = tokens[j + 1] as Token | undefined;
        if (
          b.kind === "str" &&
          after !== undefined &&
          after.kind === "word" &&
          (after.text === "doc" || after.text === "category")
        ) {
          j++; // drop the pair
          continue;
        }
        body.push(tokenText(b, locals, own, vocab));
      }
      out.push({
        vocab,
        name: nameTok.text,
        qname: `${vocab}:${nameTok.text}`,
        inputs: effect.inputs.map((x) => x.type),
        outputs: effect.outputs.map((x) => x.type),
        tokens: body,
      });
      i = j;
    }
  }
  return out;
}

function bigrams(tokens: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i + 1 < tokens.length; i++) set.add(`${tokens[i]}\u0000${tokens[i + 1]}`);
  return set;
}

/** Jaccard similarity of the token-bigram sets of two token sequences (0 to 1). */
export function similarity(a: readonly string[], b: readonly string[]): number {
  const sa = bigrams(a);
  const sb = bigrams(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let common = 0;
  for (const g of sa) if (sb.has(g)) common++;
  return common / (sa.size + sb.size - common);
}

const shapeOf = (d: Definition): string => `( ${d.inputs.join(" ")} -- ${d.outputs.join(" ")} )`;

/** Finds exact and near duplicates between definitions of different vocabularies. */
export function findDuplicates(
  defs: readonly Definition[],
  options: DupesOptions = {},
): DupesResult {
  const minTokens = options.minTokens ?? MIN_TOKENS;
  const threshold = options.threshold ?? NEAR_THRESHOLD;
  const eligible = defs.filter((d) => d.tokens.length >= minTokens);

  const groups = new Map<string, Definition[]>();
  for (const d of eligible) {
    const key = `${shapeOf(d)}\u0001${d.tokens.join("\u0002")}`;
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [d]);
    else list.push(d);
  }
  const exact: ExactGroup[] = [];
  const exactKey = new Map<Definition, string>();
  for (const [key, members] of groups) {
    for (const m of members) exactKey.set(m, key);
    if (new Set(members.map((m) => m.vocab)).size > 1) {
      exact.push({ shape: shapeOf(members[0] as Definition), members });
    }
  }

  const near: NearPair[] = [];
  for (let i = 0; i < eligible.length; i++) {
    const a = eligible[i] as Definition;
    for (let j = i + 1; j < eligible.length; j++) {
      const b = eligible[j] as Definition;
      if (a.vocab === b.vocab) continue;
      if (a.inputs.length !== b.inputs.length || a.outputs.length !== b.outputs.length) continue;
      if (exactKey.get(a) === exactKey.get(b)) continue;
      const s = similarity(a.tokens, b.tokens);
      if (s >= threshold) near.push({ a, b, similarity: s });
    }
  }
  near.sort((x, y) => y.similarity - x.similarity || x.a.qname.localeCompare(y.a.qname));
  return { exact, near };
}

/** The names in an exact group, for messages: `a:x, b:y`. */
export function groupNames(group: ExactGroup): string {
  return group.members.map((m) => m.qname).join(", ");
}

/** A readable report of the result. */
export function formatReport(result: DupesResult): string {
  const lines: string[] = [];
  lines.push(`Exact duplicates across vocabularies: ${result.exact.length}`);
  for (const g of result.exact) {
    lines.push(`  ${g.shape}  ${groupNames(g)}`);
    lines.push(`    body: ${(g.members[0] as Definition).tokens.join(" ")}`);
  }
  lines.push("");
  lines.push(
    `Near duplicates (same arity, bigram Jaccard >= ${NEAR_THRESHOLD}): ${result.near.length}`,
  );
  for (const p of result.near) {
    lines.push(
      `  ${p.similarity.toFixed(2)}  ${p.a.qname} ${shapeOf(p.a)}  ~  ${p.b.qname} ${shapeOf(p.b)}`,
    );
  }
  if (result.exact.length > 0) {
    lines.push("");
    lines.push("Move each exact duplicate into vocab/util.fth and call it as util:name.");
  }
  return lines.join("\n");
}
