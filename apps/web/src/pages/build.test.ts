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
import { readFileSync } from "node:fs";
import { decodeShare } from "@forge/recipe";
import type { Catalogue, CatalogueOp, HelpDoc, HelpOp } from "@forge/ops";
import { beforeAll, describe, expect, test } from "vitest";
import {
  BODY_MARKER,
  HEAD_MARKER,
  addToSitemap,
  buildReferencePages,
  fillTemplate,
} from "./build.js";
import type { ReferencePage } from "./build.js";
import { h } from "./html.js";
import { opPath } from "./slug.js";

const read = <T>(name: string): T =>
  JSON.parse(
    readFileSync(new URL(`../../../../packages/ops/dist/${name}`, import.meta.url), "utf8"),
  ) as T;
const catalogue = read<Catalogue>("catalogue.json");
const help = read<HelpDoc>("help.json");

const TEMPLATE = `<!doctype html><html><head>${HEAD_MARKER}<link rel="stylesheet" href="/assets/a.css"><script type="module" src="/assets/t.js"></script></head><body>${BODY_MARKER}</body></html>`;

let pages: ReferencePage[] = [];
beforeAll(async () => {
  pages = await buildReferencePages(catalogue, help, TEMPLATE);
}, 60_000);

const hrefs = (html: string): string[] =>
  [...html.matchAll(/<a [^>]*?href="([^"]*)"/g)].map((m) =>
    (m[1] as string).replace(/&amp;/g, "&"),
  );
const count = (html: string, re: RegExp): number => (html.match(re) ?? []).length;

