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

// radix is FL (vocab/radix.fth); these tests compare it with JavaScript BigInt on random numbers.
const { int, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["radix"]));

function top(r: { stack: readonly Value[] }): { v: unknown } {
  return r.stack[r.stack.length - 1] as { v: unknown };
}
const convert = (s: string, from: number, to: number) =>
  runtime.call("radix:convert", [str(s), int(from), int(to)]);

describe("radix", () => {
  test("random numbers of up to 3000 bits agree with BigInt in every pair of bases", async () => {
    let seed = 99;
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
    for (let k = 0; k < 40; k++) {
      let n = 0n;
      for (let i = 0; i < 1 + (next() % 90); i++) n = (n << 32n) | BigInt(next());
      if (k % 3 === 0) n = -n;
      const from = 2 + (next() % 35);
      const to = 2 + (next() % 35);
      const r = await convert(n.toString(from), from, to);
      expect(r.ok).toBe(true);
      expect(top(r).v).toBe(n.toString(to));
    }
  });

  test("a number past the integer limit is E_LIMIT_VALUE", async () => {
    const r = await convert("f".repeat(20_000), 16, 10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_LIMIT_VALUE");
  });

  test("a bad digit is E_COERCE", async () => {
    for (const [s, from] of [
      ["12", 2],
      ["g", 16],
      ["", 10],
      ["-", 10],
      ["1-2", 10],
    ] as const) {
      const r = await convert(s, from, 10);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("E_COERCE");
    }
  });

  test("the word carries doc, category and parameter help", () => {
    const meta = runtime.meta("radix:convert");
    expect(meta.params.map((p) => p.doc).every((d) => d && d.length > 0)).toBe(true);
    expect(meta.category).toBe("Encodings");
  });
});
