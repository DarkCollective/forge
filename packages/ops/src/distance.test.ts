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
import { levenshtein, MAX_CELLS } from "./prims/distance.js";
import { loadBundleNode } from "./sources-node.js";

// distance is FL (vocab/distance.fth) over one primitive, distance:_levenshtein (src/prims/distance.ts).
const { int, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["distance", "raise"]));

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
const ham = (s: string, unit = "byte", format = "raw", d = "\n\n") =>
  runtime.call("distance:hamming", [str(s), str(d), str(unit), str(format)]);
const lev = (a: string, b: string, i = 1, d = 1, s = 1) =>
  runtime.call("distance:levenshtein", [str(`${a}\n${b}`), str("\n"), int(i), int(d), int(s)]);

// Independent reference: the memoised recursion on the definition of the weighted edit distance.
function reference(a: string[], b: string[], ins: number, del: number, sub: number): number {
  const memo = new Map<string, number>();
  const f = (i: number, j: number): number => {
    if (i === 0) return j * ins;
    if (j === 0) return i * del;
    const key = `${i},${j}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const v = Math.min(
      f(i - 1, j) + del,
      f(i, j - 1) + ins,
      f(i - 1, j - 1) + (a[i - 1] === b[j - 1] ? 0 : sub),
    );
    memo.set(key, v);
    return v;
  };
  return f(a.length, b.length);
}

describe("distance", () => {
  test("levenshtein agrees with the recursive definition on random strings and costs", async () => {
    const next = rng(5);
    const pool = ["a", "b", "c", "é", "😀"];
    const word = () =>
      Array.from({ length: next() % 9 }, () => pool[next() % pool.length] as string);
    for (let n = 0; n < 300; n++) {
      const a = word();
      const b = word();
      const [i, d, s] = [next() % 4, next() % 4, next() % 4];
      expect(levenshtein(a.join(""), b.join(""), i, d, s)).toBe(reference(a, b, i, d, s));
    }
    const r = await lev("sitting", "kitten", 1, 2, 3);
    expect(top(r).v).toBe(reference([..."sitting"], [..."kitten"], 1, 2, 3));
  });

  test("levenshtein with unit costs is a metric on random strings", () => {
    const next = rng(6);
    const word = () => Array.from({ length: next() % 7 }, () => "abc"[next() % 3]).join("");
    for (let n = 0; n < 200; n++) {
      const [x, y, z] = [word(), word(), word()];
      expect(levenshtein(x, y, 1, 1, 1)).toBe(levenshtein(y, x, 1, 1, 1));
      expect(levenshtein(x, z, 1, 1, 1)).toBeLessThanOrEqual(
        levenshtein(x, y, 1, 1, 1) + levenshtein(y, z, 1, 1, 1),
      );
      expect(levenshtein(x, x, 1, 1, 1)).toBe(0);
    }
  });

  test("levenshtein of two 5000-character samples is quick, and the cell limit is E_LIMIT_VALUE", async () => {
    const next = rng(7);
    const a = Array.from({ length: 5000 }, () => "acgt"[next() % 4]).join("");
    const b = Array.from({ length: 5000 }, () => "acgt"[next() % 4]).join("");
    const t0 = Date.now();
    const r = await lev(a, b);
    expect(r.ok).toBe(true);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.steps).toBeLessThan(200);
    expect(MAX_CELLS).toBe(100_000_000);
    const big = await lev("a".repeat(10_001), "b".repeat(10_000));
    expect(big.ok).toBe(false);
    expect(big.ok ? "ok" : big.error.code).toBe("E_LIMIT_VALUE");
  });

  test("hamming counts equal the definition on random bytes, in every unit", async () => {
    const next = rng(8);
    for (let n = 0; n < 40; n++) {
      const len = 1 + (next() % 30);
      const x = Uint8Array.from({ length: len }, () => next() & 255);
      const y = Uint8Array.from({ length: len }, () => (next() % 3 === 0 ? next() & 255 : 0));
      const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
      const bytesDiff = x.filter((v, i) => v !== y[i]).length;
      const bitsDiff = x.reduce(
        (acc, v, i) =>
          acc + [...((v ^ (y[i] as number)) >>> 0).toString(2)].filter((c) => c === "1").length,
        0,
      );
      expect(top(await ham(`${hex(x)}\n\n${hex(y)}`, "byte", "hex")).v).toBe(bytesDiff);
      expect(top(await ham(`${hex(x)}\n\n${hex(y)}`, "bit", "hex")).v).toBe(bitsDiff);
    }
  });

  test("hamming of two 32 KiB samples in each unit is inside the step limit", async () => {
    const next = rng(9);
    const a = Array.from({ length: 32_768 }, () => String.fromCharCode(97 + (next() % 26))).join(
      "",
    );
    const b = Array.from({ length: 32_768 }, () => String.fromCharCode(97 + (next() % 26))).join(
      "",
    );
    const expected = [...a].filter((c, i) => c !== b[i]).length;
    for (const unit of ["byte", "char"]) {
      const r = await ham(`${a}\n\n${b}`, unit);
      expect(top(r).v).toBe(expected);
    }
    const bits = await ham(`${a}\n\n${b}`, "bit");
    expect(bits.ok).toBe(true);
    expect(top(bits).v).toBeGreaterThanOrEqual(expected);
  });

  test("a delimiter that is a longer text and the empty delimiter", async () => {
    expect(top(await ham("abc--xbc", "byte", "raw", "--")).v).toBe(1);
    const r = await ham("abc", "byte", "raw", "");
    expect(r.ok).toBe(false);
  });
});
