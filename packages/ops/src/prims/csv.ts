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
 * csv primitives: the RFC 4180 reader and writer behind the `csv` words. A per-character FL scanner (quotes,
 * doubled quotes, delimiters inside quoted cells) costs several times the 5.5 VM steps a character of a bare FL
 * loop (see json.ts), so the scan is a primitive; the header rules, the mapping to JSON and every parameter
 * check are FL.
 *
 * There is one tokenizer, `scanCsv`. It reads the text once, a cell at a time, and hands each cell to a sink; the
 * sinks are the two readers below, so the list-of-lists path and the table path cannot disagree about CSV:
 *
 *  - `_parse ( data:str cells:str rows:str -- list )`: a list of rows, each a list of str (the old path, behind
 *    `csv:to-json`).
 *  - `_to-table ( data:str cells:str rows:str quote:str header:bool -- ext{table} )`: typed columns, built as the
 *    cells are read (D1), with no list of rows between. An empty unquoted cell is null, an empty quoted cell
 *    (`""`) is the empty string; the column types are inferred from the text (src/table/builder.ts).
 *
 * The rules of the text, for both: every character of `cells` ends a cell and every character of `rows` ends a
 * row (the delimiters are sets of characters); a CR directly followed by an LF counts as one row end when both are
 * row delimiters. A cell that starts with the quote character runs to the closing quote and may hold delimiters
 * and line breaks, and a doubled quote in it is one quote; a quote inside an unquoted cell is kept as it is. A
 * quoted cell followed by anything but a delimiter or the end, and an unterminated quote, are E_COERCE naming the
 * offset, line and column. An empty line is skipped, and the last row needs no row end. A byte order mark at the
 * start is dropped.
 *
 *  - `_write ( rows:list cell:str row:str -- str )`: rows (lists of str) joined with `cell` between cells and
 *    `row` after every row (the text ends with a row delimiter; no rows give empty text). A cell is quoted when it holds the cell or row delimiter,
 *    a double quote, a CR or an LF; a row of one empty cell is written `""` so it is not an empty line.
 *
 * Delimiter strings are read for the escapes `\r \n \t \\` and `\xHH` (so a user can type `\r\n`
 * in a text box); any other backslash is kept.
 */
import { ForgeError, definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef, Value } from "@forge/lang";
import { limitFailure, rangeFailure } from "../prim-util.js";
import { inferTextColumn } from "../table/builder.js";
import { registerTableKind } from "../table/kind.js";
import { buildPayload } from "../table/payload.js";
import type { ColumnInput, TablePayload } from "../table/payload.js";

registerTableKind();

const { str, list } = valueHelpers;

/** The delimiter text with the escapes `\r \n \t \\ \xHH` read; other backslashes stay. */
export function unescapeDelimiter(s: string): string {
  return s.replace(
    /\\(?:x([0-9A-Fa-f]{2})|([rnt\\]))/g,
    (_m, hex: string | undefined, c: string | undefined) => {
      if (hex !== undefined) return String.fromCharCode(Number.parseInt(hex, 16));
      return c === "r" ? "\r" : c === "n" ? "\n" : c === "t" ? "\t" : "\\";
    },
  );
}

function coercion(s: string, at: number, reason: string, row: number): ForgeError {
  let cp = 0;
  let line = 1;
  let col = 1;
  for (let k = 0; k < at; k++) {
    const c = s.charCodeAt(k);
    if (c >= 0xd800 && c <= 0xdbff && k + 1 < at) k++;
    cp++;
    if (c === 0x0a) {
      line++;
      col = 1;
    } else col++;
  }
  return new ForgeError({
    code: "E_COERCE",
    message: `cannot convert str to CSV rows: ${reason} at offset ${cp} (line ${line}, column ${col}, row ${row})`,
    detail: { from: "str", to: "csv", reason, offset: cp, line, column: col, row },
  });
}

