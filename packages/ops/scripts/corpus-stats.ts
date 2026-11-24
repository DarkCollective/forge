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
 * `npm run corpus-stats -w @forge/ops`: the measures of the FL corpus that TOOLKIT §2.1, §2.5 and
 * §11 cite, taken from the tree. Prints a Markdown report; `--json` prints the measures as JSON.
 * Deterministic: the same tree gives the same bytes, so a baseline can be committed and re-checked.
 *
 * Every definition is stated next to its measure in the report. Where a survey figure of TOOLKIT
 * had no written definition, the definition here is the one chosen by L1 (2026-11-24) and the
 * report says so. The pure functions (`measureCorpus`, `renderMarkdown`) take the corpus as data,
 * so the smoke test in `corpus-stats.test.ts` can run them on a synthetic corpus; `main` reads the
 * tree. `main` needs the built package (`dist/`) for the catalogue and `INTERNAL_VOCABS`, and says
 * so when it is missing.
 *
 * Tokens are the reader's (`@forge/lang` `read`), so comments and header text are handled as the
 * engine handles them. A token is any reader token except `eof` and `header`.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { read } from "@forge/lang";
import type { Token } from "@forge/lang";

/** A file of the corpus: its name (for `.fth`, the vocabulary is the name without the extension) and text. */
export interface CorpusFile {
  readonly name: string;
  readonly text: string;
}

/** One entry of the built catalogue: the op's qualified name and its vocabulary. */
export interface CatalogueOpRef {
  readonly qname: string;
  readonly vocab: string;
}

/** The corpus as data. `ops` is absent when the package is not built; the op measures are then omitted. */
export interface CorpusInput {
  /** `vocab/*.fth` */
  readonly vocabFiles: readonly CorpusFile[];
  /** `vocab/*.test.json` */
  readonly vectorFiles: readonly CorpusFile[];
  /** `src/prims/*.ts`, test files excluded */
  readonly primFiles: readonly CorpusFile[];
  /** `INTERNAL_VOCABS` of `src/types.ts` */
  readonly internalVocabs: readonly string[];
  readonly ops?: readonly CatalogueOpRef[];
}

/** One measure. `definition` says what was counted. */
export interface Measure {
  readonly id: string;
  readonly section: string;
  readonly label: string;
  readonly value: number | string;
  readonly definition: string;
}

/**
 * The names LANGUAGE-0.3 §8, §4, §7, §10.2 and §10.4 add to `core` (35 words). A local of one of
 * these names draws `W_SHADOW` once the word is core; LANGUAGE-0.3 §14.1 leaves the count to L1.
 */
export const NEW_CORE_NAMES: readonly string[] = [
  // §8
  "first",
  "second",
  "last",
  "divmod",
  "tdiv",
  "zero-pad",
  "index-of",
  "set-nth",
  "num>float-bytes",
  "float-bytes>num",
  "float-bytes-class",
  // §4 and §7
  "ext-kind",
  "ext>text",
  "null",
  "null?",
  "json>value",
  "value>json",
  // §10.2
  "thaw",
  "anew",
  "anew-bytes",
  "aget",
  "aset!",
  "apush!",
  "alen",
  "freeze",
  // §10.4
  "add32",
  "sub32",
  "mul32",
  "shl32",
  "shr32",
  "not32",
  "rotl32",
  "rotr32",
  "bytes>u32",
  "u32>bytes",
];

/** The words that only permute the stack (LANGUAGE.md §13.1, the `stack` word set without `depth` and `clear`). */
export const SHUFFLE_WORDS: ReadonlySet<string> = new Set([
  "dup",
  "drop",
  "swap",
  "over",
  "rot",
  "-rot",
  "nip",
  "tuck",
  "dup2",
  "drop2",
]);

/** The length of the top lists in the report. */
const FIVE = 5;

/** The lines of a text: the count of line breaks, plus one for an unterminated last line. */
export function lineCount(text: string): number {
  if (text === "") return 0;
  const breaks = text.split("\n").length - 1;
  return text.endsWith("\n") ? breaks : breaks + 1;
}

/** Non-blank lines that are not comment-only lines of TypeScript (`//`, `/*`, `*`, `*\/`). */
export function codeLineCount(text: string): number {
  return text.split("\n").filter((line) => {
    const t = line.trim();
    return t !== "" && !t.startsWith("//") && !t.startsWith("/*") && !t.startsWith("*");
  }).length;
}

