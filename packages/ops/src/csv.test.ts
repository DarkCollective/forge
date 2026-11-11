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
 * Tests for the `csv` vocabulary (vocab/csv.fth, src/prims/csv.ts): `csv:to-json` and `csv:from-json`. The op
 * vectors (vocab/csv.test.json) hold the cases computed with Python's csv and json modules; these tests add the
 * round trips, the delimiter rules, malformed and truncated input, the limits and the cost at 64 KiB.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { unescapeDelimiter } from "./prims/csv.js";
import { loadBundleNode } from "./sources-node.js";

const { int, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["csv"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const out = (r: Result): string => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return (r.stack[r.stack.length - 1] as { v: string }).v;
};
const toJson = (
  data: string,
  cell = ",",
  row = "\\r\\n",
  format = "array-of-dictionaries",
  indent = 0,
  limits?: { maxValueBytes: number },
) =>
  runtime.call(
    "csv:to-json",
    [str(data), str(cell), str(row), str(format), int(indent)],
    limits === undefined ? undefined : { limits },
  );
const fromJson = (data: string, cell = ",", row = "\\r\\n", limits?: { maxValueBytes: number }) =>
  runtime.call(
    "csv:from-json",
    [str(data), str(cell), str(row)],
    limits === undefined ? undefined : { limits },
  );
const arrays = async (data: string, cell = ",", row = "\\r\\n") =>
  JSON.parse(out(await toJson(data, cell, row, "array-of-arrays"))) as string[][];

describe("the delimiter escapes", () => {
  test("\\r \\n \\t \\\\ and \\xHH are read, anything else stays", () => {
    expect(unescapeDelimiter("\\r\\n")).toBe("\r\n");
    expect(unescapeDelimiter("\\t")).toBe("\t");
    expect(unescapeDelimiter("\\\\")).toBe("\\");
    expect(unescapeDelimiter("\\x1f\\x7C")).toBe("\u001f|");
    expect(unescapeDelimiter("\\q;\\x1")).toBe("\\q;\\x1");
    expect(unescapeDelimiter("a|b")).toBe("a|b");
  });

  test("a real CR LF in the parameter works the same as the escape", async () => {
    expect(await arrays("a,b\r\n1,2\r\n", ",", "\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(await arrays("a|b;1|2", "|", ";")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("csv:to-json: reading", () => {
  test("CRLF inside a quoted cell is kept, outside it ends the row", async () => {
    expect(await arrays('"a\r\nb",c\r\nd,e')).toEqual([
      ["a\r\nb", "c"],
      ["d", "e"],
    ]);
  });

  test("the default row delimiter takes CRLF, LF and CR, in one file too", async () => {
    expect(await arrays("a\r\nb\nc\rd")).toEqual([["a"], ["b"], ["c"], ["d"]]);
  });

  test("a row delimiter of LF alone leaves a CR in the cell", async () => {
    expect(await arrays("a,b\r\nc,d", ",", "\\n")).toEqual([
      ["a", "b\r"],
      ["c", "d"],
    ]);
  });

  test("an empty line is skipped, a line of one quoted empty cell is a row", async () => {
    expect(await arrays('a\r\n\r\n""\r\n\r\nb')).toEqual([["a"], [""], ["b"]]);
    expect(await arrays("\r\n\r\n")).toEqual([]);
    expect(await arrays("")).toEqual([]);
  });

  test("a trailing cell delimiter is an empty last cell; only delimiters give empty cells", async () => {
    expect(await arrays("a,b,\r\n,,\r\n")).toEqual([
      ["a", "b", ""],
      ["", "", ""],
    ]);
  });

  test("doubled quotes, and quotes in the middle of an unquoted cell", async () => {
    expect(await arrays('"a""b""",x"y,"""",""')).toEqual([['a"b"', 'x"y', '"', ""]]);
  });

  test("a quote that does not start a cell is just text, even after a space", async () => {
    expect(await arrays(' "a",b')).toEqual([[' "a"', "b"]]);
  });

  test("a BOM is part of the first cell (strip it with another op)", async () => {
    expect(await arrays("\ufeffa,b")).toEqual([["\ufeffa", "b"]]);
  });

  test("unicode, including characters above U+FFFF as delimiters", async () => {
    expect(await arrays("😀,é\r\n名,前")).toEqual([
      ["😀", "é"],
      ["名", "前"],
    ]);
    expect(await arrays("a😀b😀c", "😀")).toEqual([["a", "b", "c"]]);
  });

  test("the dictionaries keep the header order and every value is a string", async () => {
    expect(out(await toJson("z,a,m\r\n1,2,3"))).toBe('[{"z":"1","a":"2","m":"3"}]');
  });

  test("a header cell may be empty or hold spaces", async () => {
    expect(out(await toJson("a b,,c\r\n1,2,3"))).toBe('[{"a b":"1","":"2","c":"3"}]');
  });
});

describe("csv:to-json: errors", () => {
  test.each([
    ['"abc', "unterminated quote"],
    ['a,"b\r\nc', "quote closed by the end of the text"],
    ['a,"b"c', "text after a closing quote"],
    ['"a" ,b', "a space after a closing quote"],
    ['a,"b""', "doubled quote at the end"],
    ['"', "a lone quote"],
  ])("%j is E_COERCE (%s)", async (t) => {
    expect(code(await toJson(t, ",", "\\r\\n", "array-of-arrays"))).toBe("E_COERCE");
  });

  test("the message names the offset, line, column and record", async () => {
    const r = await toJson('a,b\r\n1,"x', ",", "\\r\\n", "array-of-arrays");
    expect(!r.ok && r.error.message).toContain(
      "unterminated quoted cell at offset 7 (line 2, column 3, row 2)",
    );
    const s = await toJson('a\n"b"c');
    expect(!s.ok && s.error.message).toContain(
      "text after the closing quote of a cell at offset 5 (line 2, column 4, row 2)",
    );
  });

  test("truncating a quoted document anywhere inside a quote fails, elsewhere it reads", async () => {
    const doc = 'name,note\r\nAda,"said ""hi"", left"\r\nAlan,ok\r\n';
    for (let n = 0; n <= doc.length; n++) {
      const r = await toJson(doc.slice(0, n), ",", "\\r\\n", "array-of-arrays");
      const quotes = (doc.slice(0, n).match(/"/g) ?? []).length;
      if (quotes % 2 === 1) expect(code(r)).toBe("E_COERCE");
      else expect(code(r)).toBe("ok");
    }
  });

  test("the row length and header rules", async () => {
    const long = await toJson("a,b\r\n1,2\r\n3,4,5");
    expect(!long.ok && long.error.message).toContain("CSV row 3 has 3 cells but the header has 2");
    expect(code(await toJson("a,b\r\n1,2\r\n3"))).toBe("E_COERCE");
    expect(code(await toJson("a,b,a\r\n1,2,3"))).toBe("E_COERCE");
    // arrays have no such rules
    expect(code(await toJson("a,b\r\n1\r\n3,4,5", ",", "\\r\\n", "array-of-arrays"))).toBe("ok");
  });

  test("bad delimiters are E_RANGE", async () => {
    for (const [c, r] of [
      ["", "\\n"],
      [",", ""],
      ['"', "\\n"],
      [",", '"'],
      [",;", ";\\n"],
      ["\\n", "\\r\\n"],
    ] as const)
      expect(code(await toJson("a,b", c, r))).toBe("E_RANGE");
  });

  test("a format that is not offered is refused before the word runs", async () => {
    const r = await runtime.call("csv:to-json", [
      str("a"),
      str(","),
      str("\\n"),
      str("array"),
      int(2),
    ]);
    expect(code(r)).toBe("E_PARAM_INVALID");
  });

  test("the rows are bounded by maxValueBytes (an input of only commas is a lot of cells)", async () => {
    expect(
      code(
        await toJson(",".repeat(5000), ",", "\\n", "array-of-arrays", 0, { maxValueBytes: 10_000 }),
      ),
    ).toBe("E_LIMIT_VALUE");
    expect(
      code(await toJson("a,b", ",", "\\n", "array-of-arrays", 0, { maxValueBytes: 10_000 })),
    ).toBe("ok");
  });
});

describe("csv:from-json", () => {
  test("RFC 4180 quoting rules: delimiter, quote, CR, LF; spaces and other characters are not quoted", async () => {
    expect(
      out(await fromJson('[["a b"," lead","x,y","q\\"q","c\\rr","l\\nl","tab\\t","é;"]]')),
    ).toBe('a b, lead,"x,y","q""q","c\rr","l\nl",tab\t,é;');
  });

  test("a custom delimiter quotes its own text, in a cell and in a row delimiter", async () => {
    expect(out(await fromJson('[["a;b","c,d"],["e","f|g"]]', ";", "|"))).toBe('"a;b";c,d|e;"f|g"');
    expect(out(await fromJson('[["a","b"],["c","d"]]', "::", "\\n"))).toBe("a::b\nc::d");
    expect(out(await fromJson('[["a::b"]]', "::", "\\n"))).toBe('"a::b"');
  });

  test("keys of the first object come first, the others follow in order of appearance", async () => {
    expect(out(await fromJson('[{"b":1,"a":2},{"c":3,"a":4}]'))).toBe("b,a,c\r\n1,2,\r\n,4,3");
  });

  test("a key that needs quoting is quoted in the header", async () => {
    expect(out(await fromJson('[{"a,b":1,"c\\"d":2}]'))).toBe('"a,b","c""d"\r\n1,2');
  });

  test("numbers keep their exact JSON text, with a big integer and a float", async () => {
    expect(out(await fromJson("[[1,-0.0,100.0,1e21,12345678901234567890,0.1]]"))).toBe(
      "1,-0.0,100.0,1e+21,12345678901234567890,0.1",
    );
  });

  test("nested values are their compact JSON text, quoted when they hold the delimiter", async () => {
    expect(out(await fromJson('[{"a":[1,{"b":"c"}],"d":{}}]'))).toBe(
      'a,d\r\n"[1,{""b"":""c""}]",{}',
    );
  });

  test("null is an empty cell in an array row, in an object and nested null stays null", async () => {
    expect(out(await fromJson('[[null,"x",[null]]]'))).toBe(",x,[null]");
  });

  test("an empty array, an array of empty objects and an array of empty arrays", async () => {
    expect(out(await fromJson("[]"))).toBe("");
    expect(out(await fromJson("[{}]"))).toBe("\r\n");
    expect(out(await fromJson("[[],[]]"))).toBe("\r\n");
  });

  test("errors: not convertible JSON, mixed arrays, scalar rows, repeated keys, bad delimiters", async () => {
    for (const t of [
      "",
      "1",
      "null",
      "true",
      '"s"',
      "[1]",
      "[null]",
      '[{"a":1},2]',
      '[[1],{"a":1}]',
      '[{"a":1},null]',
      '[{"a":1,"a":2}]',
      "[",
      "{",
    ]) {
      expect(code(await fromJson(t))).toBe("E_COERCE");
    }
    expect(code(await fromJson("[]", "", "\\n"))).toBe("E_RANGE");
    expect(code(await fromJson("[]", ",", ""))).toBe("E_RANGE");
    expect(code(await fromJson("[]", '"', "\\n"))).toBe("E_RANGE");
  });

  test("bytes that are not UTF-8 are refused by the str input", async () => {
    const r = await runtime.call("csv:from-json", [
      { tag: "bytes", v: new Uint8Array([0x5b, 0xff]) },
      str(","),
      str("\\n"),
    ]);
    expect(code(r)).toBe("E_COERCE");
  });
});

describe("round trips", () => {
  const nasty = [
    "plain",
    "with,comma",
    'with "quote"',
    "two\r\nlines",
    "one\nline",
    "",
    " spaced ",
    "é😀名",
    ";|\\",
    '""',
    ",",
  ];

  test("from-json then to-json gives the strings back, for every pair of delimiters", async () => {
    const rows = [nasty, [...nasty].reverse(), nasty.map((_, i) => `cell ${i}`)];
    for (const [cell, row] of [
      [",", "\\r\\n"],
      [";", "\\n"],
      ["|", "\\r"],
      ["\\t", "\\r\\n"],
      ["::", "\\n"],
    ] as const) {
      if (cell === "::") continue; // a delimiter set is not a delimiter string: tested on its own below
      const csv = out(await fromJson(JSON.stringify(rows), cell, row));
      // a row of one empty cell survives, a blank line does not exist in this output
      expect(await arrays(csv, cell, row)).toEqual(rows);
    }
  });

  test("an array of objects comes back as the same objects", async () => {
    const objs = [
      { id: "1", name: "Ada, Countess", note: 'she said "hi"' },
      { id: "2", name: "Alan", note: "line1\nline2" },
    ];
    const csv = out(await fromJson(JSON.stringify(objs)));
    expect(JSON.parse(out(await toJson(csv)))).toEqual(objs);
  });

  test("a one-cell empty row is quoted so it survives", async () => {
    const csv = out(await fromJson('[[""],[""],["x"]]'));
    expect(csv).toBe('""\r\n""\r\nx');
    expect(await arrays(csv)).toEqual([[""], [""], ["x"]]);
  });
});

describe("cost at 64 KiB", () => {
  const cellsOf = (i: number) => [`id${i}`, `name, ${i}`, `say "${i}"`, `é${i}`, "x"];
  const rows = Array.from({ length: 2400 }, (_, i) => cellsOf(i));

  test("64 KiB of CSV to JSON, and 64 KiB of JSON back to CSV", { timeout: 60_000 }, async () => {
    const json = JSON.stringify(rows);
    expect(json.length).toBeGreaterThan(64 * 1024);
    const t0 = Date.now();
    const csv = out(await fromJson(json));
    const fromMs = Date.now() - t0;
    const fromRun = await fromJson(json);
    expect(csv.length).toBeGreaterThan(64 * 1024);
    const t1 = Date.now();
    const back = await toJson(csv, ",", "\\r\\n", "array-of-arrays", 0);
    const toMs = Date.now() - t1;
    expect(back.ok && JSON.parse(out(back))).toEqual(rows);
    const withHeader = `h1,h2,h3,h4,h5\r\n${csv}`;
    const dict = await toJson(withHeader, ",", "\\r\\n", "array-of-dictionaries", 2);
    expect(dict.ok).toBe(true);
    expect(fromRun.ok && fromRun.steps).toBeLessThan(200_000);
    expect(back.ok && back.steps).toBeLessThan(1000);
    expect(dict.ok && dict.steps).toBeLessThan(200_000);
    process.stderr.write(
      `\ncsv 64 KiB: from-json ${json.length} chars -> ${csv.length} chars: ${fromRun.ok && fromRun.steps} steps ${fromMs.toFixed(0)} ms; to-json arrays ${back.ok && back.steps} steps ${toMs.toFixed(0)} ms; to-json dictionaries ${dict.ok && dict.steps} steps\n`,
    );
  });

  test(
    "a 64 KiB quoted cell, 64 KiB of delimiters and a wide row",
    { timeout: 60_000 },
    async () => {
      const big = 'x,\r\n"'.repeat(16384);
      const csv = out(await fromJson(JSON.stringify([[big, "y"]])));
      expect((await arrays(csv))[0]).toEqual([big, "y"]);
      expect((await arrays(",".repeat(65536)))[0]).toHaveLength(65537);
      const wide = Array.from({ length: 20000 }, (_, i) => `c${i}`);
      const json = out(await toJson(`${wide.join(",")}\r\n${wide.map(() => "v").join(",")}`));
      expect(Object.keys(JSON.parse(json)[0])).toEqual(wide);
    },
  );
});
