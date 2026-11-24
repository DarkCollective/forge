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
 * Column builders for the table parsers (D1). Neither builds a list of rows: a parser hands cells to a column
 * as it reads them, and the column's type is settled once, at the end.
 *
 *  - `inferTextColumn`: the cells of a CSV column are all text, so the type is read off the text. A cell is
 *    `null` for an empty unquoted cell and a string otherwise (an empty quoted cell is the empty string). The
 *    rule is the one of D2's `from-rows`, applied to what the text looks like, and a column that is not
 *    uniformly one type is a `str` column that keeps the text (CSV cannot fail to be text):
 *      int   every non-null cell is `-?(0|[1-9][0-9]*)` and fits 64 bits (so `007` and `+5` are text)
 *      num   every non-null cell is a decimal or exponent number that is finite (ints and nums together are
 *            num, unless an int is beyond 2^53, which a double would not hold: then the column is str)
 *      bool  every non-null cell is `true` or `false`, in any case
 *      str   anything else, an empty quoted cell included, and a column of nulls only
 *  - `ColumnAccumulator`: columns filled from FL values (the JSON and NDJSON parsers). It follows D2's
 *    `from-rows` exactly: a column takes the one type its cells have, int and num make num, nulls only make
 *    str, and any other mix is `E_COERCE`.
 */
import { ForgeError } from "@forge/lang";
import type { Value } from "@forge/lang";
import { INT64_MAX, INT64_MIN } from "./payload.js";
import type { Cell, ColumnInput, ColumnType } from "./payload.js";

const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

// ---------------------------------------------------------------------------------------------
// Text columns (CSV)
// ---------------------------------------------------------------------------------------------

const K_STR = 0;
const K_INT = 1;
const K_NUM = 2;
const K_BOOL = 3;

const isDigit = (c: number): boolean => c >= 48 && c <= 57;

/** What a cell's text looks like: K_INT, K_NUM, K_BOOL, or K_STR for anything else (including the empty string). */
function classify(t: string): number {
  const n = t.length;
  if (n === 0) return K_STR;
  let i = t.charCodeAt(0) === 45 ? 1 : 0; // a minus sign
  if (i >= n) return K_STR;
  const first = t.charCodeAt(i);
  if (!isDigit(first)) {
    if (n === 4 || n === 5) {
      const lower = t.toLowerCase();
      if (lower === "true" || lower === "false") return K_BOOL;
    }
    return K_STR;
  }
  const digitsFrom = i;
  if (first === 48)
    i++; // a lone leading zero: 0, 0.5, 0e1, but not 007
  else while (i < n && isDigit(t.charCodeAt(i))) i++;
  if (i === n) {
    const digits = i - digitsFrom;
    if (digits > 19) return K_STR; // beyond 64 bits
    if (digits === 19) {
      const b = BigInt(t);
      return b >= INT64_MIN && b <= INT64_MAX ? K_INT : K_STR;
    }
    return K_INT;
  }
  let c = t.charCodeAt(i);
  if (c === 46) {
    i++;
    const from = i;
    while (i < n && isDigit(t.charCodeAt(i))) i++;
    if (i === from) return K_STR;
    c = i < n ? t.charCodeAt(i) : 0;
  }
  if (c === 101 || c === 69) {
    i++;
    if (i < n && (t.charCodeAt(i) === 43 || t.charCodeAt(i) === 45)) i++;
    const from = i;
    while (i < n && isDigit(t.charCodeAt(i))) i++;
    if (i === from) return K_STR;
  }
  if (i !== n) return K_STR;
  return Number.isFinite(Number(t)) ? K_NUM : K_STR;
}

/** True when an int's text is beyond 2^53 in size, so a double would not hold it. */
function beyondSafe(t: string): boolean {
  const digits = t.charCodeAt(0) === 45 ? t.length - 1 : t.length;
  if (digits < 16) return false;
  const b = BigInt(t);
  return b > SAFE || b < -SAFE;
}

/** The typed column of `texts`: null for an empty unquoted cell, text otherwise (see the rule at the top of this file). */
export function inferTextColumn(name: string, texts: (string | null)[]): ColumnInput {
  const n = texts.length;
  const asText: ColumnInput = { name, type: "str", cells: texts };
  let seen = 0; // a bit for each kind among the non-null cells
  for (let i = 0; i < n; i++) {
    const t = texts[i] as string | null;
    if (t === null) continue;
    seen |= 1 << classify(t);
    if ((seen & 1) !== 0) return asText;
  }
  const ints = (seen & 2) !== 0;
  const nums = (seen & 4) !== 0;
  const bools = (seen & 8) !== 0;
  if (bools && (ints || nums)) return asText;
  if (bools) {
    const cells = new Array<Cell>(n);
    for (let i = 0; i < n; i++) {
      const t = texts[i] as string | null;
      cells[i] = t === null ? null : t.length === 4;
    }
    return { name, type: "bool", cells };
  }
  if (nums) {
    const cells = new Array<Cell>(n);
    for (let i = 0; i < n; i++) {
      const t = texts[i] as string | null;
      if (t === null) cells[i] = null;
      else {
        if (ints && classify(t) === K_INT && beyondSafe(t)) return asText;
        cells[i] = Number(t);
      }
    }
    return { name, type: "num", cells };
  }
  if (ints) {
    const cells = new Array<Cell>(n);
    for (let i = 0; i < n; i++) {
      const t = texts[i] as string | null;
      cells[i] = t === null ? null : BigInt(t);
    }
    return { name, type: "int", cells };
  }
  return asText;
}