/** Splits a header at white space outside brackets, braces and strings (as `dupes.ts` does). */
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
  return { name: hasName ? head : null, type: rest.split(/[{[=]/, 1)[0] ?? "" };
}

/** The inputs and outputs of a stack-effect header. */
export function parseHeader(text: string): { inputs: HeaderItem[]; outputs: HeaderItem[] } {
  const items = headerItems(text);
  const dash = items.indexOf("--");
  const side = (xs: string[]): HeaderItem[] => xs.map(parseItem);
  return dash < 0
    ? { inputs: side(items), outputs: [] }
    : { inputs: side(items.slice(0, dash)), outputs: side(items.slice(dash + 1)) };
}

/** A colon definition (`: name ( … ) … ;`, or `MEMO:`), with its tokens. */
export interface Definition {
  readonly name: string;
  readonly memo: boolean;
  readonly headerText: string;
  readonly inputs: readonly HeaderItem[];
  readonly outputs: readonly HeaderItem[];
  /** Index of the name token in the file's token list. */
  readonly nameIndex: number;
  /** Body tokens, from after the header to before the `;`, without `"doc"` and `"category"` pairs. */
  readonly body: readonly Token[];
  /** Index of the first body token and of the `;` in the file's token list. */
  readonly bodyStart: number;
  readonly bodyEnd: number;
}

/** Every colon and `MEMO:` definition of a file's tokens (the eof token already removed). */
export function definitionsOf(toks: readonly Token[]): Definition[] {
  const out: Definition[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t?.kind !== "word" || (t.text !== ":" && t.text !== "MEMO:")) continue;
    const n = toks[i + 1];
    const h = toks[i + 2];
    if (n?.kind !== "word" || h?.kind !== "header") continue;
    let end = i + 3;
    while (end < toks.length && !(toks[end]?.kind === "word" && toks[end]?.text === ";")) end++;
    const body: Token[] = [];
    for (let j = i + 3; j < end; j++) {
      const b = toks[j];
      const after = toks[j + 1];
      if (
        b?.kind === "str" &&
        after?.kind === "word" &&
        (after.text === "doc" || after.text === "category")
      ) {
        j++;
        continue;
      }
      if (b !== undefined) body.push(b);
    }
    const { inputs, outputs } = parseHeader(h.headerText);
    out.push({
      name: n.text,
      memo: t.text === "MEMO:",
      headerText: h.headerText,
      inputs,
      outputs,
      nameIndex: i + 1,
      body,
      bodyStart: i + 3,
      bodyEnd: end,
    });
    i = end;
  }
  return out;
}

/** For each opening bracket of `open`/`close` kind, the index of its partner (and back). */
function matchPairs(toks: readonly Token[], open: string, close: string): Map<number, number> {
  const pairs = new Map<number, number>();
  const stack: number[] = [];
  toks.forEach((t, i) => {
    if (t.kind === open) stack.push(i);
    else if (t.kind === close) {
      const o = stack.pop();
      if (o !== undefined) {
        pairs.set(o, i);
        pairs.set(i, o);
      }
    }
  });
  return pairs;
}

/**
 * The else-if links of a file: an `if` whose else quotation (`[ … ] [ … ] if`, the second quotation)
 * ends with another `if`. Returns, for each `if` that is an outer link, the index of the `if` it
 * links to (the last token inside its else quotation), and the chain depth of each outermost `if`.
 */
export function elseIfChainsOf(toks: readonly Token[]): { links: number; chains: number[] } {
  const brackets = matchPairs(toks, "lbracket", "rbracket");
  const innerOf = new Map<number, number>();
  toks.forEach((t, k) => {
    if (t.kind !== "word" || t.text !== "if" || k < 1) return;
    if (toks[k - 1]?.kind !== "rbracket") return;
    const elseOpen = brackets.get(k - 1);
    if (elseOpen === undefined) return;
    const inner = k - 2;
    if (inner > elseOpen && toks[inner]?.kind === "word" && toks[inner]?.text === "if") {
      innerOf.set(k, inner);
    }
  });
  const depthOf = (k: number): number => {
    const inner = innerOf.get(k);
    return inner === undefined ? 1 : 1 + depthOf(inner);
  };
  const targets = new Set(innerOf.values());
  const chains: number[] = [];
  toks.forEach((t, k) => {
    if (t.kind !== "word" || t.text !== "if" || targets.has(k)) return;
    const d = depthOf(k);
    if (d >= 2) chains.push(d);
  });
  return { links: innerOf.size, chains };
}

/** Lists of `choice{…}` in a header: the text between the braces of each occurrence. */
export function choiceLists(headerText: string): string[] {
  return [...headerText.matchAll(/choice\{([^}]*)\}/g)].map((m) => (m[1] ?? "").trim());
}