/** What the tokenizer hands its reader: each cell with whether it was quoted, then the end of each row. */
interface CsvSink {
  cell(text: string, quoted: boolean): void;
  endRow(): void;
}

interface CsvSyntax {
  readonly cells: ReadonlySet<string>;
  readonly rowEnds: ReadonlySet<string>;
  /** The quote character, one UTF-16 code unit. */
  readonly quote: number;
}

/** The delimiter and quote arguments, escapes read and checked. */
function syntaxOf(cellsArg: string, rowsArg: string, quoteArg: string): CsvSyntax {
  const cells = new Set(Array.from(unescapeDelimiter(cellsArg)));
  const rowEnds = new Set(Array.from(unescapeDelimiter(rowsArg)));
  if (quoteArg.length !== 1) throw rangeFailure("the quote must be one character (a code unit)");
  if (cells.size === 0) throw rangeFailure("the cell delimiter must not be empty");
  if (rowEnds.size === 0) throw rangeFailure("the row delimiter must not be empty");
  if (cells.has(quoteArg) || rowEnds.has(quoteArg)) {
    throw rangeFailure("a delimiter cannot be the quote character");
  }
  for (const c of cells) {
    if (rowEnds.has(c)) throw rangeFailure("a character cannot be both a cell and a row delimiter");
  }
  return { cells, rowEnds, quote: quoteArg.charCodeAt(0) };
}

const D_NONE = 0;
const D_CELL = 1;
const D_ROW = 2;
const D_ASTRAL = 3; // a high surrogate: look at the whole code point

/**
 * Reads `dataArg` as CSV and feeds the sink. The loop works on UTF-16 code units through a table of the
 * delimiters (a code point beyond the BMP is looked up as a whole only where a delimiter is one), and slices
 * every unquoted cell out of the text at once: 100,000 rows of ten cells take well under a second.
 */
function scanCsv(dataArg: string, syntax: CsvSyntax, sink: CsvSink): void {
  const data = dataArg.charCodeAt(0) === 0xfeff ? dataArg.slice(1) : dataArg;
  const kinds = new Uint8Array(65536);
  for (const [set, kind] of [
    [syntax.cells, D_CELL],
    [syntax.rowEnds, D_ROW],
  ] as const) {
    for (const ch of set) {
      const cp = ch.codePointAt(0) as number;
      if (cp < 0x10000) kinds[cp] = kind;
      else {
        kinds[ch.charCodeAt(0)] = D_ASTRAL;
      }
    }
  }
  const quote = syntax.quote;
  const n = data.length;
  let row = 1;
  let i = 0;
  let dlen = 0; // the length of the delimiter delimAt last found

  /** The delimiter at i (D_CELL, D_ROW or D_NONE); sets dlen. */
  const delimAt = (at: number): number => {
    const k = kinds[data.charCodeAt(at)] as number;
    if (k === D_NONE) return D_NONE;
    if (k === D_ASTRAL) {
      const ch = String.fromCodePoint(data.codePointAt(at) as number);
      dlen = ch.length;
      return syntax.cells.has(ch) ? D_CELL : syntax.rowEnds.has(ch) ? D_ROW : D_NONE;
    }
    dlen = 1;
    return k;
  };
  /** Moves past a row delimiter at i; a CR followed by an LF is one when both are row delimiters. */
  const skipRowEnd = (): void => {
    const cr = data.charCodeAt(i) === 0x0d;
    i += dlen;
    if (cr && data.charCodeAt(i) === 0x0a && kinds[0x0a] === D_ROW) i++;
  };

  while (i < n) {
    if (delimAt(i) === D_ROW) {
      skipRowEnd(); // an empty line
      continue;
    }
    for (;;) {
      let text: string;
      let quoted = false;
      if (i < n && data.charCodeAt(i) === quote) {
        quoted = true;
        const open = i;
        i++;
        let from = i;
        text = "";
        for (;;) {
          const q = data.indexOf(String.fromCharCode(quote), i);
          if (q < 0) throw coercion(data, open, "unterminated quoted cell", row);
          text += data.slice(from, q);
          if (data.charCodeAt(q + 1) === quote) {
            text += String.fromCharCode(quote);
            i = q + 2;
            from = i;
            continue;
          }
          i = q + 1;
          break;
        }
        if (i < n && delimAt(i) === D_NONE) {
          throw coercion(data, i, "text after the closing quote of a cell", row);
        }
      } else {
        const start = i;
        while (i < n) {
          const k = kinds[data.charCodeAt(i)] as number;
          if (k === D_NONE) i++;
          else if (k !== D_ASTRAL || delimAt(i) !== D_NONE) break;
          else i++;
        }
        text = data.slice(start, i);
      }
      sink.cell(text, quoted);
      if (i >= n) {
        sink.endRow();
        return;
      }
      if (delimAt(i) === D_CELL) {
        i += dlen;
        continue;
      }
      skipRowEnd();
      sink.endRow();
      row++;
      break;
    }
  }
}

