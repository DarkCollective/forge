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
// The table viewer's model (UI-TOOLKIT.md section 1.7), in node: windowing, null against empty, the limit
// sentence, the keyboard.
import { describe, expect, test } from "vitest";
import {
  WHOLE_CELL_LIMIT,
  cellCopyText,
  escapeCell,
  gridLabel,
  gridTemplate,
  isTableView,
  limitHint,
  moveFocus,
  needsWindow,
  shapeText,
  showCell,
  summaryLine,
  windowRange,
} from "./table-model.js";
import type { TableViewData } from "./table-model.js";

function table(rows: number, cols: number, total = rows): TableViewData {
  return {
    columns: Array.from({ length: cols }, (_, i) => ({ name: `c${i}`, type: "str" })),
    rows: Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => `${r}:${c}`),
    ),
    total,
  };
}

describe("the summary and the limit", () => {
  test("a cut table states the total and the limit", () => {
    const v = table(100, 4, 12408);
    expect(summaryLine(v)).toBe("12,408 rows, 4 columns. Showing the first 100 rows.");
    expect(limitHint(v)).toBe("To see the rest, add a step that selects fewer rows.");
    expect(gridLabel(v)).toBe("Table, 12,408 rows, 4 columns");
    expect(shapeText(v)).toBe("4 columns, 12,408 rows");
  });
  test("a whole table says no more, and the hint is absent", () => {
    expect(summaryLine(table(4, 3))).toBe("4 rows, 3 columns.");
    expect(limitHint(table(4, 3))).toBe("");
    expect(summaryLine(table(1, 1))).toBe("1 row, 1 column.");
  });
  test("no rows", () => {
    expect(summaryLine(table(0, 3))).toBe("No rows, 3 columns.");
  });
  test("isTableView accepts the worker's view and nothing else", () => {
    expect(isTableView(table(1, 1))).toBe(true);
    expect(isTableView(null)).toBe(false);
    expect(isTableView({ columns: [{ name: 1, type: "str" }], rows: [], total: 0 })).toBe(false);
    expect(isTableView({ columns: [], rows: [] })).toBe(false);
  });
});

describe("windowing", () => {
  test("whole up to 5,000 cells, windowed beyond", () => {
    expect(WHOLE_CELL_LIMIT).toBe(5000);
    expect(needsWindow(table(100, 50))).toBe(false);
    expect(needsWindow(table(100, 51))).toBe(true);
    expect(needsWindow(table(0, 10))).toBe(false);
  });
  test("windowRange follows the scroll position with an overscan", () => {
    expect(windowRange(0, 360, 36, 100, 5)).toEqual({ first: 0, end: 15 });
    expect(windowRange(3600 - 360, 360, 36, 100, 5)).toEqual({ first: 85, end: 100 });
    expect(windowRange(720, 360, 36, 100, 0)).toEqual({ first: 20, end: 30 });
  });
  test("windowRange stays inside the rows, and is empty for no rows", () => {
    expect(windowRange(99999, 360, 36, 100, 5)).toEqual({ first: 99, end: 100 });
    expect(windowRange(-50, 360, 36, 100, 0)).toEqual({ first: 0, end: 10 });
    expect(windowRange(0, 360, 36, 0, 5)).toEqual({ first: 0, end: 0 });
    expect(windowRange(0, 0, 36, 10, 0).end).toBeGreaterThan(0);
  });
});

describe("null against empty", () => {
  test("a null, an empty string and the text null are three things", () => {
    expect(showCell(null)).toEqual({ kind: "null", text: "null", label: "null, no value" });
    expect(showCell("")).toEqual({ kind: "empty", text: '""', label: "empty text" });
    expect(showCell("null")).toEqual({ kind: "text", text: "null", label: "" });
    expect(showCell('""').kind).toBe("text");
  });
  test("copying gives the complete text, a null as nothing", () => {
    expect(cellCopyText(null)).toBe("");
    expect(cellCopyText("a\u0007b")).toBe("a\u0007b");
  });
});

