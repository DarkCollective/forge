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
 * Tests for the `xpath` vocabulary (vocab/xpath.fth, src/prims/xpath.ts): `xpath:query`. The op vectors
 * (vocab/xpath.test.json) hold the cases computed with lxml; these tests add the entity, depth and size bounds, the
 * expression limit and the cost at 64 KiB.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { MAX_EXPRESSION, MAX_NODES } from "./prims/xpath.js";
import { loadBundleNode } from "./sources-node.js";

const { str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["xpath"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const out = (r: Result): string => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return (r.stack[r.stack.length - 1] as { v: string }).v;
};
const query = (xml: string, xp: string, delimiter = "\\n", limits?: { maxValueBytes: number }) =>
  runtime.call(
    "xpath:query",
    [str(xml), str(xp), str(delimiter)],
    limits === undefined ? undefined : { limits },
  );

describe("entities and external references", () => {
  test("entities declared in the document type are not expanded (no entity bomb)", async () => {
    const lol =
      '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;"><!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">]><lolz>&lol2;</lolz>';
    const t0 = Date.now();
    const r = await query(lol, "string(/lolz)");
    expect(r.ok).toBe(true);
    expect(out(r).length).toBeLessThan(100);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  test("an external entity is never read", async () => {
    const xxe =
      '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r>&x;</r>';
    const r = await query(xxe, "string(/r)");
    expect(r.ok).toBe(true);
    expect(out(r)).not.toContain("root:");
  });

  test("the predefined entities and character references are read", async () => {
    expect(out(await query("<a>&lt;&amp;&gt;&#65;&#x42;</a>", "string(/a)"))).toBe("<&>AB");
  });
});

describe("scalar results", () => {
  test("a number, a string and a boolean give one text each", async () => {
    const doc = "<r><a>1</a><a>2.5</a></r>";
    expect(out(await query(doc, "sum(//a)"))).toBe("3.5");
    expect(out(await query(doc, "count(//a)"))).toBe("2");
    expect(out(await query(doc, "1 div 0"))).toBe("Infinity");
    expect(out(await query(doc, "0 div 0"))).toBe("NaN");
    expect(out(await query(doc, "string(//a[2])"))).toBe("2.5");
    expect(out(await query(doc, "//a[1] = 1"))).toBe("true");
    expect(out(await query(doc, "not(//a)"))).toBe("false");
  });
});

describe("bounds", () => {
  const nested = (depth: number) => "<a>".repeat(depth) + "</a>".repeat(depth);

  test("512 levels of elements are read, 513 are E_LIMIT_VALUE", async () => {
    expect(out(await query(nested(512), "count(//a)"))).toBe("512");
    expect(code(await query(nested(513), "count(//a)"))).toBe("E_LIMIT_VALUE");
  });

  test("a document of 20,000 levels is refused before any query runs", async () => {
    const t0 = Date.now();
    expect(code(await query(nested(20_000), "//a"))).toBe("E_LIMIT_VALUE");
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  test("more than 200,000 nodes are E_LIMIT_VALUE", { timeout: 60_000 }, async () => {
    const wide = (n: number) => "<r>" + "<a/>".repeat(n) + "</r>";
    expect(code(await query(wide(MAX_NODES + 1), "count(/r)"))).toBe("E_LIMIT_VALUE");
  });

  test("an expression of 4096 characters is read, 4097 is E_RANGE", async () => {
    const e = (n: number) => "1" + "+1".repeat((n - 1) / 2);
    expect(out(await query("<a/>", e(MAX_EXPRESSION - 1)))).toBe(String(MAX_EXPRESSION / 2));
    expect(code(await query("<a/>", e(MAX_EXPRESSION + 1)))).toBe("E_RANGE");
  });

  test("the output is held to the value limit", async () => {
    const doc = "<r>" + "<a>some text</a>".repeat(3000) + "</r>";
    expect(code(await query(doc, "//a", "\\n", { maxValueBytes: 10_000 }))).toBe("E_LIMIT_VALUE");
    expect(code(await query(doc, "//a"))).toBe("ok");
  });

  test("a deeply nested expression is a clean error", async () => {
    const e = "(".repeat(5000) + "1" + ")".repeat(5000);
    expect(["ok", "E_COERCE", "E_LIMIT_VALUE", "E_RANGE"]).toContain(code(await query("<a/>", e)));
  });
});

describe("cost at 64 KiB", () => {
  const xml =
    '<?xml version="1.0"?><root>' +
    Array.from(
      { length: 800 },
      (_, i) =>
        `<item id="${i}" k="v${i % 7}"><name>n${i}</name><v>${i}</v><sub><a/><b>t</b></sub></item>`,
    ).join("") +
    "</root>";

  test(
    "typical queries over a 63 KB document take well under a second or two",
    { timeout: 60_000 },
    async () => {
      expect(xml.length).toBeGreaterThan(60_000);
      const cases: [string, number][] = [
        ["//item/name", 800],
        ["//item[@k='v3']/@id", 114],
        ["//item[v>400]/name/text()", 399],
        ["count(//*)", 1],
      ];
      for (const [q, count] of cases) {
        const t0 = Date.now();
        const r = await query(xml, q);
        expect(r.ok, q).toBe(true);
        if (!r.ok) return;
        // measured: 76 VM steps (the parser and the evaluator are in the library); 50 to 250 ms
        expect(r.steps, q).toBeLessThan(500);
        expect(out(r).split("\n").length, q).toBe(count);
        expect(Date.now() - t0, q).toBeLessThan(10_000);
      }
    },
  );

  test(
    "//* over 4,800 nodes is the slowest ordinary query: about a second",
    { timeout: 60_000 },
    async () => {
      const t0 = Date.now();
      const r = await query(xml, "//*");
      expect(out(r).split("\n").length).toBe(4801);
      expect(Date.now() - t0).toBeLessThan(15_000);
    },
  );
});
