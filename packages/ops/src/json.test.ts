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
 * Tests for the shared `json` vocabulary (vocab/json.fth, src/prims/json.ts): `json:parse`, `json:stringify`,
 * `json:compact`, `json:pretty`, `json:null` and `json:null?`. Expected texts come from RFC 8259 (section 13
 * examples) and from Python's json module (`json.dumps(indent=n, ensure_ascii=False)`).
 */
import { valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { MAX_DEPTH, NULL_KEY } from "./prims/json.js";
import { loadBundleNode } from "./sources-node.js";

const { int, num, str, bool, list, bytes } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["json"]));
runtime.load(`IN: probe
: roundtrip ( text:str -- str ) text json:parse json:compact ;
: is-null ( text:str -- bool ) text json:parse json:null? ;
`);

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const top = (r: Result): Value => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.stack[r.stack.length - 1] as Value;
};
const parse = (text: string, limits?: { maxValueBytes?: number; maxIntBits?: number }) =>
  runtime.call("json:parse", [str(text)], limits === undefined ? undefined : { limits });
const stringify = (v: Value, indent: number, limits?: { maxValueBytes: number }) =>
  runtime.call("json:stringify", [v, int(indent)], limits === undefined ? undefined : { limits });
const text = (r: Result) => top(r).v as string;

/** A parsed value as plain JS: int as bigint, num as number, a record as an array of entries, null as null. */
function shape(v: Value): unknown {
  switch (v.tag) {
    case "int":
      return BigInt(v.v as number | bigint);
    case "list":
      return (v.v as Value[]).map(shape);
    case "record": {
      const m = v.v as Map<string, Value>;
      if (m.size === 1 && m.has(NULL_KEY)) return null;
      return [...m].map(([k, x]) => [k, shape(x)]);
    }
    default:
      return v.v;
  }
}
const parsed = async (t: string) => shape(top(await parse(t)));
const parsedValue = async (t: string) => top(await parse(t));
const pretty = async (t: string, indent: number) =>
  text(await stringify(await parsedValue(t), indent));

const RFC_IMAGE =
  '{"Image": {"Width": 800, "Height": 600, "Title": "View from 15th Floor", "Thumbnail": {"Url": "http://www.example.com/image/481989943", "Height": 125, "Width": 100}, "Animated" : false, "IDs": [116, 943, 234, 38793]}}';
const RFC_LOCATIONS =
  '[{"precision": "zip", "Latitude": 37.7668, "Longitude": -122.3959, "Address": "", "City": "SAN FRANCISCO", "State": "CA", "Zip": "94107", "Country": "US"}, {"precision": "zip", "Latitude": 37.371991, "Longitude": -122.026020, "Address": "", "City": "SUNNYVALE", "State": "CA", "Zip": "94085", "Country": "US"}]';

