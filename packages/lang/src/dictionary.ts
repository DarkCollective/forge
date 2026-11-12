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
/**
 * The FL dictionary: vocabularies, word entries, name resolution and transactions (spec section 6).
 *
 * Resolution is early-binding: `define` never mutates an existing entry object, it only rebinds the
 * name, so code compiled against the old entry keeps calling it. All changes go through a
 * `DictionaryTxn`; nothing is visible in the committed dictionary until `commit`.
 */
import { ForgeError } from "./errors.js";
import type {
  ChoiceTypeEntry,
  Dictionary,
  DictionaryTxn,
  DictionaryView,
  Scope,
  Vocabulary,
  WordEntry,
  WordMeta,
} from "./types.js";
import { cpCompare } from "./values.js";

/** Name of the always-present, read-only core vocabulary. */
export const CORE_VOCAB = "core";

/** A word is private when its name starts with `_` (spec section 5.7). */
export function isPrivateName(name: string): boolean {
  return name.startsWith("_");
}

/** What name resolution needs from either the committed dictionary or a transaction. */
interface Source {
  hasVocab(vocab: string): boolean;
  lookup(vocab: string, name: string): WordEntry | undefined;
  lookupChoice(vocab: string, name: string): ChoiceTypeEntry | undefined;
}

function resolveIn(src: Source, name: string, scope: Scope): WordEntry {
  // Step 2: the current vocabulary (public or private) shadows everything.
  const own = src.lookup(scope.current, name);
  if (own !== undefined) return own;

  // Step 3: imports. `core` is implicitly last, so listing it here is ignored; repeats are ignored.
  const privateName = isPrivateName(name);
  const candidates: string[] = [];
  let found: WordEntry | undefined;
  if (!privateName) {
    const seen = new Set<string>();
    for (const u of scope.using) {
      if (u === CORE_VOCAB || seen.has(u)) continue;
      seen.add(u);
      const hit = src.lookup(u, name);
      if (hit !== undefined) {
        candidates.push(`${u}:${name}`);
        found = hit;
      }
    }
  }
  if (candidates.length > 1) {
    throw new ForgeError({
      code: "E_AMBIGUOUS",
      message: `ambiguous name '${name}': found in ${candidates.join(", ")}; write vocab:${name}`,
      detail: { name, candidates },
    });
  }
  if (found !== undefined) return found;

  // Step 4: core (public words only).
  const core = privateName ? undefined : src.lookup(CORE_VOCAB, name);
  if (core !== undefined) return core;

  throw new ForgeError({
    code: "E_UNDEFINED",
    message: `undefined word '${name}'`,
    detail: { name, vocab: scope.current },
  });
}

function resolveQualifiedIn(src: Source, vocab: string, name: string, from: string): WordEntry {
  if (!src.hasVocab(vocab)) {
    throw new ForgeError({
      code: "E_NO_VOCAB",
      message: `no such vocabulary '${vocab}'`,
      detail: { vocab },
    });
  }
  const entry = src.lookup(vocab, name);
  if (entry === undefined) {
    throw new ForgeError({
      code: "E_UNDEFINED",
      message: `undefined word '${vocab}:${name}'`,
      detail: { name, vocab },
    });
  }
  if (isPrivateName(name) && from !== vocab) {
    throw new ForgeError({
      code: "E_PRIVATE",
      message: `'${vocab}:${name}' is private to vocabulary '${vocab}'`,
      detail: { name },
    });
  }
  return entry;
}

/** Choice types resolve like words (section 6.2) but only in the current vocabulary and the imports. */
function resolveChoiceIn(src: Source, name: string, scope: Scope): ChoiceTypeEntry {
  const own = src.lookupChoice(scope.current, name);
  if (own !== undefined) return own;
  const candidates: string[] = [];
  let found: ChoiceTypeEntry | undefined;
  if (!isPrivateName(name)) {
    const seen = new Set<string>();
    for (const u of scope.using) {
      if (u === CORE_VOCAB || seen.has(u)) continue;
      seen.add(u);
      const hit = src.lookupChoice(u, name);
      if (hit !== undefined) {
        candidates.push(`${u}:${name}`);
        found = hit;
      }
    }
  }
  if (candidates.length > 1) {
    throw new ForgeError({
      code: "E_AMBIGUOUS",
      message: `ambiguous choice type '${name}': found in ${candidates.join(", ")}; write choice<vocab:${name}>`,
      detail: { name, candidates, kind: "choice" },
    });
  }
  if (found !== undefined) return found;
  throw new ForgeError({
    code: "E_UNDEFINED",
    message: `undefined choice type '${name}'`,
    detail: { name, vocab: scope.current, kind: "choice" },
  });
}

