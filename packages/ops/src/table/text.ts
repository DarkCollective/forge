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
 * The text forms of a table.
 *
 * The faithful form (`toText` and `fromText` of the kind, X0 R10) is JSON with a column header and nulls:
 *
 *   {"columns":[{"name":"id","type":"int"},{"name":"s","type":"str"}],"rows":[[1,"a"],[null,""]]}
 *
 * It tells a null from the empty string and an int from a num, and it keeps every cell exactly:
 * an `int` beyond 2^53 is written as a string of digits (a JSON number would lose it in a reader that
 * uses doubles) and read back as an int; a `num` is finite, and -0 is written `-0`. Only this text is read
 * back: `fromText(toText(p))` equals `p`.
 *
 * The export forms (`table:to-json`, `table:to-csv`) are written here too, straight from the columns,
 * because building a list of records first would cost far more than the table it came from (X0 section 4.3).
 */
import { ForgeError } from "@forge/lang";
import { COLUMN_TYPES, INT64_MAX, INT64_MIN, buildPayload, cellAt } from "./payload.js";
import type { Cell, ColumnInput, ColumnType, TableColumn, TablePayload } from "./payload.js";

function coerceError(reason: string, offset: number): ForgeError {
  return new ForgeError({
    code: "E_COERCE",
    message: `cannot convert str to table: ${reason}`,
    detail: { from: "str", to: "table", reason, offset },
  });
}

// ---------------------------------------------------------------------------------------------
// Cell text
// ---------------------------------------------------------------------------------------------

const SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);
const SAFE_MIN = -SAFE_MAX;

/** The JSON text of a number that is finite: -0 stays `-0`. */
function numberText(n: number): string {
  return Object.is(n, -0) ? "-0" : String(n);
}

/** The JSON text of a cell of the faithful form: an int beyond 2^53 is a string of digits. */
function faithfulCell(cell: Cell): string {
  if (cell === null) return "null";
  switch (typeof cell) {
    case "string":
      return JSON.stringify(cell);
    case "bigint":
      return cell >= SAFE_MIN && cell <= SAFE_MAX ? cell.toString() : `"${cell.toString()}"`;
    case "number":
      return numberText(cell);
    case "boolean":
      return cell ? "true" : "false";
  }
}

/** The text of a cell as a viewer shows it: null for a null cell, the text of the value otherwise. */
export function cellDisplay(cell: Cell): string | null {
  if (cell === null) return null;
  if (typeof cell === "number") return numberText(cell);
  return String(cell);
}

// ---------------------------------------------------------------------------------------------
// The faithful form
// ---------------------------------------------------------------------------------------------

/** The faithful text, stopping once it is longer than `max` code units (`Infinity` writes it all). */
export function writeFaithful(p: TablePayload, max: number): string {
  const head = `{"columns":[${p.columns
    .map((c) => `{"name":${JSON.stringify(c.name)},"type":"${c.type}"}`)
    .join(",")}],"rows":[`;
  const parts: string[] = [head];
  let length = head.length;
  for (let i = 0; i < p.rows && length <= max; i++) {
    let row = i === 0 ? "[" : ",[";
    for (let k = 0; k < p.columns.length; k++) {
      row += (k === 0 ? "" : ",") + faithfulCell(cellAt(p.columns[k] as TableColumn, i));
    }
    row += "]";
    parts.push(row);
    length += row.length;
  }
  parts.push("]}");
  return parts.join("");
}

/**
 * The UTF-16 offset of the first character at which `text` stops being JSON (RFC 8259), or `text.length`
 * when it ends too early, or 0 when it is JSON after all. The engines' own messages no longer carry a
 * position, and a position is what the parameter field of a recipe shows.
 */
