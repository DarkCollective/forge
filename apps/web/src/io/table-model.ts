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

// The model of the table viewer (UI-TOOLKIT.md section 1.7): everything that is arithmetic or text, with no
// DOM, so that it is tested in node. `table-view.ts` draws it.

/** What the worker sends for a `table` (packages/ops `TableView`). */
export interface TableViewData {
  readonly columns: readonly { readonly name: string; readonly type: string }[];
  readonly rows: readonly (readonly (string | null)[])[];
  readonly total: number;
}

/** A table is drawn whole up to this many cells (shown rows times columns), and windowed beyond. */
export const WHOLE_CELL_LIMIT = 5000;
/** Height of a data row in CSS pixels (a touch target of at least 36 px, UI.md section 1.4). */
export const ROW_PX = 36;
/** Height of the header row: the name and the type under it. */
export const HEADER_PX = 52;
/** Rows drawn above and below the visible ones when windowed. */
export const OVERSCAN = 6;

export function isTableView(x: unknown): x is TableViewData {
  const v = x as Partial<TableViewData> | null;
  if (typeof v !== "object" || v === null) return false;
  if (!Array.isArray(v.columns) || !Array.isArray(v.rows) || typeof v.total !== "number") {
    return false;
  }
  return v.columns.every(
    (c) =>
      typeof c === "object" &&
      c !== null &&
      typeof c.name === "string" &&
      typeof c.type === "string",
  );
}

const nf = (n: number): string => n.toLocaleString("en-US");
const plural = (n: number, one: string, many: string): string => `${nf(n)} ${n === 1 ? one : many}`;

/** "12,408 rows, 4 columns. Showing the first 100 rows." / "4 rows, 3 columns." / "No rows, 3 columns." */
export function summaryLine(view: TableViewData): string {
  const shown = view.rows.length;
  const cols = plural(view.columns.length, "column", "columns");
  const head =
    view.total === 0 ? `No rows, ${cols}.` : `${plural(view.total, "row", "rows")}, ${cols}.`;
  return shown < view.total ? `${head} Showing the first ${plural(shown, "row", "rows")}.` : head;
}

/** The hint under the grid, only when the table is cut. */
export function limitHint(view: TableViewData): string {
  return view.rows.length < view.total
    ? "To see the rest, add a step that selects fewer rows."
    : "";
}

/** The shape for the footer and the badges: "4 columns, 12,408 rows". */
export function shapeText(view: TableViewData): string {
  return `${plural(view.columns.length, "column", "columns")}, ${plural(view.total, "row", "rows")}`;
}

/** The label of the grid: "Table, 12,408 rows, 4 columns". */
export function gridLabel(view: TableViewData): string {
  return `Table, ${plural(view.total, "row", "rows")}, ${plural(view.columns.length, "column", "columns")}`;
}

/** True when the table has more cells than are drawn whole. */
export function needsWindow(view: TableViewData): boolean {
  return view.rows.length * view.columns.length > WHOLE_CELL_LIMIT;
}

/** The rows to draw: first (inclusive) and end (exclusive), as indexes into `rows`. */
export function windowRange(
  scrollTop: number,
  viewport: number,
  rowHeight: number,
  count: number,
  overscan: number,
): { readonly first: number; readonly end: number } {
  if (count <= 0 || rowHeight <= 0) return { first: 0, end: 0 };
  const top = Math.max(0, scrollTop);
  const first = Math.min(count - 1, Math.max(0, Math.floor(top / rowHeight) - overscan));
  const end = Math.min(count, Math.ceil((top + Math.max(0, viewport)) / rowHeight) + overscan);
  return { first, end: Math.max(end, first + 1) };
}

// ---- how a cell reads ---------------------------------------------------------------------------

export type CellKind = "null" | "empty" | "text";

export interface CellShown {
  readonly kind: CellKind;
  /** What is drawn: the word null, two quote marks, or the text with control characters as escapes. */
  readonly text: string;
  /** The accessible name when it differs from the text; "" for none. */
  readonly label: string;
}

const hex = (n: number, width: number): string => n.toString(16).toUpperCase().padStart(width, "0");