describe("json:parse: values", () => {
  test("the scalars of RFC 8259 section 13", async () => {
    expect(await parsed('"Hello world!"')).toBe("Hello world!");
    expect(await parsed("42")).toBe(42n);
    expect(await parsed("true")).toBe(true);
    expect(await parsed("false")).toBe(false);
    expect(await parsed("null")).toBeNull();
  });

  test("the RFC 8259 image example, keys in the order written", async () => {
    const v = (await parsed(RFC_IMAGE)) as [string, unknown][];
    expect(v.map(([k]) => k)).toEqual(["Image"]);
    const image = v[0]?.[1] as [string, unknown][];
    expect(image.map(([k]) => k)).toEqual([
      "Width",
      "Height",
      "Title",
      "Thumbnail",
      "Animated",
      "IDs",
    ]);
    expect(image[0]?.[1]).toBe(800n);
    expect(image[4]?.[1]).toBe(false);
    expect(image[5]?.[1]).toEqual([116n, 943n, 234n, 38793n]);
  });

  test("the RFC 8259 locations example: floats are num, strings keep their text", async () => {
    const v = (await parsed(RFC_LOCATIONS)) as [string, unknown][][];
    expect(v).toHaveLength(2);
    expect(v[0]?.[1]).toEqual(["Latitude", 37.7668]);
    expect(v[1]?.[2]).toEqual(["Longitude", -122.02602]);
    expect(v[1]?.[5]).toEqual(["State", "CA"]);
  });

  test("empty containers, nesting and white space (space, tab, LF, CR only)", async () => {
    expect(await parsed("[]")).toEqual([]);
    expect(await parsed("{}")).toEqual([]);
    expect(await parsed(" \t\r\n[ [ ] , { } , [ [ 1 ] ] ]\n")).toEqual([[], [], [[1n]]]);
  });

  test("an array is a list, an object is a record, and the types are exact", async () => {
    expect((await parsedValue("[1]")).tag).toBe("list");
    expect((await parsedValue('{"a":1}')).tag).toBe("record");
    expect((await parsedValue("1")).tag).toBe("int");
    expect((await parsedValue("1.0")).tag).toBe("num");
    expect((await parsedValue("1e2")).tag).toBe("num");
    expect((await parsedValue('"1"')).tag).toBe("str");
  });

  test("the key order of the text is the order of the record, and equality ignores it", async () => {
    const a = await parsedValue('{"b":1,"a":2,"10":3,"2":4}');
    expect([...(a.v as Map<string, Value>).keys()]).toEqual(["b", "a", "10", "2"]);
    const b = await parsedValue('{"2":4,"10":3,"a":2,"b":1}');
    expect([...(b.v as Map<string, Value>).keys()]).toEqual(["2", "10", "a", "b"]);
    expect(text(await runtime.call("json:compact", [a]))).toBe('{"b":1,"a":2,"10":3,"2":4}');
  });

  test("a repeated key is E_COERCE with the position of the second one", async () => {
    const r = await parse('{"a":1,\n "b":2, "a":3}');
    expect(code(r)).toBe("E_COERCE");
    expect(!r.ok && r.error.message).toContain(
      "duplicate object key at offset 16 (line 2, column 9)",
    );
  });

  test("the key __proto__ and an empty key are ordinary keys", async () => {
    expect(await parsed('{"__proto__":1,"":2}')).toEqual([
      ["__proto__", 1n],
      ["", 2n],
    ]);
  });
});

describe("json:parse: numbers", () => {
  test("integers are exact, including negative zero as 0 and big integers", async () => {
    expect(await parsed("-0")).toBe(0n);
    expect(await parsed("-17")).toBe(-17n);
    expect(await parsed("9007199254740993")).toBe(9007199254740993n);
    expect(await parsed("123456789012345678901234567890")).toBe(123456789012345678901234567890n);
    expect(await parsed("-123456789012345678901234567890")).toBe(-123456789012345678901234567890n);
    const big = "9".repeat(5000);
    expect(await parsed(big)).toBe(BigInt(big));
    expect((await parsedValue("9007199254740991")).v).toBe(9007199254740991);
    expect(typeof (await parsedValue("9007199254740992")).v).toBe("bigint");
  });

  test("a number with a fraction or an exponent is a num", async () => {
    expect(await parsed("0.5")).toBe(0.5);
    expect(await parsed("-0.0")).toBe(-0);
    expect(Object.is(await parsed("-0.0"), -0)).toBe(true);
    expect(await parsed("1E3")).toBe(1000);
    expect(await parsed("1e+2")).toBe(100);
    expect(await parsed("1.5e-3")).toBe(0.0015);
    expect(await parsed("123456789012345678901234567890.0")).toBe(1.2345678901234568e29);
    expect(await parsed("5e-324")).toBe(5e-324);
    expect(await parsed("1e-999")).toBe(0);
  });

  test("a number beyond the range of a float is E_COERCE", async () => {
    expect(code(await parse("1e999"))).toBe("E_COERCE");
    expect(code(await parse("-1e999"))).toBe("E_COERCE");
  });

  test("an integer over maxIntBits is E_LIMIT_VALUE, without converting it first", async () => {
    expect(code(await parse("9".repeat(30000)))).toBe("E_LIMIT_VALUE");
    expect(code(await parse("1".repeat(25), { maxIntBits: 64 }))).toBe("E_LIMIT_VALUE");
    expect(code(await parse("1".repeat(19), { maxIntBits: 64 }))).toBe("ok");
  });

  test.each([
    "01",
    "-01",
    "+1",
    ".5",
    "1.",
    "1.e2",
    "-",
    "--1",
    "1e",
    "1e+",
    "0x10",
    "1_000",
    "NaN",
    "Infinity",
    "-Infinity",
    "1 2",
  ])("%s is not a JSON number", async (t) => {
    expect(code(await parse(t))).toBe("E_COERCE");
  });
});

