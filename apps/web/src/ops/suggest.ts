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
// "Suggested next" (UI-TOOLKIT.md section 2.6, T58): the operations that fit the data at the end of the
// recipe. No new mechanism: the type fit (fit.ts) and the content checks (content.ts) rank the catalogue.
// Pure, so that the component only renders the result.
import type { CatalogueOp } from "@forge/ops";
import { contentLevel } from "./content.js";
import type { ContentView, RowNote } from "./content.js";
import { fitLevel, needOf } from "./fit.js";
import type { DataFacts } from "./fit.js";
import { SUGGESTED_CAP, groupByCategory } from "./group.js";

/**
 * 0 when the op's check passed and its sentence names what the data was identified as ("Expects gzip data" on
 * gzip data: the "Data here" line and the row agree), 1 when it passed, 2 for the rest.
 */
function checkRank(note: RowNote | undefined, named: string | undefined): number {
  if (note?.result !== "pass") return 2;
  return named !== undefined && note.text.toLowerCase().includes(named) ? 0 : 1;
}

/**
 * Every operation that can take the data, best first: green before amber (a failed content check makes a row
 * amber), then those whose input checks passed (first the ones that name what the data was identified as), then the drawer's own order (categories in order, the
 * catalogue's order inside one). Red operations are never listed, and nothing is listed when the data
 * type is unknown. The caller applies the cap, after any filter of its own.
 */
export function rankSuggestions(
  ops: readonly CatalogueOp[],
  facts: DataFacts,
  content: ContentView | null,
): CatalogueOp[] {
  if (facts.type === "unknown") return [];
  const named = content?.identification?.name.toLowerCase();
  const scored: { op: CatalogueOp; rank: number; order: number }[] = [];
  let order = 0;
  for (const group of groupByCategory(ops)) {
    for (const op of group.ops) {
      const fit = fitLevel(needOf(op), facts.type, facts.utf8);
      order += 1;
      if (fit === "no") continue;
      const note = content?.rows.get(op.qname);
      const level = contentLevel(fit, note);
      const rank = (level === "fits" ? 0 : 3) + checkRank(note, named);
      scored.push({ op, rank, order });
    }
  }
  scored.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return scored.map((s) => s.op);
}

/** The first `SUGGESTED_CAP` suggestions. */
export function suggestNext(
  ops: readonly CatalogueOp[],
  facts: DataFacts,
  content: ContentView | null,
): CatalogueOp[] {
  return rankSuggestions(ops, facts, content).slice(0, SUGGESTED_CAP);
}
