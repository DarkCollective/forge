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
 * X0 SPIKE (throwaway): the `table` extension kind (columnar, typed, null mask) and the `relix-expr`
 * parameter kind (a validated text). Naive in these ways, all to be settled by D1/D2:
 *   - CSV cells that are empty become null; an empty string and null cannot be told apart from CSV.
 *   - Type inference is all-or-nothing per column: every non-null cell a number, or every one true/false, else str.
 *   - The text form of a table is a typed-header CSV and is lossy for null versus "" (so no fromText).
 */
import { ForgeError, registerExtKind } from "@forge/lang";
import type { ExtKind } from "@forge/lang";

export type ColumnType = "str" | "num" | "bool";

export interface Column {
  readonly name: string;
  readonly type: ColumnType;
  /** str: string[]; num: Float64Array; bool: Uint8Array (one byte per row; bit-packing is a D2 choice). */
  readonly data: string[] | Float64Array | Uint8Array;
  /** Bit i set = row i is null. Null when the column has no nulls. */
  readonly nulls: Uint8Array | null;
}

export interface TablePayload {
  readonly rows: number;
  readonly columns: readonly Column[];
}

/** The view a viewer receives (structured-clone-safe; cells are strings, null is null). */
export interface TableView {
  readonly columns: readonly { readonly name: string; readonly type: ColumnType }[];
  readonly rows: readonly (readonly (string | null)[])[];
  readonly total: number;
}

export function isNull(c: Column, i: number): boolean {
  return c.nulls !== null && ((c.nulls[i >> 3] as number) & (1 << (i & 7))) !== 0;
}

function cellText(c: Column, i: number): string | null {
  if (isNull(c, i)) return null;
  switch (c.type) {
    case "str":
      return (c.data as string[])[i] as string;
    case "num":
      return String((c.data as Float64Array)[i]);
    case "bool":
      return (c.data as Uint8Array)[i] === 1 ? "true" : "false";
  }
}

const NUM_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Build a table from rows of cell text; row 0 is the header. Throws E_COERCE on a bad header or a long row. */
export function tableFromRows(rows: readonly (readonly string[])[]): TablePayload {
  if (rows.length === 0) return { rows: 0, columns: [] };
  const header = rows[0] as readonly string[];
  if (new Set(header).size !== header.length) {
    throw new ForgeError({
      code: "E_COERCE",
      message: "cannot convert str to table: the header row repeats a column name",
      detail: { from: "str", to: "table" },
    });
  }
  const n = rows.length - 1;
  const columns: Column[] = header.map((name, ci) => {
    const cells: (string | null)[] = new Array<string | null>(n);
    let nulls: Uint8Array | null = null;
    let allNum = true;
    let allBool = true;
    let seen = 0;
    for (let r = 0; r < n; r++) {
      const row = rows[r + 1] as readonly string[];
      if (row.length > header.length) {
        throw new ForgeError({
          code: "E_COERCE",
          message: `cannot convert str to table: row ${r + 2} has ${row.length} cells but the header has ${header.length}`,
          detail: { from: "str", to: "table", row: r + 2 },
        });
      }
      const cell = row[ci];
      if (cell === undefined || cell === "") {
        cells[r] = null;
        nulls ??= new Uint8Array((n + 7) >> 3);
        nulls[r >> 3] = (nulls[r >> 3] as number) | (1 << (r & 7));
        continue;
      }
      seen++;
      cells[r] = cell;
      if (allNum && !NUM_RE.test(cell)) allNum = false;
      if (allBool && cell !== "true" && cell !== "false") allBool = false;
    }
    const type: ColumnType = seen === 0 ? "str" : allNum ? "num" : allBool ? "bool" : "str";
    let data: string[] | Float64Array | Uint8Array;
    if (type === "num") {
      const d = new Float64Array(n);
      for (let r = 0; r < n; r++) d[r] = cells[r] === null ? 0 : Number(cells[r]);
      data = d;
    } else if (type === "bool") {
      const d = new Uint8Array(n);
      for (let r = 0; r < n; r++) d[r] = cells[r] === "true" ? 1 : 0;
      data = d;
    } else {
      data = cells.map((c) => c ?? "");
    }
    return { name, type, data, nulls };
  });
  return { rows: n, columns };
}

