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
 * Tests for the `jsonpath` vocabulary (vocab/jsonpath.fth, src/prims/jsonpath.ts): `jsonpath:query`. The op vectors
 * (vocab/jsonpath.test.json) hold the RFC 9535 examples and a sample of the JSONPath Compliance Test Suite; these
 * tests add the object-prototype cases, the bounds and the cost at 64 KiB.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { MAX_QUERY } from "./prims/jsonpath.js";
import { loadBundleNode } from "./sources-node.js";

const { str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["jsonpath"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const out = (r: Result): string => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return (r.stack[r.stack.length - 1] as { v: string }).v;
};
const query = (data: string, q: string, delimiter = "\\n", limits?: { maxValueBytes: number }) =>
  runtime.call(
    "jsonpath:query",
    [str(data), str(q), str(delimiter)],
    limits === undefined ? undefined : { limits },
  );

describe("data that looks like Object.prototype", () => {
  test("only own members are selected, and any key is an ordinary key", async () => {
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
      expect(out(await query('{"a":1}', `$.${name}`)), name).toBe("");
      expect(out(await query('{"a":1}', `$['${name}']`)), name).toBe("");
    }
    expect(out(await query('{"__proto__":{"x":1},"constructor":2}', "$.__proto__.x"))).toBe("1");
    expect(out(await query('{"__proto__":{"x":1},"constructor":2}', "$.constructor"))).toBe("2");
    expect(out(await query('{"toString":"t"}', "$.toString"))).toBe('"t"');
  });

  test("a filter reads own members only", async () => {
    expect(out(await query('[{"a":1},{"b":2}]', "$[?@.constructor]"))).toBe("");
    expect(out(await query('[{"a":1},{"b":2}]', "$[?@.a]"))).toBe('{"a":1}');
  });
});

describe("numbers", () => {
  test("big integers are selected exactly; a filter that compares one never matches (JSONPath numbers are doubles)", async () => {
    expect(out(await query('{"n":123456789012345678901234567890}', "$.n"))).toBe(
      "123456789012345678901234567890",
    );
    expect(out(await query("[123456789012345678901234567890,1]", "$[?@>1]"))).toBe("");
    expect(out(await query("[123456789012345678901234567890,1]", "$[?@==1]"))).toBe("1");
  });

  test("a float with an integral value is written as an integer, as JSON.stringify does", async () => {
    expect(out(await query("[1.0,2.50,-0.0]", "$[*]", ","))).toBe("1,2.5,0");
  });
});

describe("bounds", () => {
  test("a query of 4096 characters is read, one of 4097 is E_RANGE", async () => {
    const q = "$" + "[0]".repeat((MAX_QUERY - 1) / 3);
    expect(q.length).toBeLessThanOrEqual(MAX_QUERY);
    expect(code(await query("[[0]]", q))).toBe("ok");
    expect(code(await query("[0]", "$" + "[0]".repeat(1366)))).toBe("E_RANGE");
  });

  test("filters nested past the library's limit of 30 are E_LIMIT_VALUE, not a crash", async () => {
    const q = "$" + "[?@".repeat(40) + "]".repeat(40);
    expect(code(await query("[[1]]", q))).toBe("E_LIMIT_VALUE");
  });

  test("descent into a 512-level document works", async () => {
    const doc = "[".repeat(512) + "1" + "]".repeat(512);
    expect(out(await query(doc, "$..*", ";")).split(";").length).toBeGreaterThanOrEqual(512);
  });

  test("a result larger than the value limit is E_LIMIT_VALUE", async () => {
    const doc = JSON.stringify(Array.from({ length: 20_000 }, (_, i) => i));
    expect(code(await query(doc, "$[*]", "\\n", { maxValueBytes: 10_000 }))).toBe("E_LIMIT_VALUE");
    expect(code(await query(doc, "$[*]"))).toBe("ok");
  });

  test("a query that selects the same value many times is bounded by the value limit", async () => {
    const doc = JSON.stringify(Array.from({ length: 300 }, (_, i) => i));
    // $..* then $..* again: every node twice per level of the walk
    expect(code(await query(doc, "$..*..*..*", "\\n", { maxValueBytes: 200_000 }))).toBe("ok");
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
    "queries over a 57 KB document cost a handful of VM steps and milliseconds",
    { timeout: 60_000 },
    async () => {
      expect(json.length).toBeGreaterThan(50_000);
      const cases: [string, number][] = [
        ["$..price", 450],
        ["$[?@.id>100 && @.id<300].name", 199],
        ["$..tags[1]", 450],
        ["$[?@.nested.z == true].id", 450],
        ["$[?match(@.name, 'user1.*')].id", 111],
      ];
      for (const [q, count] of cases) {
        const t0 = Date.now();
        const r = await query(json, q);
        expect(r.ok, q).toBe(true);
        if (!r.ok) return;
        // measured: 2 to 40,000 steps for the output joins (a json:compact per match); the evaluation is one call
        expect(r.steps, q).toBeLessThan(500_000);
        expect(out(r).split("\n").length, q).toBe(count);
        expect(Date.now() - t0, q).toBeLessThan(10_000);
      }
    },
  );
});