/** The corpus measures, in report order. */
export function measureCorpus(input: CorpusInput): Measure[] {
  const out: Measure[] = [];
  const add = (
    id: string,
    section: string,
    label: string,
    value: number | string,
    definition: string,
  ): void => {
    out.push({ id, section, label, value, definition });
  };

  // ---- corpus size, vectors, vocabularies (§2.1) ----
  const internal = new Set(input.internalVocabs);
  const fthNames = input.vocabFiles.map((f) => f.name.replace(/\.fth$/, ""));
  const fthSet = new Set(fthNames);
  let fthLines = 0;
  for (const f of input.vocabFiles) fthLines += lineCount(f.text);
  add(
    "fth_files",
    "2.1 Forge today",
    ".fth files in vocab/",
    fthNames.length,
    "files named *.fth in vocab/",
  );
  add(
    "fth_lines",
    "2.1 Forge today",
    ".fth lines",
    fthLines,
    "physical lines of every .fth file (blank lines and comments included)",
  );

  let vectorTotal = 0;
  let vectorOps = 0;
  let checkPairs = 0;
  let e4Expect = 0;
  let e4Files = 0;
  const vectorsByOp = new Map<string, number>();
  const vectorVocabs = new Set<string>();
  for (const f of input.vectorFiles) {
    const items: unknown = JSON.parse(f.text);
    if (!Array.isArray(items)) throw new Error(`${f.name} is not a JSON array`);
    let hit = 0;
    for (const item of items as unknown[]) {
      vectorTotal++;
      const op =
        typeof item === "object" && item !== null ? (item as { op?: unknown }).op : undefined;
      if (typeof op === "string") {
        vectorOps++;
        vectorsByOp.set(op, (vectorsByOp.get(op) ?? 0) + 1);
        vectorVocabs.add(f.name.replace(/\.test\.json$/, ""));
        const expect = (item as { expect?: { error?: unknown } }).expect;
        if (expect?.error === "E_PARAM_INVALID") hit++;
      } else {
        checkPairs++;
      }
    }
    if (hit > 0) {
      e4Expect += hit;
      e4Files++;
    }
  }
  add(
    "test_files",
    "2.1 Forge today",
    ".test.json files",
    input.vectorFiles.length,
    "files named *.test.json in vocab/",
  );
  add(
    "vectors",
    "2.1 Forge today",
    "vectors (all .test.json items)",
    vectorTotal,
    "top-level items of every .test.json array",
  );
  add(
    "vector_items_op",
    "2.1 Forge today",
    'vectors with an "op" field',
    vectorOps,
    'items with a string "op" (the op vectors)',
  );
  add(
    "vector_items_checkpair",
    "2.1 Forge today",
    "other items (checkPair)",
    checkPairs,
    'items without an "op" field',
  );
  add(
    "vector_files_without_fth",
    "2.1 Forge today",
    ".test.json with no .fth",
    [...vectorVocabs].filter((v) => !fthSet.has(v)).length,
    "vocabularies with vectors but no .fth file",
  );
  add(
    "fth_without_vectors",
    "2.1 Forge today",
    ".fth with no .test.json",
    fthNames.filter((v) => !input.vectorFiles.some((f) => f.name === `${v}.test.json`)).length,
    "vocabularies with a .fth but no .test.json",
  );

  add(
    "e_param_invalid_expect",
    "11.5 The fixes",
    "vector expectations of E_PARAM_INVALID",
    e4Expect,
    "vectors whose expect.error is E_PARAM_INVALID (the expectations LANGUAGE-0.3 §14.1 says L12 rewrites)",
  );
  add(
    "e_param_invalid_files",
    "11.5 The fixes",
    "files holding them",
    e4Files,
    "test files with at least one such expectation",
  );

  if (input.ops !== undefined) {
    const ops = input.ops;
    const opVocabs = new Set(ops.map((o) => o.vocab));
    const opsWithVectors = ops.filter((o) => (vectorsByOp.get(o.qname) ?? 0) > 0).length;
    const catalogueVocabs = new Set(opVocabs);
    const fthInCatalogue = fthNames.filter((v) => catalogueVocabs.has(v)).length;
    const fthInternal = fthNames.filter((v) => internal.has(v)).length;
    const other = fthNames.filter((v) => !catalogueVocabs.has(v) && !internal.has(v));
    add(
      "ops",
      "2.1 Forge today",
      "ops (catalogue entries)",
      ops.length,
      "entries of the built catalogue (dist/catalogue.json)",
    );
    add(
      "op_vocabs",
      "2.1 Forge today",
      "vocabularies with an op",
      opVocabs.size,
      "distinct vocabularies of the catalogue entries",
    );
    add(
      "ops_with_vectors",
      "2.1 Forge today",
      "ops with at least one vector",
      opsWithVectors,
      'catalogue ops whose qualified name is the "op" of a vector',
    );
    add(
      "fth_op_vocabs",
      "2.1 Forge today",
      ".fth files that are op vocabularies",
      fthInCatalogue,
      ".fth files whose name is a catalogue vocabulary",
    );
    add(
      "fth_internal",
      "2.1 Forge today",
      ".fth files that are internal vocabularies",
      fthInternal,
      ".fth files whose name is in INTERNAL_VOCABS (src/types.ts)",
    );
    add(
      "fth_other",
      "2.1 Forge today",
      ".fth files neither op nor internal",
      other.length,
      `.fth files in neither set: ${other.join(", ") || "none"}`,
    );
    add(
      "ops_vectors_op_files",
      "2.1 Forge today",
      "vectors in op-vocabulary files",
      [...input.vectorFiles]
        .filter((f) => catalogueVocabs.has(f.name.replace(/\.test\.json$/, "")))
        .reduce((n, f) => n + (JSON.parse(f.text) as unknown[]).length, 0),
      "vectors in .test.json files of catalogue vocabularies",
    );
  }

  // ---- definitions, tokens and the defining forms (§2.5) ----
  let colonWords = 0;
  let publicWords = 0;
  let privateWords = 0;
  let memoWords = 0;
  let privateCalledOnce = 0;
  let closureHelpers = 0;
  let smallSingleUse = 0;
  let zeroInputWords = 0;
  let zeroInputRebuilding = 0;
  let zeroInputMemo = 0;
  let constants = 0;
  let variables = 0;
  const variablesByFile: { name: string; count: number }[] = [];
  let tries = 0;
  let raiseCalls = 0;
  let shuffles = 0;
  let choiceOccurrences = 0;
  const choiceCount = new Map<string, number>();
  let choiceCaseTables = 0;
  let choiceCaseTablesInChoiceWords = 0;
  let elseIfLinks = 0;
  let elseIfChains = 0;
  let elseIfDepth3 = 0;
  let maxChainDepth = 0;
  let choiceDefs = 0;
  let reduceCallers = 0;
  let reduceSites = 0;
  const reduceFiles = new Set<string>();
  let jsonFiles = 0;
  let jsonOccurrences = 0;
  let jsonNullLines = 0;
  const jsonNullFiles = new Set<string>();
  let shadowOccurrences = 0;
  let shadowAlreadyOwn = 0;
  const shadowNames = new Map<string, number>();
  const shadowFiles = new Set<string>();
  const utilCalls = new Map<string, { calls: number; vocabs: Set<string> }>();
  let utilPublic = 0;

  const perFile: { vocab: string; tokens: Token[]; defs: Definition[] }[] = [];
  for (const f of input.vocabFiles) {
    const vocab = f.name.replace(/\.fth$/, "");
    const all = read(f.text).filter((t) => t.kind !== "eof");
    const defs = definitionsOf(all);
    perFile.push({ vocab, tokens: all, defs });

    // Each reference to a word of this file, by name (a qualified call to this vocabulary counts too).
    const defNameIdx = new Set(defs.map((d) => d.nameIndex));
    const refs = new Map<string, number>();
    all.forEach((t, i) => {
      if (defNameIdx.has(i)) return;
      if (t.kind === "word") refs.set(t.text, (refs.get(t.text) ?? 0) + 1);
      if (t.kind === "qword" && t.vocab === vocab) refs.set(t.name, (refs.get(t.name) ?? 0) + 1);
    });
    const ownNames = new Set(defs.map((d) => d.name));

    let vars = 0;
    for (const t of all) {
      if (t.kind === "word") {
        if (SHUFFLE_WORDS.has(t.text)) shuffles++;
        if (t.text === "try") tries++;
        if (t.text === "CONSTANT") constants++;
        if (t.text === "VARIABLE") vars++;
        if (t.text === "reduce") reduceSites++;
        if (t.text === "reduce") reduceFiles.add(vocab);
      }
      if (t.kind === "qword") {
        if (t.vocab === "raise") raiseCalls++;
        if (t.vocab === "json") {
          jsonOccurrences++;
          if (t.name === "null" || t.name === "null?") jsonNullFiles.add(vocab);
        }
        if (t.vocab === "util") {
          const e = utilCalls.get(t.name) ?? { calls: 0, vocabs: new Set<string>() };
          e.calls++;
          if (vocab !== "util") e.vocabs.add(vocab);
          utilCalls.set(t.name, e);
        }
      }
    }
    if (vars > 0) {
      variables += vars;
      variablesByFile.push({ name: vocab, count: vars });
    }
    if (vocab !== "json" && all.some((t) => t.kind === "qword" && t.vocab === "json")) jsonFiles++;

    // `json:null` lines, counted once per (line, file).
    const nullLines = new Set<number>();
    all.forEach((t) => {
      if (t.kind === "qword" && t.vocab === "json" && (t.name === "null" || t.name === "null?"))
        nullLines.add(t.pos.line);
    });
    jsonNullLines += nullLines.size;

    // `} case` tables: a `case` directly after a closing brace.
    all.forEach((t, i) => {
      if (t.kind === "word" && t.text === "case" && all[i - 1]?.kind === "rbrace")
        choiceCaseTables++;
    });

    // else-if chains over the whole file
    const chains = elseIfChainsOf(all);
    elseIfLinks += chains.links;
    for (const d of chains.chains) {
      elseIfChains++;
      if (d >= 3) elseIfDepth3++;
      if (d > maxChainDepth) maxChainDepth = d;
    }

    // private single-use counts, per definition
    for (const d of defs) {
      colonWords++;
      if (d.memo) memoWords++;
      const isPrivate = d.name.startsWith("_");
      if (isPrivate) privateWords++;
      else publicWords++;
      if (vocab === "util" && !isPrivate) utilPublic++;

      const locals = d.inputs.flatMap((x) => (x.name === null ? [] : [x.name]));
      // closure-binding helper: a private single-use word whose body is one quotation over a named input
      const bodyTexts = d.body;
      const oneQuotation =
        bodyTexts.length >= 2 &&
        bodyTexts[0]?.kind === "lbracket" &&
        bodyTexts[bodyTexts.length - 1]?.kind === "rbracket" &&
        matchPairs(bodyTexts, "lbracket", "rbracket").get(0) === bodyTexts.length - 1;
      const usesLocal = bodyTexts.some((t) => t.kind === "word" && locals.includes(t.text));
      const single = (refs.get(d.name) ?? 0) === 1;
      if (isPrivate && single) {
        privateCalledOnce++;
        if (oneQuotation && usesLocal) closureHelpers++;
        else if (bodyTexts.length <= FIVE) smallSingleUse++;
      }
      if (!d.memo && d.inputs.length === 0 && d.outputs.length >= 1) {
        zeroInputWords++;
        if (
          bodyTexts.some((t) => t.kind === "lbracket" || t.kind === "lbrace" || t.kind === "bytes")
        )
          zeroInputRebuilding++;
      }
      if (d.memo && d.inputs.length === 0) zeroInputMemo++;
      if (d.body.some((t) => t.kind === "word" && t.text === "reduce")) reduceCallers++;

      // header facts
      const choices = choiceLists(d.headerText);
      if (choices.length > 0) {
        choiceDefs++;
        for (const c of choices) {
          choiceOccurrences++;
          choiceCount.set(c, (choiceCount.get(c) ?? 0) + 1);
        }
        const hasCase = all
          .slice(d.bodyStart, d.bodyEnd)
          .some(
            (t, i, arr) => t.kind === "word" && t.text === "case" && arr[i - 1]?.kind === "rbrace",
          );
        if (hasCase) choiceCaseTablesInChoiceWords++;
      }

      // W_SHADOW: a local (named input or `:>` binding) named like a new core word, that the file does not define itself
      const shadowLocals: string[] = [...locals];
      d.body.forEach((t, i) => {
        if (t.kind === "word" && t.text === ":>" && d.body[i + 1]?.kind === "word")
          shadowLocals.push(d.body[i + 1]?.text ?? "");
      });
      for (const name of shadowLocals) {
        if (!NEW_CORE_NAMES.includes(name)) continue;
        if (ownNames.has(name)) {
          shadowAlreadyOwn++;
          continue;
        }
        shadowOccurrences++;
        shadowNames.set(name, (shadowNames.get(name) ?? 0) + 1);
        shadowFiles.add(vocab);
      }
    }
  }

  add(
    "fth_tokens",
    "2.5 The FL corpus",
    "tokens",
    perFile.reduce((n, p) => n + p.tokens.filter((t) => t.kind !== "header").length, 0),
    "reader tokens of every .fth file, excluding eof and headers",
  );

  add(
    "colon_words",
    "2.5 The FL corpus",
    "colon words",
    colonWords,
    "`: name` definitions (MEMO: excluded), in every .fth file",
  );
  add(
    "colon_public",
    "2.5 The FL corpus",
    "public colon words",
    publicWords,
    "definitions whose name does not start with `_`",
  );
  add(
    "colon_private",
    "2.5 The FL corpus",
    "private colon words",
    privateWords,
    "definitions whose name starts with `_`",
  );
  add(
    "memo_words",
    "2.5 The FL corpus",
    "MEMO: words",
    memoWords,
    "MEMO: definitions (memoised zero-input words)",
  );
  add(
    "private_called_once",
    "2.5 The FL corpus",
    "private words called exactly once",
    privateCalledOnce,
    "private definitions with exactly one reference in their own file (a word token of the name, or a qualified call to their own vocabulary)",
  );
  add(
    "closure_helpers",
    "2.5 The FL corpus",
    "single-use helpers that only bind a closure variable",
    closureHelpers,
    "private single-use words whose whole body is one quotation and that quotation uses a named input",
  );
  add(
    "small_single_use",
    "2.5 The FL corpus",
    "small single-use named helpers",
    smallSingleUse,
    `private single-use words that are not closure helpers, with a body of at most ${FIVE} tokens`,
  );
  add(
    "shuffle_per_100",
    "2.5 The FL corpus",
    "stack shuffling per 100 tokens",
    Number(
      (
        (shuffles /
          Math.max(
            1,
            perFile.reduce((n, p) => n + p.tokens.filter((t) => t.kind !== "header").length, 0),
          )) *
        100
      ).toFixed(2),
    ),
    "dup drop swap over rot -rot nip tuck dup2 drop2 occurrences per 100 reader tokens",
  );
  add(
    "zero_input_words",
    "2.5 The FL corpus",
    "zero-input words (not MEMO:) with an output",
    zeroInputWords,
    "`: name ( -- … )` with at least one output",
  );
  add(
    "zero_input_rebuilding",
    "2.5 The FL corpus",
    "of which build a literal on each call",
    zeroInputRebuilding,
    "the body holds a list, record or byte literal",
  );
  add(
    "zero_input_memo",
    "2.5 The FL corpus",
    "zero-input MEMO: words",
    zeroInputMemo,
    "MEMO: definitions with no input",
  );
  add(
    "constants",
    "2.5 The FL corpus",
    "CONSTANT definitions",
    constants,
    "uses of the word CONSTANT",
  );
  add("variables", "2.5 The FL corpus", "VARIABLE uses", variables, "uses of the word VARIABLE");
  const topVars = [...variablesByFile]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, FIVE);
  add(
    "variables_top5",
    "2.5 The FL corpus",
    "VARIABLE uses in the five busiest files",
    topVars.reduce((n, v) => n + v.count, 0),
    `the five files with most VARIABLE uses: ${topVars.map((v) => `${v.name} ${v.count}`).join(", ")}`,
  );
  add("try_uses", "2.5 The FL corpus", "try uses", tries, "the word token `try`");
  add(
    "raise_calls",
    "2.5 The FL corpus",
    "qualified raise: calls",
    raiseCalls,
    "qualified words with vocabulary raise",
  );
  add(
    "choice_headers",
    "2.5 The FL corpus",
    "choice{} occurrences in headers",
    choiceOccurrences,
    "each `choice{…}` in a stack-effect header, counted per occurrence",
  );
  add(
    "choice_distinct",
    "2.5 The FL corpus",
    "distinct choice{} lists",
    choiceCount.size,
    "distinct text between the braces",
  );
  add(
    "choice_copies",
    "2.5 The FL corpus",
    "choice{} occurrences whose list recurs",
    [...choiceCount.values()].filter((n) => n > 1).reduce((a, b) => a + b, 0),
    "occurrences whose list text appears in more than one occurrence",
  );
  add(
    "choice_repeats",
    "2.5 The FL corpus",
    "choice{} occurrences beyond the first of their list",
    choiceOccurrences - choiceCount.size,
    "occurrences minus distinct lists",
  );
  add(
    "choice_defs_with_header",
    "2.5 The FL corpus",
    "definitions with a choice{} header",
    choiceDefs,
    "definitions whose header holds at least one choice{}",
  );
  add(
    "choice_case_tables",
    "11.2 Group L-B",
    "`} case` tables",
    choiceCaseTables,
    "a `case` word directly after a closing brace (a value table, LANGUAGE-0.3 §9.2)",
  );
  add(
    "choice_case_in_choice_words",
    "11.2 Group L-B",
    "of which in definitions with a choice{} header",
    choiceCaseTablesInChoiceWords,
    "definitions with a choice{} header whose body holds a `} case` table",
  );
  add(
    "else_if_links",
    "2.5 The FL corpus",
    "else-if links",
    elseIfLinks,
    "an `if` whose else quotation ends with another `if`",
  );
  add(
    "else_if_chains",
    "2.5 The FL corpus",
    "else-if chains",
    elseIfChains,
    "outermost `if` of a chain of at least two links",
  );
  add(
    "else_if_depth3",
    "2.5 The FL corpus",
    "else-if chains of depth 3 or more",
    elseIfDepth3,
    "chains counting the outermost `if` as depth 1",
  );
  add(
    "else_if_max",
    "2.5 The FL corpus",
    "deepest else-if chain",
    maxChainDepth,
    "maximum depth counted as above",
  );
  add(
    "reduce_callers",
    "11.5 The fixes",
    "definitions that call reduce",
    reduceCallers,
    "definitions whose body holds the word reduce",
  );
  add("reduce_sites", "11.5 The fixes", "reduce call sites", reduceSites, "word tokens reduce");
  add(
    "reduce_files",
    "11.5 The fixes",
    "files calling reduce",
    reduceFiles.size,
    "files with a reduce word token",
  );
  add(
    "json_files",
    "14.1 The table",
    "files that call json:",
    jsonFiles,
    "files, other than json.fth, with a json-qualified word",
  );
  add(
    "json_occurrences",
    "14.1 The table",
    "json-qualified word uses",
    jsonOccurrences,
    "qualified words with vocabulary json",
  );
  add(
    "json_null_lines",
    "14.1 The table",
    "lines with json:null or json:null?",
    jsonNullLines,
    "distinct (file, line) pairs holding json:null or json:null?",
  );
  add(
    "json_null_files",
    "14.1 The table",
    "files with json:null or json:null?",
    jsonNullFiles.size,
    "files holding json:null or json:null?",
  );

  // util (§2.5)
  const utilEntries = [...utilCalls.entries()].sort(
    (a, b) => b[1].calls - a[1].calls || a[0].localeCompare(b[0]),
  );
  const usedBy3 = utilEntries.filter(([, e]) => e.vocabs.size >= 3).length;
  const top = utilEntries
    .slice(0, 6)
    .map(([name, e]) => `${name} ${e.calls}`)
    .join(", ");
  add(
    "util_public",
    "2.5 The FL corpus",
    "util public words",
    utilPublic,
    "definitions of vocab/util.fth whose name does not start with `_`",
  );
  add(
    "util_used_by_3",
    "2.5 The FL corpus",
    "util words used by three or more vocabularies",
    usedBy3,
    "util: names called from at least three other vocabularies",
  );
  add(
    "util_top",
    "2.5 The FL corpus",
    "most-called util words",
    top,
    "util: calls, from other vocabularies, the six most called",
  );

  // W_SHADOW (LANGUAGE-0.3 §14.1)
  add(
    "w_shadow_locals",
    "14.1 The table",
    "W_SHADOW locals of the 35 new core names",
    shadowOccurrences,
    "named inputs and `:>` bindings named as one of the 35 new core words, in files that do not define the word themselves",
  );
  add(
    "w_shadow_files",
    "14.1 The table",
    "files with such locals",
    shadowFiles.size,
    "distinct files of the locals above",
  );
  add(
    "w_shadow_names",
    "14.1 The table",
    "distinct names of such locals",
    shadowNames.size,
    "distinct names of the locals above",
  );
  add(
    "w_shadow_already",
    "14.1 The table",
    "locals of those names already shadowing an own word",
    shadowAlreadyOwn,
    "the same names where the file defines the word itself (not counted above, as the warning is drawn already)",
  );
  add(
    "w_shadow_by_name",
    "14.1 The table",
    "locals per name",
    [...shadowNames.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([n, c]) => `${n} ${c}`)
      .join(", ") || "none",
    "the locals above, per name",
  );

  // primitives (§2.5)
  const primModules = input.primFiles.filter((f) => /\bdefinePrimitive\(/.test(f.text));
  let primCountAll = 0;
  let nobleFiles = 0;
  let nobleCount = 0;
  let primLines = 0;
  let primCode = 0;
  for (const f of input.primFiles) {
    primLines += lineCount(f.text);
    primCode += codeLineCount(f.text);
    const n = [...f.text.matchAll(/\bdefinePrimitive\(/g)].length;
    primCountAll += n;
    if (/from "@noble\//.test(f.text)) {
      nobleFiles++;
      nobleCount += n;
    }
  }
  add(
    "prim_files",
    "2.5 The FL corpus",
    "primitive files",
    input.primFiles.length,
    "src/prims/*.ts, tests excluded",
  );
  add(
    "prim_modules",
    "2.5 The FL corpus",
    "primitive modules (files with a definePrimitive)",
    primModules.length,
    "files of src/prims with at least one definePrimitive( call",
  );
  add(
    "primitives",
    "2.5 The FL corpus",
    "primitives",
    primCountAll,
    "definePrimitive( calls in src/prims",
  );
  add(
    "prim_lines",
    "2.5 The FL corpus",
    "TypeScript lines of the primitive files",
    primLines,
    "physical lines of src/prims/*.ts (tests excluded)",
  );
  add(
    "prim_code_lines",
    "2.5 The FL corpus",
    "code lines of the primitive files",
    primCode,
    "lines that are neither blank nor comment-only",
  );
  add(
    "prim_noble_files",
    "2.5 The FL corpus",
    "primitive files importing @noble",
    nobleFiles,
    "files with an import from @noble/",
  );
  add(
    "prim_noble",
    "2.5 The FL corpus",
    "primitives in those files",
    nobleCount,
    "definePrimitive( calls in those files (the audited-library wrappers of §2.5)",
  );

  return out;
}

/** The figures of the survey that the measures cannot reproduce, and why. Printed under the table. */
export const NOT_MEASURED: readonly string[] = [
  "184 'not yet' ops and their triage (§2.1): a classification by the orchestrator, not a property of the tree.",
  "The 119 primitives by reason (§2.5 table): needs a judgement per primitive; only the audited-library wrappers are measured.",
  "The 53 own cipher and hash cores, their 3,626 code lines, the 13 host-capability and 9 stateful primitives: needs the same judgement.",
  "TEA 478 and SHA-1 186 VM steps per byte, RC4 80 steps per byte, html:decode about 5 ms per call, the CRC table about 20,000 steps per call, about 1 ms per caught error: these need running the VM and timing it.",
  "Today's W_SHADOW warnings from the compiler: needs the runtime's warning list; the count above is static.",
  "The 3.5 shuffles per 100 tokens and the 84 and 221 helper counts of the survey are re-measured here; the survey's own token and helper definitions are not in the TOOLKIT text, so the definitions above are L1's choice.",
  "The 88 callers of reduce (§11.5): re-measured as definitions calling reduce; the survey's count is not reproduced by its definition.",
];

/** Renders the measures as the Markdown report, one table per section. */
export function renderMarkdown(measures: readonly Measure[], command: string): string {
  const lines: string[] = [];
  lines.push("# FL corpus statistics");
  lines.push("");
  lines.push(`Command: \`${command}\``);
  lines.push("");
  lines.push(
    "Every value is counted from the tree by `packages/ops/scripts/corpus-stats.ts`. The definition of each is in the right-hand column.",
  );
  lines.push("");
  const sections = new Map<string, Measure[]>();
  for (const m of measures) sections.set(m.section, [...(sections.get(m.section) ?? []), m]);
  for (const [section, rows] of sections) {
    lines.push(`## ${section}`);
    lines.push("");
    lines.push("| Measure | Value | Definition |");
    lines.push("|---|---:|---|");
    for (const m of rows) {
      const v = typeof m.value === "number" ? m.value.toLocaleString("en-US") : m.value;
      lines.push(`| ${m.label} | ${v} | ${m.definition.replaceAll("|", "\\|")} |`);
    }
    lines.push("");
  }
  lines.push("## Not measured");
  lines.push("");
  for (const n of NOT_MEASURED) lines.push(`- ${n}`);
  lines.push("");
  return lines.join("\n");
}

/** The package root: this file is in `scripts/` or `dist-scripts/`, one level below it. */
function packageRoot(): string {
  return resolve(fileURLToPath(import.meta.url), "..", "..");
}

function filesIn(dir: string, keep: (name: string) => boolean): CorpusFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(keep)
    .sort()
    .map((name) => ({ name, text: readFileSync(`${dir}/${name}`, "utf8") }));
}