function csvCell(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Typed-header CSV: `name:type,...` then one line per row; a null is an empty cell. */
export function tableToCsv(t: TablePayload, maxRows = Infinity, typed = true): string {
  const lines: string[] = [];
  lines.push(t.columns.map((c) => csvCell(typed ? `${c.name}:${c.type}` : c.name)).join(","));
  const n = Math.min(t.rows, maxRows);
  for (let i = 0; i < n; i++) {
    lines.push(t.columns.map((c) => csvCell(cellText(c, i) ?? "")).join(","));
  }
  return lines.join("\r\n");
}

/** Array of objects; a null is JSON null, a num a number, a bool a boolean. */
export function tableToJson(t: TablePayload, indent: number): string {
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < t.rows; i++) {
    const o: Record<string, unknown> = {};
    for (const c of t.columns) {
      o[c.name] = isNull(c, i)
        ? null
        : c.type === "num"
          ? (c.data as Float64Array)[i]
          : c.type === "bool"
            ? (c.data as Uint8Array)[i] === 1
            : (c.data as string[])[i];
    }
    rows.push(o);
  }
  return JSON.stringify(rows, null, indent > 0 ? indent : undefined);
}

/** Bytes charged to the size meter; same accounting style as values.ts sizeOf. */
export function tableSize(t: TablePayload): number {
  // The VM meters a value each time it is produced, so a kind's sizeOf must be cheap: payloads are
  // immutable, so the size is computed once.
  const cached = sizeCache.get(t);
  if (cached !== undefined) return cached;
  let total = 16;
  for (const c of t.columns) {
    total += 16 + 2 * c.name.length;
    if (c.type === "num") total += 8 * t.rows;
    else if (c.type === "bool") total += t.rows;
    else {
      total += 4 * t.rows; // offsets
      for (const s of c.data as string[]) total += 2 * s.length;
    }
    if (c.nulls !== null) total += c.nulls.byteLength;
  }
  sizeCache.set(t, total);
  return total;
}

const sizeCache = new WeakMap<TablePayload, number>();

export function tableEquals(a: TablePayload, b: TablePayload): boolean {
  if (a.rows !== b.rows || a.columns.length !== b.columns.length) return false;
  for (let ci = 0; ci < a.columns.length; ci++) {
    const x = a.columns[ci] as Column;
    const y = b.columns[ci] as Column;
    if (x.name !== y.name || x.type !== y.type) return false;
    for (let i = 0; i < a.rows; i++) {
      if (isNull(x, i) !== isNull(y, i)) return false;
      if (isNull(x, i)) continue;
      if (cellText(x, i) !== cellText(y, i)) return false;
    }
  }
  return true;
}

export function tableView(t: TablePayload, maxRows: number): TableView {
  const n = Math.min(t.rows, maxRows);
  const rows: (string | null)[][] = [];
  for (let i = 0; i < n; i++) rows.push(t.columns.map((c) => cellText(c, i)));
  return {
    columns: t.columns.map((c) => ({ name: c.name, type: c.type })),
    rows,
    total: t.rows,
  };
}

// ---------------------------------------------------------------------------------------------
// relix-expr: a validated text. Grammar (stub): cmp { ("and" | "or") cmp }, cmp = ident op literal,
// op one of = <> < <= > >=, literal a number, a "string", true, false or null.
// ---------------------------------------------------------------------------------------------

export interface Cmp {
  readonly col: string;
  readonly op: "=" | "<>" | "<" | "<=" | ">" | ">=";
  readonly lit: string | number | boolean | null;
}
export interface ExprAst {
  readonly first: Cmp;
  readonly rest: readonly { readonly join: "and" | "or"; readonly cmp: Cmp }[];
}

const TOKEN_RE =
  /\s*(?:("(?:[^"\\]|\\.)*")|(<>|<=|>=|=|<|>)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_-]*))/y;

/** Parses the expression; throws E_COERCE naming the 1-based column of the problem. */
export function parseExpr(text: string): ExprAst {
  const toks: { k: "str" | "op" | "num" | "id"; v: string; at: number }[] = [];
  let pos = 0;
  while (pos < text.length) {
    if (/^\s*$/.test(text.slice(pos))) break;
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(text);
    if (m === null)
      throw exprError(text, pos + (text.slice(pos).search(/\S/) || 0), "unexpected character");
    const at = m.index + (m[0].length - m[0].trimStart().length);
    if (m[1] !== undefined) toks.push({ k: "str", v: m[1], at });
    else if (m[2] !== undefined) toks.push({ k: "op", v: m[2], at });
    else if (m[3] !== undefined) toks.push({ k: "num", v: m[3], at });
    else toks.push({ k: "id", v: m[4] as string, at });
    pos = TOKEN_RE.lastIndex;
  }
  let i = 0;
  const cmp = (): Cmp => {
    const a = toks[i];
    if (a?.k !== "id") throw exprError(text, a?.at ?? text.length, "expected a column name");
    const o = toks[i + 1];
    if (o?.k !== "op")
      throw exprError(text, o?.at ?? text.length, "expected a comparison operator");
    const l = toks[i + 2];
    if (l === undefined || l.k === "op")
      throw exprError(text, l?.at ?? text.length, "expected a value");
    i += 3;
    let lit: Cmp["lit"];
    if (l.k === "str") lit = JSON.parse(l.v) as string;
    else if (l.k === "num") lit = Number(l.v);
    else if (l.v === "true") lit = true;
    else if (l.v === "false") lit = false;
    else if (l.v === "null") lit = null;
    else throw exprError(text, l.at, "a value is a number, a quoted string, true, false or null");
    return { col: a.v, op: o.v as Cmp["op"], lit };
  };
  const first = cmp();
  const rest: { join: "and" | "or"; cmp: Cmp }[] = [];
  while (i < toks.length) {
    const j = toks[i] as (typeof toks)[number];
    if (j.k !== "id" || (j.v !== "and" && j.v !== "or"))
      throw exprError(text, j.at, "expected and, or or the end");
    i++;
    rest.push({ join: j.v, cmp: cmp() });
  }
  return { first, rest };
}

