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
 * The JSON-to-table parsers (D1, T55): the private words under `vocab/json-table.fth`. Both read JSON with the
 * one JSON reader of core (`jsonToValue`, L3) and put the cells straight into typed columns
 * (src/table/builder.ts), following D2's rule for `table:from-rows`: a column takes the one type its cells have,
 * an int and a num make a num, nulls only make a str column, and any other mix is E_COERCE.
 *
 *  - `_parse ( data:str header:bool -- ext{table} )`: JSON text that is an array of records (the columns are
 *    every key, first seen first, and a record without a key has null there), an array of arrays (the first is
 *    the header row when `header` is true; otherwise the columns are c1, c2 and so on), or one record (one row).
 *  - `_parse-ndjson ( data:str header:bool -- ext{table} )`: one JSON value on each line (blank lines are skipped),
 *    read as the elements of such an array. The lines are read one at a time, so the whole text is never a tree.
 *
 * A JSON null is a null cell, and a nested array or record is E_COERCE (a cell is a scalar).
 */
import { ForgeError, definePrimitive, jsonToValue } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef, Value } from "@forge/lang";
import { limitFailure } from "../prim-util.js";
import { ColumnAccumulator } from "../table/builder.js";
import { registerTableKind } from "../table/kind.js";
import { buildPayload } from "../table/payload.js";
import type { TablePayload } from "../table/payload.js";

registerTableKind();

function coerce(reason: string, extra: Record<string, unknown> = {}): ForgeError {
  return new ForgeError({
    code: "E_COERCE",
    message: `cannot convert JSON to table: ${reason}`,
    detail: { from: "json", to: "table", reason, ...extra },
  });
}

function finish(acc: ColumnAccumulator, ctx: PrimitiveContext): TablePayload {
  const { rows, columns } = acc.finish();
  const payload = buildPayload(rows, columns);
  const max = ctx.limits.maxValueBytes;
  if (payload.size > max) throw limitFailure("maxValueBytes", max, payload.size, "JSON table");
  return payload;
}

/** Collects the elements of an array (or the lines of NDJSON) into columns. */
class Shaper {
  private acc: ColumnAccumulator | null = null;
  private mode: "record" | "list" | null = null;
  private headerPending: boolean;
  private count = 0;

  constructor(
    header: boolean,
    private readonly what: string,
  ) {
    this.headerPending = header;
  }

  add(v: Value): void {
    this.count++;
    const where = `${this.what} ${this.count}`;
    if (v.tag === "record") {
      if (this.mode === "list") throw coerce(`${where} is a record but the first one is a list`);
      this.mode ??= "record";
      this.acc ??= new ColumnAccumulator();
      this.acc.addRecord(v.v.entries());
    } else if (v.tag === "list") {
      if (this.mode === "record") throw coerce(`${where} is a list but the first one is a record`);
      this.mode ??= "list";
      if (this.acc === null) {
        if (this.headerPending) {
          const names = v.v.map((n, k) => {
            if (n.tag !== "str")
              throw coerce(`the name of column ${k + 1} in the header is not a str`);
            return n.v;
          });
          this.acc = ColumnAccumulator.withNames(names);
          this.headerPending = false;
          return;
        }
        this.acc = ColumnAccumulator.withNames(v.v.map((_c, k) => `c${k + 1}`));
      }
      this.acc.addRow(v.v);
    } else {
      throw coerce(`${where} is a ${v.tag}; expected a record or a list`);
    }
  }

  done(ctx: PrimitiveContext): TablePayload {
    return finish(this.acc ?? new ColumnAccumulator(), ctx);
  }
}

function parse(text: string, header: boolean, ctx: PrimitiveContext): TablePayload {
  const v = jsonToValue(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, ctx);
  const shaper = new Shaper(header, "element");
  if (v.tag === "list") for (const item of v.v) shaper.add(item);
  else if (v.tag === "record") shaper.add(v);
  else
    throw coerce(
      `the JSON is a ${v.tag}; expected an array of records, an array of arrays or one record`,
    );
  return shaper.done(ctx);
}

function parseNdjson(text: string, header: boolean, ctx: PrimitiveContext): TablePayload {
  const shaper = new Shaper(header, "line");
  const data = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let line = 0;
  let from = 0;
  const n = data.length;
  while (from < n) {
    let end = data.indexOf("\n", from);
    if (end < 0) end = n;
    line++;
    const raw = data.slice(from, end);
    from = end + 1;
    if (raw.trim() === "") continue;
    let v: Value;
    try {
      v = jsonToValue(raw, ctx);
    } catch (e) {
      if (e instanceof ForgeError && e.code === "E_COERCE") {
        throw coerce(`line ${line} is not JSON (${e.message})`, { line });
      }
      throw e;
    }
    shaper.add(v);
  }
  return shaper.done(ctx);
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "json-table",
    "_parse",
    "( data:str header:bool -- ext{table} )",
    (data: string, header: boolean, ctx: PrimitiveContext) => parse(data, header, ctx),
    {
      doc: "Private. JSON text as a table: an array of records (the columns are every key, first seen first), an array of arrays (the first is the header row when header is true, else the columns are c1, c2, and so on) or one record (one row). A column takes the one type its cells have (an int and a num make a num, only nulls make a str); a JSON null is a null cell. Any other mix, a nested array or record in a cell, a ragged row or text that is not JSON is E_COERCE.",
    },
  ),
  definePrimitive(
    "json-table",
    "_parse-ndjson",
    "( data:str header:bool -- ext{table} )",
    (data: string, header: boolean, ctx: PrimitiveContext) => parseNdjson(data, header, ctx),
    {
      doc: "Private. Newline-delimited JSON as a table: one record or array on each line (blank lines are skipped), shaped as the elements of the array of json-table:_parse.",
    },
  ),
];
