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
