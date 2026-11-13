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
 * Tests for the shared `random` vocabulary (vocab/random.fth, src/prims/random.ts): the host CSPRNG words
 * `random:bytes-of`, `random:below` and `random:between`. The output is random, so the tests check the
 * structure (length, range, spread), pin the source with a stub of `crypto.getRandomValues` to check the
 * rejection sampling exactly, and check that a host with no source is an error and never Math.random.
 */
import { valueHelpers } from "@forge/lang";
import { afterEach, describe, expect, test, vi } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { int } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["random"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const top = (r: Result) => (r.ok ? (r.stack[r.stack.length - 1] as { v: unknown }).v : undefined);

const below = (n: number | bigint) => runtime.call("random:below", [int(n)]);
const between = (lo: number | bigint, hi: number | bigint) =>
  runtime.call("random:between", [int(lo), int(hi)]);

/** A source that hands out the given bytes in order, one request after another, then repeats the last. */
function feed(...chunks: number[][]): void {
  let i = 0;
  vi.stubGlobal("crypto", {
    getRandomValues: (a: Uint8Array) => {
      a.set((chunks[Math.min(i++, chunks.length - 1)] as number[]).slice(0, a.length));
      return a;
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("random:bytes-of", () => {
  test.each([0, 1, 16, 32, 65535, 65536, 65537, 200000])("%i bytes", async (n) => {
    const r = await runtime.call("random:bytes-of", [int(n)]);
    expect((top(r) as Uint8Array).length).toBe(n);
  });

  test("the bytes are spread over the whole range and differ between calls", async () => {
    const a = top(await runtime.call("random:bytes-of", [int(65536)])) as Uint8Array;
    const b = top(await runtime.call("random:bytes-of", [int(65536)])) as Uint8Array;
    expect(new Set(a).size).toBe(256);
    expect(a).not.toEqual(b);
    const mean = a.reduce((s, x) => s + x, 0) / a.length;
    expect(mean).toBeGreaterThan(125);
    expect(mean).toBeLessThan(130);
  });

  test("a negative count is E_RANGE", async () => {
    expect(code(await runtime.call("random:bytes-of", [int(-1)]))).toBe("E_RANGE");
  });

  test("a count above the value limit is E_LIMIT_VALUE, before anything is allocated", async () => {
    expect(code(await runtime.call("random:bytes-of", [int(2 ** 40)]))).toBe("E_LIMIT_VALUE");
  });

  test("a host with no random source is E_PRIMITIVE, not a weak fallback", async () => {
    vi.stubGlobal("crypto", undefined);
    const spy = vi.spyOn(Math, "random");
    expect(code(await runtime.call("random:bytes-of", [int(8)]))).toBe("E_PRIMITIVE");
    expect(code(await below(10))).toBe("E_PRIMITIVE");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test("it reads the host source and Math.random is never called", async () => {
    const spy = vi.spyOn(Math, "random");
    feed([1, 2, 3, 4]);
    expect(top(await runtime.call("random:bytes-of", [int(4)]))).toEqual(Uint8Array.of(1, 2, 3, 4));
    await below(1000);
    await between(5, 50);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test("has the +random effect", () => {
    expect(runtime.meta("random:bytes-of").effects).toContain("+random");
    expect(runtime.meta("random:below").effects).toContain("+random");
    expect(runtime.meta("random:between").effects).toContain("+random");
  });
});

describe("random:below", () => {
  test("a bound of 1 is always 0 and draws nothing", async () => {
    vi.stubGlobal("crypto", undefined);
    expect(top(await below(1))).toBe(0);
  });

  test("a bound of 0 or less is E_RANGE", async () => {
    expect(code(await below(0))).toBe("E_RANGE");
    expect(code(await below(-5))).toBe("E_RANGE");
  });

  test("every value in [0, n) comes out, and nothing else", async () => {
    for (const n of [2, 3, 6, 7, 10, 255, 256, 257]) {
      const seen = new Set<number>();
      for (let i = 0; i < n * 40 && (seen.size < n || i < 200); i++) {
        const v = top(await below(n)) as number;
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(n);
        seen.add(v);
      }
      expect(seen.size).toBe(n);
    }
  });

  test("a bound of 6 is uniform (chi-squared far inside a one-in-a-million bound)", async () => {
    const counts = new Array<number>(6).fill(0);
    const draws = 12000;
    for (let i = 0; i < draws; i++) counts[top(await below(6)) as number]!++;
    const expected = draws / 6;
    const chi = counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
    // 5 degrees of freedom. P(chi-squared > 40) = 1.5e-7 for a fair source (the old bound of 25 had
    // 1.4e-4, about one run in 7,000).
    expect(chi).toBeLessThan(40);
  });

  test("rejection sampling: a draw at or above the bound is thrown away, not folded", async () => {
    // n = 6 needs 3 bits. The source gives 7 (rejected), then 6 (rejected), then 5, whatever the high bits say.
    feed([0xff, 0xff, 0xff, 0xff], [0xfe, 0xff, 0xff, 0xff], [0xfd, 0xff, 0xff, 0xff]);
    expect(top(await below(6))).toBe(5);
  });

  test("a source that never gives a usable value is E_PRIMITIVE, not a hang", async () => {
    feed([0xff, 0xff, 0xff, 0xff]);
    expect(code(await below(6))).toBe("E_PRIMITIVE");
  });

  test("big integers: in range, and the bound is not reached", async () => {
    const n = 2n ** 100n + 12345n;
    let high = false;
    for (let i = 0; i < 200; i++) {
      const v = top(await below(n)) as bigint;
      expect(typeof v).toBe("bigint");
      expect(v >= 0n && v < n).toBe(true);
      if (v >= 2n ** 99n) high = true;
    }
    expect(high).toBe(true);
  });

  test("a big bound with a small result is normalised to a number", async () => {
    feed([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3]);
    const v = top(await below(2n ** 100n));
    expect(v).toBe(3);
  });

  test("bounds above 2^32 use the wide path and stay in range", async () => {
    for (let i = 0; i < 100; i++) {
      const v = top(await below(2 ** 40 + 1)) as number;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 40 + 1);
    }
  });
});

describe("random:between", () => {
  test("a range of size one is that value", async () => {
    vi.stubGlobal("crypto", undefined);
    expect(top(await between(7, 7))).toBe(7);
    expect(top(await between(-3, -3))).toBe(-3);
  });

  test("both ends are included and nothing outside, negative ranges too", async () => {
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const v = top(await between(-2, 2)) as number;
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThanOrEqual(2);
      seen.add(v);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2]);
  });

  test("lo above hi is E_RANGE", async () => {
    expect(code(await between(5, 4))).toBe("E_RANGE");
  });

  test("big integer bounds", async () => {
    const lo = -(2n ** 80n);
    const hi = 2n ** 80n;
    for (let i = 0; i < 50; i++) {
      const v = top(await between(lo, hi)) as bigint;
      expect(v >= lo && v <= hi).toBe(true);
    }
  });
});
