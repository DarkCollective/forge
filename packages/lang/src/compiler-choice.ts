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
 * Shared choice types (LANGUAGE-0.2.md section 4): reading the `CHOICE:` form, building the type
 * entry, resolving `choice<…>` references while a header is parsed, and deriving what a word takes
 * from the types its header used (the extra hash lines and `discovery.optionDocs`).
 *
 * The compiler calls into this file through small hooks; nothing here executes FL.
 */
import { ForgeError } from "./errors.js";
import type {
  ChoiceResolver,
  ChoiceTypeEntry,
  DictionaryTxn,
  ErrorCode,
  Scope,
  Sha256Fn,
  SourceInfo,
  SourcePos,
  Token,
} from "./types.js";
import { cpLength, optionsText } from "./values.js";

/** At most this many options in one shared type (LANGUAGE-0.2.md Q9). */
export const CHOICE_OPTIONS_MAX = 1024;
/** At most this many code points in one option of a shared type (Q9). */
export const CHOICE_OPTION_MAX = 128;
/** At most this many code points in the help text of one option (the `TEXT_MAX` of `param`). */
export const CHOICE_HELP_MAX = 200;

// eslint-disable-next-line no-control-regex
const C0 = /[\u0000-\u001f]/;

type WordToken = Extract<Token, { kind: "word" }>;

/** The part of the compiler the `CHOICE:` reader needs. */
export interface ChoiceFormHost {
  next(): Token;
  fail(
    code: ErrorCode,
    message: string,
    pos: SourcePos | null,
    word?: string | null,
    detail?: Record<string, unknown>,
  ): never;
  syntax(t: Token, expected: string, word?: string | null): never;
  /** The type name operand: a valid, non-reserved word name (E_NAME otherwise). */
  nameOperand(what: string): WordToken;
}

export interface ChoiceForm {
  readonly nameTok: WordToken;
  readonly options: readonly string[];
  readonly docs: Readonly<Record<string, string>>;
  /** Position just after the closing `;`. */
  readonly end: SourcePos;
}

/** Sets an own data property, also for the key `__proto__`. */
function setOwn<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/**
 * Reads `CHOICE: name { option opt [help] ; } ;` with the cursor on the `CHOICE:` keyword.
 * Malformed structure is E_SYNTAX; a bad `option` clause (arity, kind, empty, duplicate, a cap) is
 * E_META with `detail.clause = "option"`; a type name with `<` or `>` is E_NAME.
 */
export function readChoiceForm(host: ChoiceFormHost): ChoiceForm {
  host.next();
  const nameTok = host.nameOperand("CHOICE:");
  if (/[<>]/.test(nameTok.text)) {
    host.fail(
      "E_NAME",
      `'${nameTok.text}' is not a valid choice type name ('<' and '>' are not allowed)`,
      nameTok.pos,
      null,
      { name: nameTok.text },
    );
  }
  const qn = nameTok.text;
  const options: string[] = [];
  const docs: Record<string, string> = {};
  for (;;) {
    const kw = host.next();
    if (kw.kind === "eof") host.syntax(kw, "';' to end CHOICE:", qn);
    if (kw.kind === "word" && kw.text === ";") {
      if (options.length === 0) {
        host.fail("E_META", `CHOICE: '${qn}' needs at least one option clause`, kw.pos, null, {
          clause: "option",
        });
      }
      return { nameTok, options, docs, end: kw.end };
    }
    if (kw.kind !== "word" || kw.text !== "option") {
      host.syntax(kw, "'option' or ';' in CHOICE:", qn);
    }
    const bad = (why: string): never =>
      host.fail("E_META", `CHOICE: '${qn}': ${why}`, kw.pos, null, { clause: "option" });
    const args: Token[] = [];
    for (;;) {
      const a = host.next();
      if (a.kind === "eof") host.syntax(a, "';' to end the option clause", qn);
      if (a.kind === "word" && a.text === ";") break;
      args.push(a);
    }
    const first = args[0];
    if (first === undefined || args.length > 2) {
      bad("'option' takes an option and an optional help string");
    }
    const optTok = first as Token;
    let option = "";
    if (optTok.kind === "str") option = optTok.value;
    else if (optTok.kind === "word" || optTok.kind === "int") option = optTok.text;
    else bad("an option is a word, an integer or a string");
    const helpTok = args[1];
    if (helpTok !== undefined && helpTok.kind !== "str") bad("the option help must be a string");
    if (option === "") bad("an option may not be empty");
    if (cpLength(option) > CHOICE_OPTION_MAX) {
      bad(`an option is at most ${CHOICE_OPTION_MAX} code points`);
    }
    if (options.includes(option)) bad(`duplicate option '${option}'`);
    if (options.length >= CHOICE_OPTIONS_MAX) {
      bad(`a choice type has at most ${CHOICE_OPTIONS_MAX} options`);
    }
    if (helpTok !== undefined) {
      const help = (helpTok as Extract<Token, { kind: "str" }>).value;
      if (C0.test(help)) bad("option help must be a single line without control characters");
      if (cpLength(help) > CHOICE_HELP_MAX) {
        bad(`option help is at most ${CHOICE_HELP_MAX} code points`);
      }
      setOwn(docs, option, help);
    }
    options.push(option);
  }
}

