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
 * The payload of the `table` ext kind (TOOLKIT.md section 7, D2): columnar, typed, with an explicit null mask.
 * A payload is immutable once built, which is what lets `sizeOf` be cached.
 *
 * Column types and their storage:
 *   - `str`  one JS string holding every cell back to back, plus `ends`, a Uint32Array of the end offset
 *            (UTF-16 code units) of each cell; cell i is `text.slice(i === 0 ? 0 : ends[i - 1], ends[i])`.
 *            4 bytes a row and 2 bytes a code unit, which is what the size charge says.
 *   - `int`  a BigInt64Array: exact for every 64-bit integer, 8 bytes a row. (A text-backed column would
 *            cost 2 bytes a digit and compare slowly; an integer beyond 64 bits is not an `int` column,
 *            it is a `str` column that holds its digits.)
 *   - `num`  a Float64Array: finite numbers only, as FL `num` is, 8 bytes a row.
 *   - `bool` bit-packed in a Uint8Array, one bit a row.
 * A column that has a null carries a bit-packed `nulls` mask (bit i of the mask is row i); a column with no
 * null has `nulls: null`. The data under a null cell is the zero of its type (0, false, the empty string), so
 * two columns that hold the same cells hold the same bytes and `equals` can compare them directly. A null is
 * never the empty string: they differ in the mask.
 */

export type ColumnType = "str" | "int" | "num" | "bool";

export const COLUMN_TYPES: readonly ColumnType[] = Object.freeze(["str", "int", "num", "bool"]);

/** What one cell holds when it is read out of a payload: null for a null cell. */
export type Cell = string | bigint | number | boolean | null;

interface ColumnBase {
  readonly name: string;
  /** Bit-packed null mask (bit i = row i is null), or null when the column has no null. */
  readonly nulls: Uint8Array | null;
}
export interface StrColumn extends ColumnBase {
  readonly type: "str";
  readonly text: string;
  readonly ends: Uint32Array;
}
export interface IntColumn extends ColumnBase {
  readonly type: "int";
  readonly data: BigInt64Array;
}
export interface NumColumn extends ColumnBase {
  readonly type: "num";
  readonly data: Float64Array;
}
export interface BoolColumn extends ColumnBase {
  readonly type: "bool";
  /** One bit a row, packed little-endian within each byte. */
  readonly data: Uint8Array;
}
export type TableColumn = StrColumn | IntColumn | NumColumn | BoolColumn;

export interface TablePayload {
  readonly rows: number;
  readonly columns: readonly TableColumn[];
  /** The bytes the payload holds, computed once at construction (`sizeOf` reads only this). */
  readonly size: number;
}

/** What a column is built from: its cells in row order, null for a null cell. */
export interface ColumnInput {
  readonly name: string;
  readonly type: ColumnType;
  readonly cells: readonly Cell[];
}

export const INT64_MIN = -(1n << 63n);
export const INT64_MAX = (1n << 63n) - 1n;

export function getBit(bits: Uint8Array, i: number): boolean {
  return ((bits[i >> 3] as number) & (1 << (i & 7))) !== 0;
}

function setBit(bits: Uint8Array, i: number): void {
  bits[i >> 3] = (bits[i >> 3] as number) | (1 << (i & 7));
}

export function isNullAt(col: TableColumn, i: number): boolean {
  return col.nulls !== null && getBit(col.nulls, i);
}

/** The bytes of a payload (the object, then per column its name, cells and mask). */
function sizeOfColumns(rows: number, columns: readonly TableColumn[]): number {
  let total = 16;
  const maskBytes = Math.ceil(rows / 8);
  for (const c of columns) {
    total += 16 + 2 * c.name.length;
    switch (c.type) {
      case "str":
        total += 4 * rows + 2 * c.text.length;
        break;
      case "int":
      case "num":
        total += 8 * rows;
        break;
      case "bool":
        total += maskBytes;
        break;
    }
    if (c.nulls !== null) total += maskBytes;
  }
  return total;
}

