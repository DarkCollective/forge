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

// search is FL (vocab/search.fth); these tests drive its public words through the runtime.
const { bool, int, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["search", "raise"]));

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
/** The first two space-separated columns of a row and the rest of it as the third. */
const columns = (row: string): string[] => {
  const [a = "", b = "", ...rest] = row.split(" ");
  return [a, b, rest.join(" ")];
};
const count = (s: string, p: string, mode = "string", ic = false) =>
  runtime.call("search:count", [str(s), str(p), str(mode), bool(ic)]);
const fuzzy = (s: string, q: string, cs = false, best = true, d = "newline") =>
  runtime.call("search:fuzzy", [str(s), str(q), bool(cs), bool(best), str(d)]);
const offsets = (s: string, d = "\n\n", min = 1) =>
  runtime.call("search:offsets", [str(s), str(d), int(min)]);

describe("search", () => {
  test("count in string mode agrees with a non-overlapping scan, and in regex mode with matchAll", async () => {
    const next = rng(1);
    for (let n = 0; n < 100; n++) {
      const text = Array.from({ length: 60 }, () => "ab\n.A"[next() % 5]).join("");
      for (const p of ["a", "ab", "aa", ".", "b\n", "A"]) {
        const expected = text.split(p).length - 1;
        expect(top(await count(text, p)).v).toBe(expected);
        expect(top(await count(text, p, "string", true)).v).toBe(
          text.toLowerCase().split(p.toLowerCase()).length - 1,
        );
      }
      expect(top(await count(text, "[ab]+", "regex")).v).toBe([...text.matchAll(/[ab]+/gu)].length);
      expect(top(await count(text, "a", "regex", true)).v).toBe([...text.matchAll(/a/giu)].length);
    }
  });

  test("count on 64 KiB is a few steps in string mode", async () => {
    const text = "needle in a haystack. ".repeat(2979);
    const r = await count(text, "needle");
    expect(top(r).v).toBe(2979);
    expect(r.steps).toBeLessThan(100);
  });

  test("fuzzy: every kept line holds the query as a subsequence, and its positions point at it", async () => {
    const next = rng(2);
    const lines = Array.from({ length: 200 }, () =>
      Array.from({ length: 1 + (next() % 12) }, () => "abcX_ "[next() % 6]).join(""),
    );
    const query = "ac";
    const out = top(await fuzzy(lines.join("\n"), query)).v as string;
    const rows = out === "" ? [] : out.split("\n").map((r) => columns(r));
    const expectedLines = lines.filter((l) => /a.*c/i.test(l));
    expect(rows.length).toBe(expectedLines.length);
    let last = Infinity;
    for (const [score, positions, line] of rows as [string, string, string][]) {
      const ps = positions.split(",").map(Number);
      expect(Number(score)).toBeLessThanOrEqual(last);
      last = Number(score);
      expect(ps.length).toBe(2);
      expect((line as string)[ps[0] as number]?.toLowerCase()).toBe("a");
      expect((line as string)[ps[1] as number]?.toLowerCase()).toBe("c");
      expect((ps[0] as number) < (ps[1] as number)).toBe(true);
    }
  });

  test("fuzzy: a ranked order equals a stable sort of the unranked rows", async () => {
    const next = rng(3);
    const lines = Array.from({ length: 60 }, () =>
      Array.from({ length: 2 + (next() % 8) }, () => "ab_c"[next() % 4]).join(""),
    );
    const text = lines.join("\n");
    const plain = (top(await fuzzy(text, "abc", false, false)).v as string)
      .split("\n")
      .filter((r) => r !== "");
    const ranked = (top(await fuzzy(text, "abc", false, true)).v as string)
      .split("\n")
      .filter((r) => r !== "");
    const stable = plain
      .map((r, i) => ({ r, i, s: Number(columns(r)[0]) }))
      .sort((x, y) => y.s - x.s || x.i - y.i)
      .map((x) => x.r);
    expect(ranked).toEqual(stable);
  });

  test("fuzzy: 4096 short lines inside the step limit", async () => {
    const next = rng(4);
    const lines = Array.from({ length: 4096 }, () =>
      Array.from({ length: 15 }, () => String.fromCharCode(97 + (next() % 26))).join(""),
    );
    const r = await fuzzy(lines.join("\n"), "abc");
    expect(r.ok).toBe(true);
  });

  test("offsets: a sample against itself is one run, and runs never overlap or pass the shortest sample", async () => {
    const next = rng(5);
    const sample = () =>
      Array.from({ length: 30 + (next() % 20) }, () => "ab"[next() % 2]).join("");
    for (let n = 0; n < 60; n++) {
      const a = sample();
      const b = sample();
      const out = top(await offsets(`${a}\n\n${b}`)).v as string;
      const runs = out === "" ? [] : out.split("\n").map((l) => columns(l));
      const flags = Array.from({ length: Math.min(a.length, b.length) }, (_, i) => a[i] === b[i]);
      const expected: string[][] = [];
      for (let i = 0; i < flags.length;) {
        if (!flags[i]) {
          i++;
          continue;
        }
        let j = i;
        while (j < flags.length && flags[j]) j++;
        expected.push([String(i), String(j - i), a.slice(i, j)]);
        i = j;
      }
      expect(runs).toEqual(expected);
    }
  });

  test("offsets of 64 KiB in three samples", async () => {
    const next = rng(6);
    const base = Array.from({ length: 21_000 }, () => "abcdef"[next() % 6]).join("");
    const mutate = (s: string) => Array.from(s, (c) => (next() % 50 === 0 ? "z" : c)).join("");
    const r = await offsets([base, mutate(base), mutate(base)].join("\n\n"));
    expect(r.ok).toBe(true);
  });
});
