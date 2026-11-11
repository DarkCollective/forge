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

// alphabet is FL (vocab/alphabet.fth); these tests drive its public word through the runtime.
const { str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["alphabet", "raise"]));

type Result = { ok: boolean; stack: readonly Value[]; error?: { code: string } };
function top(r: Result): { v: unknown } {
  return r.stack[r.stack.length - 1] as { v: unknown };
}
const expand = (s: string, d = "comma") => runtime.call("alphabet:expand", [str(s), str(d)]);

describe("alphabet", () => {
  test("a range of any pair of characters is every code point between them", async () => {
    for (const [lo, hi] of [
      ["a", "z"],
      ["0", "9"],
      ["À", "ÿ"],
      ["Α", "Ω"],
      ["一", "丠"],
    ] as const) {
      const out = (top(await expand(`${lo}-${hi}`, "none")).v as string).split("");
      const expected: string[] = [];
      for (let c = lo.codePointAt(0) as number; c <= (hi.codePointAt(0) as number); c++) {
        expected.push(String.fromCodePoint(c));
      }
      expect(out).toEqual(expected);
    }
  });

  test("a range across the surrogates skips them", async () => {
    const out = top(await expand("퟿-", "comma")).v as string;
    expect(out).toBe("퟿,");
  });

  test("plain characters, ranges and escapes mix in order", async () => {
    expect(top(await expand("x a-c\\-\\\\ z-z")).v).toBe("x, ,a,b,c,-,\\, ,z");
  });

  test("a range of 65536 code points is accepted, one more is E_RANGE", async () => {
    const range = (lo: number, hi: number) =>
      `${String.fromCodePoint(lo)}-${String.fromCodePoint(hi)}`;
    const edge = await expand(range(0x4e00, 0x14dff), "none");
    expect(edge.ok).toBe(true);
    expect(Array.from(top(edge).v as string).length).toBe(65_536 - 2048);
    const over = await expand(range(0x4e00, 0x14e00), "none");
    expect(over.ok).toBe(false);
    expect(over.ok ? "ok" : over.error.code).toBe("E_RANGE");
  });
});
