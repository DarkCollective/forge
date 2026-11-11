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
 * Tests for the `yaml` vocabulary (vocab/yaml.fth, src/prims/yaml.ts): `yaml:to-json` and `yaml:from-json`. The op
 * vectors (vocab/yaml.test.json) hold the cases computed with PyYAML and json.dumps; these tests add the round
 * trips, the bounds (billion laughs, depth, cycles, the value limit) and the cost at 64 KiB.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { int, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["yaml"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const out = (r: Result): string => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return (r.stack[r.stack.length - 1] as { v: string }).v;
};
const toJson = (text: string, indent = 0, limits?: { maxValueBytes: number }) =>
  runtime.call(
    "yaml:to-json",
    [str(text), int(indent)],
    limits === undefined ? undefined : { limits },
  );
const fromJson = (text: string, limits?: { maxValueBytes: number }) =>
  runtime.call("yaml:from-json", [str(text)], limits === undefined ? undefined : { limits });
const message = (r: Result) => (r.ok ? "" : r.error.message);

describe("round trips", () => {
  const docs = [
    '{"a":1,"b":[1,2,{"c":3}],"d":{"e":"x"},"f":null,"g":true,"h":[],"i":{}}',
    '["true","123","null","","a: b","- x","x y","it\'s","é","  lead","trail ","#c","1.5","0x1f","yes","No","on","~",":x","@a","!x","&a","*a","%a","a #b","a: ","\'q\'","\\"dq\\"","2001-01-01","1e3","- ","a,b","[x]","{y}","?","-","a:b","=","<<"]',
    '{"ml":"line1\\nline2\\nline3\\n","ml2":"a\\n\\nb","ml3":"x\\ny","ml4":"\\n\\nlead","ml5":"tab\\there","cr":"a\\rb","ctl":"\\u0001","nbsp":"a\\u00a0b"}',
    "[[1,2],[3,[4,5]],[],[[]],{}]",
    '{"a b":1,"1":2,"":3,"true":4,"x:y":5,"-a":6,"? q":7,"é":8,"null":9,"<<":10,"=":11,"\\t":12}',
    '{"big":123456789012345678901234567890,"neg":-7,"zero":0,"f":1.5,"w":1.0,"h":100.0,"e":1e-7,"huge":1e21,"nz":-0.0}',
    '{"emoji":"😀 ok","long":"The quick brown fox jumps over the lazy dog and keeps running through the forest until the very end of the line 12345"}',
    '"scalar"',
    "5",
    "null",
    '""',
    "[]",
    "{}",
    '{"__proto__":1,"constructor":2,"toString":3}',
  ];
  for (const d of docs) {
    test(`JSON to YAML to JSON: ${d.slice(0, 50)}`, async () => {
      const y = out(await fromJson(d));
      expect(y.endsWith("\n")).toBe(true);
      const back = out(await toJson(y, 0));
      // compare through the shared JSON words, so key order and number text are what json:stringify writes
      const norm = async (t: string) => {
        const parsed = await runtime.call("json:parse", [str(t)]);
        if (!parsed.ok) throw new Error(parsed.error.message);
        return out(
          await runtime.call("json:compact", [parsed.stack[parsed.stack.length - 1] as never]),
        );
      };
      expect(back).toBe(await norm(d));
    });
  }
});

describe("reading YAML", () => {
  test("YAML 1.2 core: yes, no, on and off are strings; true, false and null in their spellings are not", async () => {
    expect(
      out(await toJson("[yes, no, on, off, y, n, true, True, TRUE, false, null, Null, ~]")),
    ).toBe('["yes","no","on","off","y","n",true,true,true,false,null,null,null]');
  });

  test("integers: decimal, hexadecimal and 0o octal are exact; floats stay floats", async () => {
    expect(
      out(await toJson("[0, -7, 0x1f, 0o17, 123456789012345678901234567890, 1.5, 3.0, 1e3, -0.5]")),
    ).toBe("[0,-7,31,15,123456789012345678901234567890,1.5,3.0,1000.0,-0.5]");
  });

  test("tags the core schema does not know keep their text", async () => {
    expect(out(await toJson("[!!binary aGk=, !custom x, 2001-12-14, !!str 12, !!int '5']"))).toBe(
      '["aGk=","x","2001-12-14","12",5]',
    );
  });

  test("an empty stream and a comment-only stream are null", async () => {
    expect(out(await toJson(""))).toBe("null");
    expect(out(await toJson("# nothing\n"))).toBe("null");
    expect(out(await toJson("---\n"))).toBe("null");
  });

  test("a byte order mark and CRLF are read", async () => {
    expect(out(await toJson("﻿a: 1\r\nb: 2\r\n"))).toBe('{"a":1,"b":2}');
  });

  test("merge keys: the own key wins, the merged ones are added", async () => {
    const r = JSON.parse(
      out(await toJson("base: &b {x: 1, y: 2}\nd:\n  <<: *b\n  y: 3\n  z: 4\n")),
    ) as { d: Record<string, number> };
    expect(r.d).toEqual({ x: 1, y: 3, z: 4 });
  });

  test("keys: scalars become text, collections and collisions are refused", async () => {
    expect(out(await toJson("1: a\n2.5: b\nnull: c\n"))).toBe('{"1":"a","2.5":"b","null":"c"}');
    expect(code(await toJson("? [1]\n: x\n"))).toBe("E_COERCE");
    expect(code(await toJson("? {a: 1}\n: x\n"))).toBe("E_COERCE");
    expect(code(await toJson("1: a\n'1': b\n"))).toBe("E_COERCE");
    expect(code(await toJson("a: 1\na: 2\n"))).toBe("E_COERCE");
  });

  test("errors name the line and column", async () => {
    const r = await toJson("a: 1\nb: [1, 2\n");
    expect(code(r)).toBe("E_COERCE");
    expect(message(r)).toMatch(/line \d+, column \d+/);
  });

  test("a lone surrogate escape is refused; a pair is one character", async () => {
    expect(code(await toJson('"\\uD800"'))).toBe("E_COERCE");
    expect(out(await toJson('"\\uD83D\\uDE00"'))).toBe('"😀"');
  });

  test(".inf, -.inf and .nan are refused (JSON has none)", async () => {
    for (const t of [".inf", "-.inf", ".nan", "{a: .Inf}", "[.NaN]"]) {
      expect(code(await toJson(t)), t).toBe("E_COERCE");
    }
  });

  test("two documents are refused, one document with end markers is not", async () => {
    expect(code(await toJson("a: 1\n---\nb: 2\n"))).toBe("E_COERCE");
    expect(out(await toJson("---\na: 1\n...\n"))).toBe('{"a":1}');
  });

  test("indent: 0 is compact, n writes n spaces per level", async () => {
    expect(out(await toJson("a: [1]", 0))).toBe('{"a":[1]}');
    expect(out(await toJson("a: [1]", 2))).toBe('{\n  "a": [\n    1\n  ]\n}');
    expect(code(await toJson("a: 1", 33))).toBe("E_PARAM_INVALID");
  });
});

describe("bounds", () => {
  const laughs = (levels: number, fan = 10) =>
    `a0: &a0 [${Array(fan).fill("x").join(",")}]\n` +
    Array.from(
      { length: levels - 1 },
      (_, i) => `a${i + 1}: &a${i + 1} [${Array(fan).fill(`*a${i}`).join(",")}]\n`,
    ).join("");

  test("billion laughs: an alias bomb stops at the value limit, fast", async () => {
    const t0 = Date.now();
    const r = await toJson(laughs(12));
    expect(code(r)).toBe("E_LIMIT_VALUE");
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  test("a smaller limit stops it sooner", async () => {
    expect(code(await toJson(laughs(6), 0, { maxValueBytes: 100_000 }))).toBe("E_LIMIT_VALUE");
    expect(code(await toJson(laughs(3), 0, { maxValueBytes: 100_000 }))).toBe("ok");
  });

  test("more than 100 aliases (the library's own default cap) are fine when they are small", async () => {
    const text = "base: &b 1\nlist:\n" + Array.from({ length: 500 }, () => "  - *b\n").join("");
    const r = JSON.parse(out(await toJson(text))) as { list: number[] };
    expect(r.list).toHaveLength(500);
  });

  test("an alias to a collection that contains it is E_COERCE", async () => {
    expect(code(await toJson("&a [*a]"))).toBe("E_COERCE");
    expect(code(await toJson("a: &a\n  b: *a\n"))).toBe("E_COERCE");
  });

  test("an alias to an anchor that was never set is E_COERCE", async () => {
    expect(code(await toJson("a: *missing"))).toBe("E_COERCE");
  });

  test("nesting: 512 levels are read, 513 are E_LIMIT_VALUE", async () => {
    expect(code(await toJson("[".repeat(512) + "]".repeat(512)))).toBe("ok");
    expect(code(await toJson("[".repeat(513) + "]".repeat(513)))).toBe("E_LIMIT_VALUE");
  });

  test("100,000 open brackets are refused without exhausting memory or the stack", async () => {
    const t0 = Date.now();
    expect(code(await toJson("[".repeat(100_000)))).toBe("E_LIMIT_VALUE");
    expect(code(await toJson("[".repeat(100_000) + "]".repeat(100_000)))).toBe("E_LIMIT_VALUE");
    expect(Date.now() - t0).toBeLessThan(20_000);
  });

  test("deeply nested block mappings are bounded too", async () => {
    const text = Array.from({ length: 600 }, (_, i) => `${" ".repeat(i)}k:`).join("\n") + " 1\n";
    expect(code(await toJson(text))).toBe("E_LIMIT_VALUE");
  });

  test("the YAML text written is held to the value limit", async () => {
    const big = JSON.stringify(Array.from({ length: 2000 }, (_, i) => `item ${i}`));
    expect(code(await fromJson(big, { maxValueBytes: 4_000 }))).toBe("E_LIMIT_VALUE");
    expect(code(await fromJson(big))).toBe("ok");
  });

  test("an integer past maxIntBits is E_LIMIT_VALUE", async () => {
    const r = await runtime.call("yaml:to-json", [str("a: " + "9".repeat(30_000)), int(0)], {
      limits: { maxIntBits: 1024 },
    });
    expect(code(r)).toBe("E_LIMIT_VALUE");
  });
});

describe("cost at 64 KiB", () => {
  const objs = Array.from({ length: 450 }, (_, i) => ({
    id: i,
    name: `user${i}`,
    price: i * 1.5,
    tags: ["a", "b", "c"],
    nested: { x: i, y: null, z: true },
    desc: `some text here ${i}`,
  }));
  const json = JSON.stringify(objs);

  test(
    "JSON to YAML and back: the library calls cost a handful of VM steps",
    { timeout: 60_000 },
    async () => {
      expect(json.length).toBeGreaterThan(50_000);
      const w = await fromJson(json);
      expect(w.ok).toBe(true);
      if (!w.ok) return;
      // measured: 6 steps, about 70 ms (the work is in the library)
      expect(w.steps).toBeLessThan(50);
      const y = out(w);
      expect(y.length).toBeGreaterThan(50_000);
      const r = await toJson(y, 0);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.steps).toBeLessThan(50);
      expect(JSON.parse(out(r))).toEqual(objs);
    },
  );
});
