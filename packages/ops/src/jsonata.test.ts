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
 * Tests for the `jsonata` vocabulary (vocab/jsonata.fth, src/prims/jsonata.ts): `jsonata:query`. The op vectors
 * (vocab/jsonata.test.json) hold the cases of the JSONata documentation; these tests add the guards (no time, no
 * randomness, evaluation steps, stack, sequence length, pad width), objects that look like Object.prototype and
 * the cost at 64 KiB.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { MAX_QUERY } from "./prims/jsonata.js";
import { loadBundleNode } from "./sources-node.js";

const { str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["jsonata"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const out = (r: Result): string => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return (r.stack[r.stack.length - 1] as { v: string }).v;
};
const query = (data: string, q: string, limits?: { maxValueBytes: number }) =>
  runtime.call("jsonata:query", [str(data), str(q)], limits === undefined ? undefined : { limits });

describe("determinism", () => {
  test("the functions that read the clock or the random generator raise an error", async () => {
    for (const q of ["$now()", "$millis()", "$random()", "$shuffle([1,2])", "$now('[Y0001]')"]) {
      const r = await query("{}", q);
      expect(code(r), q).toBe("E_COERCE");
      if (!r.ok) expect(r.error.message, q).toMatch(/not available/);
    }
  });

  test("the same query gives the same text twice", async () => {
    const a = out(await query('{"a":[3,1,2]}', "$sort(a)"));
    const b = out(await query('{"a":[3,1,2]}', "$sort(a)"));
    expect(a).toBe("[1,2,3]");
    expect(b).toBe(a);
  });
});

describe("guards", () => {
  test("a recursion that never ends stops at the step limit", { timeout: 60_000 }, async () => {
    const r = await query("{}", "($f := function($n){ $f($n+1) }; $f(1))");
    expect(code(r)).toBe("E_LIMIT_STEPS");
  });

  test("a deep but finite recursion within the limits works", async () => {
    expect(
      out(await query("{}", "($f := function($n){ $n <= 1 ? 1 : $n + $f($n-1) }; $f(100))")),
    ).toBe("5050");
  });

  test("a very deep finite recursion hits the stack guard, not the host stack", async () => {
    const r = await query("{}", "($f := function($n){ $n <= 1 ? 1 : $n + $f($n-1) }; $f(100000))");
    expect(["E_LIMIT_VALUE", "E_LIMIT_STEPS"]).toContain(code(r));
  });

  test("the range operator and sequences have limits", async () => {
    expect(code(await query("{}", "[1..100000000]"))).toBe("E_LIMIT_VALUE");
    expect(code(await query("{}", "$count([1..1000000])"))).toBe("ok");
  });

  test("$pad stops at 1,000,000 characters", async () => {
    expect(code(await query("{}", "$pad('x', 1000001)"))).toBe("E_COERCE");
    expect(out(await query("{}", "$length($pad('x', 1000000))"))).toBe("1000000");
    expect(out(await query("{}", "$pad('ab', -5, '12')"))).toBe('"121ab"');
  });

  test("a query of 16,385 characters is E_RANGE", async () => {
    expect(code(await query("{}", "1+".repeat(MAX_QUERY / 2) + "1"))).toBe("E_RANGE");
  });

  test("the result is held to the value limit", async () => {
    expect(code(await query("{}", "[1..20000]", { maxValueBytes: 10_000 }))).toBe("E_LIMIT_VALUE");
  });

  test("a function is not a result, alone or inside a value", async () => {
    expect(code(await query("{}", "function($x){ $x }"))).toBe("E_COERCE");
    expect(code(await query("{}", "[function($x){ $x }]"))).toBe("E_COERCE");
    expect(code(await query("{}", '{"f": function($x){ $x }}'))).toBe("E_COERCE");
  });

  test("$eval runs JSONata only, never JavaScript", async () => {
    expect(out(await query("{}", "$eval('1+2')"))).toBe("3");
    // code-like text is a JSONata path: it selects nothing, and nothing is run
    expect(out(await query("{}", "$eval('process.exit(1)')"))).toBe('""');
    expect(["ok", "E_COERCE"]).toContain(
      code(await query("{}", "$eval('constructor.constructor(\"return 1\")()')")),
    );
    expect(code(await query("{}", "$eval('1 +')"))).toBe("E_COERCE");
  });
});

describe("data that looks like Object.prototype", () => {
  test("members named like Object methods are ordinary or absent", async () => {
    expect(out(await query('{"a":1}', "constructor"))).toBe('""');
    expect(out(await query('{"a":1}', "__proto__"))).toBe('""');
    expect(out(await query('{"__proto__":5,"constructor":6}', "[__proto__, constructor]"))).toBe(
      "[5,6]",
    );
    expect(out(await query('{"a":1}', "$keys($)"))).toBe('"a"');
  });
});

describe("conversion", () => {
  test("null, nested values and unicode survive", async () => {
    expect(out(await query('{"a":null,"b":[{"c":"é☕😀"}]}', "{'n': a, 'c': b.c}"))).toBe(
      '{"n":null,"c":"é☕😀"}',
    );
  });

  test("a number result with an integral value is written as an integer", async () => {
    expect(out(await query("{}", "[2.0 * 3, 10 / 4, 1e3]"))).toBe("[6,2.5,1000]");
  });

  test("a regular expression and its groups", async () => {
    expect(out(await query('{"s":"k1=v1;k2=v2"}', "$match(s, /(\\w+)=(\\w+)/).groups"))).toBe(
      '["k1","v1","k2","v2"]',
    );
  });
});

describe("cost at 64 KiB", () => {
  const objs = Array.from({ length: 450 }, (_, i) => ({
    id: i,
    name: `user${i}`,
    price: i * 1.5,
    tags: ["a", "b", "c"],
    nested: { x: i, y: null, z: true },
  }));
  const json = JSON.stringify(objs);

  test("queries over a 40 KB document are one primitive call", { timeout: 60_000 }, async () => {
    expect(json.length).toBeGreaterThan(30_000);
    const cases: [string, string][] = [
      ["$sum($[*].price)", "151537.5"],
      ["$count($[price > 500])", "116"],
      ["$[id=449].name", '"user449"'],
      ["$count($.nested.x)", "450"],
    ];
    for (const [q, expected] of cases) {
      const t0 = Date.now();
      const r = await query(json, q);
      expect(r.ok, q).toBe(true);
      if (!r.ok) return;
      // measured: 12 steps (the interpreter runs inside the primitive), 5 to 30 ms
      expect(r.steps, q).toBeLessThan(100);
      expect(out(r), q).toBe(expected);
      expect(Date.now() - t0, q).toBeLessThan(10_000);
    }
  });
});
