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
 * Tests for the `extract` vocabulary beyond its vectors (vocab/extract.test.json): the shared unique, sort and
 * total options checked against a plain JavaScript reference on larger samples, binary and 64 KiB input with the
 * default limits, the zero byte handling of the UTF-16 strings, and patterns that could backtrack badly.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bool, bytes, int, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["extract"]));

let seed = 0x2545f491;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const below = (n: number) => Math.floor(rand() * n);
const randomBytes = (n: number) => Uint8Array.from({ length: n }, () => below(256));
const enc = (s: string) => new TextEncoder().encode(s);
const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const out = (r: Result): string => {
  if (!r.ok) throw new Error(r.error.code + ": " + r.error.message);
  return (r.stack[r.stack.length - 1] as { v: string }).v;
};
const code = (r: Result) => (r.ok ? "ok" : r.error.code);

/** Every argument given, as a direct call does not fill in the defaults. */
const strings = (
  data: Uint8Array,
  o: {
    encoding?: string;
    min?: number;
    match?: string;
    nul?: boolean;
    total?: boolean;
    sort?: boolean;
    unique?: boolean;
  } = {},
) =>
  runtime.call("extract:strings", [
    bytes(data),
    str(o.encoding ?? "single"),
    int(o.min ?? 4),
    str(o.match ?? "printable"),
    bool(o.nul ?? false),
    bool(o.total ?? false),
    bool(o.sort ?? false),
    bool(o.unique ?? false),
  ]);
const three = (word: string, data: Uint8Array, total = false, sort = false, unique = false) =>
  runtime.call(`extract:${word}`, [bytes(data), bool(total), bool(sort), bool(unique)]);

