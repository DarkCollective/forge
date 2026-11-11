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
 * Tests for the `css` vocabulary (vocab/css.fth, src/prims/css.ts): `css:select`. The op vectors (vocab/css.test.json)
 * hold the cases computed with lxml and cssselect; these tests add the repair of bad markup, the depth, size and
 * output bounds and the cost at 64 KiB.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { MAX_NODES, MAX_SELECTOR } from "./prims/css.js";
import { loadBundleNode } from "./sources-node.js";

const { str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["css"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const out = (r: Result): string => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return (r.stack[r.stack.length - 1] as { v: string }).v;
};
const select = (html: string, css: string, delimiter = "\\n", limits?: { maxValueBytes: number }) =>
  runtime.call(
    "css:select",
    [str(html), str(css), str(delimiter)],
    limits === undefined ? undefined : { limits },
  );

describe("markup that is not XML", () => {
  test("bad markup never fails: it is repaired as a browser repairs it", async () => {
    expect(out(await select("<p>one<p>two", "p", "|"))).toBe("<p>one</p>|<p>two</p>");
    expect(out(await select("<b><i>x</b>y</i>", "i", "|"))).toBe("<i>x</i>");
    expect(out(await select("<div><span>a</div>", "span"))).toBe("<span>a</span>");
    expect(out(await select("<br><img src=a><input disabled>", "input"))).toBe("<input disabled>");
  });

  test("script and style content is text, not markup", async () => {
    expect(out(await select("<script>if (a < b) { x = '<p>'; }</script><p>real</p>", "p"))).toBe(
      "<p>real</p>",
    );
  });

  test("markup in an attribute value is not an element", async () => {
    expect(out(await select('<a title="<p>x</p>">l</a>', "p"))).toBe("");
  });

  test("character references are decoded and written back safely", async () => {
    expect(
      out(await select("<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &copy;</p>", "p")),
    ).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; \u00a9</p>");
  });
});

describe("bounds", () => {
  test("512 levels of elements are read, 513 are E_LIMIT_VALUE", async () => {
    const nested = (n: number) => "<div>".repeat(n) + "x" + "</div>".repeat(n);
    expect(code(await select(nested(512), "div:not(div div)"))).toBe("ok");
    // nested matches are written again inside each other: 512 matches of up to 3 KB each
    expect(code(await select(nested(513), "div"))).toBe("E_LIMIT_VALUE");
  });

  test("a document of 20,000 levels is refused before the selector runs", async () => {
    const t0 = Date.now();
    expect(code(await select("<div>".repeat(20_000), "div"))).toBe("E_LIMIT_VALUE");
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  test("more than 200,000 nodes are E_LIMIT_VALUE", { timeout: 60_000 }, async () => {
    expect(code(await select("<b>x</b>".repeat(MAX_NODES / 2 + 1), "b"))).toBe("E_LIMIT_VALUE");
  });

  test("matches nest, so the output can pass the value limit: it is held to it", async () => {
    const nested = "<div>".repeat(400) + "text" + "</div>".repeat(400);
    expect(code(await select(nested, "div", "\\n", { maxValueBytes: 100_000 }))).toBe(
      "E_LIMIT_VALUE",
    );
    expect(code(await select(nested, "div"))).toBe("ok");
  });

  test("a selector of 4096 characters is read, 4097 is E_RANGE", async () => {
    expect(code(await select("<p>x</p>", "p,".repeat(MAX_SELECTOR / 2 - 1) + "p"))).toBe("ok");
    expect(code(await select("<p>x</p>", "p".repeat(MAX_SELECTOR + 1)))).toBe("E_RANGE");
  });

  test("a delimiter is read for escapes", async () => {
    expect(out(await select("<i>a</i><i>b</i>", "i", "\\t"))).toBe("<i>a</i>\t<i>b</i>");
    expect(out(await select("<i>a</i><i>b</i>", "i", "\\x2c"))).toBe("<i>a</i>,<i>b</i>");
  });
});

describe("cost at 64 KiB", () => {
  const html =
    "<html><body><div id=main>" +
    Array.from(
      { length: 500 },
      (_, i) =>
        `<p class="c${i % 5} item" data-i="${i}"><span>n${i}</span><a href="/x${i}">l</a><br><img src=a.png></p>`,
    ).join("") +
    "</div></body></html>";

  test("selectors over a 46 KB document take milliseconds", { timeout: 60_000 }, async () => {
    expect(html.length).toBeGreaterThan(40_000);
    const cases: [string, number][] = [
      ["p.c1", 100],
      ["p:nth-child(2n+1) > a", 250],
      ["a[href^='/x1']", 111],
      ["*", 2503],
      ["p:has(span):not(.c2) img", 400],
    ];
    for (const [q, count] of cases) {
      const t0 = Date.now();
      const r = await select(html, q);
      expect(r.ok, q).toBe(true);
      if (!r.ok) return;
      // measured: 76 VM steps (the parser, the matcher and the writer are in the libraries); 15 to 40 ms
      expect(r.steps, q).toBeLessThan(500);
      expect(out(r).split("\n").length, q).toBe(count);
      expect(Date.now() - t0, q).toBeLessThan(10_000);
    }
  });
});