/**
 * Builds a payload. The cells must already fit their column type (`str` a string, `int` a bigint within
 * 64 bits, `num` a finite number, `bool` a boolean, any of them null); the callers check, this throws a
 * `TypeError` for a cell that does not fit, which is a bug in the caller. Names are not checked here.
 */
export function buildPayload(rows: number, inputs: readonly ColumnInput[]): TablePayload {
  const columns = inputs.map((input): TableColumn => {
    const { name, type, cells } = input;
    if (cells.length !== rows) throw new TypeError(`column '${name}' has ${cells.length} cells`);
    let nulls: Uint8Array | null = null;
    const markNull = (i: number): void => {
      nulls ??= new Uint8Array(Math.ceil(rows / 8));
      setBit(nulls, i);
    };
    switch (type) {
      case "str": {
        const ends = new Uint32Array(rows);
        const parts: string[] = [];
        let at = 0;
        for (let i = 0; i < rows; i++) {
          const x = cells[i] as Cell;
          if (x === null) markNull(i);
          else if (typeof x !== "string") throw new TypeError(`column '${name}': not a str cell`);
          else {
            parts.push(x);
            at += x.length;
          }
          ends[i] = at;
        }
        return { name, type, text: parts.join(""), ends, nulls };
      }
      case "int": {
        const data = new BigInt64Array(rows);
        for (let i = 0; i < rows; i++) {
          const x = cells[i] as Cell;
          if (x === null) markNull(i);
          else if (typeof x !== "bigint" || x < INT64_MIN || x > INT64_MAX) {
            throw new TypeError(`column '${name}': not an int64 cell`);
          } else data[i] = x;
        }
        return { name, type, data, nulls };
      }
      case "num": {
        const data = new Float64Array(rows);
        for (let i = 0; i < rows; i++) {
          const x = cells[i] as Cell;
          if (x === null) markNull(i);
          else if (typeof x !== "number" || !Number.isFinite(x)) {
            throw new TypeError(`column '${name}': not a finite num cell`);
          } else data[i] = x;
        }
        return { name, type, data, nulls };
      }
      case "bool": {
        const data = new Uint8Array(Math.ceil(rows / 8));
        for (let i = 0; i < rows; i++) {
          const x = cells[i] as Cell;
          if (x === null) markNull(i);
          else if (typeof x !== "boolean") throw new TypeError(`column '${name}': not a bool cell`);
          else if (x) setBit(data, i);
        }
        return { name, type, data, nulls };
      }
    }
  });
  return Object.freeze({ rows, columns, size: sizeOfColumns(rows, columns) });
}

/** Cell `i` of a column: null for a null cell. */
export function cellAt(col: TableColumn, i: number): Cell {
  if (col.nulls !== null && getBit(col.nulls, i)) return null;
  switch (col.type) {
    case "str":
      return col.text.slice(i === 0 ? 0 : (col.ends[i - 1] as number), col.ends[i]);
    case "int":
      return col.data[i] as bigint;
    case "num":
      return col.data[i] as number;
    case "bool":
      return getBit(col.data, i);
  }
}

function sameBytes(a: ArrayLike<number | bigint>, b: ArrayLike<number | bigint>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameMask(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === null || b === null) return a === b;
  return sameBytes(a, b);
}

export function equalPayloads(a: TablePayload, b: TablePayload): boolean {
  if (a === b) return true;
  if (a.rows !== b.rows || a.columns.length !== b.columns.length) return false;
  for (let k = 0; k < a.columns.length; k++) {
    const x = a.columns[k] as TableColumn;
    const y = b.columns[k] as TableColumn;
    if (x.name !== y.name || x.type !== y.type || !sameMask(x.nulls, y.nulls)) return false;
    switch (x.type) {
      case "str":
        if (x.text !== (y as StrColumn).text || !sameBytes(x.ends, (y as StrColumn).ends))
          return false;
        break;
      case "int":
      case "num":
      case "bool":
        if (!sameBytes(x.data, (y as typeof x).data)) return false;
        break;
    }
  }
  return true;
}
