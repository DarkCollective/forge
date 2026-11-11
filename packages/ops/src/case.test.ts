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

// case is FL (vocab/case.fth); these tests drive its public words through the runtime.
const { str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["case", "raise"]));

type Result = { ok: boolean; stack: readonly Value[]; steps?: number; error?: { code: string } };
function top(r: Result): { v: unknown } {
  return r.stack[r.stack.length - 1] as { v: unknown };
}
const swap = (s: string) => runtime.call("case:swap-case", [str(s)]);
const alt = (s: string, first = "lower") => runtime.call("case:alternating", [str(s), str(first)]);
const all = (s: string, d = "newline") => runtime.call("case:all-casings", [str(s), str(d)]);
const toI = (s: string) => runtime.call("case:to-insensitive-regex", [str(s)]);
const fromI = (s: string) => runtime.call("case:from-insensitive-regex", [str(s)]);

describe("case", () => {
  test("swap-case twice is the identity on text whose letters map one to one", async () => {
    const text = "Hello, World! ÀÉîõü 123 ΑΒΓ αβγ Привет 😀\n";
    expect(top(await swap(text)).v).toBe(
      Array.from(text)
        .map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()))
        .join(""),
    );
    const once = top(await swap(text)).v as string;
    expect(top(await swap(once)).v).toBe(text);
  });

  test("swap-case and alternating run on 64 KiB inside the step limit", async () => {
    const text = "Hello, World! ".repeat(4681);
    expect(text.length).toBeGreaterThan(65_000);
    const a = await swap(text);
    expect(a.ok).toBe(true);
    expect(top(a).v).toBe("hELLO, wORLD! ".repeat(4681));
    const b = await alt(text);
    expect(b.ok).toBe(true);
    expect((top(b).v as string).slice(0, 14)).toBe("hElLo, WoRlD! ");
  });

  test("alternating restarts at every call", async () => {
    expect(top(await alt("abc")).v).toBe("aBc");
    expect(top(await alt("abc")).v).toBe("aBc");
    expect(top(await alt("abc", "upper")).v).toBe("AbC");
  });

  test("all-casings has 2^k distinct lines, each equal to the input ignoring case", async () => {
    const text = "aB1cD";
    const lines = (top(await all(text)).v as string).split("\n");
    expect(lines.length).toBe(16);
    expect(new Set(lines).size).toBe(16);
    for (const l of lines) expect(l.toLowerCase()).toBe(text.toLowerCase());
    expect(lines[0]).toBe("ab1cd");
    expect(lines[15]).toBe("AB1CD");
  });

  test("all-casings numbers the combinations with the first letter as the lowest bit", async () => {
    const lines = (top(await all("abc")).v as string).split("\n");
    for (let i = 0; i < 8; i++) {
      const expected = ["a", "b", "c"]
        .map((c, j) => (((i >> j) & 1) === 1 ? c.toUpperCase() : c))
        .join("");
      expect(lines[i]).toBe(expected);
    }
  });

  test("all-casings: 12 letters is 4096 lines in the step limit, 13 is E_RANGE, none is refused", async () => {
    const twelve = await all("abcdefghijkl");
    expect(twelve.ok).toBe(true);
    expect((top(twelve).v as string).split("\n").length).toBe(4096);
    const twelveInText = await all("a1 b2-c3_d4.e5,f6;g7:h8/i9?j0!k#l");
    expect(twelveInText.ok).toBe(true);
    const thirteen = await all("abcdefghijklm");
    expect(thirteen.ok).toBe(false);
    expect(thirteen.ok ? "ok" : thirteen.error.code).toBe("E_RANGE");
    const none = await runtime.call("case:all-casings", [str("ab"), str("none")]);
    expect(none.ok).toBe(false);
  });

  test("to-insensitive-regex makes a pattern match without the i flag", async () => {
    const cases: [string, string[], string[]][] = [
      ["hello", ["hello", "HELLO", "HeLLo"], ["hell"]],
      ["^[a-f]+\\d{2}$", ["abc12", "ABC12", "aBf99"], ["abg12", "abc1"]],
      ["x[^abc]y", ["xdy", "xDy", "XDY"], ["xay", "xAy", "XBY"]],
      ["(?<w>ab)\\k<w>", ["abab", "ABAB"], ["abAB"]],
      ["\\x41\\u0042é", ["ABé", "ABÉ"], ["abé"]],
    ];
    for (const [pattern, yes, no] of cases) {
      const out = top(await toI(pattern)).v as string;
      const re = new RegExp(out, "u");
      for (const s of yes) expect(re.test(s), `${pattern} -> ${out} should match ${s}`).toBe(true);
      for (const s of no)
        expect(re.test(s), `${pattern} -> ${out} should not match ${s}`).toBe(false);
    }
  });

  test("to-insensitive-regex agrees with the i flag on random inputs", async () => {
    const pattern = "[a-c]x(foo|bar)+[^m-p]?q{1,2}";
    const out = top(await toI(pattern)).v as string;
    const plain = new RegExp(`^(?:${out})$`, "u");
    const flagged = new RegExp(`^(?:${pattern})$`, "iu");
    let seed = 9;
    const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 8;
    const pool = ["a", "B", "c", "x", "X", "foo", "BAR", "m", "Q", "q", "z", "F"];
    for (let i = 0; i < 3000; i++) {
      const s = Array.from({ length: 1 + (rnd() % 7) }, () => pool[rnd() % pool.length]).join("");
      expect(plain.test(s)).toBe(flagged.test(s));
    }
  });

  test("from-insensitive-regex undoes to-insensitive-regex", async () => {
    for (const p of [
      "hello World",
      "^a[b-d_]\\d+\\x41(?<n>x)\\k<n>$",
      "[^q]|\\p{Lu}+",
      "é[aeiou]",
      "",
    ]) {
      const there = top(await toI(p)).v as string;
      expect(top(await fromI(there)).v).toBe(p);
    }
  });

  test("the pattern words run on 20 KiB of pattern text", async () => {
    const p = "ab[c-f]\\d+(x|y)?".repeat(1300);
    const a = await toI(p);
    expect(a.ok).toBe(true);
    const b = await fromI(top(a).v as string);
    expect(top(b).v).toBe(p);
  });
});