describe("json:parse: strings", () => {
  test("every escape of RFC 8259", async () => {
    expect(await parsed('"\\" \\\\ \\/ \\b \\f \\n \\r \\t \\u0041 \\u00e9 \\u00E9 \\u20ac"')).toBe(
      '" \\ / \b \f \n \r \t A é é €',
    );
  });

  test("a surrogate pair of escapes is one character, raw astral text is kept", async () => {
    expect(await parsed('"\\ud83d\\ude00"')).toBe("\u{1F600}");
    expect(await parsed('"\\uD83D\\uDE00 \u{1F600}"')).toBe("\u{1F600} \u{1F600}");
    expect(await parsed('"\\ud834\\udd1e"')).toBe("\u{1D11E}");
  });

  test("U+0000 by escape is allowed, a raw control character is not", async () => {
    expect(await parsed('"\\u0000"')).toBe("\0");
    expect(code(await parse('"a\tb"'))).toBe("E_COERCE");
    expect(code(await parse('"a\nb"'))).toBe("E_COERCE");
    expect(code(await parse('"a\u0001b"'))).toBe("E_COERCE");
  });

  test.each([
    ['"\\ud83d"', "a high surrogate escape alone"],
    ['"\\ude00"', "a low surrogate escape alone"],
    ['"\\ud83d\\u0041"', "a high surrogate escape and a plain one"],
    ['"\\ude00\\ud83d"', "a surrogate pair the wrong way round"],
    ['"\\ud83dx"', "a high surrogate escape and text"],
    ['"\ud83d"', "a raw lone high surrogate"],
    ['"\ude00"', "a raw lone low surrogate"],
  ])("%s (%s) is E_COERCE", async (t) => {
    expect(code(await parse(t))).toBe("E_COERCE");
  });

  test.each([
    '"\\x41"',
    '"\\u12"',
    '"\\u12G4"',
    '"\\q"',
    '"\\',
    '"abc',
    '"abc\\',
    "'a'",
    '"\\U0041"',
  ])("%j is a bad string", async (t) => {
    expect(code(await parse(t))).toBe("E_COERCE");
  });

  test("keys follow the string rules", async () => {
    expect(await parsed('{"\\u00e9\\n":1}')).toEqual([["é\n", 1n]]);
    expect(code(await parse('{"\\ud800":1}'))).toBe("E_COERCE");
  });
});

