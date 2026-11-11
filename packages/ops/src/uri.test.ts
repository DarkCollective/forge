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
 * Tests for the `uri` vocabulary (vocab/uri.fth, no primitives): Parse URI. The op vectors (vocab/uri.test.json)
 * hold the cases computed with Python's urllib.parse; these tests add random URLs against a model written here,
 * query strings with many arguments, hostile input and the cost at 64 KiB.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["uri"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const out = (r: Result): string => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return (r.stack[r.stack.length - 1] as { v: string }).v;
};
const parse = (data: string) => runtime.call("uri:parse", [str(data)]);

let seed = 0x44a1;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const below = (n: number) => Math.floor(rand() * n);
const word = () => Array.from({ length: 1 + below(8) }, () => "abcdefghij"[below(10)]).join("");

describe("Parse URI against the model", () => {
  test("random URLs: the parts are those that were put in", async () => {
    for (let i = 0; i < 150; i++) {
      const scheme = ["http", "https", "ftp", "ws"][below(4)] as string;
      const user = rand() < 0.4 ? `${word()}${rand() < 0.5 ? `:${word()}` : ""}` : "";
      const host = `${word()}.${word()}.com`;
      const port = rand() < 0.5 ? String(1 + below(65000)) : "";
      const path = rand() < 0.7 ? `/${word()}/${word()}` : "";
      const args = Array.from({ length: below(4) }, () => [word(), word()] as const);
      const frag = rand() < 0.4 ? word() : "";
      const url = `${scheme}://${user ? `${user}@` : ""}${host}${port ? `:${port}` : ""}${path}${args.length ? `?${args.map(([k, v]) => `${k}=${v}`).join("&")}` : ""}${frag ? `#${frag}` : ""}`;
      const keys = [...new Set(args.map(([k]) => k))];
      const w = Math.max(0, ...keys.map((k) => k.length));
      const expected =
        `Protocol:\t${scheme}:\n` +
        (user ? `Auth:\t\t${user}\n` : "") +
        `Hostname:\t${host}\n` +
        (port ? `Port:\t\t${port}\n` : "") +
        `Path name:\t${path || "/"}\n` +
        (args.length
          ? `Arguments:\n${keys
              .map(
                (k) =>
                  `\t${k.padEnd(w)} = ${args
                    .filter(([kk]) => kk === k)
                    .map(([, v]) => v)
                    .join(",")}\n`,
              )
              .join("")}`
          : "") +
        (frag ? `Hash:\t\t#${frag}\n` : "");
      expect(out(await parse(url)), url).toBe(expected);
    }
  });

  test("percent escapes: valid UTF-8, a bare % and invalid bytes", async () => {
    const r = out(await parse("http://h/?a=%F0%9F%98%80&b=%E2%82&c=%&d=%4"));
    expect(r).toContain("\ta = \u{1F600}\n");
    expect(r).toContain("\tb = %E2%82\n");
    expect(r).toContain("\tc = %\n");
    expect(r).toContain("\td = %4\n");
    expect(out(await parse("http://%75ser:%70w@h/"))).toContain("Auth:\t\tuser:pw\n");
  });

  test("a port, brackets and the empty parts", async () => {
    expect(out(await parse("http://h:/x"))).toBe(
      "Protocol:\thttp:\nHostname:\th\nPath name:\t/x\n",
    );
    expect(out(await parse("http://[::1]/x"))).toContain("Hostname:\t::1\n");
    expect(out(await parse("http://H.EXAMPLE:80/"))).toContain(
      "Hostname:\th.example\nPort:\t\t80\n",
    );
    expect(out(await parse("http://h/?"))).toBe("Protocol:\thttp:\nHostname:\th\nPath name:\t/\n");
    expect(out(await parse("#only"))).toBe("Hash:\t\t#only\n");
    expect(out(await parse("?a=1"))).toBe("Arguments:\n\ta = 1\n");
    expect(code(await parse("http://h:99999999999999999999x/"))).toBe("E_COERCE");
    expect(code(await parse("http://h:1:2/"))).toBe("E_COERCE");
  });

  test("a 64 KiB query with 8,000 arguments, some repeated", { timeout: 60_000 }, async () => {
    const args: string[] = [];
    for (let size = 0; size < 64 * 1024;) {
      const a = `k${below(3000)}=v${below(100)}`;
      args.push(a);
      size += a.length + 1;
    }
    const t0 = Date.now();
    const r = await parse(`http://h/p?${args.join("&")}`);
    const ms = Date.now() - t0;
    const text = out(r);
    const keys = new Set(args.map((a) => a.split("=")[0]));
    expect(text.split("\n").length).toBe(keys.size + 5);
    expect(r.ok && r.steps).toBeLessThan(10_000_000);
    process.stderr.write(
      `\nuri parse ${args.length} arguments (${keys.size} names): ${r.ok && r.steps} steps ${ms} ms\n`,
    );
  });

  test(
    "a 64 KiB query of distinct names (the worst case for the lookup record)",
    { timeout: 60_000 },
    async () => {
      const args: string[] = [];
      for (let size = 0, i = 0; size < 64 * 1024; i++) {
        const a = `n${i}=${i % 7}`;
        args.push(a);
        size += a.length + 1;
      }
      const t0 = Date.now();
      const r = await parse(`http://h/p?${args.join("&")}`);
      const ms = Date.now() - t0;
      expect(out(r).split("\n").length).toBe(args.length + 5);
      process.stderr.write(
        `\nuri parse ${args.length} distinct arguments: ${r.ok && r.steps} steps ${ms} ms\n`,
      );
    },
  );

  test("hostile text", { timeout: 60_000 }, async () => {
    for (const t of [
      "%".repeat(60_000),
      "?".repeat(60_000),
      "&".repeat(60_000),
      "=".repeat(60_000),
      "://".repeat(20_000),
      "@".repeat(60_000),
      `http://${"[".repeat(30_000)}`,
      `h://${"a:".repeat(20_000)}`,
    ]) {
      const c = code(await parse(t));
      expect(["ok", "E_COERCE"]).toContain(c);
    }
  });
});

describe("truncated and mutated input", () => {
  test(
    "every prefix of a URL and 400 mutations give a result or E_COERCE",
    { timeout: 60_000 },
    async () => {
      const seedText =
        "https://user:p%40ss@Example.COM:8080/a/b%20c?x=1&y=two+words&x=2&flag&e=#frag";
      const alphabet = "%:/?#&=@[]. \u00e9a1";
      for (let cut = 0; cut <= seedText.length; cut++)
        expect(["ok", "E_COERCE"]).toContain(code(await parse(seedText.slice(0, cut))));
      for (let i = 0; i < 400; i++) {
        const chars = [...seedText];
        for (let k = 0, n = 1 + below(4); k < n; k++) {
          const at = below(chars.length);
          if (below(2) === 0) chars.splice(at, 1);
          else chars.splice(at, 0, alphabet[below(alphabet.length)] as string);
        }
        expect(["ok", "E_COERCE"]).toContain(code(await parse(chars.join(""))));
      }
    },
  );
});
