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
 * The vocabulary scanner (RECIPES.md section 2.4): a pure function over the `.fth` sources and the
 * names of the primitive modules. It checks what can be checked from tokens and orders the units
 * so that a unit comes after every unit it depends on.
 */
import { CORE_VOCAB, cpCompare, isVocabName, read } from "@forge/lang";
import type { Token } from "@forge/lang";
import type { ScanVocabFn, VocabUnit } from "./types.js";

const USER_VOCAB = "user";
const FTH_SUFFIX = ".fth";

function sorted(names: Iterable<string>): string[] {
  return [...names].sort(cpCompare);
}

function tokenise(file: string, source: string): Token[] {
  try {
    return read(source);
  } catch (e) {
    // read only throws ForgeError (E_LEX, E_LIMIT_SOURCE, E_LIMIT_VALUE)
    throw new Error(`${file}: ${(e as Error).message}`, { cause: e });
  }
}

/** A string literal of a header: `"…"` with `\` escapes. */
const HEADER_STRING = /"(?:[^"\\]|\\.)*"/gs;
/** The `vocab` of a `name:choice<vocab:type>` reference (LANGUAGE-0.2.md section 4). */
const CHOICE_REF = /(?<=:)choice<([A-Za-z][A-Za-z0-9_-]{0,63}):[^>\s]*>/g;

/** Vocabularies named by `choice<vocab:name>` references in the raw text of a header. */
function choiceVocabs(headerText: string): string[] {
  const code = headerText.replace(HEADER_STRING, '""');
  return [...code.matchAll(CHOICE_REF)].map((m) => m[1] as string);
}

interface Parsed {
  /** Vocabularies named by `USING:` forms and `vocab:word` tokens, in no particular order. */
  readonly mentioned: Set<string>;
}

function inspect(file: string, vocab: string, tokens: readonly Token[]): Parsed {
  const mentioned = new Set<string>();
  let ins = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as Token;
    if (t.kind === "qword") {
      mentioned.add(t.vocab);
    } else if (t.kind === "header") {
      for (const v of choiceVocabs(t.headerText)) mentioned.add(v);
    } else if (t.kind === "word") {
      switch (t.text) {
        case "IN:": {
          ins++;
          const name = tokens[i + 1];
          if (name === undefined || name.kind !== "word" || name.text !== vocab) {
            const found = name !== undefined && name.kind === "word" ? name.text : "nothing";
            throw new Error(`${file}: IN: must name '${vocab}', found ${found}`);
          }
          break;
        }
        case "USING:": {
          for (let j = i + 1; j < tokens.length; j++) {
            const u = tokens[j] as Token;
            if (u.kind !== "word" || u.text === ";") break;
            mentioned.add(u.text);
          }
          break;
        }
        case "VOCAB":
          throw new Error(`${file}: VOCAB is not allowed in a vocabulary unit; use IN:`);
        case "PRIMITIVE":
          throw new Error(
            `${file}: PRIMITIVE is not allowed: primitives are bound by createRuntime`,
          );
        default:
          break;
      }
    }
  }
  if (ins !== 1) {
    throw new Error(`${file}: a vocabulary unit must contain exactly one IN: (found ${ins})`);
  }
  return { mentioned };
}

/** Finds a cycle among the nodes that Kahn's algorithm could not remove, and writes it `a -> b -> a`. */
function describeCycle(edges: ReadonlyMap<string, readonly string[]>, left: Set<string>): string {
  const start = sorted(left)[0] as string;
  const path: string[] = [];
  const index = new Map<string, number>();
  let node = start;
  for (;;) {
    const seen = index.get(node);
    if (seen !== undefined) return [...path.slice(seen), node].join(" -> ");
    index.set(node, path.length);
    path.push(node);
    // every remaining node still depends on a remaining node
    node = (edges.get(node) as readonly string[]).find((d) => left.has(d)) as string;
  }
}

export const scanVocab: ScanVocabFn = (files, primitiveVocabs) => {
  const primitives = new Set<string>();
  for (const name of primitiveVocabs) {
    if (!isVocabName(name) || name === CORE_VOCAB || name === USER_VOCAB) {
      throw new Error(`prims/${name}: '${name}' is not a usable vocabulary name`);
    }
    primitives.add(name);
  }

  // 1. read and check each unit
  const parsed = new Map<string, { file: string; source: string; mentioned: Set<string> }>();
  for (const file of files) {
    if (!file.name.endsWith(FTH_SUFFIX)) {
      throw new Error(`${file.name}: a vocabulary source file must end in ${FTH_SUFFIX}`);
    }
    const vocab = file.name.slice(0, -FTH_SUFFIX.length);
    if (!isVocabName(vocab) || vocab === CORE_VOCAB || vocab === USER_VOCAB) {
      throw new Error(`${file.name}: '${vocab}' is not a usable vocabulary name`);
    }
    if (parsed.has(vocab)) throw new Error(`${file.name}: vocabulary '${vocab}' is defined twice`);
    const { mentioned } = inspect(file.name, vocab, tokenise(file.name, file.text));
    parsed.set(vocab, { file: file.name, source: file.text, mentioned });
  }
  const known = new Set<string>([...parsed.keys(), ...primitives]);

  // 2. dependencies
  const deps = new Map<string, string[]>();
  for (const [vocab, p] of parsed) {
    const names = sorted(p.mentioned);
    for (const dep of names) {
      if (dep !== CORE_VOCAB && dep !== vocab && !known.has(dep)) {
        throw new Error(`unknown vocabulary '${dep}' used by ${p.file}`);
      }
    }
    deps.set(
      vocab,
      names.filter((d) => d !== CORE_VOCAB && d !== vocab),
    );
  }

  // 3. Kahn's algorithm, ties broken by vocabulary name. Dependencies without a unit (primitive
  // modules only) need no ordering.
  const order: string[] = [];
  const left = new Set<string>(parsed.keys());
  const waiting = (v: string) => (deps.get(v) as string[]).filter((d) => left.has(d));
  while (left.size > 0) {
    const next = sorted(left).find((v) => waiting(v).length === 0);
    if (next === undefined) {
      throw new Error(`vocabulary dependency cycle: ${describeCycle(deps, left)}`);
    }
    order.push(next);
    left.delete(next);
  }

  const units: VocabUnit[] = order.map((vocab) => {
    const p = parsed.get(vocab) as { file: string; source: string };
    return { vocab, name: p.file, source: p.source, deps: deps.get(vocab) as string[] };
  });
  return { units, vocabs: sorted(known) };
};
