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

// bytes-slice is FL (vocab/bytes-slice.fth); these tests drive its public words through the runtime.
const { bool, bytes, int } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["bytes-slice", "raise"]));

function top(r: { stack: readonly Value[] }): { v: unknown } {
  return r.stack[r.stack.length - 1] as { v: unknown };
}
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s >>> 24;
  };
}
const data = (n: number, seed = 1) => {
  const next = rng(seed);
  return Uint8Array.from({ length: n }, next);
};
const call = (w: string, d: Uint8Array, a: number, b: number, lines = false) =>
  runtime.call(`bytes-slice:${w}`, [bytes(d), int(a), int(b), bool(lines)]);

describe("bytes-slice", () => {
  test("take and remove agree with slice for every start and length", async () => {
    const d = data(12);
    for (let start = 0; start <= 14; start++) {
      for (let length = 0; length <= 14; length++) {
        expect(top(await call("take", d, start, length)).v).toEqual(d.slice(start, start + length));
        const removed = Uint8Array.from([...d.slice(0, start), ...d.slice(start + length)]);
        expect(top(await call("remove", d, start, length)).v).toEqual(removed);
      }
    }
  });

  test("take-nth and remove-nth agree with an index filter", async () => {
    const d = data(40, 2);
    for (let n = 1; n <= 7; n++) {
      for (const start of [0, 1, 5, 39, 40, 50]) {
        const kept = (i: number) => i >= start && (i - start) % n === 0;
        expect(top(await call("take-nth", d, n, start)).v).toEqual(d.filter((_, i) => kept(i)));
        expect(top(await call("remove-nth", d, n, start)).v).toEqual(d.filter((_, i) => !kept(i)));
      }
    }
  });

  test("each-line applies the operation to every line and keeps the line feeds", async () => {
    const lines = [
      data(9, 4).map((b) => (b === 10 ? 11 : b)),
      data(0),
      data(5, 6).map((b) => (b === 10 ? 11 : b)),
    ];
    const joined = Uint8Array.from(lines.flatMap((l, i) => (i === 0 ? [...l] : [10, ...l])));
    const perLine = (f: (l: Uint8Array) => Uint8Array) =>
      Uint8Array.from(lines.flatMap((l, i) => (i === 0 ? [...f(l)] : [10, ...f(l)])));
    expect(top(await call("take", joined, 2, 3, true)).v).toEqual(perLine((l) => l.slice(2, 5)));
    expect(top(await call("take-nth", joined, 3, 1, true)).v).toEqual(
      perLine((l) => l.filter((_, i) => i >= 1 && (i - 1) % 3 === 0)),
    );
    expect(top(await call("remove-nth", joined, 2, 0, true)).v).toEqual(
      perLine((l) => l.filter((_, i) => i % 2 === 1)),
    );
  });

  test("64 KiB inside the default step limit", async () => {
    const d = data(65_536, 8);
    for (const w of ["take-nth", "remove-nth"]) {
      const r = await call(w, d, 3, 1);
      expect(r.ok).toBe(true);
    }
    expect((await call("take", d, 100, 30_000)).steps).toBeLessThan(100);
  });

  test("n of 0 is refused", async () => {
    const r = await call("take-nth", data(4), 0, 0);
    expect(r.ok).toBe(false);
  });
});
