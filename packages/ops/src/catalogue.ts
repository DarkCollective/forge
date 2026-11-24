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
 * The catalogue (RECIPES.md section 2.3): a projection of the loaded runtime's `WordMeta`.
 */
import { CORE_VOCAB, cpCompare, getExtKind, listWords, sha256 } from "@forge/lang";
import type { ForgeRuntime, WordEntry, WordMeta } from "@forge/lang";
import { isRegexPrimitive } from "./regex-engine.js";
import {
  CATALOGUE_FORMAT,
  INTERNAL_VOCABS,
  SLOT_FAMILIES,
  SLOT_KINDS,
  UI_PARAM_TYPES,
} from "./types.js";
import type {
  BuildCatalogueFn,
  Catalogue,
  CatalogueConversion,
  CatalogueOp,
  IsCatalogueOpFn,
  PinsCompat,
} from "./types.js";

/** `previousHashes` holds at most this many entries per op (RECIPES-1.2.md section 9.2). */
export const MAX_PREVIOUS_HASHES = 4;

const HASH_RE = /^[0-9a-f]{64}$/;

/**
 * Rule 4 of RECIPES.md section 2.2 for one parameter: its type is in `UI_PARAM_TYPES`, and an `ext` parameter counts
 * only when its kind is registered with a `fromText` (RECIPES-1.2.md section 3.1).
 */
function isUiParam(p: WordMeta["params"][number]): boolean {
  if (!UI_PARAM_TYPES.includes(p.type)) return false;
  if (p.type !== "ext") return true;
  return p.kind !== undefined && getExtKind(p.kind)?.fromText !== undefined;
}

/**
 * Rules 1 to 6 of RECIPES.md section 2.2 for a word reached by its canonical name. (An alias is
 * detected by `buildCatalogue`, which knows the name the word was listed under.)
 */
export const isCatalogueOp: IsCatalogueOpFn = (meta: WordMeta): boolean =>
  meta.op &&
  meta.exported &&
  !INTERNAL_VOCABS.includes(meta.vocab) &&
  (meta.kind === "fl" || meta.kind === "primitive") &&
  meta.params.every(isUiParam) &&
  meta.effect.outputs.length === 1 &&
  !meta.effect.unchecked &&
  !meta.effect.variadicInput &&
  meta.qname === `${meta.vocab}:${meta.name}`;

/**
 * Does the word, or any word it calls (transitively, FL words only), run the regex engine or a primitive that
 * declares `hardKill: true` (RECIPES-1.2.md section 19.1 a)?
 */
function reachesHardKill(runtime: ForgeRuntime, qname: string): boolean {
  const seen = new Set<string>();
  const work: WordEntry[] = [runtime.lookup(qname)];
  for (let entry = work.pop(); entry !== undefined; entry = work.pop()) {
    if (seen.has(entry.qname)) continue;
    seen.add(entry.qname);
    if (entry.kind === "primitive") {
      if (isRegexPrimitive(entry.qname)) return true;
      if (entry.def.hardKill === true) return true;
    } else if (entry.kind === "fl" && entry.code !== null) {
      work.push(...entry.code.deps);
    }
  }
  return false;
}

/**
 * The slot parameter of an op (RECIPES-1.2.md section 4.5): its first parameter's name when the data input and the first
 * parameter both have type `ext` with a kind in `SLOT_KINDS`, else `undefined`. Throws when the name is not a family name.
 */
function slotOf(meta: WordMeta): string | undefined {
  const input = meta.effect.inputs[0];
  const first = meta.params[0];
  if (input === undefined || first === undefined) return undefined;
  const isSlotKind = (t: { type: string; kind?: string }): boolean =>
    t.type === "ext" && t.kind !== undefined && SLOT_KINDS.includes(t.kind);
  if (!isSlotKind(input) || !isSlotKind(first)) return undefined;
  if (!Object.hasOwn(SLOT_FAMILIES, first.name)) {
    const names = Object.keys(SLOT_FAMILIES)
      .map((n) => `'${n}'`)
      .join(" and ");
    throw new Error(
      `${meta.qname} takes a relation as its data input and as its first parameter, so it is a slot op, ` +
        `but the parameter is named '${first.name}'; the accepted names are ${names}`,
    );
  }
  return first.name;
}

/**
 * Reads the content of `pins-compat.json` (RECIPES-1.2.md section 9.2): an object from qualified op name to a list of at
 * most 4 distinct hashes of 64 lowercase hex digits. Empty text is an empty object. Throws an `Error` naming the entry.
 */
export function parsePinsCompat(text: string): PinsCompat {
  if (text.trim() === "") return {};
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("pins-compat.json: expected an object from op name to a list of hashes");
  }
  const out: Record<string, readonly string[]> = {};
  for (const [qname, list] of Object.entries(value)) {
    if (
      !Array.isArray(list) ||
      list.length > MAX_PREVIOUS_HASHES ||
      !list.every((h) => typeof h === "string" && HASH_RE.test(h)) ||
      new Set(list).size !== list.length
    ) {
      throw new Error(
        `pins-compat.json: '${qname}' must be a list of at most ${MAX_PREVIOUS_HASHES} distinct hashes of 64 lowercase hex digits`,
      );
    }
    out[qname] = list as string[];
  }
  return out;
}