describe("json:parse: strictness and positions", () => {
  test.each([
    "",
    "   ",
    "[1,]",
    "[,1]",
    '{"a":1,}',
    "{a:1}",
    "{'a':1}",
    '{"a"}',
    '{"a":}',
    '{"a" 1}',
    "{1:2}",
    "[1 2]",
    "[1,,2]",
    "nul",
    "nulll",
    "True",
    "tru",
    "[",
    "]",
    "{",
    '{"a":1',
    "[1",
    "[1]x",
    "[1][2]",
    "1 // c",
    "/* c */ 1",
    "\ufeff1",
    "\u00a01",
    "\u20281",
    "\u000b1",
    "[1]\0",
    "{}}",
    "[[1]",
    '{"a":{"b":1}',
  ])("%j is E_COERCE", async (t) => {
    expect(code(await parse(t))).toBe("E_COERCE");
  });

  test("the message names the offset, line and column (counted in code points)", async () => {
    let r = await parse("[1,\n 2,]");
    expect(!r.ok && r.error.message).toContain("at offset 7 (line 2, column 4)");
    expect(!r.ok && r.error.detail).toMatchObject({ offset: 7, line: 2, column: 4 });
    r = await parse('["\u{1F600}", x]');
    expect(!r.ok && r.error.message).toContain(
      "unexpected character 'x' at offset 6 (line 1, column 7)",
    );
    r = await parse("");
    expect(!r.ok && r.error.message).toContain(
      "unexpected end of input at offset 0 (line 1, column 1)",
    );
    r = await parse('{"a":1');
    expect(!r.ok && r.error.message).toContain("at offset 6");
    r = await parse('{"a": "abc');
    expect(!r.ok && r.error.message).toContain("unterminated string at offset 6");
  });

  test("truncating a valid document at every point fails (except where the prefix is itself valid)", async () => {
    const doc = '{"a":[1,-2.5e3,"x\\u00e9\\ud83d\\ude00",true,false,null,{}],"b":{"c":[[]]}}';
    for (let n = 0; n < doc.length; n++) {
      const prefix = doc.slice(0, n);
      let valid = true;
      try {
        JSON.parse(prefix);
      } catch {
        valid = false;
      }
      const r = await parse(prefix);
      // a prefix of a document is never valid JSON here (the whole is an object), so both must refuse it
      expect(valid).toBe(false);
      expect(code(r)).toBe("E_COERCE");
    }
    expect(code(await parse(doc))).toBe("ok");
  });

  test("the input is a str: bytes that are not UTF-8 never reach the parser", async () => {
    const r = await runtime.call("json:parse", [bytes(new Uint8Array([0x22, 0xff, 0x22]))]);
    expect(code(r)).toBe("E_COERCE");
    const ok = await runtime.call("json:parse", [bytes(new TextEncoder().encode('["é"]'))]);
    expect(shape(top(ok))).toEqual(["é"]);
  });
});

describe("depth", () => {
  const nest = (n: number, open = "[", close = "]", inner = "") =>
    open.repeat(n) + inner + close.repeat(n);

  test(`${MAX_DEPTH} levels are fine, one more is E_LIMIT_VALUE`, async () => {
    expect(code(await parse(nest(MAX_DEPTH)))).toBe("ok");
    expect(code(await parse(nest(MAX_DEPTH + 1)))).toBe("E_LIMIT_VALUE");
    expect(code(await parse('{"a":'.repeat(MAX_DEPTH) + "1" + "}".repeat(MAX_DEPTH)))).toBe("ok");
    expect(code(await parse('{"a":'.repeat(MAX_DEPTH + 1) + "1" + "}".repeat(MAX_DEPTH + 1)))).toBe(
      "E_LIMIT_VALUE",
    );
  });

  test("a very deep or unclosed text fails cleanly, without exhausting the host stack", async () => {
    expect(code(await parse("[".repeat(100_000)))).toBe("E_LIMIT_VALUE");
    expect(code(await parse("[".repeat(100_000) + "]".repeat(100_000)))).toBe("E_LIMIT_VALUE");
  });

  test("stringify has the same limit, and the output of a deep parse round trips", async () => {
    const v = await parsedValue(nest(MAX_DEPTH));
    expect(text(await stringify(v, 0))).toBe(nest(MAX_DEPTH));
    let deep: Value = list([]);
    for (let i = 0; i < MAX_DEPTH; i++) deep = list([deep]);
    expect(code(await stringify(deep, 0))).toBe("E_LIMIT_VALUE");
  });
});