export function jsonErrorOffset(text: string): number {
  const n = text.length;
  let i = 0;
  const ws = (): void => {
    while (i < n && " \t\n\r".includes(text[i] as string)) i++;
  };
  const literal = (word: string): boolean => {
    for (let k = 0; k < word.length; k++) {
      if (text[i + k] !== word[k]) {
        i += k;
        return false;
      }
    }
    i += word.length;
    return true;
  };
  const digits = (): boolean => {
    const from = i;
    while (i < n && text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 57) i++;
    return i > from;
  };
  const stringBody = (): boolean => {
    i++; // the opening quote
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        i++;
        return true;
      }
      if (c < 0x20) return false;
      if (c === 0x5c) {
        const e = text[i + 1];
        if (e !== undefined && '"\\/bfnrt'.includes(e)) i += 2;
        else if (e === "u" && /^[0-9A-Fa-f]{4}$/.test(text.slice(i + 2, i + 6))) i += 6;
        else {
          i += e === "u" ? 2 : 1;
          return false;
        }
      } else i++;
    }
    return false;
  };
  const value = (depth: number): boolean => {
    ws();
    const c = text[i];
    if (c === undefined || depth > 64) return false;
    if (c === "{" || c === "[") {
      const close = c === "{" ? "}" : "]";
      i++;
      ws();
      if (text[i] === close) {
        i++;
        return true;
      }
      for (;;) {
        if (c === "{") {
          ws();
          if (text[i] !== '"' || !stringBody()) return false;
          ws();
          if (text[i] !== ":") return false;
          i++;
        }
        if (!value(depth + 1)) return false;
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === close) {
          i++;
          return true;
        }
        return false;
      }
    }
    if (c === '"') return stringBody();
    if (c === "t") return literal("true");
    if (c === "f") return literal("false");
    if (c === "n") return literal("null");
    if (c === "-") i++;
    if (text[i] === "0") i++;
    else if (!digits()) return false;
    if (text[i] === ".") {
      i++;
      if (!digits()) return false;
    }
    if (text[i] === "e" || text[i] === "E") {
      i++;
      if (text[i] === "+" || text[i] === "-") i++;
      if (!digits()) return false;
    }
    return true;
  };
  if (!value(0)) return i;
  ws();
  return i < n ? i : 0;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

const INT_TEXT = /^-?(0|[1-9][0-9]*)$/;

/** Reads one cell of a column, or throws `E_COERCE` naming the cell. */
function readCell(x: unknown, type: ColumnType, where: string): Cell {
  if (x === null) return null;
  switch (type) {
    case "str":
      if (typeof x === "string") return x;
      break;
    case "bool":
      if (typeof x === "boolean") return x;
      break;
    case "num":
      if (typeof x === "number") return x;
      break;
    case "int":
      if (typeof x === "number") {
        if (Number.isSafeInteger(x)) return BigInt(x);
        throw coerceError(
          `${where} is not a safe integer (write integers beyond 2^53 as a string of digits)`,
          0,
        );
      }
      if (typeof x === "string" && INT_TEXT.test(x)) {
        const n = BigInt(x);
        if (n >= INT64_MIN && n <= INT64_MAX) return n;
        throw coerceError(`${where} is outside the 64-bit integer range`, 0);
      }
      break;
  }
  throw coerceError(`${where} is not a ${type} or null`, 0);
}

/**
 * Reads the faithful text. A fault is `E_COERCE` with `detail.offset`: the offset of a JSON syntax error,
 * and 0 for a fault in the shape (the text parses, but is not a table).
 */
