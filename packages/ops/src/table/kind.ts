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
 * The `table` ext kind (LANGUAGE-0.3.md section 4, TOOLKIT.md section 7, decisions T21 and T36): `table` is
 * core, registered from `@forge/ops`. `registerTableKind` is idempotent; the primitive module of the `table`
 * vocabulary calls it at load, so a table can exist wherever the vocabulary is loaded.
 */
import { registerExtKind } from "@forge/lang";
import type { ExtKind } from "@forge/lang";
import { cellAt, equalPayloads } from "./payload.js";
import type { TableColumn, TablePayload } from "./payload.js";
import { cellDisplay, readFaithful, writeFaithful } from "./text.js";

/** The structured-clone-safe summary a viewer gets (UI-TOOLKIT.md section 1.7, X0 section 5.1). */
export interface TableView {
  readonly columns: readonly { readonly name: string; readonly type: string }[];
  /** The first rows as text cells, null for a null. */
  readonly rows: readonly (readonly (string | null)[])[];
  /** The number of rows the table holds, not the number shown. */
  readonly total: number;
}

/** The text of the kind cut to `max` code units with `...` (not splitting a surrogate pair). */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 3) return text.slice(0, Math.max(0, max));
  let end = max - 3;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--;
  return text.slice(0, end) + "...";
}

export const tableKind: ExtKind<TablePayload> = {
  kind: "table",
  equals: equalPayloads,
  sizeOf: (p) => p.size,
  toText: (p, max) => cut(writeFaithful(p, max), max),
  fromText: readFaithful,
  view(p, o): TableView {
    const shown = Math.min(p.rows, Math.max(0, Math.floor(o.maxRows)));
    const rows: (string | null)[][] = [];
    for (let i = 0; i < shown; i++) {
      rows.push(p.columns.map((c: TableColumn) => cellDisplay(cellAt(c, i))));
    }
    return {
      columns: p.columns.map((c) => ({ name: c.name, type: c.type })),
      rows,
      total: p.rows,
    };
  },
};

/** Registers the `table` kind: process-wide, idempotent, the last registration wins. */
export function registerTableKind(): void {
  registerExtKind(tableKind);
}
