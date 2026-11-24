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

// The `table` viewer (UI-TOOLKIT.md section 1.7, TOOLKIT.md decisions T21 and T42). It shows the first rows
// the worker sent, the total and the limit, in a `role="grid"` with a roving tabindex. A table of at most
// 5,000 cells is drawn whole; a larger one is windowed by rows, placed with the CSSOM (never a `style`
// attribute). DOM is built by script and text goes in through textContent. The only style is one adopted
// stylesheet over the tokens: no `<style>` element, because `style-src 'self'` blocks it.
import {
  HEADER_PX,
  OVERSCAN,
  ROW_PX,
  cellCopyText,
  escapeCell,
  gridLabel,
  gridTemplate,
  isNumeric,
  isTableView,
  limitHint,
  moveFocus,
  needsWindow,
  shapeText,
  showCell,
  summaryLine,
  windowRange,
} from "./table-model.js";
import type { GridPos, TableViewData } from "./table-model.js";
import { registerViewer } from "./viewers.js";
import type { ExtOutput, Viewer, ViewerContext } from "./viewers.js";

const SHEET_TEXT = `
:host { display: block; min-width: 0; }
.summary {
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
  color: var(--text);
}
.hint {
  margin: var(--space-2) 0 0;
  font-size: var(--text-sm);
  color: var(--text-muted);
}
.grid {
  position: relative;
  overflow: auto;
  max-height: 28rem;
  min-height: 6rem;
  border: var(--border-width) solid var(--border);
  border-radius: var(--radius-s);
  background: var(--surface);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  scroll-padding-left: 3.5rem;
  scroll-padding-top: ${HEADER_PX}px;
}
.row {
  display: grid;
  grid-template-columns: var(--cols);
  width: max-content;
  min-width: 100%;
  height: ${ROW_PX}px;
}
.row.head {
  position: sticky;
  top: 0;
  z-index: 2;
  height: ${HEADER_PX}px;
}
.spacer { position: relative; }
.window { will-change: transform; }
.cell, .colhead, .rowhead {
  box-sizing: border-box;
  min-width: 0;
  padding: 0 var(--space-3);
  display: flex;
  align-items: center;
  border-bottom: var(--border-width) solid var(--border);
  border-right: var(--border-width) solid var(--border);
  background: var(--surface);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cell { display: block; line-height: ${ROW_PX - 2}px; }
.row.odd .cell { background: var(--surface-2); }
.num { text-align: right; }
.colhead {
  display: block;
  background: var(--surface-2);
  font-family: var(--font-ui);
  font-weight: var(--weight-medium);
  line-height: 1.3;
  padding-top: var(--space-1);
}
.colhead .type {
  display: block;
  font-size: var(--text-xs);
  font-weight: var(--weight-normal);
  color: var(--text-muted);
}
.rowhead {
  position: sticky;
  left: 0;
  z-index: 1;
  display: block;
  line-height: ${ROW_PX - 2}px;
  background: var(--surface-2);
  color: var(--text-muted);
  text-align: right;
  font-weight: var(--weight-normal);
}
.row.head .rowhead { z-index: 3; }
.cell.null, .cell.empty { color: var(--text-muted); }
.cell.null { font-style: italic; }
.cell:focus-visible, .colhead:focus-visible, .rowhead:focus-visible, .grid:focus-visible {
  outline: var(--focus-width) solid var(--focus);
  outline-offset: calc(-1 * var(--focus-width));
}
@media (forced-colors: active) {
  .grid, .cell, .colhead, .rowhead { background: Canvas; color: CanvasText; border-color: CanvasText; }
  .cell.null, .cell.empty, .colhead .type, .rowhead, .hint { color: GrayText; }
  .cell:focus-visible, .colhead:focus-visible, .rowhead:focus-visible {
    outline: 2px solid Highlight;
  }
}
`;

let sheet: CSSStyleSheet | null | undefined;

/** The shared sheet, or null where constructable stylesheets are missing: the grid is then unstyled. */
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

/** The grid of one table output. */
class TableGrid {
  readonly host: HTMLElement;
  private readonly scroll: HTMLElement;
  private readonly windowEl: HTMLElement;
  private readonly windowed: boolean;
  private readonly rows: number;
  private readonly cols: number;
  private active: GridPos = { row: 1, col: 1 };
  private first = -1;
  private end = -1;
  private viewport = 28 * 16;

