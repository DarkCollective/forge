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
 * csv primitives: the RFC 4180 reader and writer behind `csv:to-json` and `csv:from-json`. A per-character FL
 * scanner (quotes, doubled quotes, delimiters inside quoted cells) costs several times the 5.5 VM steps a
 * character of a bare FL loop (see json.ts), so the scan is a primitive; the rows-to-JSON mapping, the header rules and every parameter check are FL.
 *
 *  - `_parse ( data:str cells:str rows:str -- list )`: a list of rows, each a list of str. Every character of
 *    `cells` ends a cell and every character of `rows` ends a row (CyberChef's behaviour: its delimiters are sets
 *    of characters); a CR directly followed by an LF counts as one row end when both are row delimiters. A cell
 *    that starts with a double quote runs to the closing quote and may hold delimiters and line breaks, and a
 *    doubled quote in it is one quote; a quote inside an unquoted cell is kept as it is. A quoted cell followed
 *    by anything but a delimiter or the end, and an unterminated quote, are E_COERCE naming the offset, line and
 *    column. An empty line is skipped, and the last row needs no row end.
 *  - `_write ( rows:list cell:str row:str -- str )`: rows (lists of str) joined with `cell` between cells and
 *    `row` between rows (no row end after the last). A cell is quoted when it holds the cell or row delimiter,
 *    a double quote, a CR or an LF; a row of one empty cell is written `""` so it is not an empty line.
 *
 * Both delimiter strings are read for the escapes `\r \n \t \\` and `\xHH` (so a user can type `\r\n`
 * in a text box); any other backslash is kept.
 */
import { ForgeError, definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef, Value } from "@forge/lang";
import { limitFailure, rangeFailure } from "../prim-util.js";

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

function parse(data: string, cellsArg: string, rowsArg: string, ctx: PrimitiveContext): Value[] {
  const cells = new Set(Array.from(unescapeDelimiter(cellsArg)));
  const rowEnds = new Set(Array.from(unescapeDelimiter(rowsArg)));
  if (cells.size === 0) throw rangeFailure("the cell delimiter must not be empty");
  if (rowEnds.size === 0) throw rangeFailure("the row delimiter must not be empty");
  if (cells.has('"') || rowEnds.has('"')) {
    throw rangeFailure("a delimiter cannot be the double quote");
  }
  for (const c of cells) {
    if (rowEnds.has(c)) throw rangeFailure("a character cannot be both a cell and a row delimiter");
  }
  const max = ctx.limits.maxValueBytes;
  let size = 0;
  const account = (bytes: number) => {
    size += bytes;
    if (size > max) throw limitFailure("maxValueBytes", max, size, "CSV rows");
  };

  const n = data.length;
  const rows: Value[] = [];
  let row: Value[] = [];
  let field = "";
  let started = false; // the current row has a character, a delimiter or a quoted cell
  let atStart = true; // the next character begins a cell
  let i = 0;

  const endField = () => {
    account(24 + field.length * 2);
    row.push(str(field));
    field = "";
    atStart = true;
  };
  const endRow = () => {
    if (started) {
      endField();
      account(8);
      rows.push(list(row));
    }
    row = [];
    started = false;
    atStart = true;
  };

  while (i < n) {
    const cp = data.codePointAt(i) as number;
    const ch = String.fromCodePoint(cp);
    if (cp === 0x22 && atStart) {
      // a quoted cell: runs to the closing quote; "" is one quote
      const open = i;
      i++;
      started = true;
      atStart = false;
      let from = i;
      for (;;) {
        const q = data.indexOf('"', i);
        if (q < 0) throw coercion(data, open, "unterminated quoted cell", rows.length + 1);
        field += data.slice(from, q);
        if (data.charCodeAt(q + 1) === 0x22) {
          field += '"';
          i = q + 2;
          from = i;
          continue;
        }
        i = q + 1;
        break;
      }
      if (i < n) {
        const next = String.fromCodePoint(data.codePointAt(i) as number);
        if (!cells.has(next) && !rowEnds.has(next)) {
          throw coercion(data, i, "text after the closing quote of a cell", rows.length + 1);
        }
      }
      continue;
    }
    i += ch.length;
    if (cells.has(ch)) {
      started = true;
      endField();
    } else if (rowEnds.has(ch)) {
      if (ch === "\r" && data.charCodeAt(i) === 0x0a && rowEnds.has("\n")) i++;
      endRow();
    } else {
      started = true;
      atStart = false;
      field += ch;
    }
  }
  endRow();
  return rows;
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
  definePrimitive("csv", "_write", "( rows:list cell:str row:str -- str )", write, {
    doc: "Private. A list of rows (lists of str) as RFC 4180 text: cell between cells, row between rows (none after the last; both read the escapes of csv:_parse). A cell is quoted when it holds the delimiters, a double quote, a CR or an LF.",
  }),
];