/** Reads the corpus of the package at `root`. Needs `dist/` for the catalogue and `INTERNAL_VOCABS`. */
export async function readCorpus(root: string): Promise<CorpusInput> {
  const dist = `${root}/dist`;
  if (!existsSync(`${dist}/types.js`)) {
    throw new Error("dist/ is not built: run npm run build -w @forge/ops first");
  }
  const types = (await import(pathToFileURL(`${dist}/types.js`).href)) as {
    INTERNAL_VOCABS: string[];
  };
  const catalogueFile = `${dist}/catalogue.json`;
  let ops: CatalogueOpRef[] | undefined;
  if (existsSync(catalogueFile)) {
    const cat = JSON.parse(readFileSync(catalogueFile, "utf8")) as {
      ops: { qname: string; vocab: string }[];
    };
    ops = cat.ops.map((o) => ({ qname: o.qname, vocab: o.vocab }));
  }
  const prims = filesIn(
    `${root}/src/prims`,
    (n) => n.endsWith(".ts") && !n.endsWith(".test.ts") && !n.endsWith(".d.ts"),
  );
  return {
    vocabFiles: filesIn(`${root}/vocab`, (n) => n.endsWith(".fth")),
    vectorFiles: filesIn(`${root}/vocab`, (n) => n.endsWith(".test.json")),
    primFiles: prims,
    internalVocabs: [...types.INTERNAL_VOCABS],
    ...(ops === undefined ? {} : { ops }),
  };
}

async function main(): Promise<void> {
  const json = process.argv.includes("--json");
  const root = packageRoot();
  const measures = measureCorpus(await readCorpus(root));
  if (json) {
    process.stdout.write(`${JSON.stringify(measures, null, 2)}\n`);
  } else {
    process.stdout.write(
      renderMarkdown(
        measures,
        "npm run --silent corpus-stats -w @forge/ops > docs/research/corpus-baseline-2026-11-24.md",
      ),
    );
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