function parse(dataArg: string, cellsArg: string, rowsArg: string, ctx: PrimitiveContext): Value[] {
  const syntax = syntaxOf(cellsArg, rowsArg, '"');
  const max = ctx.limits.maxValueBytes;
  let size = 0;
  const account = (bytes: number) => {
    size += bytes;
    if (size > max) throw limitFailure("maxValueBytes", max, size, "CSV rows");
  };
  const rows: Value[] = [];
  let row: Value[] = [];
  scanCsv(dataArg, syntax, {
    cell(text) {
      account(24 + text.length * 2);
      row.push(str(text));
    },
    endRow() {
      account(8);
      rows.push(list(row));
      row = [];
    },
  });
  return rows;
}

/** An error for a row that is not as wide as the header (or, without a header, the first row). */
function raggedRow(row: number, cells: number | null, width: number, header: boolean): ForgeError {
  const was = header ? "the header has" : "the first row has";
  const reason =
    cells === null
      ? `CSV row ${row} has more cells than ${was} (${width})`
      : `CSV row ${row} has ${cells} cells but ${was} ${width}`;
  return new ForgeError({
    code: "E_COERCE",
    message: `cannot convert str to table: ${reason}`,
    detail: { from: "str", to: "table", reason, row },
  });
}

/**
 * Reads CSV into a table: the cells go straight into one array per column, and each column's type is inferred
 * when the text has been read. With `header` the first row names the columns (a repeated name is E_COERCE);
 * without it the columns are `c1`, `c2` and so on. A row of another width than the first is E_COERCE.
 */
export function csvToTable(
  data: string,
  cellsArg: string,
  rowsArg: string,
  quoteArg: string,
  header: boolean,
  ctx: PrimitiveContext,
): TablePayload {
  const syntax = syntaxOf(cellsArg, rowsArg, quoteArg);
  let names: string[] | null = null;
  let cols: (string | null)[][] = [];
  let first: (string | null)[] = []; // the cells of the first row, until its width is known
  let k = 0;
  let row = 1;
  let rows = 0;
  scanCsv(data, syntax, {
    cell(text, quoted) {
      const cell = text === "" && !quoted ? null : text;
      if (names === null) first.push(cell);
      else {
        if (k >= cols.length) throw raggedRow(row, null, cols.length, header);
        (cols[k] as (string | null)[])[rows] = cell;
        k++;
      }
    },
    endRow() {
      if (names === null) {
        if (header) {
          names = first.map((c) => c ?? "");
          const seen = new Set<string>();
          for (const name of names) {
            if (seen.has(name)) {
              const reason = `the header repeats the column name '${name}'`;
              throw new ForgeError({
                code: "E_COERCE",
                message: `cannot convert str to table: ${reason}`,
                detail: { from: "str", to: "table", reason },
              });
            }
            seen.add(name);
          }
          cols = names.map(() => []);
        } else {
          names = first.map((_c, j) => `c${j + 1}`);
          cols = first.map((c) => [c]);
          rows = 1;
        }
        first = [];
      } else {
        if (k !== cols.length) throw raggedRow(row, k, cols.length, header);
        rows++;
      }
      k = 0;
      row++;
    },
  });
  const inputs: ColumnInput[] = (names ?? []).map((name, j) =>
    inferTextColumn(name, cols[j] as (string | null)[]),
  );
  const payload = buildPayload(rows, inputs);
  const max = ctx.limits.maxValueBytes;
  if (payload.size > max) throw limitFailure("maxValueBytes", max, payload.size, "CSV table");
  return payload;
}

