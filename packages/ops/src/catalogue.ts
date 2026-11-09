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
import { CORE_VOCAB, listWords, sha256 } from "@forge/lang";
import type { ForgeRuntime, WordEntry, WordMeta } from "@forge/lang";
import { isRegexPrimitive } from "./regex-engine.js";
import { CATALOGUE_FORMAT, INTERNAL_VOCABS, UI_PARAM_TYPES } from "./types.js";
import type { BuildCatalogueFn, CatalogueOp, IsCatalogueOpFn } from "./types.js";

function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
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
  meta.params.every((p) => UI_PARAM_TYPES.includes(p.type)) &&
  meta.effect.outputs.length === 1 &&
  !meta.effect.unchecked &&
  !meta.effect.variadicInput &&
  meta.qname === `${meta.vocab}:${meta.name}`;

/** Does the word, or any word it calls (transitively, FL words only), run the regex engine? */
function reachesRegexEngine(runtime: ForgeRuntime, qname: string): boolean {
  const seen = new Set<string>();
  const work: WordEntry[] = [runtime.lookup(qname)];
  for (let entry = work.pop(); entry !== undefined; entry = work.pop()) {
    if (seen.has(entry.qname)) continue;
    seen.add(entry.qname);
    if (entry.kind === "primitive") {
      if (isRegexPrimitive(entry.qname)) return true;
    } else if (entry.kind === "fl" && entry.code !== null) {
      work.push(...entry.code.deps);
    }
  }
  return false;
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
      ops.push({
        qname: meta.qname,
        name: meta.name,
        vocab: meta.vocab,
        category: meta.category,
        doc: meta.doc,
        aliases: meta.aliases,
        seeAlso: meta.seeAlso,
        input: (meta.effect.inputs[0] as { type: CatalogueOp["input"] }).type,
        output: (meta.effect.outputs[0] as { type: CatalogueOp["output"] }).type,
        effect: meta.effect.text,
        params: meta.params,
        effects: meta.effects,
        version: meta.version,
        hash: meta.hash,
        needsHardKill: reachesRegexEngine(runtime, meta.qname),
      });
    }
  }
  ops.sort((a, b) => compareCodePoints(a.qname, b.qname));
  const vocabs = [...new Set(ops.map((op) => op.vocab))].sort(compareCodePoints);
  return {
    format: CATALOGUE_FORMAT,
    version: sha256(JSON.stringify(ops)).slice(0, 16),
    vocabs,
    ops,
  };
};
