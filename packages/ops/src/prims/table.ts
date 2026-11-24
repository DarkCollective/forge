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
 * table primitives: the private words under `vocab/table.fth`. The value itself (columns, null mask, text
 * form, size) is `src/table/`; what is here is the glue FL cannot do, which is building typed columns from FL
 * values and reading them back out, and writing the JSON and CSV text straight from the columns (a list of
 * records per row would cost far more than the table, X0 section 4.3). Loading this module registers the
 * `table` kind.
 *
 *  - `_from-rows ( names:list rows:list -- ext{table} )`: a table from the column names (strings, no repeat) and
 *    a list of rows, each a list with one cell per column. A cell is a str, an int (within 64 bits), a num, a
 *    bool or `null`. A column takes the one type its cells have (an int and a num make a num; a column of nulls
 *    only is a str column); a column that mixes other types is E_COERCE.
 *  - `_from-text ( text:str -- ext{table} )`: a table from its text form.
 *  - `_columns`, `_types`, `_rows`, `_column`, `_count`: the table read back as FL values.
 *  - `_to-json ( t indent:int -- str )`, `_to-csv ( t cell:str row:str -- str )`.
 */
import { ForgeError, definePrimitive, nullValue, valueHelpers } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef, Value } from "@forge/lang";
import { limitFailure, rangeFailure } from "../prim-util.js";
import { INT64_MAX, INT64_MIN, buildPayload, cellAt } from "../table/payload.js";
import type { Cell, ColumnInput, ColumnType, TablePayload } from "../table/payload.js";
import { registerTableKind } from "../table/kind.js";
import { readFaithful, writeCsv, writeJson } from "../table/text.js";
import { unescapeDelimiter } from "./csv.js";

registerTableKind();

const { str, list, bool, num, int } = valueHelpers;

function coerce(reason: string): ForgeError {
  return new ForgeError({
    code: "E_COERCE",
    message: `cannot build a table: ${reason}`,
    detail: { from: "list", to: "table", reason },
  });
}

function typeError(what: string, tag: string): ForgeError {
  return new ForgeError({
    code: "E_TYPE",
    message: `${what} must be a str, int, num, bool or null, not a ${tag}`,
    detail: { what, tag },
  });
}

/** A cell of a row: its tag, or "null" for the null value. */
function tagOf(v: Value, what: string): string {
  if (v.tag === "ext") {
    if (v.kind === "null") return "null";
    throw typeError(what, `ext{${v.kind}}`);
  }
  if (v.tag === "str" || v.tag === "int" || v.tag === "num" || v.tag === "bool") return v.tag;
  throw typeError(what, v.tag);
}

function columnOf(name: string, cells: readonly Value[], rows: number): ColumnInput {
  const tags = new Set<string>();
  cells.forEach((v, i) => tags.add(tagOf(v, `cell ${i + 1} of column '${name}'`)));
  tags.delete("null");
  const where = `column '${name}'`;
  let type: ColumnType;
  if (tags.size === 0 || (tags.size === 1 && tags.has("str"))) type = "str";
  else if (tags.size === 1 && tags.has("bool")) type = "bool";
  else if (tags.size === 1 && tags.has("int")) type = "int";
  else if (tags.size === 1 && tags.has("num")) type = "num";
  else if (tags.size === 2 && tags.has("int") && tags.has("num")) type = "num";
  else throw coerce(`${where} mixes ${[...tags].sort().join(" and ")}`);
  const out: Cell[] = new Array<Cell>(rows);
  for (let i = 0; i < rows; i++) {
    const v = cells[i] as Value;
    if (v.tag === "ext") {
      out[i] = null;
      continue;
    }
    switch (type) {
      case "int": {
        const n = BigInt(v.v as number | bigint);
        if (n < INT64_MIN || n > INT64_MAX) {
          throw coerce(
            `${where} holds an integer outside 64 bits (keep such digits in a str column)`,
          );
        }
        out[i] = n;
        break;
      }
      case "num":
        if (v.tag === "int" && typeof v.v === "bigint") {
          throw coerce(`${where} mixes a num with an integer beyond 2^53`);
        }
        out[i] = Number(v.v);
        break;
      default:
        out[i] = v.v as Cell;
    }
  }
  return { name, type, cells: out };
}

function fromRows(names: readonly Value[], rowValues: readonly Value[]): TablePayload {
  const seen = new Set<string>();
  const header = names.map((n, k) => {
    if (n.tag !== "str") throw typeError(`name ${k + 1}`, n.tag);
    if (seen.has(n.v)) throw coerce(`the column name '${n.v}' is repeated`);
    seen.add(n.v);
    return n.v;
  });
  const cols: Value[][] = header.map(() => new Array<Value>(rowValues.length));
  rowValues.forEach((r, i) => {
    if (r.tag !== "list") throw typeError(`row ${i + 1}`, r.tag);
    if (r.v.length !== header.length) {
      throw coerce(`row ${i + 1} has ${r.v.length} cells but there are ${header.length} columns`);
    }
    for (let k = 0; k < header.length; k++) (cols[k] as Value[])[i] = r.v[k] as Value;
  });
  return buildPayload(
    rowValues.length,
    header.map((name, k) => columnOf(name, cols[k] as Value[], rowValues.length)),
  );
}