export function readFaithful(text: string): TablePayload {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw coerceError(
      `not JSON (${(e as Error).message})`,
      Math.min(jsonErrorOffset(text), text.length),
    );
  }
  if (!isObject(json) || Object.keys(json).length !== 2) {
    throw coerceError('expected an object with exactly "columns" and "rows"', 0);
  }
  const header = json["columns"];
  const body = json["rows"];
  if (!Array.isArray(header)) throw coerceError('"columns" is not a list', 0);
  if (!Array.isArray(body)) throw coerceError('"rows" is not a list', 0);
  const names = new Set<string>();
  const types: ColumnType[] = [];
  const cols: string[] = [];
  header.forEach((h: unknown, k) => {
    if (!isObject(h) || Object.keys(h).length !== 2) {
      throw coerceError(`column ${k + 1} is not an object with "name" and "type"`, 0);
    }
    const { name, type } = h as { name?: unknown; type?: unknown };
    if (typeof name !== "string")
      throw coerceError(`the name of column ${k + 1} is not a string`, 0);
    if (!COLUMN_TYPES.includes(type as ColumnType)) {
      throw coerceError(`column '${name}' has an unknown type`, 0);
    }
    if (names.has(name)) throw coerceError(`the column name '${name}' is repeated`, 0);
    names.add(name);
    cols.push(name);
    types.push(type as ColumnType);
  });
  const cells: Cell[][] = cols.map(() => new Array<Cell>(body.length));
  body.forEach((row: unknown, i) => {
    if (!Array.isArray(row) || row.length !== cols.length) {
      throw coerceError(`row ${i + 1} is not a list of ${cols.length} cells`, 0);
    }
    for (let k = 0; k < cols.length; k++) {
      (cells[k] as Cell[])[i] = readCell(
        row[k],
        types[k] as ColumnType,
        `cell ${k + 1} of row ${i + 1}`,
      );
    }
  });
  const inputs: ColumnInput[] = cols.map((name, k) => ({
    name,
    type: types[k] as ColumnType,
    cells: cells[k] as Cell[],
  }));
  return buildPayload(body.length, inputs);
}

// ---------------------------------------------------------------------------------------------
// JSON and CSV export
// ---------------------------------------------------------------------------------------------

/** A cell as JSON: a null is `null`; an int is its digits (a reader that wants more than 2^53 must use a big-integer reader). */
function jsonCell(cell: Cell): string {
  if (cell === null) return "null";
  if (typeof cell === "string") return JSON.stringify(cell);
  if (typeof cell === "bigint") return cell.toString();
  if (typeof cell === "number") return numberText(cell);
  return cell ? "true" : "false";
}

/** The table as a JSON array of objects keyed by the column names, indented by `indent` spaces a level (0 is compact). */
export function writeJson(p: TablePayload, indent: number): string {
  if (p.rows === 0) return "[]";
  const keys = p.columns.map((c) => JSON.stringify(c.name));
  const pretty = indent > 0;
  const pad1 = " ".repeat(indent);
  const pad2 = pad1 + pad1;
  const objects: string[] = [];
  for (let i = 0; i < p.rows; i++) {
    const fields: string[] = [];
    for (let k = 0; k < p.columns.length; k++) {
      const value = jsonCell(cellAt(p.columns[k] as TableColumn, i));
      fields.push(pretty ? `${pad2}${keys[k]}: ${value}` : `${keys[k]}:${value}`);
    }
    objects.push(
      pretty
        ? fields.length === 0
          ? `${pad1}{}`
          : `${pad1}{\n${fields.join(",\n")}\n${pad1}}`
        : `{${fields.join(",")}}`,
    );
  }
  return pretty ? `[\n${objects.join(",\n")}\n]` : `[${objects.join(",")}]`;
}

/**
 * The table as CSV (RFC 4180): a header row, then a row for each row. A null is an empty cell and the empty
 * string is `""`, so the two stay apart for a reader that can tell a quoted cell from a bare one. (A table of
 * one column cannot show a null row: it would be an empty line, which readers skip.) A cell is quoted when it
 * holds a delimiter, a double quote, a CR or an LF, or is empty. Every row, the last included, ends with the
 * row delimiter.
 */
export function writeCsv(p: TablePayload, cellDelimiter: string, rowDelimiter: string): string {
  const quote = (s: string): string => `"${s.replaceAll('"', '""')}"`;
  const field = (s: string): string =>
    s === "" || /["\r\n]/.test(s) || s.includes(cellDelimiter) || s.includes(rowDelimiter)
      ? quote(s)
      : s;
  const lines: string[] = [];
  lines.push(p.columns.map((c) => field(c.name)).join(cellDelimiter));
  for (let i = 0; i < p.rows; i++) {
    const cells: string[] = [];
    for (const c of p.columns) {
      const cell = cellAt(c, i);
      cells.push(cell === null ? "" : field(cellDisplay(cell) as string));
    }
    lines.push(cells.join(cellDelimiter));
  }
  return p.columns.length === 0 ? "" : lines.join(rowDelimiter) + rowDelimiter;
}
