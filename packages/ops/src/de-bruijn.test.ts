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
 * Tests for the `de-bruijn` vocabulary (vocab/de-bruijn.fth): the known small sequences, the defining property (every
 * word of length n appears exactly once in the cyclic sequence) over many (k, n), the equality with an independent
 * implementation of the recursive FKM algorithm, and the limits.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { buildCatalogue } from "./catalogue.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int } = valueHelpers;
const bundle = await loadBundleNode(["de-bruijn"]);
const runtime = assembleRuntime(bundle);

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const top = (r: Result) => (r.ok ? (r.stack[r.stack.length - 1] as { v: unknown }).v : undefined);
const gen = (k: number, n: number) =>
  runtime.call("de-bruijn:generate", [bytes(new Uint8Array(0)), int(k), int(n)]);

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

/** The recursive FKM algorithm of the literature, written independently of the FL (arrays, recursion). */
function reference(k: number, n: number): string {
  const a = new Array<number>(k * n).fill(0);
  const seq: number[] = [];
  const db = (t: number, p: number): void => {
    if (t > n) {
      if (n % p === 0) for (let i = 1; i <= p; i++) seq.push(a[i]!);
    } else {
      a[t] = a[t - p]!;
      db(t + 1, p);
      for (let j = a[t - p]! + 1; j < k; j++) {
        a[t] = j;
        db(t + 1, t);
      }
    }
  };
  db(1, 1);
  return seq.map((d) => DIGITS[d]).join("");
}

describe("catalogue", () => {
  test("de-bruijn:generate is a Generators op without effects", () => {
    const cat = buildCatalogue(assembleRuntime(bundle));
    const op = cat.ops.find((o) => o.qname === "de-bruijn:generate");
    expect(op?.category).toBe("Generators");
    expect(op?.effects ?? []).toEqual([]);
  });
});

describe("known sequences", () => {
  test.each([
    [2, 1, "01"],
    [2, 2, "0011"],
    [2, 3, "00010111"],
    [2, 4, "0000100110101111"],
    [3, 2, "001021122"],
    [4, 1, "0123"],
    [10, 1, "0123456789"],
    [12, 1, "0123456789ab"],
    [36, 1, DIGITS],
    [2, 5, "00000100011001010011101011011111"],
  ])("B(%i, %i) = %s", async (k, n, expected) => {
    expect(top(await gen(k, n))).toBe(expected);
  });
});

describe("the defining property", () => {
  const cases: [number, number][] = [];
  for (let k = 2; k <= 6; k++) for (let n = 1; n <= 5; n++) if (k ** n <= 8000) cases.push([k, n]);
  cases.push([2, 16], [4, 8], [16, 4], [36, 2], [7, 3], [16, 3], [3, 10]);

  test.each(cases)(
    "B(%i, %i) has every word once, cyclically, and equals the reference",
    async (k, n) => {
      const s = top(await gen(k, n)) as string;
      expect(s).toHaveLength(k ** n);
      const cyc = s + s.slice(0, n - 1);
      const seen = new Set<string>();
      for (let i = 0; i < s.length; i++) seen.add(cyc.slice(i, i + n));
      expect(seen.size).toBe(k ** n);
      expect(s).toBe(reference(k, n));
    },
  );
});

describe("limits", () => {
  test("the largest size, 65,536 symbols, is accepted within the step limit", async () => {
    const r = await gen(2, 16);
    expect(code(r)).toBe("ok");
    expect((top(r) as string).length).toBe(65536);
  });

  test.each([
    [2, 17],
    [3, 11],
    [36, 4],
  ])("B(%i, %i) is out of range", async (k, n) => {
    expect(["E_RANGE", "E_PARAM_INVALID"]).toContain(code(await gen(k, n)));
  });

  test.each([
    [1, 3],
    [37, 1],
    [2, 0],
  ])("k = %i, n = %i is refused", async (k, n) => {
    expect(["E_RANGE", "E_PARAM_INVALID"]).toContain(code(await gen(k, n)));
  });
});