/** A cell as an FL value: null is `ext{null}`. */
function valueOf(cell: Cell): Value {
  if (cell === null) return nullValue();
  switch (typeof cell) {
    case "string":
      return str(cell);
    case "bigint":
      return int(cell);
    case "number":
      return num(cell);
    case "boolean":
      return bool(cell);
  }
}

function rowsOf(p: TablePayload, ctx: PrimitiveContext): Value[] {
  // each cell is charged by the VM when the list is returned; stop early on a table that cannot fit
  const cells = p.rows * p.columns.length;
  if (cells * 16 > ctx.limits.maxValueBytes) {
    throw limitFailure("maxValueBytes", ctx.limits.maxValueBytes, cells * 16, "table rows");
  }
  const rows: Value[] = [];
  for (let i = 0; i < p.rows; i++) rows.push(list(p.columns.map((c) => valueOf(cellAt(c, i)))));
  return rows;
}

function guardText(ctx: PrimitiveContext, text: string, what: string): string {
  const max = ctx.limits.maxValueBytes;
  if (text.length * 2 > max) throw limitFailure("maxValueBytes", max, text.length * 2, what);
  return text;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "table",
    "_from-rows",
    "( names:list rows:list -- ext{table} )",
    (names: readonly Value[], rows: readonly Value[]) => fromRows(names, rows),
    {
      doc: "Private. A table from column names (strings, no repeat) and a list of rows (lists with a cell per column). A cell is a str, an int within 64 bits, a num, a bool or null; a column takes the type its cells have (int and num together make num; only nulls make str) and a column that mixes other types is E_COERCE.",
    },
  ),
  definePrimitive("table", "_from-text", "( text:str -- ext{table} )", readFaithful, {
    doc: "Private. A table from its text form: JSON with a column header and rows. Anything else is E_COERCE.",
  }),
  definePrimitive(
    "table",
    "_columns",
    "( t:ext{table} -- list )",
    (p: TablePayload) => p.columns.map((c) => str(c.name)),
    { doc: "Private. The column names, in order." },
  ),
  definePrimitive(
    "table",
    "_types",
    "( t:ext{table} -- list )",
    (p: TablePayload) => p.columns.map((c) => str(c.type)),
    { doc: "Private. The column types (str, int, num or bool), in order." },
  ),
  definePrimitive(
    "table",
    "_rows",
    "( t:ext{table} -- list )",
    (p: TablePayload, ctx: PrimitiveContext) => rowsOf(p, ctx),
    {
      doc: "Private. The rows as a list of lists, a null cell as null.",
    },
  ),
  definePrimitive(
    "table",
    "_column",
    "( t:ext{table} name:str -- list )",
    (p: TablePayload, name: string, ctx: PrimitiveContext) => {
      const col = p.columns.find((c) => c.name === name);
      if (col === undefined) throw rangeFailure(`the table has no column '${name}'`, { name });
      if (p.rows * 16 > ctx.limits.maxValueBytes) {
        throw limitFailure("maxValueBytes", ctx.limits.maxValueBytes, p.rows * 16, "table column");
      }
      const cells: Value[] = [];
      for (let i = 0; i < p.rows; i++) cells.push(valueOf(cellAt(col, i)));
      return cells;
    },
    { doc: "Private. The cells of one column, a null cell as null; E_RANGE for an unknown name." },
  ),
  definePrimitive("table", "_count", "( t:ext{table} -- int )", (p: TablePayload) => p.rows, {
    doc: "Private. The number of rows.",
  }),
  definePrimitive(
    "table",
    "_to-json",
    "( t:ext{table} indent:int -- str )",
    (p: TablePayload, indent: number | bigint, ctx: PrimitiveContext) => {
      const n = Number(indent);
      if (!Number.isInteger(n) || n < 0 || n > 16) throw rangeFailure("indent must be 0 to 16");
      return guardText(ctx, writeJson(p, n), "table JSON text");
    },
    {
      doc: "Private. The table as a JSON array of objects keyed by the column names, indented by indent spaces a level (0 is compact). A null is null; an int is written with all its digits.",
    },
  ),
  definePrimitive(
    "table",
    "_to-csv",
    "( t:ext{table} cell:str row:str -- str )",
    (p: TablePayload, cellArg: string, rowArg: string, ctx: PrimitiveContext) => {
      const cell = unescapeDelimiter(cellArg);
      const row = unescapeDelimiter(rowArg);
      if (cell === "") throw rangeFailure("the cell delimiter must not be empty");
      if (row === "") throw rangeFailure("the row delimiter must not be empty");
      if (cell.includes('"') || row.includes('"')) {
        throw rangeFailure("a delimiter cannot contain the double quote");
      }
      if (cell.includes(row) || row.includes(cell)) {
        throw rangeFailure("the cell and row delimiters must differ");
      }
      return guardText(ctx, writeCsv(p, cell, row), "table CSV text");
    },
    {
      doc: "Private. The table as RFC 4180 text: a header row, then a row for each row, each ending with the row delimiter. A null is an empty cell and the empty string is two double quotes. Both delimiters read the escapes \\r \\n \\t \\\\ and \\xHH.",
    },
  ),
];