/** The name a conversion uses for one side of an op: the ext kind, else the type tag. */
function typeName(type: string, kind: string | undefined): string {
  return type === "ext" && kind !== undefined ? kind : type;
}

function checkConversions(
  conversions: readonly CatalogueConversion[],
  ops: readonly CatalogueOp[],
): void {
  const byName = new Map(ops.map((o) => [o.qname, o]));
  for (const c of conversions) {
    const label = `conversion ${c.from} -> ${c.to} (${c.op})`;
    const op = byName.get(c.op);
    if (op === undefined) throw new Error(`${label}: ${c.op} is not a catalogue operation`);
    if (typeName(op.input, op.inputKind) !== c.from) {
      throw new Error(`${label}: the data input of ${c.op} is not ${c.from}`);
    }
    if (typeName(op.output, op.outputKind) !== c.to) {
      throw new Error(`${label}: the output of ${c.op} is not ${c.to}`);
    }
    const bare = op.params.find((p) => p.required);
    if (bare !== undefined) {
      throw new Error(`${label}: parameter '${bare.name}' of ${c.op} has no default`);
    }
  }
}

/**
 * What a JSON schema cannot say about a catalogue (CR252): no op lists its own `hash` among its `previousHashes`. Returns
 * one message per violation, empty when the catalogue is sound.
 */
export function catalogueIssues(catalogue: Catalogue): string[] {
  const issues: string[] = [];
  for (const op of catalogue.ops) {
    if (op.previousHashes?.includes(op.hash) === true) {
      issues.push(`${op.qname}: previousHashes contains the current hash`);
    }
  }
  return issues;
}

export const buildCatalogue: BuildCatalogueFn = (runtime, options = {}) => {
  const bundleVocabs = options.bundleVocabs;
  const ops: CatalogueOp[] = [];
  for (const vocab of runtime.dictionary.vocabs()) {
    if (vocab === CORE_VOCAB || INTERNAL_VOCABS.includes(vocab)) continue;
    for (const name of listWords(runtime.dictionary, vocab)) {
      const meta = runtime.meta(`${vocab}:${name}`);
      // an alias is listed under its own name but resolves to the canonical entry
      if (meta.qname !== `${vocab}:${name}` || !isCatalogueOp(meta)) continue;
      if (meta.doc === null || meta.category === null) {
        const missing = meta.doc === null ? "doc" : "category";
        const message = `${meta.qname} is an operation but has no ${missing}`;
        if (bundleVocabs === undefined || bundleVocabs.includes(vocab)) throw new Error(message);
        options.warn?.(`${message}; it is not in the catalogue`);
        continue;
      }
      const input = meta.effect.inputs[0] as { type: CatalogueOp["input"]; kind?: string };
      const output = meta.effect.outputs[0] as { type: CatalogueOp["output"]; kind?: string };
      const slot = slotOf(meta);
      const previous = options.pinsCompat?.[meta.qname];
      if (
        previous !== undefined &&
        (previous.length > MAX_PREVIOUS_HASHES ||
          previous.some((h) => !HASH_RE.test(h) || h === meta.hash))
      ) {
        throw new Error(
          `${meta.qname}: previousHashes must be at most ${MAX_PREVIOUS_HASHES} hashes of 64 lowercase hex digits, none equal to the current hash`,
        );
      }
      ops.push({
        qname: meta.qname,
        name: meta.name,
        vocab: meta.vocab,
        category: meta.category,
        doc: meta.doc,
        aliases: meta.aliases,
        seeAlso: meta.seeAlso,
        input: input.type,
        ...(input.kind === undefined ? {} : { inputKind: input.kind }),
        output: output.type,
        ...(output.kind === undefined ? {} : { outputKind: output.kind }),
        effect: meta.effect.text,
        params: meta.params,
        effects: meta.effects,
        version: meta.version,
        hash: meta.hash,
        ...(previous === undefined || previous.length === 0 ? {} : { previousHashes: previous }),
        needsHardKill: reachesHardKill(runtime, meta.qname),
        ...(slot === undefined ? {} : { slot }),
      });
    }
  }
  ops.sort((a, b) => cpCompare(a.qname, b.qname));
  const vocabs = [...new Set(ops.map((op) => op.vocab))].sort(cpCompare);
  const conversions = options.conversions ?? [];
  checkConversions(conversions, ops);
  return {
    format: CATALOGUE_FORMAT,
    version: sha256(JSON.stringify(ops)).slice(0, 16),
    vocabs,
    ops,
    ...(conversions.length === 0 ? {} : { conversions }),
  };
};
