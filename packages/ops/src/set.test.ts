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
 * Property tests for the `set` vocabulary (vocab/set.fth, no primitives): random sets against a JavaScript model,
 * the power set limits, and the size of input a recipe can hold. Fixed answers are in vocab/set.test.json.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["set"]));

let seed = 0x5e7;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const below = (n: number) => Math.floor(rand() * n);

async function call(word: string, ...args: string[]): Promise<string> {
  const r = await runtime.call(
    word,
    args.map((a) => str(a)),
  );
  if (!r.ok) return r.error.code;
  return (r.stack[r.stack.length - 1] as { v: string }).v;
}

const uniq = (xs: string[]) => [...new Set(xs)];
const randomSet = () => Array.from({ length: below(12) }, () => `k${below(15)}`);

describe("set operations against a JavaScript model", () => {
  test("union, intersection, difference and symmetric difference of two to four random sets", async () => {
    for (let round = 0; round < 60; round++) {
      const sets = Array.from({ length: 2 + below(3) }, randomSet);
      const text = sets.map((s) => s.join(",")).join("\n\n");
      const [first, ...rest] = sets.map(uniq) as [string[], ...string[][]];
      const union = uniq(sets.flat());
      const inter = rest.reduce((acc, s) => acc.filter((i) => s.includes(i)), first);
      const diff = rest.reduce((acc, s) => acc.filter((i) => !s.includes(i)), first);
      const sym = rest.reduce(
        (acc, s) => [...acc.filter((i) => !s.includes(i)), ...s.filter((i) => !acc.includes(i))],
        first,
      );
      expect(await call("set:union", text, "\n\n", ",")).toBe(union.join(","));
      expect(await call("set:intersection", text, "\n\n", ",")).toBe(inter.join(","));
      expect(await call("set:difference", text, "\n\n", ",")).toBe(diff.join(","));
      expect(await call("set:symmetric-difference", text, "\n\n", ",")).toBe(sym.join(","));
    }
  });

  test("with three sets the symmetric difference keeps the items in an odd number of sets", async () => {
    for (let round = 0; round < 30; round++) {
      const sets = Array.from({ length: 3 }, () => uniq(randomSet()));
      const text = sets.map((s) => s.join(",")).join("\n\n");
      const odd = uniq(sets.flat()).filter(
        (i) => sets.filter((s) => s.includes(i)).length % 2 === 1,
      );
      const got = (await call("set:symmetric-difference", text, "\n\n", ","))
        .split(",")
        .filter((x) => x !== "");
      expect([...got].sort()).toEqual([...odd].sort());
    }
  });

  test("cartesian product has |A| x |B| pairs in A-major order", async () => {
    for (let round = 0; round < 20; round++) {
      const a = uniq(randomSet());
      const b = uniq(randomSet());
      const want = a.flatMap((x) => b.map((y) => `(${x},${y})`));
      expect(
        await call("set:cartesian-product", `${a.join(",")}\n\n${b.join(",")}`, "\n\n", ","),
      ).toBe(want.join(","));
    }
  });
});

describe("power set", () => {
  test("2^n subsets, each distinct, the empty one first, in CyberChef's order, each followed by the delimiter", async () => {
    for (const n of [0, 1, 2, 5, 8]) {
      const items = Array.from({ length: n }, (_, i) => `i${i}`);
      const raw = await call("set:power-set", items.join(","), ",", "\n");
      if (n === 0) {
        expect(raw).toBe("");
        continue;
      }
      expect(raw.endsWith("\n")).toBe(true);
      const out = raw.slice(0, -1).split("\n");
      expect(out.length).toBe(2 ** n);
      expect(out[0]).toBe("");
      expect(new Set(out).size).toBe(2 ** n);
      // the binary counting order with the first item as the most significant bit, then a stable sort by length
      const model = Array.from({ length: 2 ** n }, (_, k) =>
        items.filter((_it, i) => (k >> (n - 1 - i)) & 1).join(","),
      );
      model.sort((a, b) => a.length - b.length);
      expect(out).toEqual(model);
    }
  });

  test("16 items (65,536 subsets) work; 17 distinct items are E_RANGE; duplicates are removed first", async () => {
    const sixteen = Array.from({ length: 16 }, (_, i) => String(i));
    const out = (await call("set:power-set", sixteen.join(","), ",", "\n")).split("\n");
    expect(out.length).toBe(65_537);
    expect(out[65_535]).toBe(sixteen.join(","));
    expect(out[65_536]).toBe("");
    expect(await call("set:power-set", [...sixteen, "16"].join(","), ",", "\n")).toBe("E_RANGE");
    expect(
      (await call("set:power-set", [...sixteen, ...sixteen].join(","), ",", "\n")).split("\n")
        .length,
    ).toBe(65_537);
  });
});

describe("size of the input", () => {
  test("two sets of 6,000 items (about 50 KB) run inside the default limits", async () => {
    const a = Array.from({ length: 6000 }, (_, i) => `item${i}`);
    const b = Array.from({ length: 6000 }, (_, i) => `item${i + 3000}`);
    const text = `${a.join(",")}\n\n${b.join(",")}`;
    expect((await call("set:union", text, "\n\n", ",")).split(",").length).toBe(9000);
    expect((await call("set:intersection", text, "\n\n", ",")).split(",").length).toBe(3000);
    expect((await call("set:difference", text, "\n\n", ",")).split(",").length).toBe(3000);
    expect((await call("set:symmetric-difference", text, "\n\n", ",")).split(",").length).toBe(
      6000,
    );
  });
});

describe("catalogue", () => {
  test("every word is in the Arithmetic category and none needs an effect", () => {
    for (const w of [
      "union",
      "intersection",
      "difference",
      "symmetric-difference",
      "cartesian-product",
      "power-set",
    ]) {
      const meta = runtime.meta(`set:${w}`);
      expect(meta.category).toBe("Arithmetic");
      expect(meta.effects).toEqual([]);
    }
  });
});