function exprError(text: string, at: number, why: string): ForgeError {
  return new ForgeError({
    code: "E_COERCE",
    message: `cannot convert str to relix-expr: ${why} at column ${at + 1}`,
    detail: { from: "str", to: "relix-expr", column: at + 1, text },
  });
}

/** Rows of `t` for which the expression holds; an unknown column is E_PARAM_INVALID. */
export function tableWhere(t: TablePayload, ast: ExprAst): TablePayload {
  const all = [ast.first, ...ast.rest.map((r) => r.cmp)];
  for (const c of all) {
    if (!t.columns.some((k) => k.name === c.col)) {
      throw new ForgeError({
        code: "E_PARAM_INVALID",
        message: `parameter expr: no column '${c.col}' (columns: ${t.columns.map((k) => k.name).join(", ")})`,
        detail: { param: "expr", constraint: "column", value: c.col },
      });
    }
  }
  const test = (c: Cmp, i: number): boolean => {
    const col = t.columns.find((k) => k.name === c.col) as Column;
    if (isNull(col, i)) return c.lit === null ? c.op === "=" : c.op === "<>";
    const v: string | number | boolean =
      col.type === "num"
        ? (col.data as Float64Array)[i]!
        : col.type === "bool"
          ? (col.data as Uint8Array)[i] === 1
          : (col.data as string[])[i]!;
    const d =
      c.lit === null || typeof v !== typeof c.lit ? NaN : v < c.lit ? -1 : v > c.lit ? 1 : 0;
    switch (c.op) {
      case "=":
        return d === 0;
      case "<>":
        return d !== 0;
      case "<":
        return d < 0;
      case "<=":
        return d <= 0;
      case ">":
        return d > 0;
      case ">=":
        return d >= 0;
    }
  };
  const keep: number[] = [];
  for (let i = 0; i < t.rows; i++) {
    let ok = test(ast.first, i);
    for (const r of ast.rest) ok = r.join === "and" ? ok && test(r.cmp, i) : ok || test(r.cmp, i);
    if (ok) keep.push(i);
  }
  const columns: Column[] = t.columns.map((c) => {
    let nulls: Uint8Array | null = null;
    const pick = <T extends string[] | Float64Array | Uint8Array>(
      src: T,
      make: (n: number) => T,
    ): T => {
      const out = make(keep.length);
      keep.forEach((from, to) => {
        (out as unknown as number[])[to] = (src as unknown as number[])[from] as number;
        if (isNull(c, from)) {
          nulls ??= new Uint8Array((keep.length + 7) >> 3);
          nulls[to >> 3] = (nulls[to >> 3] as number) | (1 << (to & 7));
        }
      });
      return out;
    };
    const data =
      c.type === "num"
        ? pick(c.data as Float64Array, (n) => new Float64Array(n))
        : c.type === "bool"
          ? pick(c.data as Uint8Array, (n) => new Uint8Array(n))
          : pick(c.data as string[], (n) => new Array<string>(n).fill(""));
    return { name: c.name, type: c.type, data, nulls };
  });
  return { rows: keep.length, columns };
}

// ---------------------------------------------------------------------------------------------
// The two kinds
// ---------------------------------------------------------------------------------------------

export const tableKind: ExtKind<TablePayload> = {
  kind: "table",
  equals: tableEquals,
  sizeOf: tableSize,
  toText: (t, max) =>
    tableToCsv(t, Math.max(1, Math.floor(max / (8 * Math.max(1, t.columns.length))))),
  view: (t, o) => tableView(t, o.maxRows),
};

export interface ExprPayload {
  readonly text: string;
}

export const exprKind: ExtKind<ExprPayload> = {
  kind: "relix-expr",
  equals: (a, b) => a.text === b.text,
  sizeOf: (p) => 2 * p.text.length,
  toText: (p) => p.text,
  fromText: (text) => {
    parseExpr(text);
    return { text };
  },
};

export function registerTableKinds(): void {
  registerExtKind(tableKind);
  registerExtKind(exprKind);
}
