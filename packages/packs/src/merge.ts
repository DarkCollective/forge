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
 * Merging catalogue fragments (PACKS.md section 5.2).
 */
import { cpCompare } from "@forge/lang";
import { CATALOGUE_FORMAT, catalogueVersionOf } from "@forge/ops";
import type { Catalogue, CatalogueConversion, CatalogueOp } from "@forge/ops";

export { catalogueVersionOf };

/**
 * Merges the core catalogue with the fragments of the enabled packs, given in pack order. The result holds the ops of all
 * inputs sorted by `qname` in code-point order, the union of the vocabularies sorted, the conversions of the core and then
 * of each fragment in order, and `version = catalogueVersionOf(ops)`: the function `buildCatalogue` uses, so for core
 * alone the result has the core version.
 *
 * The version covers `ops` only, as RECIPES-1.2.md section 14.4 defines it. The conversions are carried but not hashed:
 * a conversion names an op that is in `ops`, and the baker's skew check applies `catalogueVersionOf` to a filtered op
 * list that has no conversions to hash. The merge-equality test compares the conversions beside the version.
 *
 * Throws when an input has another `format`, or when two inputs hold an op of the same qualified name: the invariant of
 * PACKS.md section 5.1 makes the ops of a fragment disjoint from those of every other input.
 */
export function mergeCatalogues(core: Catalogue, fragments: readonly Catalogue[]): Catalogue {
  const seen = new Set<string>();
  const ops: CatalogueOp[] = [];
  const vocabs = new Set<string>();
  const conversions: CatalogueConversion[] = [];
  for (const input of [core, ...fragments]) {
    if (input.format !== CATALOGUE_FORMAT) {
      throw new Error(`cannot merge a catalogue of format ${String(input.format)}`);
    }
    for (const op of input.ops) {
      if (seen.has(op.qname)) {
        throw new Error(`cannot merge catalogues: ${op.qname} is in more than one`);
      }
      seen.add(op.qname);
      ops.push(op);
    }
    for (const v of input.vocabs) vocabs.add(v);
    conversions.push(...(input.conversions ?? []));
  }
  ops.sort((a, b) => cpCompare(a.qname, b.qname));
  return {
    format: CATALOGUE_FORMAT,
    version: catalogueVersionOf(ops),
    vocabs: [...vocabs].sort(cpCompare),
    ops,
    ...(conversions.length === 0 ? {} : { conversions }),
  };
}
