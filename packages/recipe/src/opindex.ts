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
/** Name lookup over a catalogue (canonical names and aliases). A `Map` is used, so no name reaches a prototype. */
import type { CatalogueOpView, CatalogueView } from "./types.js";

export interface OpEntry {
  readonly op: CatalogueOpView;
  /** True when the name that was looked up is an alias. */
  readonly alias: boolean;
}

export interface OpIndex {
  find(name: string): OpEntry | undefined;
}

const cache = new WeakMap<CatalogueView, OpIndex>();

/** The index of `catalogue`; built once per catalogue object. Canonical names win over aliases. */
export function opIndex(catalogue: CatalogueView): OpIndex {
  const hit = cache.get(catalogue);
  if (hit !== undefined) return hit;
  const byName = new Map<string, OpEntry>();
  for (const op of catalogue.ops) byName.set(op.qname, { op, alias: false });
  for (const op of catalogue.ops) {
    const vocab = op.qname.slice(0, op.qname.indexOf(":"));
    for (const alias of op.aliases) {
      const name = `${vocab}:${alias}`;
      if (!byName.has(name)) byName.set(name, { op, alias: true });
    }
  }
  const index: OpIndex = { find: (name) => byName.get(name) };
  cache.set(catalogue, index);
  return index;
}
