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
 * Tests for the diff primitive (src/prims/diff.ts): `_edits` gives a valid script (applying it to the first
 * sequence gives the second), a shortest one (as long as the optimum found by dynamic programming), and the
 * runs have the shape the FL side relies on.
 */
import { valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { primitives } from "./diff.js";

const { str } = valueHelpers;
const edits = primitives.find((p) => p.name === "_edits")!.fn as (
  a: Value[],
  b: Value[],
) => Value[];

type Run = [kind: number, a: number, b: number, len: number];
const run = (a: string[], b: string[]): Run[] =>
  edits(
    a.map((x) => str(x)),
    b.map((x) => str(x)),
  ).map((r) => (r.v as Value[]).map((x) => Number(x.v)) as Run);

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Length of a longest common subsequence, by dynamic programming. */
function lcs(a: string[], b: string[]): number {
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      cur[j] =
        a[i - 1] === b[j - 1]
          ? (prev[j - 1] as number) + 1
          : Math.max(prev[j] as number, cur[j - 1] as number);
    }
    prev = cur;
  }
  return prev[b.length] as number;
}

/** Applies a script to a, checking every run against both sequences; returns the result and the number of edits. */
function apply(a: string[], b: string[], runs: Run[]): { out: string[]; edits: number } {
  const out: string[] = [];
  let ai = 0;
  let bi = 0;
  let count = 0;
  let prevKind = -1;
  for (const [kind, ra, rb, len] of runs) {
    expect(len).toBeGreaterThan(0);
    expect([ra, rb]).toEqual([ai, bi]);
    if (kind === 0) {
      expect(prevKind).not.toBe(0);
      for (let k = 0; k < len; k++) {
        expect(a[ai + k]).toBe(b[bi + k]);
        out.push(a[ai + k] as string);
      }
      ai += len;
      bi += len;
    } else if (kind === 1) {
      expect(prevKind).not.toBe(1);
      expect(prevKind).not.toBe(2);
      ai += len;
      count += len;
    } else {
      for (let k = 0; k < len; k++) out.push(b[bi + k] as string);
      bi += len;
      count += len;
    }
    prevKind = kind;
  }
  expect([ai, bi]).toEqual([a.length, b.length]);
  return { out, edits: count };
}

describe("diff._edits", () => {
  test("small cases", () => {
    expect(run([], [])).toEqual([]);
    expect(run(["a"], ["a"])).toEqual([[0, 0, 0, 1]]);
    expect(run([], ["x", "y"])).toEqual([[2, 0, 0, 2]]);
    expect(run(["x", "y"], [])).toEqual([[1, 0, 0, 2]]);
    expect(run(["a", "b", "c"], ["a", "B", "c"])).toEqual([
      [0, 0, 0, 1],
      [1, 1, 1, 1],
      [2, 2, 1, 1],
      [0, 2, 2, 1],
    ]);
  });

  test("a deletion comes before the insertion in a block of changes", () => {
    expect(run(["a", "b"], ["c", "d", "e"])).toEqual([
      [1, 0, 0, 2],
      [2, 2, 0, 3],
    ]);
  });

  test("kitten and sitting", () => {
    const a = [..."kitten"];
    const b = [..."sitting"];
    const runs = run(a, b);
    expect(apply(a, b, runs).out).toEqual(b);
    expect(apply(a, b, runs).edits).toBe(5);
  });

  test("random sequences: a valid script of the shortest length", () => {
    const next = rng(12345);
    for (let round = 0; round < 400; round++) {
      const alpha = 1 + Math.floor(next() * 5);
      const make = () =>
        Array.from({ length: Math.floor(next() * 30) }, () => String(Math.floor(next() * alpha)));
      const a = make();
      const b = make();
      const { out, edits: n } = apply(a, b, run(a, b));
      expect(out).toEqual(b);
      expect(n).toBe(a.length + b.length - 2 * lcs(a, b));
    }
  });

  test("a long sequence with a few changes is quick and minimal", () => {
    const next = rng(99);
    const a = Array.from({ length: 20000 }, () => String(Math.floor(next() * 50)));
    const b = a.slice();
    for (let k = 0; k < 40; k++) b[Math.floor(next() * b.length)] = "x";
    b.splice(5000, 3);
    const t0 = Date.now();
    const runs = run(a, b);
    expect(Date.now() - t0).toBeLessThan(5000);
    const { out, edits: n } = apply(a, b, runs);
    expect(out).toEqual(b);
    expect(n).toBeLessThanOrEqual(43 * 2 + 3);
  });

  test("unrelated long sequences finish with a valid script", () => {
    const next = rng(7);
    const make = () => Array.from({ length: 12000 }, () => String(Math.floor(next() * 4)));
    const a = make();
    const b = make();
    const { out } = apply(a, b, run(a, b));
    expect(out).toEqual(b);
  });

  test("a key that is not a string is E_COERCE", () => {
    expect(() => edits([valueHelpers.int(1)], [str("a")])).toThrow(/strings/);
  });
});
