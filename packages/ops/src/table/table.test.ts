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
 * Tests for the `table` kind (src/table/) and the `table` vocabulary (vocab/table.fth, src/prims/table.ts):
 * the kind conformance of X1, equality, size, the text form, the JSON and CSV export, and the words.
 */
import { ForgeError, ext, getExtKind, kindConformance, sizeOf, valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "../bundle.js";
import { buildCatalogue } from "../catalogue.js";
import { loadBundleNode } from "../sources-node.js";
import { tableKind } from "./kind.js";
import { buildPayload } from "./payload.js";
import type { Cell, ColumnInput, TablePayload } from "./payload.js";
import { jsonErrorOffset, readFaithful, writeCsv, writeFaithful, writeJson } from "./text.js";

const { int, str, num, bool, list, record } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["table"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;

function top(r: Result): Value {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.stack[r.stack.length - 1] as Value;
}
const code = (r: Result): string => (r.ok ? "ok" : r.error.code);
const text = (r: Result): string => (top(r) as { v: string }).v;
const payloadOf = (r: Result): TablePayload => (top(r) as { v: TablePayload }).v;

const NULL = { tag: "ext", kind: "null", v: {} } as Value;
const S = (...xs: string[]): Value => list(xs.map((x) => str(x)));
const R = (...rows: Value[][]): Value => list(rows.map((r) => list(r)));
const build = (names: string[], rows: Value[][]) =>
  runtime.call("table:from-rows", [S(...names), R(...rows)]);
const tableValue = (p: TablePayload): Value => ext("table", p);

/** A payload from columns written as `[name, type, cells]`. */
function make(...cols: [string, ColumnInput["type"], Cell[]][]): TablePayload {
  const rows = cols.length === 0 ? 0 : (cols[0] as [string, string, Cell[]])[2].length;
  return buildPayload(
    rows,
    cols.map(([name, type, cells]) => ({ name, type, cells })),
  );
}

const sample = make(
  ["id", "int", [1n, 2n, null]],
  ["name", "str", ["Ada", "", null]],
  ["score", "num", [1.5, null, -0]],
  ["ok", "bool", [true, false, null]],
);

describe("the kind", () => {
  test("is registered by the table vocabulary and passes the conformance test", () => {
    expect(getExtKind("table")).toBe(tableKind);
    const many = 2000;
    const large = buildPayload(many, [
      { name: "n", type: "int", cells: Array.from({ length: many }, (_, i) => BigInt(i)) },
      { name: "s", type: "str", cells: Array.from({ length: many }, (_, i) => `row ${i}`) },
    ]);
    expect(
      kindConformance(tableKind, {
        small: sample,
        large,
        other: make(["id", "int", [1n]]),
        minBytes: (p) => p.rows * p.columns.length,
        text: writeFaithful(sample, Infinity),
      }),
    ).toEqual([]);
    expect(kindConformance(tableKind, { small: make(), large: sample })).toEqual([]);
  });

  test("equals compares names, types, nulls and every cell", () => {
    const again = readFaithful(writeFaithful(sample, Infinity));
    expect(tableKind.equals(sample, again)).toBe(true);
    const swap = (cols: [string, ColumnInput["type"], Cell[]][]) => make(...cols);
    const base: [string, ColumnInput["type"], Cell[]][] = [
      ["a", "int", [1n, null]],
      ["b", "str", ["x", "y"]],
    ];
    const eq = (cols: [string, ColumnInput["type"], Cell[]][]) =>
      tableKind.equals(swap(base), swap(cols));
    expect(eq(base)).toBe(true);
    expect(eq([["a", "int", [1n, 2n]], base[1] as never])).toBe(false); // null against a value
    expect(
      eq([
        ["a", "int", [1n, null]],
        ["b", "str", ["x", "z"]],
      ]),
    ).toBe(false);
    expect(
      eq([
        ["a", "int", [1n, null]],
        ["b", "str", ["x", null]],
      ]),
    ).toBe(false);
    expect(
      eq([
        ["a", "int", [1n, null]],
        ["c", "str", ["x", "y"]],
      ]),
    ).toBe(false); // name
    expect(eq([["a", "num", [1, null]], base[1] as never])).toBe(false); // type
    expect(eq([base[0] as never])).toBe(false); // columns
    expect(tableKind.equals(make(["a", "str", ["ab", "c"]]), make(["a", "str", ["a", "bc"]]))).toBe(
      false,
    ); // same characters, other cuts
    expect(tableKind.equals(make(["a", "bool", [true]]), make(["a", "bool", [false]]))).toBe(false);
    expect(tableKind.equals(make(["a", "num", [0]]), make(["a", "num", [-0]]))).toBe(true); // 0 = -0 in FL
    expect(tableKind.equals(make(["a", "int", [1n]]), make(["a", "int", [1n, 2n]]))).toBe(false);
  });

  test("a null is not the empty string", () => {
    const a = make(["s", "str", [""]]);
    const b = make(["s", "str", [null]]);
    expect(tableKind.equals(a, b)).toBe(false);
    expect(readFaithful(writeFaithful(a, Infinity)).columns[0]?.nulls).toBeNull();
    expect(readFaithful(writeFaithful(b, Infinity)).columns[0]?.nulls).not.toBeNull();
  });

  test("the FL = word uses the kind's equals", async () => {
    const r = await runtime.call("=", [
      tableValue(sample),
      tableValue(readFaithful(writeFaithful(sample, Infinity))),
    ]);
    expect((top(r) as { v: boolean }).v).toBe(true);
  });
});

describe("size", () => {
  test("is cached, honest and what the VM charges", () => {
    // 16 + per column (16 + 2 * name) + cells + mask
    const p = make(
      ["ab", "str", ["xy", "z"]],
      ["n", "int", [1n, null]],
      ["b", "bool", [true, false]],
    );
    expect(tableKind.sizeOf(p)).toBe(
      16 + (16 + 4 + (4 * 2 + 2 * 3)) + (16 + 2 + 8 * 2 + 1) + (16 + 2 + 1),
    );
    expect(sizeOf(tableValue(p))).toBe(16 + tableKind.sizeOf(p));
    expect(tableKind.sizeOf(make())).toBe(16);
  });

  test("10,000 rows by 10 columns: numbers, ints, strings, bools", () => {
    const rows = 10_000;
    const cols = (f: (r: number, c: number) => Cell, type: ColumnInput["type"]) =>
      buildPayload(
        rows,
        Array.from({ length: 10 }, (_, c) => ({
          name: `c${c}`,
          type,
          cells: Array.from({ length: rows }, (_, r) => f(r, c)),
        })),
      );
    const nums = cols((r, c) => r * 10 + c + 0.5, "num");
    const ints = cols((r, c) => BigInt(r * 10 + c), "int");
    const strs = cols((r, c) => String(r * 10 + c).padStart(8, "x"), "str");
    const bools = cols((r, c) => (r + c) % 2 === 0, "bool");
    // The measured figures (reported in the work package): numbers 800,216, strings 2,000,216.
    expect(nums.size).toBe(800_216);
    expect(ints.size).toBe(800_216);
    expect(strs.size).toBe(2_000_216);
    expect(bools.size).toBe(12_716); // bit-packed: 1,250 bytes a column
    expect(nums.size).toBeLessThan(800_000 * 1.001);
    expect(strs.size).toBeLessThan(2_000_000 * 1.001);
  });
});

describe("the faithful text form", () => {
  test("round-trips nulls, empty strings, ints beyond 2^53, empty tables and Unicode", () => {
    const wide = make(
      ["i", "int", [9007199254740993n, -9223372036854775808n, 9223372036854775807n, 0n, null]],
      ["u", "str", ["é", "日本語", "😀 emoji", "\ud800 lone", ""]],
      ["n", "num", [1e300, 5e-324, -0, 0.1, null]],
      ["b", "bool", [null, true, false, true, null]],
    );
    for (const p of [wide, sample, make(), make(["a", "str", []]), make(["x", "int", [null]])]) {
      const t = tableKind.toText(p, 1_000_000);
      const back = tableKind.fromText?.(t) as TablePayload;
      expect(tableKind.equals(back, p), t).toBe(true);
      expect(tableKind.toText(back, 1_000_000)).toBe(t);
    }
    expect(writeFaithful(wide, Infinity)).toContain('"9007199254740993"');
    expect(
      Object.is(wide.columns[2] && (wide.columns[2] as { data: Float64Array }).data[2], -0),
    ).toBe(true);
    const lone = readFaithful(writeFaithful(wide, Infinity));
    expect((lone.columns[1] as { text: string }).text).toContain("\ud800 lone");
  });

  test("the text is the documented JSON", () => {
    expect(writeFaithful(sample, Infinity)).toBe(
      '{"columns":[{"name":"id","type":"int"},{"name":"name","type":"str"},{"name":"score","type":"num"},{"name":"ok","type":"bool"}],' +
        '"rows":[[1,"Ada",1.5,true],[2,"",null,false],[null,null,-0,null]]}',
    );
  });

  test("toText cuts to max with ...", () => {
    const t = tableKind.toText(sample, 40);
    expect(t.length).toBe(40);
    expect(t.endsWith("...")).toBe(true);
    expect(tableKind.toText(sample, 2)).toBe('{"');
    const emoji = make(["😀😀😀😀", "str", ["😀"]]);
    expect(tableKind.toText(emoji, 25).length).toBeLessThanOrEqual(25);
  });

  const bad = (t: string): ForgeError => {
    try {
      readFaithful(t);
    } catch (e) {
      return e as ForgeError;
    }
    throw new Error("expected a failure");
  };

  test("a bad text is E_COERCE with an offset", () => {
    const syntax = bad('{"columns":[],"rows":[}');
    expect(syntax.code).toBe("E_COERCE");
    expect(typeof (syntax.detail as { offset: number }).offset).toBe("number");
    expect((syntax.detail as { offset: number }).offset).toBeGreaterThan(0);
    expect((bad("").detail as { offset: number }).offset).toBe(0);
    for (const t of [
      "[]",
      "null",
      '{"columns":[]}',
      '{"columns":[],"rows":[],"x":1}',
      '{"columns":{},"rows":[]}',
      '{"columns":[],"rows":{}}',
      '{"columns":[1],"rows":[]}',
      '{"columns":[{"name":1,"type":"str"}],"rows":[]}',
      '{"columns":[{"name":"a","type":"date"}],"rows":[]}',
      '{"columns":[{"name":"a","type":"str"},{"name":"a","type":"str"}],"rows":[]}',
      '{"columns":[{"name":"a","type":"str"}],"rows":[1]}',
      '{"columns":[{"name":"a","type":"str"}],"rows":[["x","y"]]}',
      '{"columns":[{"name":"a","type":"str"}],"rows":[[1]]}',
      '{"columns":[{"name":"a","type":"int"}],"rows":[[1.5]]}',
      '{"columns":[{"name":"a","type":"int"}],"rows":[[9007199254740993]]}',
      '{"columns":[{"name":"a","type":"int"}],"rows":[["9223372036854775808"]]}',
      '{"columns":[{"name":"a","type":"int"}],"rows":[["01"]]}',
      '{"columns":[{"name":"a","type":"num"}],"rows":[["NaN"]]}',
      '{"columns":[{"name":"a","type":"bool"}],"rows":[[0]]}',
    ]) {
      expect(bad(t).code, t).toBe("E_COERCE");
    }
    expect(bad('{"columns":[{"name":"a","type":"int"}],"rows":[[1.5]]}').message).toContain(
      "cell 1 of row 1",
    );
  });

  test("a str coerces to a table slot through fromText", async () => {
    const r = await runtime.call("table:count", [str(writeFaithful(sample, Infinity))]);
    expect((top(r) as { v: number }).v).toBe(3);
    const e = await runtime.call("table:count", [str("nope")]);
    expect(code(e)).toBe("E_COERCE");
  });
});

describe("table:to-json", () => {
  test("writes an array of objects with nulls, and reads back", () => {
    const j = writeJson(sample, 0);
    expect(j).toBe(
      '[{"id":1,"name":"Ada","score":1.5,"ok":true},{"id":2,"name":"","score":null,"ok":false},{"id":null,"name":null,"score":-0,"ok":null}]',
    );
    expect(JSON.parse(j)).toEqual([
      { id: 1, name: "Ada", score: 1.5, ok: true },
      { id: 2, name: "", score: null, ok: false },
      { id: null, name: null, score: -0, ok: null },
    ]);
  });

  test("indents like JSON.stringify", () => {
    for (const p of [
      make(["a", "str", ["x"]], ["b", "num", [1.5]]),
      make(),
      make(["a", "int", [1n, null]]),
      make(["a", "str", ["é\n"]]),
    ]) {
      for (const n of [1, 2, 4]) {
        expect(writeJson(p, n)).toBe(JSON.stringify(JSON.parse(writeJson(p, 0)), null, n));
      }
    }
    expect(writeJson(make(), 2)).toBe("[]");
    expect(writeJson(make(["a", "str", []]), 2)).toBe("[]");
  });

  test("keeps every digit of an int", () => {
    expect(writeJson(make(["i", "int", [9007199254740993n]]), 0)).toBe('[{"i":9007199254740993}]');
  });

  test("the word, its default and its limits", async () => {
    const t = tableValue(sample);
    expect(text(await runtime.call("table:to-json", [t, int(2)]))).toBe(writeJson(sample, 2));
    expect(text(await runtime.call("table:to-json", [t, int(0)]))).toBe(writeJson(sample, 0));
    expect(code(await runtime.call("table:to-json", [t, int(17)]))).not.toBe("ok");
    expect(
      code(await runtime.call("table:to-json", [t, int(2)], { limits: { maxValueBytes: 100 } })),
    ).not.toBe("ok");
  });

  test("a table built from FL values reads back as the same values", async () => {
    const r = await build(
      ["a", "b"],
      [
        [int(1), str("x")],
        [NULL, str("")],
        [int(3), NULL],
      ],
    );
    const j = await runtime.call("table:to-json", [top(r), int(0)]);
    expect(JSON.parse(text(j))).toEqual([
      { a: 1, b: "x" },
      { a: null, b: "" },
      { a: 3, b: null },
    ]);
  });
});

describe("table:to-csv", () => {
  test("writes a header and rows, a null empty and the empty string quoted", () => {
    expect(writeCsv(sample, ",", "\r\n")).toBe(
      'id,name,score,ok\r\n1,Ada,1.5,true\r\n2,"",,false\r\n,,-0,\r\n',
    );
  });

  test("quotes delimiters, quotes and line breaks, and honours the delimiters", () => {
    const p = make(["a;b", "str", ['say "hi"', "x;y", "l1\nl2", "plain"]]);
    expect(writeCsv(p, ",", "\n")).toBe('a;b\n"say ""hi"""\nx;y\n"l1\nl2"\nplain\n');
    expect(writeCsv(p, ";", "\n")).toBe('"a;b"\n"say ""hi"""\n"x;y"\n"l1\nl2"\nplain\n');
    expect(writeCsv(make(), ",", "\r\n")).toBe("");
    expect(writeCsv(make(["a", "int", []]), ",", "\r\n")).toBe("a\r\n");
  });

  test("a table of one column and one null is an empty line, which is the one thing CSV cannot keep", () => {
    expect(writeCsv(make(["a", "int", [null, 1n]]), ",", "\n")).toBe("a\n\n1\n");
  });

  test("round-trips through an RFC 4180 reader, nulls apart from empty strings", async () => {
    const r = await build(
      ["k", "v"],
      [
        [str("1"), str("a,b")],
        [str("2"), str("")],
        [str("3"), NULL],
        [str("4"), str('q"q\r\nz')],
      ],
    );
    const csv = text(await runtime.call("table:to-csv", [top(r), str(","), str("\\r\\n")]));
    expect(csv).toBe('k,v\r\n1,"a,b"\r\n2,""\r\n3,\r\n4,"q""q\r\nz"\r\n');
    const parse = (s: string): { cells: string[]; quoted: boolean[] }[] => {
      const rows: { cells: string[]; quoted: boolean[] }[] = [];
      let cells: string[] = [];
      let quoted: boolean[] = [];
      let field = "";
      let q = false;
      let i = 0;
      while (i < s.length) {
        const c = s[i] as string;
        if (c === '"' && field === "" && !q) {
          q = true;
          i++;
          for (;;) {
            const end = s.indexOf('"', i);
            field += s.slice(i, end);
            if (s[end + 1] === '"') {
              field += '"';
              i = end + 2;
            } else {
              i = end + 1;
              break;
            }
          }
          continue;
        }
        if (c === "," || c === "\r") {
          cells.push(field);
          quoted.push(q);
          field = "";
          q = false;
          if (c === "\r") {
            rows.push({ cells, quoted });
            cells = [];
            quoted = [];
            i++;
          }
          i++;
          continue;
        }
        field += c;
        i++;
      }
      return rows;
    };
    const rows = parse(csv).slice(1);
    const back = rows.map((row) =>
      row.cells.map((c, k) => (c === "" && !row.quoted[k] ? null : c)),
    );
    expect(back).toEqual([
      ["1", "a,b"],
      ["2", ""],
      ["3", null],
      ["4", 'q"q\r\nz'],
    ]);
  });

  test("the word, its defaults, escapes and refusals", async () => {
    const t = tableValue(make(["a", "str", ["x"]], ["b", "int", [1n]]));
    expect(text(await runtime.call("table:to-csv", [t, str(","), str("\\r\\n")]))).toBe(
      "a,b\r\nx,1\r\n",
    );
    expect(text(await runtime.call("table:to-csv", [t, str("\\t"), str("\\n")]))).toBe(
      "a\tb\nx\t1\n",
    );
    for (const [cell, row] of [
      ["", "\n"],
      [",", ""],
      ['"', "\n"],
      [",", '"'],
      [",", ","],
      ["ab", "b"],
    ]) {
      expect(
        code(await runtime.call("table:to-csv", [t, str(cell as string), str(row as string)])),
      ).toBe("E_RANGE");
    }
  });
});

describe("the words", () => {
  test("from-rows infers the type of each column", async () => {
    const r = await build(
      ["i", "n", "m", "b", "s", "z"],
      [
        [int(1), int(1), num(0.5), bool(true), str("a"), NULL],
        [int(-9223372036854775808n), num(2.5), int(2), NULL, str(""), NULL],
      ],
    );
    expect(payloadOf(r).columns.map((c) => c.type)).toEqual([
      "int",
      "num",
      "num",
      "bool",
      "str",
      "str",
    ]);
    expect(payloadOf(r).rows).toBe(2);
    const empty = await build(["a", "b"], []);
    expect(payloadOf(empty).rows).toBe(0);
    expect(payloadOf(await build([], [])).columns).toEqual([]);
  });

  test("from-rows refuses what does not fit", async () => {
    const cases: [string[], Value[][]][] = [
      [["a", "a"], []], // repeated name
      [["a"], [[int(1), int(2)]]], // row too long
      [["a", "b"], [[int(1)]]], // row too short
      [["a"], [[int(1)], [str("x")]]], // mixed
      [["a"], [[bool(true)], [int(1)]]],
      [["a"], [[int(2n ** 63n)]]], // beyond 64 bits
      [["a"], [[int(2n ** 53n + 1n)], [num(0.5)]]], // a big int with a num
    ];
    for (const [names, rows] of cases) {
      expect(code(await build(names, rows))).toBe("E_COERCE");
    }
    expect(code(await runtime.call("table:from-rows", [S("a"), list([int(1)])]))).toBe("E_TYPE"); // a row that is no list
    expect(code(await runtime.call("table:from-rows", [list([int(1)]), R()]))).toBe("E_TYPE");
    expect(code(await runtime.call("table:from-rows", [S("a"), R([list([])])]))).toBe("E_TYPE");
    expect(code(await runtime.call("table:from-rows", [S("a"), R([record([])])]))).toBe("E_TYPE");
    expect(code(await runtime.call("table:from-rows", [S("a"), R([ext("table", sample)])]))).toBe(
      "E_TYPE",
    );
  });

  test("columns, types, rows, column, count, records", async () => {
    const t = tableValue(sample);
    expect(top(await runtime.call("table:columns", [t]))).toEqual(S("id", "name", "score", "ok"));
    expect(top(await runtime.call("table:types", [t]))).toEqual(S("int", "str", "num", "bool"));
    expect((top(await runtime.call("table:count", [t])) as { v: number }).v).toBe(3);
    const rows = top(await runtime.call("table:rows", [t])) as { v: Value[] };
    expect(rows.v).toHaveLength(3);
    expect(rows.v[0]).toEqual(list([int(1), str("Ada"), num(1.5), bool(true)]));
    expect((rows.v[2] as { v: Value[] }).v[0]).toEqual(NULL);
    expect((rows.v[1] as { v: Value[] }).v[1]).toEqual(str(""));
    expect(top(await runtime.call("table:column", [t, str("name")]))).toEqual(
      list([str("Ada"), str(""), NULL]),
    );
    expect(code(await runtime.call("table:column", [t, str("nope")]))).toBe("E_RANGE");
    const recs = top(await runtime.call("table:records", [t])) as { v: Value[] };
    expect(recs.v[0]).toEqual(
      record([
        ["id", int(1)],
        ["name", str("Ada")],
        ["score", num(1.5)],
        ["ok", bool(true)],
      ]),
    );
    expect(code(await runtime.call("table:rows", [t], { limits: { maxValueBytes: 50 } }))).toBe(
      "E_LIMIT_VALUE",
    );
    expect(
      code(await runtime.call("table:column", [t, str("id")], { limits: { maxValueBytes: 20 } })),
    ).toBe("E_LIMIT_VALUE");
  });

  test("from-records takes every key in first-seen order and null for a missing one", async () => {
    const recs = list([
      record([
        ["a", int(1)],
        ["b", str("x")],
      ]),
      record([
        ["b", str("y")],
        ["c", bool(true)],
      ]),
      record([]),
    ]);
    const r = await runtime.call("table:from-records", [recs]);
    expect(payloadOf(r).columns.map((c) => `${c.name}:${c.type}`)).toEqual([
      "a:int",
      "b:str",
      "c:bool",
    ]);
    const rows = top(await runtime.call("table:rows", [top(r)])) as { v: Value[] };
    expect(rows.v[1]).toEqual(list([NULL, str("y"), bool(true)]));
    expect(rows.v[2]).toEqual(list([NULL, NULL, NULL]));
    expect(payloadOf(await runtime.call("table:from-records", [list([])])).rows).toBe(0);
    expect(code(await runtime.call("table:from-records", [list([int(1)])]))).toBe("E_TYPE");
  });

  test("from-text reads the text form and ext>text writes it", async () => {
    const t = writeFaithful(sample, Infinity);
    const r = await runtime.call("table:from-text", [str(t)]);
    expect(tableKind.equals(payloadOf(r), sample)).toBe(true);
    const back = await runtime.call("ext>text", [top(r)]);
    expect(text(back)).toBe(t);
    expect(code(await runtime.call("table:from-text", [str("{")]))).toBe("E_COERCE");
  });

  test("a table passes through list and record, and is charged to the value limit", async () => {
    const t = tableValue(sample);
    expect(sizeOf(list([t, t]))).toBeGreaterThan(2 * sample.size);
    expect(sizeOf(record([["t", t]]))).toBeGreaterThan(sample.size);
    const rows = Array.from({ length: 200 }, () => [str("0123456789")]);
    expect(code(await build(["s"], rows))).toBe("ok");
    const r = await runtime.call("table:from-rows", [S("s"), R(...rows)], {
      limits: { maxValueBytes: 3000 },
    });
    expect(code(r)).toBe("E_LIMIT_VALUE");
  });
});

describe("the offset of a JSON syntax error", () => {
  test("is where the text stops being JSON", () => {
    const cases: [string, number][] = [
      ["", 0],
      ["   ", 3],
      ["{", 1],
      ['{"a"', 4],
      ['{"a" 1}', 5],
      ['{"a":1,}', 7],
      ["[1,,2]", 3],
      ["[1 2]", 3],
      ["nul", 3],
      ["nulx", 3],
      ["01", 1],
      ["-", 1],
      ["1.", 2],
      ["1e", 2],
      ["1e+", 3],
      ['"abc', 4],
      ['"a\\q"', 3],
      ['"a\\u12G4"', 4],
      ['"a\nb"', 2],
      ["[1] x", 4],
      ["{1:2}", 1],
    ];
    for (const [text, at] of cases) expect(jsonErrorOffset(text), JSON.stringify(text)).toBe(at);
    for (const ok of ['{"a":[1,2.5e-3,"\\u00e9\\n",true,false,null,{}]}', " [ ] ", "-0", "0.5"]) {
      expect(jsonErrorOffset(ok), ok).toBe(0);
    }
    expect(jsonErrorOffset("[".repeat(100))).toBeGreaterThan(60);
  });
});

describe("the catalogue", () => {
  test("names the kind of an ext input and output", () => {
    const ops = buildCatalogue(runtime, { bundleVocabs: ["table"] }).ops.filter(
      (o) => o.vocab === "table",
    );
    const by = (n: string) => ops.find((o) => o.qname === n);
    expect(by("table:to-json")).toMatchObject({ input: "ext", inputKind: "table", output: "str" });
    expect(by("table:to-json")?.outputKind).toBeUndefined();
    expect(by("table:to-csv")).toMatchObject({ input: "ext", inputKind: "table" });
    expect(by("table:from-text")).toMatchObject({
      input: "str",
      output: "ext",
      outputKind: "table",
    });
    expect(by("table:from-json")).toMatchObject({
      input: "str",
      output: "ext",
      outputKind: "table",
    });
    expect(by("table:from-ndjson")).toMatchObject({
      input: "str",
      output: "ext",
      outputKind: "table",
    });
    expect(ops.map((o) => o.qname).sort()).toEqual([
      "table:from-json",
      "table:from-ndjson",
      "table:from-text",
      "table:to-csv",
      "table:to-json",
    ]);
  });
});
