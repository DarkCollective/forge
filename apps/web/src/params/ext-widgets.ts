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
 * X0 SPIKE (throwaway): parameter helpers for `ext{kind}` parameters (TOOLKIT.md section 6.3). A kind's
 * parameter value is its text form, so the recipe JSON is a string and the UI starts with a text field.
 * A helper adds two things to that field: a live check of the text, and column names to offer.
 *
 * The check here is a stub written for the spike. It repeats the grammar of `parseExpr` in
 * packages/ops/src/table/table.ts on purpose in a smaller form: the web app imports only types from
 * @forge/ops, so the real design must ship one validator that both the worker and the page can load.
 */
import type { OutputValue } from "@forge/worker";

export interface SchemaColumn {
  readonly name: string;
  readonly type: string;
}

export interface ExtParamCheck {
  readonly ok: boolean;
  readonly message: string;
}

export interface ExtParamHelper {
  readonly kind: string;
  /** Check the text against the schema of the input table (undefined when none is known yet). */
  check(text: string, schema: readonly SchemaColumn[] | undefined): ExtParamCheck;
}

const helpers = new Map<string, ExtParamHelper>();

export function registerParamHelper(h: ExtParamHelper): void {
  helpers.set(h.kind, h);
}

export function getParamHelper(kind: string): ExtParamHelper | undefined {
  return helpers.get(kind);
}

/** The columns of a table output, or undefined when the output is not a table with a view. */
export function schemaOf(
  output: OutputValue | null | undefined,
): readonly SchemaColumn[] | undefined {
  if (output?.kind !== "ext" || output.extKind !== "table") return undefined;
  const v = output.view as { columns?: unknown } | undefined;
  if (v === undefined || !Array.isArray(v.columns)) return undefined;
  return (v.columns as unknown[]).flatMap((c) => {
    const col = c as { name?: unknown; type?: unknown };
    return typeof col.name === "string" && typeof col.type === "string"
      ? [{ name: col.name, type: col.type }]
      : [];
  });
}

const TOKEN =
  /\s*(?:("(?:[^"\\]|\\.)*")|(<>|<=|>=|=|<|>)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_-]*))/y;

/** `col op value (and|or col op value)*`: names must be columns when the schema is known. */
export function checkRelixExpr(
  text: string,
  schema: readonly SchemaColumn[] | undefined,
): ExtParamCheck {
  if (text.trim() === "") return { ok: false, message: "Write a condition such as age > 30." };
  const toks: { k: string; v: string; at: number }[] = [];
  let pos = 0;
  while (pos < text.length && !/^\s*$/.test(text.slice(pos))) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(text);
    if (m === null) return { ok: false, message: `Unexpected character at column ${pos + 1}.` };
    const k =
      m[1] !== undefined ? "str" : m[2] !== undefined ? "op" : m[3] !== undefined ? "num" : "id";
    toks.push({ k, v: (m[1] ?? m[2] ?? m[3] ?? m[4]) as string, at: m.index });
    pos = TOKEN.lastIndex;
  }
  let i = 0;
  for (;;) {
    const [a, o, l] = [toks[i], toks[i + 1], toks[i + 2]];
    if (a?.k !== "id") return { ok: false, message: "Expected a column name." };
    if (schema !== undefined && !schema.some((c) => c.name === a.v)) {
      return {
        ok: false,
        message: `No column "${a.v}". Columns: ${schema.map((c) => c.name).join(", ")}.`,
      };
    }
    if (o?.k !== "op") return { ok: false, message: `Expected = <> < <= > >= after ${a.v}.` };
    if (l === undefined || l.k === "op") return { ok: false, message: "Expected a value." };
    if (l.k === "id" && !["true", "false", "null"].includes(l.v)) {
      return { ok: false, message: "A value is a number, a quoted string, true, false or null." };
    }
    i += 3;
    if (i >= toks.length) return { ok: true, message: "Valid." };
    const j = toks[i];
    if (j?.k !== "id" || (j.v !== "and" && j.v !== "or")) {
      return { ok: false, message: "Expected and, or or the end." };
    }
    i++;
  }
}

registerParamHelper({ kind: "relix-expr", check: checkRelixExpr });
