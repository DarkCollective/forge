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
import { valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

// string-escape is FL (vocab/string-escape.fth); these tests drive its public words through the runtime.
const { bool, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["string-escape", "raise"]));

type Result = { ok: boolean; stack: readonly Value[]; steps?: number; error?: { code: string } };
function top(r: Result): { v: unknown } {
  return r.stack[r.stack.length - 1] as { v: unknown };
}
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s >>> 8;
  };
}
const escape = (
  s: string,
  level = "special",
  quote = "single",
  json = false,
  es6 = true,
  upper = false,
) =>
  runtime.call("string-escape:escape", [
    str(s),
    str(level),
    str(quote),
    bool(json),
    bool(es6),
    bool(upper),
  ]);
const unescape = (s: string) => runtime.call("string-escape:unescape", [str(s)]);

// A text with every kind of character: ASCII, controls, quotes, BMP, astral.
function sample(seed: number, n: number): string {
  const next = rng(seed);
  const pool = [
    "a",
    "Z",
    "0",
    " ",
    "~",
    "\\",
    "'",
    '"',
    "`",
    "\n",
    "\t",
    "\u0000",
    "\u0001",
    "\u007f",
    "é",
    "€",
    " ",
    "\u{1f600}",
    "\u{10ffff}",
    "$",
    "{",
  ];
  return Array.from({ length: n }, () => pool[next() % pool.length]).join("");
}

describe("string-escape", () => {
  test("unescape inverts escape for every level, quote, json, es6 and case", async () => {
    const text = sample(1, 300);
    for (const level of ["special", "everything", "minimal"]) {
      for (const quote of ["single", "double", "backtick"]) {
        for (const json of [false, true]) {
          for (const es6 of [false, true]) {
            for (const upper of [false, true]) {
              const coded = top(await escape(text, level, quote, json, es6, upper)).v as string;
              expect(
                top(await unescape(coded)).v,
                `${level} ${quote} ${json} ${es6} ${upper}`,
              ).toBe(text);
            }
          }
        }
      }
    }
  });

  test("the output of escape at special and everything level is ASCII; json output parses as JSON", async () => {
    const text = sample(2, 200);
    for (const level of ["special", "everything"]) {
      const coded = top(await escape(text, level)).v as string;
      expect(/^[\x20-\x7e]*$/.test(coded)).toBe(true);
    }
    const jsonText = top(await escape(text, "special", "double", true)).v as string;
    expect(JSON.parse(`"${jsonText}"`)).toBe(text);
    const minimal = top(await escape(text, "minimal", "double", true)).v as string;
    expect(JSON.parse(`"${minimal}"`)).toBe(text);
  });

  test("a JavaScript string literal built from the output reads back the same text", async () => {
    const text = sample(3, 200);
    for (const [quote, q] of [
      ["single", "'"],
      ["double", '"'],
      ["backtick", "`"],
    ] as const) {
      const coded = top(await escape(text, "special", quote)).v as string;
      // a template literal also reads $ { as a substitution; the sample has no ${ pair after escaping a $ is not needed
      const safe = quote === "backtick" ? coded.replaceAll("${", "\\${") : coded;
      expect(new Function(`return ${q}${safe}${q}`)()).toBe(text);
    }
  });

  test("a unescape of any text with no backslash is the identity", async () => {
    const text = sample(4, 100).replaceAll("\\", "/");
    expect(top(await unescape(text)).v).toBe(text);
  });

  test("64 KiB of text round trips inside the default step limit", async () => {
    const text = 'Line one, "quoted"\n\tTabbed é€ \u{1f600} done.\n'.repeat(1800);
    expect(text.length).toBeGreaterThan(65_000);
    const e = await escape(text);
    expect(e.ok).toBe(true);
    const u = await unescape(top(e).v as string);
    expect(u.ok).toBe(true);
    expect(top(u).v).toBe(text);
  });

  test("a surrogate pair of two escapes is one character, a lone half is E_COERCE", async () => {
    expect(top(await unescape("\\ud83d\\ude00")).v).toBe("\u{1f600}");
    for (const bad of ["\\ud83d", "\\ude00", "\\ud83dx", "\\u{d800}", "\\u{110000}"]) {
      const r = await unescape(bad);
      expect(r.ok, bad).toBe(false);
      expect(r.error?.code).toBe("E_COERCE");
    }
  });
});
