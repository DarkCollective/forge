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

/* X0 SPIKE tests: the ext value core, the table kind and the relix-expr parameter kind. */
import { equals, getExtKind, parseHeader, repr, sizeOf, valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";
import { tableFromRows, tableSize } from "./table/table.js";

const { str, int } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["table", "csv"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const top = (r: Result): Value => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.stack[r.stack.length - 1] as Value;
};

const CSV = "name,age,active\r\nAda,36,true\r\nAlan,41,false\r\nGrace,,true\r\n";

describe("ext header syntax", () => {
  test("ext{kind} parses as input and output, and round-trips in canonical text", () => {
    const e = parseHeader(
      "t:ext{table} expr:ext{relix-expr} -- ext{table}",
      {
        offset: 0,
        line: 1,
        col: 1,
      },
      "strict",
    );
    expect(e.inputs.map((s) => [s.type, s.options])).toEqual([
      ["ext", ["table"]],
      ["ext", ["relix-expr"]],
    ]);
    expect(e.outputs[0]?.options).toEqual(["table"]);
    expect(e.text).toBe("( t:ext{table} expr:ext{relix-expr} -- ext{table} )");
  });
  test("a bare ext and a bad kind are E_HEADER", () => {
    const at = { offset: 0, line: 1, col: 1 };
    expect(() => parseHeader("t:ext -- str", at, "strict")).toThrow(/needs a kind/);
    expect(() => parseHeader("t:ext{A_b} -- str", at, "strict")).toThrow(/kind name/);
  });
});

describe("table kind", () => {
  test("from-csv gives an ext table with typed columns and a null", async () => {
    const t = top(await runtime.call("table:from-csv", [str(CSV)]));
    expect(t.tag).toBe("ext");
    expect((t as { kind: string }).kind).toBe("table");
    const json = JSON.parse(top(await runtime.call("table:to-json", [t, int(0)])).v as string);
    expect(json).toEqual([
      { name: "Ada", age: 36, active: true },
      { name: "Alan", age: 41, active: false },
      { name: "Grace", age: null, active: true },
    ]);
  });
  test("equality, repr text and size go through the registry", async () => {
    const a = top(await runtime.call("table:from-csv", [str(CSV)]));
    const b = top(await runtime.call("table:from-csv", [str(CSV)]));
    expect(equals(a, b)).toBe(true);
    expect(repr(a)).toContain("name:str,age:num,active:bool");
    expect(sizeOf(a)).toBeGreaterThan(0);
    expect(getExtKind("table")).toBeDefined();
  });
  test("to-csv gives a plain header", async () => {
    const t = top(await runtime.call("table:from-csv", [str(CSV)]));
    expect(top(await runtime.call("table:to-csv", [t])).v).toBe(
      "name,age,active\r\nAda,36,true\r\nAlan,41,false\r\nGrace,,true",
    );
  });
  test("a str parameter is parsed by the kind (fromText) and a bad one is E_COERCE", async () => {
    const t = top(await runtime.call("table:from-csv", [str(CSV)]));
    const ok = top(await runtime.call("table:filter", [t, str("age > 36 and active = false")]));
    expect(JSON.parse(top(await runtime.call("table:to-json", [ok, int(0)])).v as string)).toEqual([
      { name: "Alan", age: 41, active: false },
    ]);
    const bad = await runtime.call("table:filter", [t, str("age >")]);
    expect(bad.ok ? "ok" : bad.error.code).toBe("E_COERCE");
    const unknown = await runtime.call("table:filter", [t, str("height > 3")]);
    expect(unknown.ok ? "ok" : unknown.error.code).toBe("E_PARAM_INVALID");
  });
  test("an ext of the wrong kind is E_TYPE", async () => {
    const t = top(await runtime.call("table:from-csv", [str(CSV)]));
    const r = await runtime.call("table:filter", [t, t]);
    expect(r.ok ? "ok" : r.error.code).toBe("E_TYPE");
  });
  test("a non-ext value into ext{table} is E_TYPE", async () => {
    const r = await runtime.call("table:to-csv", [int(3)]);
    expect(r.ok ? "ok" : r.error.code).toBe("E_TYPE");
  });
  test("the size limit applies", async () => {
    const r = await runtime.call("table:from-csv", [str(CSV)], { limits: { maxValueBytes: 100 } });
    expect(r.ok ? "ok" : r.error.code).toMatch(/E_LIMIT/);
  });
});

describe("size cost against TOOLKIT section 2.4", () => {
  test("10,000 rows by 10 num columns", () => {
    const rows: string[][] = [Array.from({ length: 10 }, (_, i) => `c${i}`)];
    for (let r = 0; r < 10_000; r++)
      rows.push(Array.from({ length: 10 }, (_, c) => String(r * 10 + c)));
    const t = tableFromRows(rows);
    const bytes = tableSize(t);
    console.log(
      `X0 size: 10000x10 num columns = ${bytes} bytes (${bytes / 10_000 / 10} B per cell)`,
    );
    expect(bytes).toBeLessThan(1_600_000);
  });
  test("10,000 rows by 10 columns with a null mask", () => {
    const rows: string[][] = [Array.from({ length: 10 }, (_, i) => `c${i}`)];
    for (let r = 0; r < 10_000; r++) {
      rows.push(
        Array.from({ length: 10 }, (_, c) => (r % 7 === 0 && c === 3 ? "" : String(r + c))),
      );
    }
    const bytes = tableSize(tableFromRows(rows));
    console.log(`X0 size: same with one nullable column = ${bytes} bytes`);
    expect(bytes).toBeLessThan(1_600_000);
  });
});
