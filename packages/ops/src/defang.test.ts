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
 * Tests for the `defang` vocabulary (vocab/defang.fth, no primitives): Defang URL and Fang URL. The op vectors
 * (vocab/defang.test.json) hold hand-checked cases; these tests add the round trip on random URLs, the three
 * processing modes on text with many matches, hostile input and the cost at 64 KiB.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bool, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["defang"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const out = (r: Result): string => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return (r.stack[r.stack.length - 1] as { v: string }).v;
};
const defang = (
  data: string,
  process = "valid-domains-and-full-urls",
  dots = true,
  http = true,
  slashes = true,
) =>
  runtime.call("defang:defang-url", [
    str(data),
    bool(dots),
    bool(http),
    bool(slashes),
    str(process),
  ]);
const fang = (data: string, dots = true, http = true, slashes = true) =>
  runtime.call("defang:fang-url", [str(data), bool(dots), bool(http), bool(slashes)]);

let seed = 0x91d3;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const below = (n: number) => Math.floor(rand() * n);
const label = () =>
  Array.from(
    { length: 1 + below(8) },
    () => "abcdefghijklmnopqrstuvwxyz0123456789"[below(36)],
  ).join("");
const randomUrl = () =>
  `${["http", "https", "ftp"][below(3)]}://${label()}.${label()}${rand() < 0.5 ? `.${["com", "org", "co", "net"][below(4)]}` : ".io"}${rand() < 0.5 ? `:${1 + below(9000)}` : ""}${rand() < 0.7 ? `/${label()}/${label()}.${label()}` : ""}${rand() < 0.4 ? `?a=${label()}` : ""}`;

describe("Defang URL and Fang URL", () => {
  test("random URLs: defanged text has no dot, no http and no ://, and fanging restores it", async () => {
    for (let i = 0; i < 150; i++) {
      const url = randomUrl();
      const d = out(await defang(`see ${url} now`, "everything"));
      expect(d).not.toContain("http");
      expect(d.replaceAll("[://]", "")).not.toContain("://");
      expect(d.replaceAll("[.]", "")).not.toContain(".");
      // "ftp" URLs have no http to restore, and https becomes hxxps
      expect(out(await fang(d))).toBe(`see ${url} now`);
      // the same through the URL pattern
      const f = out(await defang(`see ${url} now`, "only-full-urls"));
      expect(f.replaceAll("[.]", "").replaceAll("[://]", "")).not.toMatch(/\.|:\/\/|http/);
    }
  });

  test("the modes differ on text with a domain and no URL", async () => {
    const t = "mail the abuse desk at abuse.example.org or open http://example.net/x.";
    expect(out(await defang(t, "everything"))).toBe(
      "mail the abuse desk at abuse[.]example[.]org or open hxxp[://]example[.]net/x[.]",
    );
    expect(out(await defang(t, "only-full-urls"))).toBe(
      "mail the abuse desk at abuse.example.org or open hxxp[://]example[.]net/x.",
    );
    expect(out(await defang(t, "valid-domains-and-full-urls"))).toBe(
      "mail the abuse desk at abuse[.]example[.]org or open hxxp[://]example[.]net/x.",
    );
  });

  test("a domain is two or more labels and a top-level label of letters", async () => {
    expect(
      out(await defang("a.b 1.2 x.y.zz v1.2.3 foo.c a.bc", "valid-domains-and-full-urls")),
    ).toBe("a.b 1.2 x[.]y[.]zz v1.2.3 foo.c a[.]bc");
    expect(out(await defang("xn--bcher-kva.example", "valid-domains-and-full-urls"))).toBe(
      "xn--bcher-kva[.]example",
    );
    // a name right after a dot or a hyphen that follows a letter or digit is not a new start (the lookbehind that
    // keeps the search linear); after anything else it is, as in CyberChef (found by the WP 5.59b cross-check:
    // the first lookbehind also skipped ".example.com", "*.example.com" and "-bad-.example.com")
    expect(out(await defang("-bad-.example.com", "valid-domains-and-full-urls"))).toBe(
      "-bad-.example[.]com",
    );
    expect(out(await defang("*.example.com .a.bc a..b.com www.-a.com", "valid-domains-and-full-urls"))).toBe(
      "*.example[.]com .a[.]bc a..b[.]com www.-a[.]com",
    );
    expect(out(await defang("see (www.example.com)", "valid-domains-and-full-urls"))).toBe(
      "see (www[.]example[.]com)",
    );
  });

  test("fang leaves every other bracket and keeps upper case hxxp", async () => {
    expect(out(await fang("[.] [:] [://] hxxp HXXP hxxps"))).toBe(". [:] :// http HXXP https");
    expect(out(await fang("hxxp[://]a[.]b", false, true, true))).toBe("http://a[.]b");
  });

  test("64 KiB of text with a URL on every line", { timeout: 60_000 }, async () => {
    const lines: string[] = [];
    for (let size = 0; size < 64 * 1024;) {
      const l = `line ${lines.length}: ${randomUrl()} and ${label()}.${label()}.com`;
      lines.push(l);
      size += l.length + 1;
    }
    const text = lines.join("\n");
    for (const process of ["everything", "only-full-urls", "valid-domains-and-full-urls"]) {
      const t0 = Date.now();
      const r = await defang(text, process);
      const ms = Date.now() - t0;
      expect(out(r).length).toBeGreaterThan(text.length);
      expect(r.ok && r.steps).toBeLessThan(10_000_000);
      process_write(process, text.length, r.ok ? r.steps : -1, ms);
    }
    const back = await fang(out(await defang(text, "everything")));
    expect(out(back)).toBe(text);
  });

  test("hostile text that could make the patterns backtrack", { timeout: 60_000 }, async () => {
    const t0 = Date.now();
    for (const t of [
      "http://" + "a.".repeat(20000),
      "a.".repeat(30000) + "!",
      "a-".repeat(30000),
      "xn--".repeat(10000) + ".com",
      "HTTP://" + "-".repeat(60000),
      ("a" + ".a".repeat(60)).repeat(500),
      ".-a".repeat(20000),
      "a..".repeat(20000),
      "_a.".repeat(20000),
    ]) {
      expect(code(await defang(t))).toBe("ok");
    }
    expect(Date.now() - t0).toBeLessThan(20_000);
  });
});

function process_write(mode: string, chars: number, steps: number, ms: number): void {
  process.stderr.write(`\ndefang-url ${mode} ${chars} chars: ${steps} steps ${ms} ms\n`);
}
