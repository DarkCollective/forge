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
 * Tests for the `html-text` vocabulary (vocab/html-text.fth): tags, block elements, script and style, comments,
 * character references, and the way it treats text that only looks like markup.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { buildCatalogue } from "./catalogue.js";
import { loadBundleNode } from "./sources-node.js";

const { str } = valueHelpers;
type Result = Awaited<ReturnType<ReturnType<typeof assembleRuntime>["call"]>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const top = (r: Result) => (r.ok ? (r.stack[r.stack.length - 1] as { v: unknown }).v : undefined);

const bundle = await loadBundleNode(["html-text"]);
const runtime = assembleRuntime(bundle);
const toText = async (s: string) =>
  top(await runtime.call("html-text:to-text", [str(s)])) as string;

describe("catalogue", () => {
  test("html-text:to-text is a Language op", () => {
    const op = buildCatalogue(assembleRuntime(bundle)).ops.find(
      (o) => o.qname === "html-text:to-text",
    );
    expect(op?.category).toBe("Language");
  });
});

describe("html-text:to-text", () => {
  test("tags are dropped, text kept", async () => {
    expect(await toText("<p>Hello <b>world</b>!</p>")).toBe("Hello world!");
    expect(await toText('<a href="https://example.com/?a=1&amp;b=2" title="x">link</a>')).toBe(
      "link",
    );
    expect(await toText("plain text")).toBe("plain text");
    expect(await toText("")).toBe("");
  });

  test("script and style elements are dropped with their content, in any case", async () => {
    expect(await toText("a<script>var x = '<b>';</script>b<style>p{color:red}</style>c")).toBe(
      "abc",
    );
    expect(await toText("a<SCRIPT type='x'>1</ScRiPt >b")).toBe("ab");
    expect(await toText("x<script>alert(1)")).toBe("x");
    expect(await toText("x<style>p{}")).toBe("x");
    expect(await toText("<script src=a.js></script>y")).toBe("y");
  });

  test("comments and the doctype are dropped", async () => {
    expect(await toText("<!DOCTYPE html><html><!-- <b>hidden</b> -->visible</html>")).toBe(
      "visible",
    );
    expect(await toText("a<!-- never closed")).toBe("a");
    expect(await toText('<?xml version="1.0"?>text')).toBe("text");
  });

  test("br and block elements are line breaks", async () => {
    expect(await toText("line1<br>line2<br/>line3<BR />line4")).toBe("line1\nline2\nline3\nline4");
    expect(await toText("<div>one</div><div>two</div>")).toBe("one\n\ntwo");
    expect(await toText("<h1>Title</h1><p>Body</p>")).toBe("Title\n\nBody");
    expect(await toText("<ul><li>one</li><li>two</li></ul>")).toBe("one\n\ntwo");
    expect(await toText("<table><tr><td>a</td><td>b</td></tr></table>")).toBe("a\n\nb");
  });

  test("inline elements do not break lines", async () => {
    expect(await toText("a<span>b</span><em>c</em><strong>d</strong>e")).toBe("abcde");
    expect(await toText("<pre>x</pre>")).toBe("x");
    expect(await toText("<p>brown</p>")).toBe("brown");
    expect(await toText("<body>b</body><br>")).toBe("b");
  });

  test("character references are decoded once, after the tags are gone", async () => {
    expect(await toText("&lt;b&gt; &amp; &copy; &#x41; &#66;")).toBe("<b> & © A B");
    expect(await toText("&amp;lt;")).toBe("&lt;");
    expect(await toText("&lt;script&gt;alert(1)&lt;/script&gt;")).toBe("<script>alert(1)</script>");
  });

  test("a < that does not start a tag stays", async () => {
    expect(await toText("if a < b and c > d")).toBe("if a < b and c > d");
    expect(await toText("1<2 and 3>2")).toBe("1<2 and 3>2");
  });

  test("runs of line feeds are cut to two and the text is trimmed", async () => {
    expect(await toText("\n\n\n  a\n\n\n\n\nb  \n\n")).toBe("a\n\nb");
    expect(await toText("<p></p><p></p><p>x</p><p></p>")).toBe("x");
  });

  test("a large document is within the step and time limits", async () => {
    const doc = "<div><p>Some <b>bold</b> text &amp; more</p><script>x()</script></div>\n".repeat(
      900,
    );
    const r = await runtime.call("html-text:to-text", [str(doc)]);
    expect(code(r)).toBe("ok");
    expect(top(r)).toContain("Some bold text & more");
    expect(top(r)).not.toContain("x()");
  });
});
