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
 * Tests for the `rison` vocabulary (vocab/rison.fth, src/prims/rison.ts). The op vectors (vocab/rison.test.json)
 * hold the cases computed with Python's prison and the JavaScript number rules; these tests add the grammar
 * edges, round trips, hostile nesting and strings, the limits and the cost at 64 KiB.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { code, loadRuntime, message, randomJson, rng, steps, text } from "./data-format-test.js";

const { int, str } = valueHelpers;
const runtime = await loadRuntime(["rison"]);

const encode = (json: string, mode = "rison", limits?: { maxValueBytes: number }) =>
  runtime.call(
    "rison:encode",
    [str(json), str(mode)],
    limits === undefined ? undefined : { limits },
  );
const decode = (rison: string, mode = "rison", indent = 0, limits?: { maxValueBytes: number }) =>
  runtime.call(
    "rison:decode",
    [str(rison), str(mode), int(indent)],
    limits === undefined ? undefined : { limits },
  );

describe("encode", () => {
  test("which strings are bare", async () => {
    for (const [j, r] of [
      ['"abc"', "abc"],
      ['"a-b"', "a-b"],
      ['"a.b/c~d"', "a.b/c~d"],
      ['"-a"', "'-a'"],
      ['"9a"', "'9a'"],
      ['"a b"', "'a b'"],
      ['"a\'b"', "'a!'b'"],
      ['"a!b"', "'a!!b'"],
      ['"a:b"', "'a:b'"],
      ['"a(b"', "'a(b'"],
      ['"a)b"', "'a)b'"],
      ['"a,b"', "'a,b'"],
      ['"a*b"', "'a*b'"],
      ['"a@b"', "'a@b'"],
      ['"a$b"', "'a$b'"],
      ['"\u00e9\ud83d\ude00"', "é😀"],
      ['"a\\tb"', "a\tb"],
    ] as const)
      expect(text(await encode(j))).toBe(r);
  });
  test("numbers are written as JavaScript prints them, integers in full", async () => {
    for (const [j, r] of [
      ["100.0", "100"],
      ["1e21", "1e21"],
      ["1.5e-7", "1.5e-7"],
      ["-0.0", "0"],
      ["123456789012345678901234567890", "123456789012345678901234567890"],
      ["1e-6", "0.000001"],
      ["0.1", "0.1"],
    ] as const)
      expect(text(await encode(j))).toBe(r);
  });
  test("keys are sorted by UTF-16 code unit, as rison.js does", async () => {
    expect(text(await encode('{"b":1,"B":2,"a":3,"\\ud83d\\ude00":4,"\\uffff":5}'))).toBe(
      "(B:2,a:3,b:1,😀:4,\uffff:5)",
    );
  });
  test("o-rison and a-rison", async () => {
    expect(text(await encode('{"a":{"b":[]},"c":1}', "o-rison"))).toBe("a:(b:!()),c:1");
    expect(text(await encode("[[1],{}]", "a-rison"))).toBe("!(1),()");
    expect(code(await encode("[1]", "o-rison"))).toBe("E_COERCE");
    expect(code(await encode("null", "o-rison"))).toBe("E_COERCE");
    expect(code(await encode('{"a":1}', "a-rison"))).toBe("E_COERCE");
    expect(code(await encode("{}", "xrison"))).toBe("E_PARAM_INVALID");
  });
  test("nesting and the value budget", async () => {
    expect(code(await encode("[".repeat(100_000)))).toBe("E_LIMIT_VALUE"); // the JSON reader stops at 512 levels
    expect(code(await encode("[".repeat(100) + "0" + "]".repeat(100)))).toBe("E_COERCE");
    expect(
      code(await encode(JSON.stringify("x ".repeat(40_000)), "rison", { maxValueBytes: 100_000 })),
    ).toBe("E_LIMIT_VALUE");
  });
});

