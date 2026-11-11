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
 * Tests for the `prng` vocabulary (vocab/prng.fth): the structure of the random output (length, range, alphabet,
 * delimiter, spread), the catalogue entries, and that the words ignore their input. The deterministic vectors
 * (ranges of size one, errors) are in vocab/prng.test.json.
 */
import { valueHelpers } from "@forge/lang";
import { afterEach, describe, expect, test, vi } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { buildCatalogue } from "./catalogue.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int, str } = valueHelpers;
const bundle = await loadBundleNode(["prng"]);
const runtime = assembleRuntime(bundle);

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const top = (r: Result) => (r.ok ? (r.stack[r.stack.length - 1] as { v: unknown }).v : undefined);
const none = bytes(new Uint8Array(0));

const gen = async (
  min: number | bigint,
  max: number | bigint,
  count: number,
  delimiter = "newline",
) =>
  top(
    await runtime.call("prng:integers", [none, int(min), int(max), int(count), str(delimiter)]),
  ) as string;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("catalogue", () => {
  test("prng:bytes and prng:integers are catalogue ops with the Generators category, and the shared words are not", () => {
    const cat = buildCatalogue(runtime);
    const mine = cat.ops.filter((o) => o.vocab === "prng");
    expect(mine.map((o) => o.qname)).toEqual(["prng:bytes", "prng:integers"]);
    expect(mine.every((o) => o.category === "Generators")).toBe(true);
    expect(mine.every((o) => o.effects.includes("+random"))).toBe(true);
    expect(cat.ops.some((o) => ["random", "list", "util"].includes(o.vocab))).toBe(false);
  });
});

describe("prng:bytes", () => {
  test("the header default of the length is 32", () => {
    expect(runtime.meta("prng:bytes").params[0]?.default).toBeDefined();
  });

  test("32 bytes", async () => {
    const r = await runtime.call("prng:bytes", [none, int(32)]);
    expect((top(r) as Uint8Array).length).toBe(32);
  });

  test.each([0, 1, 5, 4096, 1048576])("%i bytes", async (n) => {
    const r = await runtime.call("prng:bytes", [none, int(n)]);
    expect((top(r) as Uint8Array).length).toBe(n);
  });

  test("the input is ignored", async () => {
    const r = await runtime.call("prng:bytes", [bytes(Uint8Array.of(1, 2, 3)), int(4)]);
    expect((top(r) as Uint8Array).length).toBe(4);
  });

  test("output is random: two calls differ and every byte value occurs", async () => {
    const a = top(await runtime.call("prng:bytes", [none, int(65536)])) as Uint8Array;
    const b = top(await runtime.call("prng:bytes", [none, int(65536)])) as Uint8Array;
    expect(a).not.toEqual(b);
    expect(new Set(a).size).toBe(256);
  });

  test("no random source is E_PRIMITIVE", async () => {
    vi.stubGlobal("crypto", undefined);
    expect(code(await runtime.call("prng:bytes", [none, int(8)]))).toBe("E_PRIMITIVE");
  });
});

describe("prng:integers", () => {
  test("one integer from 0 to 99", async () => {
    for (let i = 0; i < 100; i++) {
      const s = await gen(0, 99, 1);
      expect(s).toMatch(/^\d{1,2}$/);
    }
  });

  test("count, delimiter and range", async () => {
    const s = await gen(10, 20, 500, "comma");
    const parts = s.split(",").map(Number);
    expect(parts.length).toBe(500);
    expect(parts.every((n) => Number.isInteger(n) && n >= 10 && n <= 20)).toBe(true);
    expect(new Set(parts).size).toBe(11);
  });

  test("both ends are included, negative ranges work", async () => {
    const seen = new Set((await gen(-1, 1, 300)).split("\n"));
    expect([...seen].sort()).toEqual(["-1", "0", "1"]);
  });

  test("a die roll is uniform", async () => {
    const draws = 12000;
    const counts = new Array<number>(6).fill(0);
    for (const x of (await gen(1, 6, draws, "space")).split(" ")) counts[Number(x) - 1]!++;
    const expected = draws / 6;
    const chi = counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
    expect(chi).toBeLessThan(25);
  });

  test("65,536 integers fit the default limits", async () => {
    const s = await gen(0, 1_000_000, 65536, "newline");
    expect(s.split("\n").length).toBe(65536);
  });

  test("big integers", async () => {
    const lo = 2n ** 70n;
    const hi = 2n ** 70n + 1000n;
    const parts = (await gen(lo, hi, 50, "space")).split(" ").map(BigInt);
    expect(parts.length).toBe(50);
    expect(parts.every((n) => n >= lo && n <= hi)).toBe(true);
  });

  test("min above max is E_RANGE", async () => {
    const r = await runtime.call("prng:integers", [none, int(2), int(1), int(1), str("newline")]);
    expect(code(r)).toBe("E_RANGE");
  });

  test("a pinned source gives exact values", async () => {
    // [0, 9] needs 4 bits: 0x03 is 3, 0x0f is rejected, 0x1a is masked to 10 and rejected, then 0x08 is 8.
    const seq = [[0x03], [0x0f], [0x1a], [0x08]];
    let i = 0;
    vi.stubGlobal("crypto", {
      getRandomValues: (a: Uint8Array) => {
        a.set(seq[i++ % seq.length] as number[]);
        return a;
      },
    });
    expect(await gen(100, 109, 2, "comma")).toBe("103,108");
  });
});