describe("json:null and json:null?", () => {
  test("null parses to the sentinel, which json:null? recognises and stringify writes as null", async () => {
    const n = await runtime.call("json:null", []);
    expect(top(n).tag).toBe("record");
    expect(code(await runtime.call("json:null?", [top(n)]))).toBe("ok");
    expect(top(await runtime.call("json:null?", [top(n)])).v).toBe(true);
    expect(top(await runtime.call("probe:is-null", [str("null")])).v).toBe(true);
    expect(top(await runtime.call("probe:is-null", [str(" null ")])).v).toBe(true);
    expect(text(await stringify(top(n), 0))).toBe("null");
    expect(text(await stringify(top(n), 2))).toBe("null");
  });

  test("nothing else is null: other records, strings, numbers, lists", async () => {
    for (const t of [
      "{}",
      '{"null":true}',
      '{"x":true}',
      '"null"',
      "0",
      "false",
      "[]",
      "[null]",
      '{"a":null}',
    ]) {
      expect(top(await runtime.call("probe:is-null", [str(t)])).v).toBe(false);
    }
  });

  test("the sentinel cannot come out of parse: a lone surrogate key is refused", async () => {
    expect(code(await parse('{"\\udfffnull":true}'))).toBe("E_COERCE");
    expect(code(await parse(`{"${NULL_KEY}":true}`))).toBe("E_COERCE");
  });

  test("null inside containers round trips, and two nulls are equal", async () => {
    expect(text(await runtime.call("probe:roundtrip", [str('[null,{"a":null},[null]]')]))).toBe(
      '[null,{"a":null},[null]]',
    );
    const r = await runtime.run(`"[null]" json:parse "[ null ]" json:parse = .`);
    expect(r.ok && r.output).toBe("true\n");
  });
});

