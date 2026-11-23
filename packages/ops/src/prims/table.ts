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
 * X0 SPIKE (throwaway): table primitives. Importing this module registers the `table` and `relix-expr`
 * ext kinds. The CSV scan is the csv vocabulary's RFC 4180 reader (csv:_parse), so the prototype is
 * only naive about what it does with the cells (see table/table.ts), not about quoting.
 *
 *  - `_from-csv ( data:str -- ext{table} )`
 *  - `_to-json ( t:ext{table} indent:int -- str )`
 *  - `_to-csv ( t:ext{table} -- str )`
 *  - `_where ( t:ext{table} expr:ext{relix-expr} -- ext{table} )`
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef, Value } from "@forge/lang";
import { limitFailure } from "../prim-util.js";
import {
  parseExpr,
  registerTableKinds,
  tableFromRows,
  tableSize,
  tableToCsv,
  tableToJson,
  tableWhere,
} from "../table/table.js";
import type { ExprPayload, TablePayload } from "../table/table.js";
import { primitives as csvPrimitives } from "./csv.js";

registerTableKinds();

const csvParse = csvPrimitives.find((p) => p.name === "_parse") as PrimitiveDef;

function guard(t: TablePayload, ctx: PrimitiveContext): TablePayload {
  const size = tableSize(t);
  if (size > ctx.limits.maxValueBytes) {
    throw limitFailure("maxValueBytes", ctx.limits.maxValueBytes, size, "table");
  }
  return t;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "table",
    "_from-csv",
    "( data:str -- ext{table} )",
    (data: unknown, ctx: PrimitiveContext) => {
      const rows = csvParse.fn(data, ",", "\\r\\n", ctx) as Value[];
      const cells = rows.map((r) => (r.v as Value[]).map((c) => c.v as string));
      return guard(tableFromRows(cells), ctx);
    },
    { doc: "Private. CSV text to a columnar table (X0 spike)." },
  ),
  definePrimitive(
    "table",
    "_to-json",
    "( t:ext{table} indent:int -- str )",
    (t: unknown, indent: unknown) => tableToJson(t as TablePayload, Number(indent)),
    { doc: "Private. A table as a JSON array of objects (X0 spike)." },
  ),
  definePrimitive(
    "table",
    "_to-csv",
    "( t:ext{table} -- str )",
    (t: unknown) => tableToCsv(t as TablePayload, Infinity, false),
    { doc: "Private. A table as CSV with a plain header (X0 spike)." },
  ),
  definePrimitive(
    "table",
    "_to-expr",
    "( text:str -- ext{relix-expr} )",
    (text: unknown) => {
      parseExpr(text as string);
      return { text } as ExprPayload;
    },
    { doc: "Private. Text to a relix-expr value, checked (X0 spike; an ext kind with no viewer)." },
  ),
  definePrimitive(
    "table",
    "_where",
    "( t:ext{table} expr:ext{relix-expr} -- ext{table} )",
    (t: unknown, expr: unknown, ctx: PrimitiveContext) =>
      guard(tableWhere(t as TablePayload, parseExpr((expr as ExprPayload).text)), ctx),
    { doc: "Private. The rows of a table for which a comparison expression holds (X0 spike)." },
  ),
];