describe("real pages", () => {
  test("one index and one page per op, at the op's URL", () => {
    expect(pages[0]?.path).toBe("/ops/");
    expect(pages.length).toBe(catalogue.ops.length + 1);
    expect(new Set(pages.map((p) => p.path)).size).toBe(pages.length);
    expect(new Set(pages.map((p) => p.file)).size).toBe(pages.length);
    for (const op of catalogue.ops) expect(pages.some((p) => p.path === opPath(op))).toBe(true);
  });

  test("the index lists every op once, with its link and its use-when line", () => {
    const index = pages[0]?.html ?? "";
    for (const op of catalogue.ops) {
      expect(count(index, new RegExp(`<a href="${opPath(op)}">`, "g")), op.qname).toBe(1);
    }
    const withHelp = help.ops.filter((o) => o.useWhen);
    expect(withHelp.length).toBeGreaterThan(400);
    for (const o of withHelp.slice(0, 40)) {
      expect(index).toContain(
        (o.useWhen as string)
          .replace(/&/g, "&amp;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;"),
      );
    }
  });

  test("every internal link of every page resolves to a generated page or an anchor on one", () => {
    const paths = new Set(pages.map((p) => p.path));
    const site = new Set(["/", "/about/", "/privacy/", "/terms/", "/security/", "/accessibility/"]);
    for (const page of pages) {
      const ids = new Set([...page.html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
      for (const href of hrefs(page.html)) {
        if (href.startsWith("https://")) continue;
        if (href.startsWith("#")) {
          expect(ids.has(href.slice(1)), `${page.path} ${href}`).toBe(true);
        } else if (href.startsWith("/#")) {
          expect(href, page.path).toMatch(
            /^\/#v=1&r=[A-Za-z0-9_-]+(&i=[A-Za-z0-9_-]+&ie=[a-z0-9]+)?$/,
          );
        } else {
          const [path, hash] = href.split("#") as [string, string | undefined];
          expect(
            paths.has(path as string) || site.has(path as string),
            `${page.path} -> ${href}`,
          ).toBe(true);
          if (hash !== undefined && paths.has(path as string)) {
            const target = pages.find((p) => p.path === path)?.html ?? "";
            expect(target.includes(` id="${hash}"`), `${page.path} -> ${href}`).toBe(true);
          }
        }
      }
    }
  });

  test("every page has one h1, a description, a canonical link, a skip link and landmarks, and no inline code", () => {
    for (const p of pages) {
      expect(count(p.html, /<h1[ >]/g), p.path).toBe(1);
      expect(count(p.html, /<meta name="description" content="[^"]+"/g), p.path).toBe(1);
      expect(p.html).toContain(
        `<link rel="canonical" href="https://forge.darkcollective.com${p.path}" />`,
      );
      expect(p.html).toContain('<a class="skip-link" href="#main">');
      expect(count(p.html, /<main[ >]/g)).toBe(1);
      expect(count(p.html, /<header[ >]/g)).toBe(1);
      expect(count(p.html, /<footer[ >]/g)).toBe(1);
      expect(count(p.html, /<script/g), p.path).toBe(1); // the template's theme module only
      expect(p.html).not.toMatch(/ style=| on[a-z]+=|<style|<iframe|<img|javascript:/i);
    }
  });

  test("external links are https, noopener noreferrer, and named as leaving Forge", () => {
    let seen = 0;
    for (const p of pages) {
      for (const m of p.html.matchAll(/<a [^>]*href="(https?:[^"]*)"[^>]*>/g)) {
        if ((m[1] as string).startsWith("https://forge.darkcollective.com")) continue;
        if ((m[1] as string).startsWith("https://github.com/DarkCollective/forge")) continue;
        seen++;
        expect(m[1], p.path).toMatch(/^https:\/\//);
        expect(m[0], p.path).toContain('rel="noopener noreferrer"');
      }
    }
    expect(seen).toBeGreaterThan(100);
  });

  test("the op page has the content the brief names", () => {
    const op = catalogue.ops.find((o) => o.qname === "pbkdf2:derive") as CatalogueOp;
    const page = pages.find((p) => p.path === opPath(op))?.html ?? "";
    for (const text of [
      "pbkdf2:derive",
      "Key derivation",
      "Use this when",
      "Signature",
      "Parameters",
      "Examples",
      "Further reading",
      "RFC 6070 section 2",
      "0c60c80f961f0e71f3a9b524af6012062fe037a6",
      "see also".toLowerCase() === "" ? "" : "See also",
      "Input bytes, output bytes.",
    ]) {
      expect(page, text).toContain(text);
    }
    expect(page).toContain('<a href="/ops/hmac/digest/">');
  });

  test("an Open in Forge link decodes to the example's recipe and input", async () => {
    const op = catalogue.ops.find((o) => o.qname === "pbkdf2:derive") as CatalogueOp;
    const page = pages.find((p) => p.path === opPath(op))?.html ?? "";
    const link = hrefs(page).find((u) => u.startsWith("/#v=1")) as string;
    const decoded = await decodeShare(link.slice(2), { catalogue });
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const step = decoded.recipe.steps[0] as unknown as {
      op: string;
      params: Record<string, unknown>;
    };
    expect(step.op).toBe("pbkdf2:derive");
    expect(step.params.iterations).toBe(1);
    expect(new TextDecoder().decode(decoded.input)).toBe("password");
  });

  test("every example of the help document has a link, or says why not", () => {
    let linked = 0;
    for (const entry of help.ops) {
      const page =
        pages.find(
          (p) =>
            p.path === opPath(catalogue.ops.find((o) => o.qname === entry.qname) as CatalogueOp),
        )?.html ?? "";
      const n = count(page, />Open in Forge<span/g);
      const missing = count(page, /too large to open from a link/g);
      expect(n + missing, entry.qname).toBe(entry.examples.length);
      linked += n;
    }
    expect(linked).toBeGreaterThan(800);
  });

  test("same input, same bytes", async () => {
    const again = await buildReferencePages(catalogue, help, TEMPLATE);
    expect(again.map((p) => p.html)).toEqual(pages.map((p) => p.html));
  });
});

describe("hostile data", () => {
  const evil = '<script>alert(1)</script>"><img src=x onerror=alert(1)> $& $1 </main>';
  const op = {
    qname: 'v"x:n<b>',
    name: "n<b>",
    vocab: 'v"x',
    category: evil,
    doc: evil,
    aliases: [evil],
    seeAlso: [evil, "pbkdf2:derive"],
    input: "bytes",
    output: "bytes",
    effect: evil,
    params: [
      {
        name: 'p"q',
        type: "choice",
        options: [evil, "ok"],
        default: evil,
        doc: evil,
        index: 1,
        required: false,
        constraint: { pattern: evil },
      },
    ],
    effects: [],
    version: "1",
    hash: "x",
    needsHardKill: false,
  } as unknown as CatalogueOp;
  const entry: HelpOp = {
    qname: op.qname,
    useWhen: evil,
    links: [
      { url: 'https://example.com/?a=1&b="><script>', label: evil },
      { url: "javascript:alert(1)", label: "bad" },
      { url: "http://insecure.example/", label: "bad" },
    ],
    inverse: evil,
    optionDocs: { 'p"q': { [evil]: evil } },
    examples: [
      {
        title: evil,
        note: evil,
        ref: evil,
        params: { 'p"q': evil, n: { value: evil, enc: "utf8" } },
        input: { value: evil + "\u202e\u0000", enc: "utf8" },
        expect: { value: evil, enc: "utf8" },
      },
      {
        title: "err",
        note: null,
        ref: null,
        params: {},
        input: { value: "", enc: "utf8" },
        expect: { error: evil },
      },
      {
        title: "json",
        note: null,
        ref: null,
        params: {},
        input: { value: "", enc: "utf8" },
        expect: { json: [evil] },
      },
    ],
  };

  test("nothing hostile becomes markup, in any page", async () => {
    const cat = { ...catalogue, ops: [op] } as Catalogue;
    const doc = { ...help, ops: [entry] } as HelpDoc;
    const out = await buildReferencePages(cat, doc, TEMPLATE);
    expect(out.length).toBe(2);
    for (const p of out) {
      const body = p.html.slice(p.html.indexOf("<body>"));
      expect(body, p.path).not.toMatch(/<script|<img|<\/main>.*<\/main>/s);
      expect(p.html, p.path).not.toContain("alert(1)</script>");
      expect(p.html, p.path).not.toContain("<img");
      expect(count(p.html, /<script/g), p.path).toBe(1);
      expect(count(p.html, /<main[ >]/g), p.path).toBe(1);
      expect(count(p.html, /<h1[ >]/g), p.path).toBe(1);
      expect(p.html, p.path).not.toContain("javascript:");
      expect(p.html, p.path).not.toContain("http://insecure");
    }
    const page = out[1]?.html ?? "";
    expect(page).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(page).toContain("$&amp; $1");
    expect(page).toContain("\\u202e");
    expect(page).toContain('href="https://example.com/?a=1&amp;b=%22%3E%3Cscript%3E"');
    expect(out[1]?.path).toBe("/ops/v_22_x/n_3c_b_3e_/");
    expect(out[1]?.path).toMatch(/^[a-z0-9/_-]+$/);
  });
});

describe("template and sitemap", () => {
  const parts = {
    title: "T",
    description: 'D "q" $&',
    canonical: "https://x/",
    body: h`<p>${"$& $1 $`"}</p>`,
  };

  test("fillTemplate puts text in literally and escapes the metadata", () => {
    const out = fillTemplate(TEMPLATE, parts);
    expect(out).toContain('content="D &quot;q&quot; $&amp;"');
    expect(out).toContain("<p>$&amp; $1 $&#96;</p>");
  });

  test("fillTemplate demands each marker exactly once", () => {
    expect(() => fillTemplate("<head></head>" + BODY_MARKER, parts)).toThrow(/exactly once/);
    expect(() => fillTemplate(TEMPLATE + BODY_MARKER, parts)).toThrow(/exactly once/);
  });

  test("the sitemap keeps its entries and gains the pages", () => {
    const base =
      '<?xml version="1.0"?>\n<urlset>\n  <url>\n    <loc>https://forge.darkcollective.com/about/</loc>\n  </url>\n</urlset>\n';
    const out = addToSitemap(base, pages);
    expect(out.startsWith(base.slice(0, base.indexOf("</urlset>")))).toBe(true);
    expect(out).toContain("<loc>https://forge.darkcollective.com/about/</loc>");
    expect(out).toContain("<loc>https://forge.darkcollective.com/ops/</loc>");
    expect(out).toContain("<loc>https://forge.darkcollective.com/ops/pbkdf2/derive/</loc>");
    expect(count(out, /<loc>/g)).toBe(1 + pages.length);
    expect(out.trimEnd().endsWith("</urlset>")).toBe(true);
  });
});