// ---------------------------------------------------------------------------------------------
// Value columns (JSON)
// ---------------------------------------------------------------------------------------------

const T_STR = 1;
const T_INT = 2;
const T_NUM = 4;
const T_BOOL = 8;

function coerce(reason: string): ForgeError {
  return new ForgeError({
    code: "E_COERCE",
    message: `cannot build a table: ${reason}`,
    detail: { from: "json", to: "table", reason },
  });
}

/** Columns that cells are added to as they are read, a row at a time. */
export class ColumnAccumulator {
  rows = 0;
  private readonly names: string[] = [];
  private readonly index = new Map<string, number>();
  private readonly cols: Cell[][] = [];
  private readonly tags: number[] = [];
  private readonly stamp: number[] = [];

  /** A table whose columns are fixed from the start (an array of arrays with a header). */
  static withNames(names: readonly string[]): ColumnAccumulator {
    const acc = new ColumnAccumulator();
    for (const name of names) {
      if (acc.index.has(name)) throw coerce(`the column name '${name}' is repeated`);
      acc.column(name);
    }
    return acc;
  }

  get width(): number {
    return this.names.length;
  }

  /** The index of a column, created (with nulls for the rows so far) when new. */
  private column(name: string): number {
    let k = this.index.get(name);
    if (k === undefined) {
      k = this.names.length;
      this.index.set(name, k);
      this.names.push(name);
      this.cols.push(new Array<Cell>(this.rows).fill(null));
      this.tags.push(0);
      this.stamp.push(-1);
    }
    return k;
  }

  private cellOf(v: Value, name: string): Cell {
    const where = `column '${name}'`;
    switch (v.tag) {
      case "str":
        return v.v;
      case "bool":
        return v.v;
      case "num":
        return v.v;
      case "int": {
        const b = BigInt(v.v);
        if (b < INT64_MIN || b > INT64_MAX) {
          throw coerce(`${where} holds an integer outside 64 bits`);
        }
        return b;
      }
      case "ext":
        if (v.kind === "null") return null;
        throw coerce(`${where} holds a value of kind ${v.kind}`);
      default:
        throw coerce(`${where} holds a ${v.tag}; a cell is a str, an int, a num, a bool or null`);
    }
  }

  private put(k: number, v: Value): void {
    const cell = this.cellOf(v, this.names[k] as string);
    (this.cols[k] as Cell[]).push(cell);
    if (cell !== null) {
      this.tags[k] =
        (this.tags[k] as number) |
        (typeof cell === "string"
          ? T_STR
          : typeof cell === "bigint"
            ? T_INT
            : typeof cell === "number"
              ? T_NUM
              : T_BOOL);
    }
  }

  /** Adds a row from the entries of a record; a column the record lacks gets null, and a new key makes a column. */
  addRecord(entries: Iterable<readonly [string, Value]>): void {
    for (const [key, v] of entries) {
      const k = this.column(key);
      this.put(k, v);
      this.stamp[k] = this.rows;
    }
    for (let k = 0; k < this.cols.length; k++) {
      if (this.stamp[k] !== this.rows) (this.cols[k] as Cell[]).push(null);
    }
    this.rows++;
  }

  /** Adds a row from a list of cells, one for each column (the columns were named by `withNames`). */
  addRow(cells: readonly Value[]): void {
    if (cells.length !== this.cols.length) {
      throw coerce(
        `row ${this.rows + 1} has ${cells.length} cells but there are ${this.cols.length} columns`,
      );
    }
    for (let k = 0; k < cells.length; k++) this.put(k, cells[k] as Value);
    this.rows++;
  }

  /** The columns, each with the one type its cells have (D2's rule for `from-rows`). */
  finish(): { rows: number; columns: ColumnInput[] } {
    const columns = this.cols.map((cells, k): ColumnInput => {
      const name = this.names[k] as string;
      const tags = this.tags[k] as number;
      let type: ColumnType;
      if (tags === 0 || tags === T_STR) type = "str";
      else if (tags === T_BOOL) type = "bool";
      else if (tags === T_INT) type = "int";
      else if (tags === T_NUM || tags === (T_INT | T_NUM)) type = "num";
      else {
        const parts = [
          tags & T_BOOL ? "bool" : "",
          tags & T_INT ? "int" : "",
          tags & T_NUM ? "num" : "",
          tags & T_STR ? "str" : "",
        ].filter((s) => s !== "");
        throw coerce(`column '${name}' mixes ${parts.join(" and ")}`);
      }
      if (tags === (T_INT | T_NUM)) {
        const out = new Array<Cell>(cells.length);
        for (let i = 0; i < cells.length; i++) {
          const c = cells[i] as Cell;
          if (typeof c === "bigint") {
            if (c > SAFE || c < -SAFE) {
              throw coerce(`column '${name}' mixes a num with an integer beyond 2^53`);
            }
            out[i] = Number(c);
          } else out[i] = c;
        }
        return { name, type, cells: out };
      }
      return { name, type, cells };
    });
    return { rows: this.rows, columns };
  }
}
