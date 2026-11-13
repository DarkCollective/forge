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
import { describe, expect, test } from "vitest";
import { SafeHtml, empty, escapeText, h, join } from "./html.js";

const HOSTILE = [
  "<script>alert(1)</script>",
  '"><img src=x onerror=alert(1)>',
  "'><svg/onload=alert(1)>",
  "javascript:alert(1)",
  "</title><script>x</script>",
  "&amp; &lt; ${evil} $& $1 `tick`",
  "a\u0000b",
  "<!--",
  "-->",
];

describe("h", () => {
  test("escapes every interpolated string as text", () => {
    for (const bad of HOSTILE) {
      const out = h`<p title="${bad}">${bad}</p>`.toString();
      expect(out).not.toMatch(/<script|<img|<svg|<!--/);
      expect(out).not.toContain('"><');
      expect(out.startsWith('<p title="')).toBe(true);
      // The attribute value has no raw quote that could end it early.
      const inner = /^<p title="(.*)">(.*)<\/p>$/s.exec(out);
      expect(inner).not.toBeNull();
      expect(inner?.[1]).not.toContain('"');
      expect(inner?.[1]).toBe(inner?.[2]);
    }
  });

  test("keeps the literal markup and nested h results", () => {
    const inner = h`<b>${"<i>"}</b>`;
    expect(h`<p>${inner}</p>`.toString()).toBe("<p><b>&lt;i&gt;</b></p>");
  });

  test("a string that looks like markup is not markup", () => {
    expect(h`<p>${"<b>x</b>"}</p>`.toString()).toBe("<p>&lt;b&gt;x&lt;/b&gt;</p>");
    expect(h`<p>${join(["<b>", h`<i>`])}</p>`.toString()).toBe("<p>&lt;b&gt;<i></p>");
  });

  test("lists, numbers and empty values", () => {
    expect(h`<ul>${["a", "<", 3].map((x) => h`<li>${x}</li>`)}</ul>`.toString()).toBe(
      "<ul><li>a</li><li>&lt;</li><li>3</li></ul>",
    );
    expect(h`[${null}${undefined}${false}${empty}]`.toString()).toBe("[]");
  });

  test("SafeHtml cannot be made from a string", () => {
    // @ts-expect-error the constructor needs the private token
    expect(() => new SafeHtml("<script>", Symbol("x"))).toThrow();
  });

  test("escapeText covers the five characters, the backtick and NUL", () => {
    expect(escapeText("&<>\"'`\u0000")).toBe("&amp;&lt;&gt;&quot;&#39;&#96;\ufffd");
  });
});