function resolveChoiceQualifiedIn(
  src: Source,
  vocab: string,
  name: string,
  from: string,
): ChoiceTypeEntry {
  if (!src.hasVocab(vocab)) {
    throw new ForgeError({
      code: "E_NO_VOCAB",
      message: `no such vocabulary '${vocab}'`,
      detail: { vocab },
    });
  }
  const entry = src.lookupChoice(vocab, name);
  if (entry === undefined) {
    throw new ForgeError({
      code: "E_UNDEFINED",
      message: `undefined choice type '${vocab}:${name}'`,
      detail: { name, vocab, kind: "choice" },
    });
  }
  if (isPrivateName(name) && from !== vocab) {
    throw new ForgeError({
      code: "E_PRIVATE",
      message: `choice type '${vocab}:${name}' is private to vocabulary '${vocab}'`,
      detail: { name, kind: "choice" },
    });
  }
  return entry;
}

interface MutableVocab {
  readonly name: string;
  readonly readonly: boolean;
  readonly words: Map<string, WordEntry>;
  readonly choices: Map<string, ChoiceTypeEntry>;
}

class Store implements Dictionary, Source {
  readonly vocabMap = new Map<string, MutableVocab>([
    [CORE_VOCAB, { name: CORE_VOCAB, readonly: true, words: new Map(), choices: new Map() }],
  ]);

  hasVocab(vocab: string): boolean {
    return this.vocabMap.has(vocab);
  }

  lookup(vocab: string, name: string): WordEntry | undefined {
    return this.vocabMap.get(vocab)?.words.get(name);
  }

  lookupChoice(vocab: string, name: string): ChoiceTypeEntry | undefined {
    return this.vocabMap.get(vocab)?.choices.get(name);
  }

  vocab(name: string): Vocabulary | undefined {
    return this.vocabMap.get(name);
  }

  vocabs(): readonly string[] {
    return [...this.vocabMap.keys()].sort(cpCompare);
  }

  resolve(name: string, scope: Scope): WordEntry {
    return resolveIn(this, name, scope);
  }

  resolveQualified(vocab: string, name: string, from: string): WordEntry {
    return resolveQualifiedIn(this, vocab, name, from);
  }

  resolveChoice(name: string, scope: Scope): ChoiceTypeEntry {
    return resolveChoiceIn(this, name, scope);
  }

  resolveChoiceQualified(vocab: string, name: string, from: string): ChoiceTypeEntry {
    return resolveChoiceQualifiedIn(this, vocab, name, from);
  }

  begin(): DictionaryTxn {
    return new Txn(this);
  }
}

class Txn implements DictionaryTxn, Source {
  /** Vocabularies created in this transaction. */
  private readonly newVocabs = new Set<string>();
  /** Staged bindings per vocabulary (for committed and new vocabularies alike). */
  private readonly overlay = new Map<string, Map<string, WordEntry>>();
  /** Staged choice types per vocabulary. */
  private readonly choiceOverlay = new Map<string, Map<string, ChoiceTypeEntry>>();
  /** `vocab\0name` keys bound (by define or alias) within this transaction. */
  private readonly bound = new Set<string>();
  /** `vocab\0name` keys of choice types defined within this transaction. */
  private readonly boundChoices = new Set<string>();
  /** Entries defined with `trusted`, whose aliases may also go into a read-only vocabulary. */
  private readonly trusted = new Set<WordEntry>();
  private readonly metaEdits: { entry: WordEntry; meta: WordMeta }[] = [];
  private closed = false;

  constructor(private readonly store: Store) {}

  private assertOpen(): void {
    if (this.closed) {
      throw new ForgeError({
        code: "E_INTERNAL",
        message: "dictionary transaction already committed or rolled back",
      });
    }
  }

  private isReadonly(vocab: string): boolean {
    return this.store.vocabMap.get(vocab)?.readonly === true;
  }

  hasVocab(vocab: string): boolean {
    return this.newVocabs.has(vocab) || this.store.hasVocab(vocab);
  }

  lookup(vocab: string, name: string): WordEntry | undefined {
    return this.overlay.get(vocab)?.get(name) ?? this.store.lookup(vocab, name);
  }

  lookupChoice(vocab: string, name: string): ChoiceTypeEntry | undefined {
    return this.choiceOverlay.get(vocab)?.get(name) ?? this.store.lookupChoice(vocab, name);
  }

  private snapshot(name: string): Vocabulary {
    const base = this.store.vocabMap.get(name);
    const staged = this.overlay.get(name);
    const stagedChoices = this.choiceOverlay.get(name);
    if (staged === undefined && stagedChoices === undefined && base !== undefined) return base;
    const words = new Map(base?.words);
    for (const [k, v] of staged ?? []) words.set(k, v);
    const choices = new Map(base?.choices);
    for (const [k, v] of stagedChoices ?? []) choices.set(k, v);
    return { name, readonly: base?.readonly === true, words, choices };
  }

  vocab(name: string): Vocabulary | undefined {
    return this.hasVocab(name) ? this.snapshot(name) : undefined;
  }

  vocabs(): readonly string[] {
    return [...new Set([...this.store.vocabMap.keys(), ...this.newVocabs])].sort(cpCompare);
  }

  resolve(name: string, scope: Scope): WordEntry {
    return resolveIn(this, name, scope);
  }

  resolveQualified(vocab: string, name: string, from: string): WordEntry {
    return resolveQualifiedIn(this, vocab, name, from);
  }

