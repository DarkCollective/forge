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

/*
 * Tests for the `coords` primitives: a table of trigonometric and hyperbolic functions and atan2,
 * private helpers of the UTM projection and of the great-circle distance.
 */
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "../bundle.js";
import { loadBundleNode } from "../sources-node.js";
import { primitives } from "./coords.js";

const runtime = assembleRuntime(await loadBundleNode(["coords"]));
const byName = (n: string) => primitives.find((p) => p.name === n);

describe("coords._math and coords._atan2", () => {
  test("are the two private primitives", () => {
    expect(primitives.map((p) => `${p.vocab}:${p.name}`)).toEqual([
      "coords:_math",
      "coords:_atan2",
    ]);
  });

  test("_math applies the named function", () => {
    const f = byName("_math")?.fn as (x: number, name: string) => number;
    for (const name of [
      "sin",
      "cos",
      "tan",
      "asin",
      "atan",
      "sinh",
      "cosh",
      "asinh",
      "atanh",
    ] as const) {
      const x = name === "asin" || name === "atanh" ? 0.3 : 1.7;
      expect(f(x, name), name).toBe(Math[name](x));
    }
  });

  test("an unknown function name throws", () => {
    const f = byName("_math")?.fn as (x: number, name: string) => number;
    expect(() => f(1, "log")).toThrow();
  });

  test("_atan2 takes y first", () => {
    const f = byName("_atan2")?.fn as (y: number, x: number) => number;
    expect(f(1, 0)).toBe(Math.PI / 2);
    expect(f(0, -1)).toBe(Math.PI);
    expect(f(-1, -1)).toBe(Math.atan2(-1, -1));
  });

  test("a private word cannot be called from another vocabulary", async () => {
    const r = await runtime.run('1.0 "sin" coords:_math');
    expect(r.ok).toBe(false);
  });
});