/** The reference for the options: unique (first appearance), then sort by code point, then the total. */
function reference(found: string[], total: boolean, sort: boolean, unique: boolean): string {
  let list = unique ? [...new Set(found)] : found;
  if (sort) list = [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return (total ? `Total found: ${list.length}\n\n` : "") + list.join("\n");
}

describe("the options match a reference on many random matches", () => {
  const words = Array.from({ length: 300 }, () =>
    Array.from({ length: 4 + below(6) }, () => String.fromCharCode(97 + below(26))).join(""),
  );
  const picks = Array.from({ length: 3000 }, () => words[below(words.length)] as string);
  const data = latin1(picks.join("\0"));
  for (const total of [false, true]) {
    for (const sort of [false, true]) {
      for (const unique of [false, true]) {
        test(`strings total=${total} sort=${sort} unique=${unique}`, async () => {
          expect(out(await strings(data, { total, sort, unique }))).toBe(
            reference(picks, total, sort, unique),
          );
        });
      }
    }
  }
});

describe("extract:strings", () => {
  test("the zero bytes of UTF-16 are removed from the output, in both byte orders", async () => {
    const le = latin1("w\0o\0r\0d\0s\0");
    const be = latin1("\0w\0o\0r\0d\0s");
    expect(out(await strings(le, { encoding: "utf16le" }))).toBe("words");
    expect(out(await strings(be, { encoding: "utf16be" }))).toBe("words");
    // misaligned: the zero bytes are on the wrong side, so the first character is lost (BE) or the last (LE)
    expect(out(await strings(le, { encoding: "utf16be" }))).toBe("ords");
    expect(out(await strings(be, { encoding: "utf16le" }))).toBe("word");
  });

  test("random binary 64 KiB: every string is a run of printable ASCII of at least the minimum length", async () => {
    const data = randomBytes(65536);
    const lines = out(await strings(data, { min: 3 })).split("\n");
    const expected = String.fromCharCode(...data).match(/[ -~]{3,}/g) ?? [];
    expect(lines).toEqual(expected);
  });

  test("random binary 64 KiB in all encodings, with unique and sort, within the default limits", async () => {
    const data = randomBytes(65536);
    const t = Date.now();
    const r = await strings(data, {
      encoding: "all",
      min: 3,
      sort: true,
      unique: true,
      total: true,
    });
    expect(code(r)).toBe("ok");
    expect(Date.now() - t).toBeLessThan(5000);
  });

  test("64 KiB of text in one run is one string", async () => {
    const text = "abcdefgh ".repeat(7282).slice(0, 65536);
    expect(out(await strings(enc(text)))).toBe(text);
  });

  test("a hostile minimum length larger than the data finds nothing", async () => {
    expect(out(await strings(enc("abcdef"), { min: 100000 }))).toBe("");
  });
});

describe("the other extractors on 64 KiB", () => {
  const sample = (make: (i: number) => string): Uint8Array => {
    let s = "";
    for (let i = 0; s.length < 65536; i++) s += make(i) + " ";
    return enc(s.slice(0, 65536).replace(/\S*$/, ""));
  };
  const cases: [string, (i: number) => string, RegExp][] = [
    ["emails", (i) => `user${i}@host${i % 50}.example.com`, /^user\d+@host\d+\.example\.com$/],
    [
      "urls",
      (i) => `http://host${i}.example.com/p/${i}?q=${i}#f`,
      /^http:\/\/host\d+\.example\.com\/p\/\d+\?q=\d+#f$/,
    ],
    ["domains", (i) => `www.host${i}.example.org`, /^www\.host\d+\.example\.org$/],
    [
      "mac-addresses",
      (i) => `00:11:22:33:${(i % 256).toString(16).padStart(2, "0")}:ff`,
      /^00:11:22:33:[0-9a-f]{2}:ff$/,
    ],
  ];
  for (const [word, make, shape] of cases) {
    test(`${word}: every line has the shape, unique removes the repeats`, async () => {
      const lines = out(await three(word, sample(make), false, true, true)).split("\n");
      expect(lines.length).toBeGreaterThan(100);
      expect(lines.every((l) => shape.test(l))).toBe(true);
      expect(new Set(lines).size).toBe(lines.length);
      expect([...lines].sort()).toEqual(lines);
    });
  }

  test("ip-addresses: 64 KiB of addresses, both families", async () => {
    let s = "";
    for (let i = 0; s.length < 65536; i++)
      s += `${below(256)}.${below(256)}.${below(256)}.${below(256)} 2001:db8::${i.toString(16)} `;
    const r = await runtime.call("extract:ip-addresses", [
      bytes(enc(s)),
      bool(true),
      bool(true),
      bool(true),
      bool(false),
      bool(true),
      bool(true),
    ]);
    expect(code(r)).toBe("ok");
    const lines = out(r).split("\n");
    expect(lines.length).toBeGreaterThan(1000);
    expect(lines.some((l) => l.includes(":"))).toBe(true);
    expect(lines.every((l) => !/^(10|127|192\.168|169\.254)\./.test(l))).toBe(true);
  });

  test("file-paths: UNIX paths on 64 KiB", async () => {
    const unix = sample((i) => `/usr/lib/x${i}/bin`);
    const lines = out(
      await runtime.call("extract:file-paths", [
        bytes(unix),
        bool(true),
        bool(true),
        bool(false),
        bool(false),
        bool(false),
      ]),
    ).split("\n");
    expect(lines.length).toBeGreaterThan(1000);
    expect(lines.every((l) => /^\/usr\/lib\/x\d+\/bin$/.test(l))).toBe(true);
  });

  test("hashes: random hex digests of several sizes with all", async () => {
    const hex = (n: number) => Array.from({ length: n }, () => below(16).toString(16)).join("");
    const sizes = [8, 16, 32, 40, 56, 64, 96, 128];
    const made = Array.from({ length: 400 }, (_, i) => hex(sizes[i % sizes.length] as number));
    const r = await runtime.call("extract:hashes", [
      bytes(enc(made.join(" "))),
      int(40),
      bool(true),
      bool(false),
      bool(false),
      bool(false),
    ]);
    expect(out(r).split("\n")).toEqual(made);
  });
});

describe("hostile input stays fast", () => {
  const hostile: [string, string, string][] = [
    ["emails", "emails", "a".repeat(65000) + "@"],
    ["emails with dots", "emails", "a.".repeat(30000) + "@"],
    ["emails, hosts", "emails", "x@" + "a-".repeat(30000)],
    ["urls", "urls", "http://" + "a".repeat(65000)],
    ["urls, brackets", "urls", "http://a.com/" + "(x".repeat(30000)],
    ["domains", "domains", "a-".repeat(30000) + "."],
    ["domains, labels", "domains", "a.b-".repeat(15000)],
    ["file-paths, Windows", "file-paths", "C:\\" + "a b\\".repeat(15000)],
    ["file-paths, spaces", "file-paths", "C:\\" + "a ".repeat(30000)],
    ["file-paths, UNIX", "file-paths", "/" + "a".repeat(30000) + "...,,,."],
    ["mac-addresses", "mac-addresses", "00:".repeat(20000)],
    ["ip-addresses, IPv6", "ip-addresses", "1:".repeat(30000)],
    ["ip-addresses, IPv6 groups", "ip-addresses", "1::".repeat(20000)],
    ["ip-addresses, IPv4", "ip-addresses", "1.".repeat(30000)],
  ];
  for (const [name, word, text] of hostile) {
    test(name, async () => {
      const args =
        word === "ip-addresses"
          ? [
              bytes(enc(text)),
              bool(true),
              bool(true),
              bool(false),
              bool(false),
              bool(false),
              bool(false),
            ]
          : word === "file-paths"
            ? [bytes(enc(text)), bool(true), bool(true), bool(false), bool(false), bool(false)]
            : [bytes(enc(text)), bool(false), bool(false), bool(false)];
      const t = Date.now();
      const r = await runtime.call(`extract:${word}`, args);
      expect(code(r)).toBe("ok");
      expect(Date.now() - t).toBeLessThan(2000);
    });
  }
});

describe("parameters", () => {
  test("a minimum length below 1 is refused at a direct call", async () => {
    expect(code(await strings(enc("abcd"), { min: 0 }))).toBe("E_PARAM_INVALID");
  });
  test("a bad encoding is refused", async () => {
    expect(code(await strings(enc("abcd"), { encoding: "utf32" }))).toBe("E_PARAM_INVALID");
  });
  test("a hash length of 0 or 129 is refused", async () => {
    for (const n of [0, 129]) {
      const r = await runtime.call("extract:hashes", [
        bytes(enc("ab")),
        int(n),
        bool(false),
        bool(false),
        bool(false),
        bool(false),
      ]);
      expect(code(r)).toBe("E_PARAM_INVALID");
    }
  });
});