describe("json:stringify", () => {
  const SAMPLE =
    '{"b":[1,2.5,null,true,false,"é\u007f\\u001f\\"\\\\/\\n\u{1F600}\u2028"],"a":{},"c":[],"d":[[],{}],"e":1000000000000000000000000000000,"f":-0.0,"g":1e+21,"i":0.30000000000000004,"j":5e-324,"k":100.0}';

  test("compact: no white space, exactly the text of Python's json.dumps(separators=(',', ':'))", async () => {
    expect(text(await runtime.call("probe:roundtrip", [str(SAMPLE)]))).toBe(
      '{"b":[1,2.5,null,true,false,"é\u007f\\u001f\\"\\\\/\\n\u{1F600}\u2028"],"a":{},"c":[],"d":[[],{}],"e":1000000000000000000000000000000,"f":-0.0,"g":1e+21,"i":0.30000000000000004,"j":5e-324,"k":100.0}',
    );
    expect(await pretty(RFC_IMAGE, 0)).toBe(
      '{"Image":{"Width":800,"Height":600,"Title":"View from 15th Floor","Thumbnail":{"Url":"http://www.example.com/image/481989943","Height":125,"Width":100},"Animated":false,"IDs":[116,943,234,38793]}}',
    );
  });

  test("indent 2: the layout of Python's json.dumps(indent=2)", async () => {
    expect(await pretty(RFC_IMAGE, 2)).toBe(`{
  "Image": {
    "Width": 800,
    "Height": 600,
    "Title": "View from 15th Floor",
    "Thumbnail": {
      "Url": "http://www.example.com/image/481989943",
      "Height": 125,
      "Width": 100
    },
    "Animated": false,
    "IDs": [
      116,
      943,
      234,
      38793
    ]
  }
}`);
  });

  test("indent 4, empty containers stay [] and {}, and json:pretty is indent 2", async () => {
    expect(await pretty('{"a":[],"b":{},"c":[[],{}],"d":[1]}', 4)).toBe(`{
    "a": [],
    "b": {},
    "c": [
        [],
        {}
    ],
    "d": [
        1
    ]
}`);
    const v = await parsedValue('{"a":[1]}');
    expect(text(await runtime.call("json:pretty", [v]))).toBe('{\n  "a": [\n    1\n  ]\n}');
    expect(text(await runtime.call("json:compact", [v]))).toBe('{"a":[1]}');
  });

  test("scalars at the top", async () => {
    expect(text(await stringify(str('a"b'), 0))).toBe('"a\\"b"');
    expect(text(await stringify(int(7), 2))).toBe("7");
    expect(text(await stringify(bool(false), 0))).toBe("false");
    expect(text(await stringify(list([]), 2))).toBe("[]");
  });

  test("strings: the short escapes, \\u00xx in lower case for other control characters, the rest raw", async () => {
    expect(text(await stringify(str('\b\f\n\r\t\0\u001f\u007f"\\/'), 0))).toBe(
      '"\\b\\f\\n\\r\\t\\u0000\\u001f\u007f\\"\\\\/"',
    );
    expect(text(await stringify(str("é\u2028\u{1F600}"), 0))).toBe('"é\u2028\u{1F600}"');
  });

  test("numbers: ints are exact, nums are the shortest text that reads back and keep a fraction or exponent", async () => {
    const cases: [Value, string][] = [
      [int(0), "0"],
      [int(-5), "-5"],
      [int(2n ** 80n), "1208925819614629174706176"],
      [int(-(2n ** 64n)), "-18446744073709551616"],
      [num(1.5), "1.5"],
      [num(100), "100.0"],
      [num(-0), "-0.0"],
      [num(0.1 + 0.2), "0.30000000000000004"],
      [num(1e21), "1e+21"],
      [num(1e-7), "1e-7"],
      [num(5e-324), "5e-324"],
      [num(1.7976931348623157e308), "1.7976931348623157e+308"],
      [num(123456789012345680000), "123456789012345680000.0"],
    ];
    for (const [v, expected] of cases) expect(text(await stringify(v, 0))).toBe(expected);
  });

  test("an int is not turned into a num, nor a num into an int, by a round trip", async () => {
    const t = "[1,1.0,100,100.0,1e2,-0.0,12345678901234567890]";
    expect(text(await runtime.call("probe:roundtrip", [str(t)]))).toBe(
      "[1,1.0,100,100.0,100.0,-0.0,12345678901234567890]",
    );
  });

  test("bytes, quotations and files have no JSON form: E_TYPE, also inside a container", async () => {
    expect(code(await stringify(bytes(new Uint8Array([1])), 0))).toBe("E_TYPE");
    expect(code(await stringify(list([int(1), bytes(new Uint8Array())]), 0))).toBe("E_TYPE");
    const q = await runtime.run("[ 1 ]");
    const quot = q.ok ? (q.stack[0] as Value) : undefined;
    expect(quot?.tag).toBe("quot");
    expect(code(await stringify(quot as Value, 0))).toBe("E_TYPE");
  });

  test("a lone surrogate in a string or a key is E_COERCE", async () => {
    expect(code(await stringify(str("a\ud800b"), 0))).toBe("E_COERCE");
    expect(code(await stringify(list([str("\udc00")]), 0))).toBe("E_COERCE");
    expect(code(await stringify(valueHelpers.record([["\ud800", int(1)]]), 0))).toBe("E_COERCE");
  });

  test("the indent is from 0 to 32", async () => {
    expect(code(await stringify(list([int(1)]), 32))).toBe("ok");
    expect(code(await stringify(list([int(1)]), 33))).toBe("E_RANGE");
    expect(code(await stringify(list([int(1)]), -1))).toBe("E_RANGE");
  });

  test("the output is bounded by maxValueBytes", async () => {
    const big = list(Array.from({ length: 1000 }, () => str("x".repeat(100))));
    expect(code(await stringify(big, 0, { maxValueBytes: 100_000 }))).toBe("E_LIMIT_VALUE");
    expect(code(await stringify(big, 0, { maxValueBytes: 1_000_000 }))).toBe("ok");
  });
});