  resolveChoice(name: string, scope: Scope): ChoiceTypeEntry {
    return resolveChoiceIn(this, name, scope);
  }

  resolveChoiceQualified(vocab: string, name: string, from: string): ChoiceTypeEntry {
    return resolveChoiceQualifiedIn(this, vocab, name, from);
  }

  ensureVocab(name: string): Vocabulary {
    this.assertOpen();
    if (!this.hasVocab(name)) this.newVocabs.add(name);
    return this.snapshot(name);
  }

  private bind(vocab: string, name: string, entry: WordEntry): void {
    let staged = this.overlay.get(vocab);
    if (staged === undefined) {
      staged = new Map();
      this.overlay.set(vocab, staged);
    }
    staged.set(name, entry);
    this.bound.add(`${vocab}\0${name}`);
  }

  define(
    entry: WordEntry,
    opts?: { readonly trusted?: boolean; readonly allowRedefine?: boolean },
  ): WordEntry | undefined {
    this.assertOpen();
    const { vocab, name } = entry;
    if (this.isReadonly(vocab) && opts?.trusted !== true) {
      throw readonlyError(vocab);
    }
    if (this.bound.has(`${vocab}\0${name}`) && opts?.allowRedefine !== true) {
      throw redefinedError(vocab, name);
    }
    this.ensureVocab(vocab);
    const replaced = this.lookup(vocab, name);
    this.bind(vocab, name, entry);
    if (opts?.trusted === true) this.trusted.add(entry);
    return replaced;
  }

  defineChoice(
    entry: ChoiceTypeEntry,
    opts?: { readonly trusted?: boolean; readonly allowRedefine?: boolean },
  ): ChoiceTypeEntry | undefined {
    this.assertOpen();
    const { vocab, name } = entry;
    if (this.isReadonly(vocab) && opts?.trusted !== true) {
      throw readonlyError(vocab);
    }
    const key = `${vocab}\0${name}`;
    if (this.boundChoices.has(key) && opts?.allowRedefine !== true) {
      throw redefinedError(vocab, name, "choice type");
    }
    this.ensureVocab(vocab);
    const replaced = this.lookupChoice(vocab, name);
    let staged = this.choiceOverlay.get(vocab);
    if (staged === undefined) {
      staged = new Map();
      this.choiceOverlay.set(vocab, staged);
    }
    staged.set(name, entry);
    this.boundChoices.add(key);
    return replaced;
  }

  alias(entry: WordEntry, aliasName: string): void {
    this.assertOpen();
    const { vocab } = entry;
    if (this.isReadonly(vocab) && !this.trusted.has(entry)) throw readonlyError(vocab);
    if (this.bound.has(`${vocab}\0${aliasName}`)) throw redefinedError(vocab, aliasName);
    this.ensureVocab(vocab);
    this.bind(vocab, aliasName, entry);
  }

  stageMeta(entry: WordEntry, meta: WordMeta): void {
    this.assertOpen();
    this.metaEdits.push({ entry, meta });
  }

  commit(): void {
    this.assertOpen();
    this.closed = true;
    const vocabMap = this.store.vocabMap;
    for (const name of this.newVocabs) {
      vocabMap.set(name, { name, readonly: false, words: new Map(), choices: new Map() });
    }
    for (const [vocab, staged] of this.overlay) {
      // Every staged vocabulary exists: define/alias call ensureVocab first.
      const target = vocabMap.get(vocab) as MutableVocab;
      for (const [name, entry] of staged) target.words.set(name, entry);
    }
    for (const [vocab, staged] of this.choiceOverlay) {
      const target = vocabMap.get(vocab) as MutableVocab;
      for (const [name, entry] of staged) target.choices.set(name, entry);
    }
    for (const { entry, meta } of this.metaEdits) entry.meta = meta;
  }

  rollback(): void {
    this.assertOpen();
    this.closed = true;
  }
}

function readonlyError(vocab: string): ForgeError {
  return new ForgeError({
    code: "E_READONLY",
    message: `vocabulary '${vocab}' is read-only`,
    detail: { vocab },
  });
}

function redefinedError(vocab: string, name: string, what?: string): ForgeError {
  return new ForgeError({
    code: "E_REDEFINED",
    message: `${what === undefined ? "" : `${what} `}'${name}' is already defined in vocabulary '${vocab}' in this unit`,
    detail: what === undefined ? { name, vocab } : { name, vocab, kind: "choice" },
  });
}

/** A new dictionary containing only the empty, read-only `core` vocabulary. */
export function createDictionary(): Dictionary {
  return new Store();
}

/**
 * Names of the public words of a vocabulary (aliases included), sorted by code point.
 * Private words are excluded (spec section 5.7). Throws E_NO_VOCAB for an unknown vocabulary.
 */
export function listWords(view: DictionaryView, vocab: string): string[] {
  const v = view.vocab(vocab);
  if (v === undefined) {
    throw new ForgeError({
      code: "E_NO_VOCAB",
      message: `no such vocabulary '${vocab}'`,
      detail: { vocab },
    });
  }
  return [...v.words.keys()].filter((n) => !isPrivateName(n)).sort(cpCompare);
}
