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
 * Tests for the table parsers of D1: `csv:parse` and `csv:parse-tsv` (src/prims/csv.ts, src/table/builder.ts)
 * and `table:from-json` and `table:from-ndjson` (src/prims/table.ts): the RFC 4180 vectors, null
 * against the empty string, the column types, Unicode, errors, round trips with the writers and the size of
 * input the old list-of-lists path could not read.
 */
import { ext, valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "../bundle.js";
import { loadBundleNode } from "../sources-node.js";
import { cellAt } from "./payload.js";
import type { Cell, TablePayload } from "./payload.js";

const { str, bool, int } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["csv", "table"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;

const payloadSync = (r: Result): TablePayload => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return (r.stack[r.stack.length - 1] as { v: TablePayload }).v;
};
const P = async (r: Promise<Result> | Result): Promise<TablePayload> => payloadSync(await r);
const strOf = (r: Result): string => {
  if (!r.ok) throw new Error(r.error.message);
  return (r.stack[r.stack.length - 1] as { v: string }).v;
};
const code = (r: Result): string => (r.ok ? "ok" : r.error.code);
const message = (r: Result): string => (r.ok ? "" : r.error.message);

const csv = (data: string, extra: Value[] = []) =>
  runtime.call("csv:parse", [str(data), ...extra, bool(true)]);
const csvPlain = (data: string, header = true) =>
  runtime.call("csv:parse", [str(data), str(","), str("\\r\\n"), str('"'), bool(header)]);
const tsv = (data: string, header = true) =>
  runtime.call("csv:parse-tsv", [str(data), bool(header)]);
const json = (data: string, header = true) =>
  runtime.call("table:from-json", [str(data), bool(header)]);
const ndjson = (data: string, header = true) =>
  runtime.call("table:from-ndjson", [str(data), bool(header)]);

/** The table as `[names, types, rows]` for comparison. */
function shape(p: TablePayload): [string[], string[], Cell[][]] {
  const rows: Cell[][] = [];
  for (let i = 0; i < p.rows; i++) rows.push(p.columns.map((c) => cellAt(c, i)));
  return [p.columns.map((c) => c.name), p.columns.map((c) => c.type), rows];
}

describe("csv:parse: RFC 4180", () => {
  test("CRLF, LF and CR rows, and a missing final line end", async () => {
    const want = [["a", "b"], ["str", "int"], [["x", 1n]]];
    expect(shape(await P(csvPlain("a,b\r\nx,1\r\n")))).toEqual(want);
    expect(shape(await P(csvPlain("a,b\nx,1\n")))).toEqual(want);
    expect(shape(await P(csvPlain("a,b\rx,1\r")))).toEqual(want);
    expect(shape(await P(csvPlain("a,b\r\nx,1")))).toEqual(want);
  });

  test("a quoted cell holds delimiters, doubled quotes and a CRLF", async () => {
    const p = await P(csvPlain('a,b,c\r\n"x,1","he said ""hi""","line1\r\nline2"\r\n'));
    expect(shape(p)[2]).toEqual([["x,1", 'he said "hi"', "line1\r\nline2"]]);
  });

  test("empty lines are skipped, also between rows and at the end", async () => {
    const p = await P(csvPlain("\r\na,b\r\n\r\n1,2\r\n\r\n\r\n3,4\r\n\r\n"));
    expect(shape(p)).toEqual([
      ["a", "b"],
      ["int", "int"],
      [
        [1n, 2n],
        [3n, 4n],
      ],
    ]);
  });

  test("a quote inside an unquoted cell is kept", async () => {
    expect(shape(await P(csvPlain('a\nsay "hi"\n')))[2]).toEqual([['say "hi"']]);
  });

  test("a trailing delimiter is an empty last cell", async () => {
    const p = await P(csvPlain("a,b\n1,\n,2\n"));
    expect(shape(p)[2]).toEqual([
      [1n, null],
      [null, 2n],
    ]);
  });

  test("a byte order mark is dropped", async () => {
    expect(shape(await P(csvPlain("﻿a,b\n1,2\n")))[0]).toEqual(["a", "b"]);
  });

  test("a header and no rows is a table of str columns with no rows; empty text has no columns", async () => {
    expect(shape(await P(csvPlain("a,b\r\n")))).toEqual([["a", "b"], ["str", "str"], []]);
    expect(shape(await P(csvPlain("")))).toEqual([[], [], []]);
    expect(shape(await P(csvPlain("\r\n\r\n")))).toEqual([[], [], []]);
  });

  test("a ragged row is E_COERCE and names the row", async () => {
    const short = await csvPlain("a,b\r\n1,2\r\n3\r\n");
    expect(code(short)).toBe("E_COERCE");
    expect(message(short)).toContain("row 3 has 1 cells but the header has 2");
    const long = await csvPlain("a,b\r\n1,2,3\r\n");
    expect(code(long)).toBe("E_COERCE");
    expect(message(long)).toContain("row 2 has more cells than the header has (2)");
    expect(message(await csvPlain("1,2\r\n3\r\n", false))).toContain("the first row has 2");
  });

  test("an unterminated quote and text after a closing quote are E_COERCE with a position", async () => {
    const open = await csvPlain('a\n"x\n');
    expect(code(open)).toBe("E_COERCE");
    expect(message(open)).toContain("unterminated quoted cell at offset 2 (line 2, column 1");
    const after = await csvPlain('a\n"x"y\n');
    expect(code(after)).toBe("E_COERCE");
    expect(message(after)).toContain("text after the closing quote");
  });

  test("a repeated header name is E_COERCE", async () => {
    const r = await csvPlain("a,a\n1,2\n");
    expect(code(r)).toBe("E_COERCE");
    expect(message(r)).toContain("repeats the column name 'a'");
  });

  test("without a header the columns are c1, c2 and the first row is data", async () => {
    expect(shape(await P(csvPlain("1,x\n2,y\n", false)))).toEqual([
      ["c1", "c2"],
      ["int", "str"],
      [
        [1n, "x"],
        [2n, "y"],
      ],
    ]);
    expect(shape(await P(csvPlain("", false)))).toEqual([[], [], []]);
  });

  test("the delimiters, the quote and the line endings are options", async () => {
    const r = csv("a;b|'x;1';2|", [str(";"), str("|"), str("'")]);
    expect(shape(await P(r))).toEqual([["a", "b"], ["str", "int"], [["x;1", 2n]]]);
  });

  test("bad options are E_RANGE", async () => {
    expect(code(await csv("a", [str(","), str("\\n"), str("ab")]))).toBe("E_RANGE");
    expect(code(await csv("a", [str(""), str("\\n"), str('"')]))).toBe("E_RANGE");
    expect(code(await csv("a", [str(","), str(""), str('"')]))).toBe("E_RANGE");
    expect(code(await csv("a", [str('"'), str("\\n"), str('"')]))).toBe("E_RANGE");
    expect(code(await csv("a", [str(","), str(",\\n"), str('"')]))).toBe("E_RANGE");
  });

  test("a delimiter beyond the BMP works", async () => {
    const p = await P(csv("a\u{1f600}b\nx\u{1f600}y\n", [str("\u{1f600}"), str("\\n"), str('"')]));
    expect(shape(p)).toEqual([["a", "b"], ["str", "str"], [["x", "y"]]]);
  });
});

describe("csv:parse: null and the empty string", () => {
  test("an empty unquoted cell is null and a quoted empty cell is the empty string", async () => {
    const p = await P(csvPlain('a,b\n1,\n2,""\n,x\n'));
    expect(shape(p)).toEqual([
      ["a", "b"],
      ["int", "str"],
      [
        [1n, null],
        [2n, ""],
        [null, "x"],
      ],
    ]);
  });

  test("a quoted empty cell makes a numeric-looking column text", async () => {
    const p = await P(csvPlain('a\n1\n""\n3\n'));
    expect(shape(p)).toEqual([["a"], ["str"], [["1"], [""], ["3"]]]);
  });

  test("a single-column row of an empty quoted cell is a row; an empty line is not", async () => {
    expect(shape(await P(csvPlain('a\n""\n\nx\n')))[2]).toEqual([[""], ["x"]]);
  });

  test("table:to-csv and csv:parse round trip null against the empty string", async () => {
    const t = await P(csvPlain('a,b\n1,\n2,""\n,"x"\n'));
    const w = await runtime.call("table:to-csv", [ext("table", t), str(","), str("\\r\\n")]);
    expect(w.ok).toBe(true);
    const out = { v: strOf(w) };
    expect(shape(await P(await csvPlain(out.v)))).toEqual(shape(t));
  });
});

describe("csv:parse: column types", () => {
  const types = async (data: string): Promise<string[]> => shape(await P(csvPlain(data)))[1];
  const cells = async (data: string): Promise<Cell[]> =>
    shape(await P(csvPlain(data)))[2].map((r) => r[0] as Cell);

  test("int, num, bool and str", async () => {
    expect(await types("a,b,c,d\n1,1.5,true,x\n-2,2e3,FALSE,y\n")).toEqual([
      "int",
      "num",
      "bool",
      "str",
    ]);
    expect(await cells("a\n1\n-2\n")).toEqual([1n, -2n]);
    expect(await cells("a\n1.5\n2e3\n-0.25\n")).toEqual([1.5, 2000, -0.25]);
    expect(await cells("a\ntrue\nFalse\nTRUE\n")).toEqual([true, false, true]);
  });

  test("an int and a num together make a num", async () => {
    expect(await types("a\n1\n2.5\n")).toEqual(["num"]);
    expect(await cells("a\n1\n2.5\n")).toEqual([1, 2.5]);
  });

  test("nulls only make a str column, and nulls do not change a type", async () => {
    expect(await types("a,b\n,\n,\n")).toEqual(["str", "str"]);
    expect(await types("a\n1\n\n\n2\n")).toEqual(["int"]);
    expect(await cells("a,b\n,1\n,2\n")).toEqual([null, null]);
  });

  test("a mixed column keeps its text", async () => {
    expect(await cells("a\n1\nx\n")).toEqual(["1", "x"]);
    expect(await cells("a\ntrue\n1\n")).toEqual(["true", "1"]);
    expect(await cells("a\n1.5\ntrue\n")).toEqual(["1.5", "true"]);
  });

  test("text that only looks like a number stays text", async () => {
    for (const t of [
      "007",
      "+5",
      "1.",
      ".5",
      "1e",
      "0x10",
      "1_000",
      "1,5",
      "--1",
      "-",
      "NaN",
      "Infinity",
      "1e999",
      " 1",
    ]) {
      expect(await cells(`a\n"${t}"\n`)).toEqual([t]);
    }
    expect(await cells("a\n0\n-0\n10\n")).toEqual([0n, 0n, 10n]);
    expect(await cells("a\n0.5\n0e1\n")).toEqual([0.5, 0]);
  });

  test("int64 limits: 64 bits stay int, more is text, and an int beyond 2^53 is exact", async () => {
    expect(await cells("a\n9223372036854775807\n-9223372036854775808\n9007199254740993\n")).toEqual(
      [9223372036854775807n, -9223372036854775808n, 9007199254740993n],
    );
    expect(await cells("a\n9223372036854775808\n")).toEqual(["9223372036854775808"]);
    expect(await cells("a\n123456789012345678901234567890\n")).toEqual([
      "123456789012345678901234567890",
    ]);
  });

  test("an int beyond 2^53 with a num makes the column text, not a lossy num", async () => {
    expect(await cells("a\n9007199254740993\n1.5\n")).toEqual(["9007199254740993", "1.5"]);
    expect(await types("a\n12345678901234567.5\n1\n")).toEqual(["num"]);
  });

  test("a quoted number is still a number", async () => {
    expect(await cells('a\n"1"\n2\n')).toEqual([1n, 2n]);
  });
});

describe("csv:parse: Unicode", () => {
  test("names and cells keep every code point", async () => {
    const p = await P(csvPlain('naïve,日本,😀\r\n"é","a,日",\u{1f600}x\r\n'));
    expect(shape(p)).toEqual([
      ["naïve", "日本", "😀"],
      ["str", "str", "str"],
      [["é", "a,日", "😀x"]],
    ]);
  });
});

describe("csv:parse-tsv", () => {
  test("tabs separate cells, commas do not", async () => {
    expect(shape(await P(tsv("a\tb\n1,5\t2\n")))).toEqual([
      ["a", "b"],
      ["str", "int"],
      [["1,5", 2n]],
    ]);
    expect(shape(await P(tsv("1\t2\n", false)))[0]).toEqual(["c1", "c2"]);
  });

  test("a quoted cell holds a tab and a null is empty", async () => {
    expect(shape(await P(tsv('a\tb\n"x\ty"\t\n')))[2]).toEqual([["x\ty", null]]);
  });
});

describe("table:from-json", () => {
  test("an array of records: columns in first-seen order, null for a missing key", async () => {
    const p = await P(json('[{"a":1,"b":"x"},{"b":"y","c":true},{"a":2.5,"c":null}]'));
    expect(shape(p)).toEqual([
      ["a", "b", "c"],
      ["num", "str", "bool"],
      [
        [1, "x", null],
        [null, "y", true],
        [2.5, null, null],
      ],
    ]);
  });

  test("an array of arrays with a header, and without", async () => {
    expect(shape(await P(json('[["id","name"],[1,"Ada"],[2,null]]')))).toEqual([
      ["id", "name"],
      ["int", "str"],
      [
        [1n, "Ada"],
        [2n, null],
      ],
    ]);
    expect(shape(await P(json('[[1,"Ada"],[2,"Alan"]]', false)))).toEqual([
      ["c1", "c2"],
      ["int", "str"],
      [
        [1n, "Ada"],
        [2n, "Alan"],
      ],
    ]);
  });

  test("one record is one row and an empty array is an empty table", async () => {
    expect(shape(await P(json('{"a":1}')))[2]).toEqual([[1n]]);
    expect(shape(await P(json("[]")))).toEqual([[], [], []]);
    expect(shape(await P(json('[["a"]]')))).toEqual([["a"], ["str"], []]);
  });

  test("integers beyond 2^53 are exact, and the empty string is not null", async () => {
    const p = await P(json('[{"n":9007199254740993,"s":""},{"n":-9223372036854775808,"s":null}]'));
    expect(shape(p)[2]).toEqual([
      [9007199254740993n, ""],
      [-9223372036854775808n, null],
    ]);
  });

  test("mixed types, nested values, ragged rows and bad JSON are E_COERCE", async () => {
    expect(code(await json('[{"a":1},{"a":"x"}]'))).toBe("E_COERCE");
    expect(message(await json('[{"a":1},{"a":true}]'))).toContain("column 'a' mixes bool and int");
    expect(code(await json('[{"a":[1]}]'))).toBe("E_COERCE");
    expect(code(await json('[{"a":{"b":1}}]'))).toBe("E_COERCE");
    expect(code(await json('[["a","b"],[1]]'))).toBe("E_COERCE");
    expect(code(await json('[["a","a"],[1,2]]'))).toBe("E_COERCE");
    expect(code(await json("[[1,2]]"))).toBe("E_COERCE"); // a header that is not text
    expect(code(await json('[{"a":1},[1]]'))).toBe("E_COERCE");
    expect(code(await json('[[1],{"a":1}]', false))).toBe("E_COERCE");
    expect(code(await json("[1,2]"))).toBe("E_COERCE");
    expect(code(await json('"x"'))).toBe("E_COERCE");
    expect(code(await json('[{"a":1}'))).toBe("E_COERCE");
    expect(code(await json('[{"a":123456789012345678901234567890}]'))).toBe("E_COERCE");
    expect(code(await json('[{"a":9007199254740993},{"a":1.5}]'))).toBe("E_COERCE");
  });

  test("round trips with table:to-json", async () => {
    const t = await P(
      json('[{"a":1,"b":"x","c":1.5,"d":true},{"a":null,"b":"","c":null,"d":false}]'),
    );
    const w = await runtime.call("table:to-json", [ext("table", t), int(0)]);
    const text = strOf(w);
    expect(shape(await P(await json(text)))).toEqual(shape(t));
  });
});

describe("table:from-ndjson", () => {
  test("one record on each line, blank lines skipped, CRLF accepted", async () => {
    const p = await P(ndjson('{"a":1,"b":"x"}\r\n\r\n{"a":2}\n  \n{"b":null,"c":true}\n'));
    expect(shape(p)).toEqual([
      ["a", "b", "c"],
      ["int", "str", "bool"],
      [
        [1n, "x", null],
        [2n, null, null],
        [null, null, true],
      ],
    ]);
  });

  test("lines that are arrays, with and without a header", async () => {
    expect(shape(await P(ndjson('["a","b"]\n[1,2]\n[3,4]')))).toEqual([
      ["a", "b"],
      ["int", "int"],
      [
        [1n, 2n],
        [3n, 4n],
      ],
    ]);
    expect(shape(await P(ndjson("[1]\n[2]\n", false)))[0]).toEqual(["c1"]);
  });

  test("a bad line names its number", async () => {
    const r = await ndjson('{"a":1}\n{"a":\n');
    expect(code(r)).toBe("E_COERCE");
    expect(message(r)).toContain("line 2");
    expect(code(await ndjson("1\n"))).toBe("E_COERCE");
  });

  test("empty text is an empty table", async () => {
    expect(shape(await P(ndjson("")))).toEqual([[], [], []]);
  });
});

describe("a size the list-of-lists path could not read", () => {
  test("100,000 rows by 10 columns parse in a second or two", async () => {
    const rows = 100_000;
    const lines: string[] = ["id,name,score,flag,a,b,c,d,e,f"];
    for (let i = 0; i < rows; i++) {
      lines.push(`${i},name ${i},${i % 97}.5,${i % 2 === 0},x${i},${i * 3},,"q ""${i}""",${-i},z`);
    }
    const data = lines.join("\r\n") + "\r\n";
    const t0 = performance.now();
    const r = await runtime.call(
      "csv:parse",
      [str(data), str(","), str("\\r\\n"), str('"'), bool(true)],
      {
        limits: { maxValueBytes: 256 * 1024 * 1024 },
      },
    );
    const ms = performance.now() - t0;
    const p = await P(r);
    expect(p.rows).toBe(rows);
    expect(p.columns.map((c) => c.type)).toEqual([
      "int",
      "str",
      "num",
      "bool",
      "str",
      "int",
      "str",
      "str",
      "int",
      "str",
    ]);
    expect(cellAt(p.columns[1] as never, 99_999)).toBe("name 99999");
    expect(cellAt(p.columns[7] as never, 5)).toBe('q "5"');
    expect(cellAt(p.columns[6] as never, 5)).toBeNull();
    console.log(`csv:parse 100,000 rows x 10: ${data.length} chars, ${Math.round(ms)} ms`);
    expect(ms).toBeLessThan(20_000);
  });

  test("the same rows as NDJSON", async () => {
    const rows = 100_000;
    const lines: string[] = [];
    for (let i = 0; i < rows; i++) {
      lines.push(
        JSON.stringify({
          id: i,
          name: `n${i}`,
          s: i + 0.5,
          f: i % 2 === 0,
          a: "x",
          b: i,
          c: null,
          d: "d",
          e: -i,
          g: "z",
        }),
      );
    }
    const data = lines.join("\n");
    const t0 = performance.now();
    const r = await runtime.call("table:from-ndjson", [str(data), bool(true)], {
      limits: { maxValueBytes: 256 * 1024 * 1024 },
    });
    const ms = performance.now() - t0;
    expect((await P(r)).rows).toBe(rows);
    console.log(`table:from-ndjson 100,000 rows x 10: ${data.length} chars, ${Math.round(ms)} ms`);
    expect(ms).toBeLessThan(30_000);
  });
});

describe("the limit", () => {
  test("a table over maxValueBytes is E_LIMIT_VALUE", async () => {
    const r = await runtime.call(
      "csv:parse",
      [str("a,b\n" + "1,2\n".repeat(2000)), str(","), str("\\r\\n"), str('"'), bool(true)],
      {
        limits: { maxValueBytes: 20_000 },
      },
    );
    expect(code(r)).toBe("E_LIMIT_VALUE");
  });
});
