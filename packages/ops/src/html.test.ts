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
import { fileURLToPath } from "node:url";
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

// html is FL (vocab/html.fth); these tests drive its public words through the runtime.
const { str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["html"]));

function top(r: { stack: readonly unknown[] }): { v: unknown } {
  return r.stack[r.stack.length - 1] as { v: unknown };
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * Random scalar values only: ASCII, BMP outside surrogates, and astral. U+0000 is left out: the
 * HTML rule that a reference to 0 decodes to U+FFFD means NUL cannot round-trip.
 */
function randomText(next: () => number, count: number): string {
  let out = "";
  for (let i = 0; i < count; i++) {
    const pick = next();
    let cp: number;
    if (pick < 0.4) cp = 1 + Math.floor(next() * 0x7f);
    else if (pick < 0.8) cp = Math.floor(next() * (0xd800 - 0x80)) + 0x80;
    else cp = 0x10000 + Math.floor(next() * (0x10ffff - 0x10000 + 1));
    out += String.fromCodePoint(cp);
  }
  return out;
}

describe("html round trip", () => {
  test("decode(encode(x)) == x for random text, every scope and format", async () => {
    const next = rng(31337);
    for (let trial = 0; trial < 40; trial++) {
      const text = randomText(next, Math.floor(next() * 25));
      for (const scope of ["minimal", "non-ascii", "all"]) {
        for (const format of ["named", "decimal", "hex"]) {
          const encoded = await runtime.call("html:encode", [str(text), str(scope), str(format)]);
          expect(encoded.ok).toBe(true);
          const decoded = await runtime.call("html:decode", [str(top(encoded).v as string)]);
          expect(decoded.ok).toBe(true);
          expect(top(decoded).v).toBe(text);
        }
      }
    }
  });

  test("minimal output contains no raw markup characters", async () => {
    const r = await runtime.call("html:encode", [str("<&>\"'"), str("minimal"), str("named")]);
    expect(top(r).v).toBe("&lt;&amp;&gt;&quot;&apos;");
  });
});

// ---- the full table of named references ----

const here = fileURLToPath(import.meta.url).replaceAll("\\", "/");
const source = readFileSync(here.replace(/\/src\/[^/]*$/, "/vocab/html.fth"), "utf8");
const dataLines = /: _entities \( -- str \)\n {2}"([^"]*)"/.exec(source)?.[1]?.split("\n") ?? [];

async function decode(text: string): Promise<string> {
  const r = await runtime.call("html:decode", [str(text)]);
  expect(r.ok).toBe(true);
  return top(r).v as string;
}

describe("html:decode named references", () => {
  test("the data is the WHATWG list: 2,231 names, 106 of them legacy (no semicolon)", () => {
    expect(dataLines).toHaveLength(2231);
    const names = dataLines.map((l) => l.slice(0, l.indexOf("=")));
    expect(new Set(names).size).toBe(2231);
    expect(names.filter((n) => !n.endsWith(";"))).toHaveLength(106);
    // every legacy name also exists with its semicolon, with the same value
    const value = new Map(
      dataLines.map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    );
    for (const n of names.filter((x) => !x.endsWith(";"))) {
      expect(value.get(`${n};`)).toBe(value.get(n));
    }
  });

  test("the data is unchanged: a checksum over the lines, as derived from entities.json", () => {
    // FNV-1a over the UTF-8 bytes of the lines "name=hex[,hex]" in the order of entities.json
    // (https://html.spec.whatwg.org/entities.json), the name without its ampersand, joined by LF.
    let h = 0x811c9dc5;
    // The lines are ASCII, so a char-code copy is the UTF-8 bytes.
    for (const byte of Uint8Array.from(dataLines.join("\n"), (c) => c.charCodeAt(0))) {
      h ^= byte;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    expect(h.toString(16)).toBe("c15559d3");
  });

  test.each([
    ["&Aacute;", "Á"],
    ["&AElig;", "Æ"],
    ["&Zeta;", "Ζ"],
    ["&hearts;", "♥"],
    ["&NotEqualTilde;", "≂̸"],
    ["&fjlig;", "fj"],
    ["&Afr;", "\u{1d504}"],
    ["&zwnj;", "‌"],
    ["&nbsp;", " "],
    ["&CounterClockwiseContourIntegral;", "∳"],
  ])("%s", async (input, expected) => {
    expect(await decode(input)).toBe(expected);
  });

  test("every name resolves, with and without a semicolon where the standard allows it", async () => {
    const parts: string[] = [];
    const expected: string[] = [];
    for (const l of dataLines) {
      const eq = l.indexOf("=");
      const cps = l
        .slice(eq + 1)
        .split(",")
        .map((x) => parseInt(x, 16));
      parts.push(`&${l.slice(0, eq)}|`);
      expected.push(`${String.fromCodePoint(...cps)}|`);
    }
    expect(await decode(parts.join(""))).toBe(expected.join(""));
  });

  test("a name that is not legacy needs its semicolon; a legacy one does not", async () => {
    expect(await decode("&euro")).toBe("&euro");
    expect(await decode("&copy")).toBe("©");
    expect(await decode("&notit;")).toBe("¬it;");
    expect(await decode("&ampx")).toBe("&x");
    expect(await decode("&frac12&frac1")).toBe("½&frac1");
  });

  test("names are case sensitive", async () => {
    expect(await decode("&Copy; &COPY; &copy;")).toBe("&Copy; © ©");
  });
});

describe("html:decode numeric references", () => {
  test("128 to 159 are the windows-1252 characters of the standard", async () => {
    const all = Array.from({ length: 32 }, (_, i) => `&#${128 + i};`).join("");
    const w1252 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f" + "\u0090‘’“”•–—˜™š›œ\u009džŸ";
    expect(await decode(all)).toBe(w1252);
    expect(await decode("&#x80;&#X9F;")).toBe("€Ÿ");
  });

  test("the neighbours of the remap range are not remapped", async () => {
    expect(await decode("&#127;&#160;")).toBe("\u007f ");
  });

  test("the semicolon is optional, the run of digits is the longest", async () => {
    expect(await decode("&#65 &#x41g &#65;;")).toBe("A Ag A;");
  });

  test("leading zeros and enormous values", async () => {
    expect(await decode("&#0000000065;")).toBe("A");
    expect(await decode(`&#${"9".repeat(30)};`)).toBe("�");
    expect(await decode(`&#x${"f".repeat(5000)};`)).toBe("�");
  });

  test("no digits: the text is unchanged", async () => {
    expect(await decode("&#;&#x;&#xg;&#")).toBe("&#;&#x;&#xg;&#");
  });
});

describe("html:decode on larger input", () => {
  test("64 KiB of references decodes in one call", { timeout: 60_000 }, async () => {
    const unit = "a &lt; b &amp;&copy; &#233;&#x1F600; ";
    const count = Math.floor(65536 / unit.length);
    const expected = "a < b &© é\u{1f600} ".repeat(count);
    expect(await decode(unit.repeat(count))).toBe(expected);
  });

  test("text without an ampersand is returned as is", async () => {
    expect(await decode("plain text")).toBe("plain text");
  });
});
