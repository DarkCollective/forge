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
 * X0 SPIKE (throwaway): the `table` viewer. A custom element with a shadow root whose only style is one
 * constructable stylesheet over the tokens (adopted stylesheets pass `style-src 'self'`; a `<style>`
 * element or a `style=` attribute would not). Every node is made with createElement and text goes in
 * through textContent. Not virtualised: it shows the first rows the worker sent (X0: 100).
 */
import { registerViewer } from "./viewers.js";
import type { ExtOutput } from "./viewers.js";

interface TableViewData {
  readonly columns: readonly { readonly name: string; readonly type: string }[];
  readonly rows: readonly (readonly (string | null)[])[];
  readonly total: number;
}

function isTableView(x: unknown): x is TableViewData {
  const v = x as Partial<TableViewData> | null;
  return (
    typeof v === "object" &&
    v !== null &&
    Array.isArray(v.columns) &&
    Array.isArray(v.rows) &&
    typeof v.total === "number"
  );
}

const SHEET_TEXT = `
:host { display: block; min-width: 0; }
.summary {
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
  color: var(--text-muted);
}
.scroll {
  overflow: auto;
  max-height: 28rem;
  border: var(--border-width) solid var(--border);
  border-radius: var(--radius-s);
  background: var(--surface);
}
.scroll:focus-visible {
  outline: var(--focus-width) solid var(--focus);
  outline-offset: var(--focus-offset);
}
table {
  border-collapse: separate;
  border-spacing: 0;
  width: max-content;
  min-width: 100%;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--text);
}
th, td {
  padding: var(--space-1) var(--space-3);
  border-bottom: var(--border-width) solid var(--border);
  border-right: var(--border-width) solid var(--border);
  text-align: left;
  white-space: nowrap;
  max-width: 24rem;
  overflow: hidden;
  text-overflow: ellipsis;
}
thead th {
  position: sticky;
  top: 0;
  background: var(--surface-2);
  font-family: var(--font-ui);
  font-weight: var(--weight-medium);
}
th.rownum {
  position: sticky;
  left: 0;
  background: var(--surface-2);
  color: var(--text-muted);
  text-align: right;
  font-weight: var(--weight-normal);
}
thead th.rownum { z-index: 1; }
.type {
  display: block;
  font-size: var(--text-xs);
  font-weight: var(--weight-normal);
  color: var(--text-muted);
}
td.num { text-align: right; }
td.null {
  color: var(--text-muted);
  font-style: italic;
}
tbody tr:nth-child(even) td { background: var(--surface-2); }
tbody tr:nth-child(even) th.rownum { background: var(--surface-3); }
`;

let sheet: CSSStyleSheet | null | undefined;

function sharedSheet(): CSSStyleSheet | null {
  if (sheet !== undefined) return sheet;
  try {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(SHEET_TEXT);
  } catch {
    sheet = null;
  }
  return sheet;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The `<forge-table-view>` element: set `data` (or use `renderTable`). */
export class ForgeTableView extends HTMLElement {
  private root: ShadowRoot;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
    const s = sharedSheet();
    if (s !== null) this.root.adoptedStyleSheets = [s];
  }

  set data(data: TableViewData) {
    const nodes: Node[] = [];
    const shown = data.rows.length;
    const cols = data.columns.length;
    const summary = el(
      "p",
      "summary",
      `${data.total.toLocaleString("en-US")} row${data.total === 1 ? "" : "s"}, ${cols} column${
        cols === 1 ? "" : "s"
      }` + (shown < data.total ? `, showing the first ${shown.toLocaleString("en-US")}` : ""),
    );
    summary.setAttribute("role", "status");
    nodes.push(summary);

    const scroll = el("div", "scroll");
    scroll.tabIndex = 0;
    scroll.setAttribute("role", "region");
    scroll.setAttribute("aria-label", "Table output");
    const table = el("table");
    const thead = el("thead");
    const hr = el("tr");
    const corner = el("th", "rownum", "#");
    corner.scope = "col";
    hr.append(corner);
    for (const c of data.columns) {
      const th = el("th", undefined, c.name);
      th.scope = "col";
      th.append(el("span", "type", c.type));
      hr.append(th);
    }
    thead.append(hr);
    const tbody = el("tbody");
    data.rows.forEach((row, i) => {
      const tr = el("tr");
      const rn = el("th", "rownum", String(i + 1));
      rn.scope = "row";
      tr.append(rn);
      row.forEach((cell, ci) => {
        const type = data.columns[ci]?.type;
        const td = el("td", cell === null ? "null" : type === "num" ? "num" : undefined);
        td.textContent = cell === null ? "null" : cell;
        tr.append(td);
      });
      tbody.append(tr);
    });
    table.append(thead, tbody);
    scroll.append(table);
    nodes.push(scroll);
    this.root.replaceChildren(...nodes);
  }
}

if (customElements.get("forge-table-view") === undefined) {
  customElements.define("forge-table-view", ForgeTableView);
}

export function renderTable(output: ExtOutput): HTMLElement {
  if (!isTableView(output.view)) throw new Error("table view data missing");
  const node = document.createElement("forge-table-view") as ForgeTableView;
  node.data = output.view;
  return node;
}

registerViewer({ kind: "table", render: renderTable });