describe("round trips", () => {
  const docs = [
    RFC_IMAGE,
    RFC_LOCATIONS,
    '{"a":[],"b":{},"c":[[[]]],"d":"\\u0000\\u001f\\ud83d\\ude00","e":-123456789012345678901234567890,"f":-1.5e-10,"g":null,"h":[true,false,null]}',
    '"\\u2028\\u2029"',
    "[0,-0,0.0,-0.0,1e0]",
  ];
  test.each(docs)("parse then stringify then parse gives the same value: %s", async (d) => {
    const v1 = await parsedValue(d);
    for (const indent of [0, 1, 2, 8]) {
      const t = text(await stringify(v1, indent));
      const v2 = await parsedValue(t);
      expect(shape(v2)).toEqual(shape(v1));
      expect(text(await stringify(v2, indent))).toBe(t);
    }
  });

  test("the text matches Python's json.dumps for the same value", async () => {
    // json.dumps(json.loads(d), separators=(",", ":"), ensure_ascii=False) with the exponent form 1e-07 written 1e-7
    const v = await parsedValue('{"x": [1, 2.50, "\\u00e9", {"k": null}], "y": 1E2}');
    expect(text(await stringify(v, 0))).toBe('{"x":[1,2.5,"é",{"k":null}],"y":100.0}');
  });
});

describe("cost at 64 KiB", () => {
  const record = (i: number) =>
    `{"id":${i},"name":"item ${i}","tags":["a","b\\n","\\u00e9"],"v":${i}.5,"ok":true,"n":null}`;
  const doc = `[${Array.from({ length: 800 }, (_, i) => record(i)).join(",")}]`;

  test(
    "a 64 KiB document parses and stringifies in a handful of VM steps",
    { timeout: 60_000 },
    async () => {
      expect(doc.length).toBeGreaterThan(64 * 1024);
      const t0 = Date.now();
      const p = await parse(doc);
      const parseMs = Date.now() - t0;
      expect(p.ok && p.steps).toBeLessThan(10);
      const v = top(p);
      const c = await stringify(v, 0);
      expect(text(c) === doc.replaceAll("\\u00e9", "é")).toBe(true);
      expect(c.ok && c.steps).toBeLessThan(10);
      const i = await stringify(v, 2);
      expect(i.ok && i.steps).toBeLessThan(10);
      expect(parseMs).toBeLessThan(5000);
      process.stderr.write(
        `\njson 64 KiB (${doc.length} chars): parse ${p.ok && p.steps} steps ${parseMs.toFixed(0)} ms, compact ${c.ok && c.steps} steps, indent 2 ${i.ok && i.steps} steps (${text(i).length} chars)\n`,
      );
    },
  );

  test(
    "a 64 KiB string, a 64 KiB integer literal and 64 KiB of nesting",
    { timeout: 60_000 },
    async () => {
      const s = "x".repeat(65536);
      expect(shape(top(await parse(`"${s}"`)))).toBe(s);
      expect(code(await parse(`[${"1,".repeat(32767)}1]`))).toBe("ok");
      expect(code(await parse("[".repeat(65536)))).toBe("E_LIMIT_VALUE");
      const digits = "7".repeat(19_000);
      expect(shape(top(await parse(digits)))).toBe(BigInt(digits));
    },
  );

  test("parsed values count against maxValueBytes", async () => {
    expect(code(await parse(`[${"1,".repeat(1000)}1]`, { maxValueBytes: 1000 }))).toBe(
      "E_LIMIT_VALUE",
    );
    expect(code(await parse(`["${"x".repeat(1000)}"]`, { maxValueBytes: 1000 }))).toBe(
      "E_LIMIT_VALUE",
    );
    expect(
      code(
        await parse(`{${Array.from({ length: 200 }, (_, i) => `"k${i}":0`).join(",")}}`, {
          maxValueBytes: 1000,
        }),
      ),
    ).toBe("E_LIMIT_VALUE");
  });
});