/**
 * The text of a cell with the characters that cannot be shown safely written as escapes: C0 and C1
 * controls, DEL, the line and paragraph separators, the bidirectional controls and marks, the zero-width
 * and byte order characters, and a lone surrogate. Everything else, Unicode text included, is kept.
 */
export function escapeCell(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text.slice(i, i + 2);
        i++;
      } else out += `\\u${hex(c, 4)}`;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      out += `\\u${hex(c, 4)}`;
    } else if (c === 0x09) out += "\\t";
    else if (c === 0x0a) out += "\\n";
    else if (c === 0x0d) out += "\\r";
    else if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) out += `\\x${hex(c, 2)}`;
    else if (
      c === 0x2028 ||
      c === 0x2029 ||
      c === 0xfeff ||
      c === 0x061c ||
      (c >= 0x200b && c <= 0x200f) ||
      (c >= 0x202a && c <= 0x202e) ||
      (c >= 0x2060 && c <= 0x2064) ||
      (c >= 0x2066 && c <= 0x206f)
    ) {
      out += `\\u${hex(c, 4)}`;
    } else out += text.charAt(i);
  }
  return out;
}

/** The shown form of a cell. A null, the empty string and the text `null` are three different things. */
export function showCell(cell: string | null): CellShown {
  if (cell === null) return { kind: "null", text: "null", label: "null, no value" };
  if (cell === "") return { kind: "empty", text: '""', label: "empty text" };
  const text = escapeCell(cell);
  return { kind: "text", text, label: "" };
}

/** What Ctrl+C puts on the clipboard for a cell: its complete text, a null as nothing. */
export function cellCopyText(cell: string | null): string {
  return cell ?? "";
}

// ---- columns ------------------------------------------------------------------------------------

export function isNumeric(type: string): boolean {
  return type === "int" || type === "num";
}

const MIN_REM = 6;
const MAX_REM = 24;
const NUMBER_COL = "3.5rem";

/** `grid-template-columns` of every row: the row-number column, then each column clamped to 6..24 rem. */
export function gridTemplate(view: TableViewData): string {
  const tracks = view.columns.map((c, i) => {
    let longest = Math.max(c.name.length, c.type.length);
    for (const row of view.rows) {
      const cell = row[i];
      const len =
        cell === null || cell === undefined ? 4 : cell.length === 0 ? 2 : Math.min(cell.length, 64);
      if (len > longest) longest = len;
    }
    return `clamp(${MIN_REM}rem, ${Math.min(longest, 64) + 3}ch, ${MAX_REM}rem)`;
  });
  return [NUMBER_COL, ...tracks].join(" ");
}

// ---- the keyboard -------------------------------------------------------------------------------
// Positions: row 0 is the header row, rows 1..rows the data rows; column 0 is the row-number column,
// columns 1..cols the data columns. aria-rowindex is row + 1 and aria-colindex is col + 1.

export interface GridPos {
  readonly row: number;
  readonly col: number;
}

export interface GridSize {
  readonly rows: number;
  readonly cols: number;
}

export interface KeyInput {
  readonly key: string;
  readonly ctrl: boolean;
  /** Rows visible at once, for Page Up and Page Down. */
  readonly page: number;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Where a key moves the focus, or null when the key is not a grid key. The result stays in the grid. */
export function moveFocus(pos: GridPos, size: GridSize, input: KeyInput): GridPos | null {
  let { row, col } = pos;
  switch (input.key) {
    case "ArrowUp":
      row -= 1;
      break;
    case "ArrowDown":
      row += 1;
      break;
    case "ArrowLeft":
      col -= 1;
      break;
    case "ArrowRight":
      col += 1;
      break;
    case "Home":
      col = 0;
      if (input.ctrl) row = 0;
      break;
    case "End":
      col = size.cols;
      if (input.ctrl) row = size.rows;
      break;
    case "PageUp":
      row -= Math.max(1, input.page);
      break;
    case "PageDown":
      row += Math.max(1, input.page);
      break;
    default:
      return null;
  }
  return { row: clamp(row, 0, size.rows), col: clamp(col, 0, size.cols) };
}