function write(
  rows: readonly Value[],
  cellArg: string,
  rowArg: string,
  ctx: PrimitiveContext,
): string {
  const cell = unescapeDelimiter(cellArg);
  const rowEnd = unescapeDelimiter(rowArg);
  if (cell === "") throw rangeFailure("the cell delimiter must not be empty");
  if (rowEnd === "") throw rangeFailure("the row delimiter must not be empty");
  if (cell.includes('"') || rowEnd.includes('"')) {
    throw rangeFailure("a delimiter cannot contain the double quote");
  }
  const max = ctx.limits.maxValueBytes;
  let out = "";
  rows.forEach((r, ri) => {
    if (r.tag !== "list") throw typeFailure(`row ${ri + 1}`, r.tag);
    const items = r.v as readonly Value[];
    if (ri > 0) out += rowEnd;
    items.forEach((c, ci) => {
      if (c.tag !== "str") throw typeFailure(`cell ${ci + 1} of row ${ri + 1}`, c.tag);
      const text = c.v as string;
      if (ci > 0) out += cell;
      const quoted =
        (text === "" && items.length === 1) ||
        /["\r\n]/.test(text) ||
        text.includes(cell) ||
        text.includes(rowEnd);
      out += quoted ? `"${text.replace(/"/g, '""')}"` : text;
    });
    if (out.length * 2 > max) throw limitFailure("maxValueBytes", max, out.length * 2, "CSV text");
  });
  // the text ends with a row delimiter after the last row
  if (rows.length > 0) out += rowEnd;
  return out;
}

function typeFailure(what: string, tag: string): ForgeError {
  return new ForgeError({
    code: "E_TYPE",
    message: `${what} must be a str (rows are lists of str), not a ${tag}`,
    detail: { what, tag },
  });
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("csv", "_parse", "( data:str cells:str rows:str -- list )", parse, {
    doc: "Private. RFC 4180 text to a list of rows (lists of str). Each character of cells ends a cell and each character of rows ends a row (a CR before an LF is one row end when both are row delimiters); both strings read the escapes \\r \\n \\t \\\\ and \\xHH. A cell that starts with a double quote runs to the closing quote and may hold delimiters and line breaks (a doubled quote is one quote). An unterminated quote or text after a closing quote is E_COERCE with the position; empty lines are skipped.",
  }),
  definePrimitive(
    "csv",
    "_to-table",
    "( data:str cells:str rows:str quote:str header:bool -- ext{table} )",
    (
      data: string,
      cells: string,
      rows: string,
      quote: string,
      header: boolean,
      ctx: PrimitiveContext,
    ) => csvToTable(data, cells, rows, quote, header, ctx),
    {
      doc: "Private. RFC 4180 text to a table, straight into typed columns. The delimiters and the quote are those of csv:_parse (the quote is one character). An empty unquoted cell is null and an empty quoted cell is the empty string; a column is int, num or bool when every non-null cell reads as one, and str otherwise. With header the first row names the columns; without it they are c1, c2, and so on. A row of another width, a repeated header name, an unterminated quote or text after a closing quote is E_COERCE.",
    },
  ),
  definePrimitive("csv", "_write", "( rows:list cell:str row:str -- str )", write, {
    doc: "Private. A list of rows (lists of str) as RFC 4180 text: cell between cells, row between rows (none after the last; both read the escapes of csv:_parse). A cell is quoted when it holds the delimiters, a double quote, a CR or an LF.",
  }),
];