describe("decode", () => {
  test("the grammar of rison.js", async () => {
    for (const [r, j] of [
      ["!t", "true"],
      ["!f", "false"],
      ["!n", "null"],
      ["-0", "0"],
      ["0.5e2", "50.0"],
      ["12e+3", "12000.0"],
      ["abc", '"abc"'],
      ["'abc'", '"abc"'],
      ["'it!'s'", '"it\'s"'],
      ["'a!!b'", '"a!b"'],
      ["!(a,b)", '["a","b"]'],
      ["(a:!t,b:'x y')", '{"a":true,"b":"x y"}'],
      ["(1:2)", '{"1":2}'],
      ["(-1.5:2)", '{"-1.5":2}'],
      ["a-b.c/d~e", '"a-b.c/d~e"'],
      ["é😀", '"é😀"'],
    ] as const)
      expect(text(await decode(r))).toBe(j);
  });
  test("white space is only allowed around the text", async () => {
    expect(text(await decode("\t (a:1)\r\n"))).toBe('{"a":1}');
    expect(code(await decode("(a: 1)"))).toBe("E_COERCE");
    expect(code(await decode("(a:1, b:2)"))).toBe("E_COERCE");
  });
  test("a big integer is exact and a huge one is refused", async () => {
    expect(text(await decode("123456789012345678901234567890"))).toBe(
      "123456789012345678901234567890",
    );
    expect(["E_COERCE", "E_LIMIT_VALUE"]).toContain(code(await decode("9".repeat(1_000_000))));
  });
  test("errors name the offset", async () => {
    const r = await decode("(a:1,b:@)");
    expect(code(r)).toBe("E_COERCE");
    expect(message(r)).toContain("offset 7");
    expect(message(await decode("!(1,2"))).toContain("offset 5");
  });
  test("every prefix of a document is E_COERCE or a shorter value", async () => {
    const doc = "(a:!(1,2.5,'x y',!n,!t),b:(c:'it!'s'),d:-12e-3)";
    expect(code(await decode(doc))).toBe("ok");
    for (let cut = 1; cut < doc.length; cut++) {
      const c = code(await decode(doc.slice(0, cut)));
      expect(["ok", "E_COERCE"]).toContain(c);
      if (c === "ok") expect(doc.slice(0, cut)).not.toMatch(/[(!]$/);
    }
    expect(code(await decode(doc.slice(0, 20)))).toBe("E_COERCE");
  });
  test("a million open lists stop at the depth limit", async () => {
    const r = await decode("!(".repeat(500_000));
    expect(code(r)).toBe("E_COERCE");
    expect(message(r)).toContain("deeper than 64");
    expect(code(await decode("(a:".repeat(500_000)))).toBe("E_COERCE");
  });
  test("the value budget stops a result that is too big", async () => {
    const big = `!(${"1,".repeat(20_000)}1)`;
    expect(code(await decode(big, "rison", 0, { maxValueBytes: 100_000 }))).toBe("E_LIMIT_VALUE");
    expect(code(await decode(big))).toBe("ok");
  });
});

describe("round trips", () => {
  test("random JSON values survive encode and decode in all three forms", async () => {
    const rand = rng(59);
    for (let i = 0; i < 300; i++) {
      const v = randomJson(rand, 4);
      // numbers with an integral value come back as integers (Rison has one number type)
      const norm = JSON.parse(JSON.stringify(v));
      const j = JSON.stringify(v);
      const back = JSON.parse(text(await decode(text(await encode(j)))));
      expect(back).toEqual(norm);
      if (Array.isArray(v))
        expect(JSON.parse(text(await decode(text(await encode(j, "a-rison")), "a-rison")))).toEqual(
          norm,
        );
      else if (typeof v === "object" && v !== null)
        expect(JSON.parse(text(await decode(text(await encode(j, "o-rison")), "o-rison")))).toEqual(
          norm,
        );
    }
  });
});

describe("cost at 64 KiB", () => {
  test("about 64 KiB of JSON and of Rison", { timeout: 60_000 }, async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      name: `name ${i} it's`,
      tags: ["a", "b c", i],
      score: i / 8 + 0.1,
      ok: i % 2 === 0,
      none: null,
    }));
    const j = JSON.stringify(rows);
    expect(j.length).toBeGreaterThan(64 * 1024);
    const t0 = Date.now();
    const e = await encode(j);
    const encMs = Date.now() - t0;
    const r = text(e);
    const t1 = Date.now();
    const d = await decode(r);
    const decMs = Date.now() - t1;
    expect(JSON.parse(text(d))).toEqual(rows);
    expect(steps(e)).toBeLessThan(100);
    expect(steps(d)).toBeLessThan(100);
    process.stderr.write(
      `\nrison ${j.length} chars JSON -> ${r.length} chars: encode ${steps(e)} steps ${encMs} ms; decode ${steps(d)} steps ${decMs} ms\n`,
    );
  });
});