/** SHA-256 (hex) of the canonical option rendering `{a|b|c}` (the part of a type a word's hash covers). */
export function choiceTypeHash(options: readonly string[], sha256: Sha256Fn): string {
  return sha256(optionsText(options));
}

export function makeChoiceEntry(
  vocab: string,
  form: ChoiceForm,
  source: SourceInfo,
  sha256: Sha256Fn,
): ChoiceTypeEntry {
  const name = form.nameTok.text;
  return {
    qname: `${vocab}:${name}`,
    name,
    vocab,
    options: Object.freeze([...form.options]),
    docs: Object.freeze({ ...form.docs }),
    hash: choiceTypeHash(form.options, sha256),
    source,
  };
}

/** A `choice<…>` reference met while a header was parsed. */
export interface ChoiceRef {
  /** Offset of the header item (`name:choice<…>`) that holds the reference. */
  readonly offset: number;
  readonly entry: ChoiceTypeEntry;
}

/**
 * The resolver handed to `parseHeader`: `name` resolves through the scope (current vocabulary, then
 * imports), `vocab:name` through exactly that vocabulary. Every hit is appended to `refs`. An error
 * gets the position of the header item.
 */
export function makeChoiceResolver(
  txn: DictionaryTxn,
  scope: Scope,
  refs: ChoiceRef[],
): ChoiceResolver {
  return (ref, pos) => {
    const colon = ref.indexOf(":");
    let entry: ChoiceTypeEntry;
    try {
      entry =
        colon < 0
          ? txn.resolveChoice(ref, scope)
          : txn.resolveChoiceQualified(ref.slice(0, colon), ref.slice(colon + 1), scope.current);
    } catch (e) {
      if (e instanceof ForgeError)
        throw e.with({ pos: e.pos ?? pos, vocab: e.vocab ?? scope.current });
      throw e;
    }
    refs.push({ offset: pos.offset, entry });
    return entry;
  };
}

/** What a word takes from the shared types its header referenced. */
export interface ChoiceUse {
  /** Distinct `ChoiceTypeEntry.hash` values (unsorted); input to `computeHash`. */
  readonly hashes: readonly string[];
  /** `discovery.optionDocs`: parameter name to option to help, only parameters with help. */
  readonly optionDocs: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/**
 * `inputs[i]` are the named-input records of the header in order (`offset` of the item and the
 * parameter `name`, null when anonymous); the data input (index 0) is not a parameter.
 */
export function choiceUse(
  refs: readonly ChoiceRef[],
  inputs: readonly { readonly offset: number; readonly name: string | null }[],
): ChoiceUse {
  const optionDocs: Record<string, Record<string, string>> = {};
  const hashes = new Set<string>();
  for (const r of refs) {
    hashes.add(r.entry.hash);
    const i = inputs.findIndex((x) => x.offset === r.offset);
    const slot = inputs[i];
    if (i < 1 || slot === undefined || slot.name === null) continue;
    const docs: Record<string, string> = {};
    for (const o of r.entry.options) {
      const d = Object.getOwnPropertyDescriptor(r.entry.docs, o)?.value as string | undefined;
      if (d !== undefined) setOwn(docs, o, d);
    }
    if (Object.keys(docs).length > 0) optionDocs[slot.name] = docs;
  }
  return { hashes: [...hashes], optionDocs };
}