  constructor(
    private readonly view: TableViewData,
    signal: AbortSignal,
  ) {
    this.rows = view.rows.length;
    this.cols = view.columns.length;
    this.windowed = needsWindow(view);
    this.active = { row: this.rows > 0 ? 1 : 0, col: this.cols > 0 ? 1 : 0 };

    this.host = el("div");
    const root = this.host.attachShadow({ mode: "open" });
    const s = sharedSheet();
    if (s !== null) root.adoptedStyleSheets = [s];

    const summary = el("p", "summary", summaryLine(view));
    summary.id = "summary";

    this.scroll = el("div", "grid");
    this.scroll.tabIndex = -1;
    this.scroll.setAttribute("role", "grid");
    this.scroll.setAttribute("aria-label", gridLabel(view));
    this.scroll.setAttribute("aria-describedby", "summary");
    this.scroll.setAttribute("aria-rowcount", String(this.rows + 1));
    this.scroll.setAttribute("aria-colcount", String(this.cols + 1));
    this.scroll.style.setProperty("--cols", gridTemplate(view));

    this.scroll.append(this.headerRow());
    const spacer = el("div", "spacer");
    spacer.setAttribute("role", "presentation");
    spacer.style.height = `${this.rows * ROW_PX}px`;
    this.windowEl = el("div", "window");
    this.windowEl.setAttribute("role", "rowgroup");
    spacer.append(this.windowEl);
    this.scroll.append(spacer);

    root.append(summary, this.scroll);
    const hint = limitHint(view);
    if (hint !== "") root.append(el("p", "hint", hint));

    this.scroll.addEventListener("keydown", (e) => this.onKey(e));
    this.scroll.addEventListener("focusin", (e) => this.onFocusIn(e));
    if (this.windowed) {
      this.scroll.addEventListener("scroll", () => this.draw(false), { passive: true });
    }
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        const h = this.scroll.clientHeight;
        if (h > 0 && h !== this.viewport + HEADER_PX) {
          this.viewport = Math.max(0, h - HEADER_PX);
          this.draw(false);
        }
      });
      observer.observe(this.scroll);
      signal.addEventListener("abort", () => observer.disconnect(), { once: true });
    }
    this.draw(true);
  }

  private headerRow(): HTMLElement {
    const row = el("div", "row head");
    row.setAttribute("role", "row");
    row.setAttribute("aria-rowindex", "1");
    const corner = el("div", "rowhead", "#");
    corner.setAttribute("role", "columnheader");
    corner.setAttribute("aria-colindex", "1");
    corner.setAttribute("aria-label", "Row number");
    this.mark(corner, 0, 0);
    row.append(corner);
    this.view.columns.forEach((c, i) => {
      const head = el("div", "colhead");
      head.setAttribute("role", "columnheader");
      head.setAttribute("aria-colindex", String(i + 2));
      const name = c.name === "" ? '""' : escapeCell(c.name);
      head.setAttribute("aria-label", `${name}, ${c.type}`);
      head.append(el("span", "name", name), el("span", "type", escapeCell(c.type)));
      this.mark(head, 0, i + 1);
      row.append(head);
    });
    return row;
  }

  /** Records the position on the cell and sets its place in the roving tabindex. */
  private mark(node: HTMLElement, row: number, col: number): void {
    node.dataset["r"] = String(row);
    node.dataset["c"] = String(col);
    node.tabIndex = row === this.active.row && col === this.active.col ? 0 : -1;
  }

  private dataRow(i: number): HTMLElement {
    const cells = this.view.rows[i] ?? [];
    const r = i + 1;
    const row = el("div", i % 2 === 1 ? "row odd" : "row");
    row.setAttribute("role", "row");
    row.setAttribute("aria-rowindex", String(r + 1));
    const head = el("div", "rowhead", String(r));
    head.setAttribute("role", "rowheader");
    head.setAttribute("aria-colindex", "1");
    this.mark(head, r, 0);
    row.append(head);
    this.view.columns.forEach((c, k) => {
      const cell = cells[k] ?? null;
      const shown = showCell(cell);
      const classes = ["cell"];
      if (shown.kind !== "text") classes.push(shown.kind);
      else if (isNumeric(c.type)) classes.push("num");
      const node = el("div", classes.join(" "), shown.text);
      node.setAttribute("role", "gridcell");
      node.setAttribute("aria-colindex", String(k + 2));
      if (shown.label !== "") node.setAttribute("aria-label", shown.label);
      this.mark(node, r, k + 1);
      row.append(node);
    });
    return row;
  }

  /** Draws the rows in view. Only a change of the range (or `force`) rebuilds them. */
  private draw(force: boolean): void {
    let first = 0;
    let end = this.rows;
    if (this.windowed) {
      const range = windowRange(this.scroll.scrollTop, this.viewport, ROW_PX, this.rows, OVERSCAN);
      first = range.first;
      end = range.end;
    }
    if (!force && first === this.first && end === this.end) return;
    const hadFocus = this.host.shadowRoot?.activeElement != null;
    this.first = first;
    this.end = end;
    const nodes: HTMLElement[] = [];
    for (let i = first; i < end; i++) nodes.push(this.dataRow(i));
    this.windowEl.replaceChildren(...nodes);
    this.windowEl.style.transform = `translateY(${first * ROW_PX}px)`;
    // The tab stop must exist: when the active row is out of the window, the first drawn row holds it.
    if (this.active.row >= 1 && (this.active.row - 1 < first || this.active.row - 1 >= end)) {
      const stop = this.windowEl.querySelector<HTMLElement>(`[data-c="${this.active.col}"]`);
      if (stop !== null) stop.tabIndex = 0;
    }
    if (hadFocus) (this.cellAt(this.active) ?? this.scroll).focus({ preventScroll: true });
  }

  private cellAt(pos: GridPos): HTMLElement | null {
    return (
      this.host.shadowRoot?.querySelector<HTMLElement>(
        `[data-r="${pos.row}"][data-c="${pos.col}"]`,
      ) ?? null
    );
  }

  private onFocusIn(e: Event): void {
    const target = e.target as HTMLElement | null;
    const r = target?.dataset?.["r"];
    const c = target?.dataset?.["c"];
    if (r === undefined || c === undefined) return;
    const prev = this.cellAt(this.active);
    if (prev !== null && prev !== target) prev.tabIndex = -1;
    this.active = { row: Number(r), col: Number(c) };
    if (target !== null && target !== undefined) target.tabIndex = 0;
  }

  /** Scrolls so that the data row is fully visible between the sticky header and the bottom edge. */
  private reveal(row: number): void {
    if (row < 1) return;
    const top = (row - 1) * ROW_PX;
    const visible = Math.max(ROW_PX, this.scroll.clientHeight - HEADER_PX);
    if (top < this.scroll.scrollTop) this.scroll.scrollTop = top;
    else if (top + ROW_PX > this.scroll.scrollTop + visible) {
      this.scroll.scrollTop = top + ROW_PX - visible;
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (e.altKey || e.metaKey) return;
    if ((e.key === "c" || e.key === "C") && e.ctrlKey) {
      const cell = this.cellAt(this.active);
      const r = this.active.row;
      const c = this.active.col;
      if (cell === null) return;
      const text =
        r >= 1 && c >= 1
          ? cellCopyText(this.view.rows[r - 1]?.[c - 1] ?? null)
          : r === 0 && c >= 1
            ? (this.view.columns[c - 1]?.name ?? "")
            : r >= 1
              ? String(r)
              : "";
      e.preventDefault();
      try {
        void navigator.clipboard.writeText(text).catch(() => undefined);
      } catch {
        // No clipboard: nothing to do.
      }
      return;
    }
    if (e.shiftKey) return;
    const page = Math.max(1, Math.floor((this.scroll.clientHeight - HEADER_PX) / ROW_PX) - 1);
    const next = moveFocus(
      this.active,
      { rows: this.rows, cols: this.cols },
      { key: e.key, ctrl: e.ctrlKey, page },
    );
    if (next === null) return;
    e.preventDefault();
    this.reveal(next.row);
    this.draw(false);
    const target = this.cellAt(next);
    if (target !== null) target.focus();
  }
}

/** `render` of the viewer: a host element with a shadow root. Throws when the output holds no table view. */
export function renderTable(output: ExtOutput, ctx: ViewerContext): HTMLElement {
  if (!isTableView(output.view)) throw new TypeError("the table has no view data");
  return new TableGrid(output.view, ctx.signal).host;
}

export const tableViewer: Viewer = {
  kind: "table",
  noun: "table",
  render: renderTable,
  summary: (output) => (isTableView(output.view) ? shapeText(output.view) : null),
  bytesOps: [
    { op: "table:to-csv", label: "Table to CSV" },
    { op: "table:to-json", label: "Table to JSON" },
  ],
};

registerViewer(tableViewer);