describe("hostile text", () => {
  test("control characters, bidi controls and lone surrogates are shown as escapes", () => {
    expect(escapeCell("a\tb\nc\rd")).toBe("a\\tb\\nc\\rd");
    expect(escapeCell("\u0000\u0007\u007f\u0085")).toBe("\\x00\\x07\\x7F\\x85");
    expect(escapeCell("x‮y")).toBe("x\\u202Ey");
    expect(escapeCell("​﻿ ")).toBe("\\u200B\\uFEFF\\u2028");
    expect(escapeCell("a\ud800b")).toBe("a\\uD800b");
    expect(escapeCell("a\udc00")).toBe("a\\uDC00");
  });
  test("markup, Unicode and a valid surrogate pair are kept as text", () => {
    expect(escapeCell("<img src=x onerror=alert(1)></script>")).toBe(
      "<img src=x onerror=alert(1)></script>",
    );
    expect(escapeCell("héllo 世界 😀")).toBe("héllo 世界 😀");
  });
  test("column widths are clamped whatever the cell length", () => {
    const v: TableViewData = {
      columns: [
        { name: "a", type: "str" },
        { name: "b", type: "str" },
      ],
      rows: [["x".repeat(100000), "y"]],
      total: 1,
    };
    const tracks = gridTemplate(v);
    expect(tracks).toContain("clamp(6rem, 67ch, 24rem)");
    expect(tracks.startsWith("3.5rem ")).toBe(true);
  });
});

describe("the keyboard", () => {
  const size = { rows: 10, cols: 4 };
  const key = (k: string, ctrl = false, page = 5) => ({ key: k, ctrl, page });
  test("arrows move by cell and stop at the edges", () => {
    expect(moveFocus({ row: 2, col: 2 }, size, key("ArrowDown"))).toEqual({ row: 3, col: 2 });
    expect(moveFocus({ row: 2, col: 2 }, size, key("ArrowUp"))).toEqual({ row: 1, col: 2 });
    expect(moveFocus({ row: 2, col: 2 }, size, key("ArrowLeft"))).toEqual({ row: 2, col: 1 });
    expect(moveFocus({ row: 2, col: 2 }, size, key("ArrowRight"))).toEqual({ row: 2, col: 3 });
    expect(moveFocus({ row: 0, col: 0 }, size, key("ArrowUp"))).toEqual({ row: 0, col: 0 });
    expect(moveFocus({ row: 10, col: 4 }, size, key("ArrowRight"))).toEqual({ row: 10, col: 4 });
  });
  test("Home and End go along the row, with Ctrl across the grid", () => {
    expect(moveFocus({ row: 3, col: 2 }, size, key("Home"))).toEqual({ row: 3, col: 0 });
    expect(moveFocus({ row: 3, col: 2 }, size, key("End"))).toEqual({ row: 3, col: 4 });
    expect(moveFocus({ row: 3, col: 2 }, size, key("Home", true))).toEqual({ row: 0, col: 0 });
    expect(moveFocus({ row: 3, col: 2 }, size, key("End", true))).toEqual({ row: 10, col: 4 });
  });
  test("Page Up and Page Down move by the visible height", () => {
    expect(moveFocus({ row: 2, col: 1 }, size, key("PageDown"))).toEqual({ row: 7, col: 1 });
    expect(moveFocus({ row: 8, col: 1 }, size, key("PageDown"))).toEqual({ row: 10, col: 1 });
    expect(moveFocus({ row: 8, col: 1 }, size, key("PageUp"))).toEqual({ row: 3, col: 1 });
    expect(moveFocus({ row: 2, col: 1 }, size, key("PageUp", false, 0))).toEqual({
      row: 1,
      col: 1,
    });
  });
  test("other keys are not grid keys", () => {
    expect(moveFocus({ row: 1, col: 1 }, size, key("a"))).toBeNull();
    expect(moveFocus({ row: 1, col: 1 }, size, key("Tab"))).toBeNull();
  });
});
