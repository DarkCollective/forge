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
 * Tests for the shared `list` vocabulary (vocab/list.fth, src/prims/list.ts): `list:sort`, `list:sort-by` and
 * `list:shuffle`, and how fast they are on 65,536 elements with the default limits.
 */
import { valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { afterEach, describe, expect, test, vi } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { int, str, num, bytes, list } = valueHelpers;
const bundle = await loadBundleNode(["list"]);
const runtime = assembleRuntime(bundle);
runtime.load(`IN: probe
USING: list ;
: by-length ( items:list -- list ) items items [ len ] map list:sort-by ;
: by-lower ( items:list -- list ) items items [ lower ] map list:sort-by ;
`);

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const top = (r: Result) => (r.ok ? (r.stack[r.stack.length - 1] as { v: unknown }).v : undefined);
const ints = (...n: (number | bigint)[]) => list(n.map((x) => int(x)));
const strs = (...s: string[]) => list(s.map((x) => str(x)));
const plain = (v: unknown) => (v as Value[]).map((x) => x.v);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("list:sort", () => {
  test("ints numerically, including negatives and big integers", async () => {
    const big = 2n ** 80n;
    const r = await runtime.call("list:sort", [ints(10, 9, -3, big, 0, -big, 2)]);
    expect(plain(top(r))).toEqual([-big, -3, 0, 2, 9, 10, big]);
  });

  test("ints and nums compare as numbers", async () => {
    const r = await runtime.call("list:sort", [list([int(3), num(2.5), int(-1), num(3.5)])]);
    expect(plain(top(r))).toEqual([-1, 2.5, 3, 3.5]);
  });

  test("strings by code point, not by UTF-16 code unit", async () => {
    // U+FF5E (one code unit, 0xFF5E) sorts below U+1F600 (surrogates 0xD83D 0xDE00) by code point, above by code unit
    const r = await runtime.call("list:sort", [strs("\u{1F600}", "～", "b", "B", "a", "", "ab")]);
    expect(plain(top(r))).toEqual(["", "B", "a", "ab", "b", "～", "\u{1F600}"]);
  });

  test("it is stable", async () => {
    // equal keys keep their order: sort-by on equal keys leaves the items as they are
    const items = strs("c", "a", "b", "d");
    const r = await runtime.call("list:sort-by", [items, ints(1, 1, 1, 1)]);
    expect(plain(top(r))).toEqual(["c", "a", "b", "d"]);
  });

  test("an empty list and a one-element list", async () => {
    expect(plain(top(await runtime.call("list:sort", [list([])])))).toEqual([]);
    expect(plain(top(await runtime.call("list:sort", [strs("x")])))).toEqual(["x"]);
  });

  test("the input list is not changed", async () => {
    const input = ints(3, 1, 2);
    await runtime.call("list:sort", [input]);
    expect(plain(input.v)).toEqual([3, 1, 2]);
  });

  test("mixed numbers and strings are E_COERCE", async () => {
    expect(code(await runtime.call("list:sort", [list([int(1), str("a")])]))).toBe("E_COERCE");
  });

  test("other values are E_COERCE", async () => {
    expect(code(await runtime.call("list:sort", [list([bytes(Uint8Array.of(1))])]))).toBe(
      "E_COERCE",
    );
    expect(code(await runtime.call("list:sort", [list([list([])])]))).toBe("E_COERCE");
  });

  test("sorting 65,536 short strings is well within the default limits", async () => {
    const n = 65536;
    const items = list(
      Array.from({ length: n }, (_, i) => str(((i * 2654435761) >>> 0).toString(36))),
    );
    const t0 = Date.now();
    const r = await runtime.call("list:sort", [items]);
    const ms = Date.now() - t0;
    const out = plain(top(r)) as string[];
    expect(out.length).toBe(n);
    for (let i = 1; i < n; i++) expect((out[i - 1] as string) <= (out[i] as string)).toBe(true);
    expect(ms).toBeLessThan(2000);
  });
});

describe("list:sort-by", () => {
  test("items follow the order of their keys", async () => {
    const r = await runtime.call("list:sort-by", [strs("c", "a", "b"), ints(3, 1, 2)]);
    expect(plain(top(r))).toEqual(["a", "b", "c"]);
  });

  test("keys may be strings, the items anything", async () => {
    const r = await runtime.call("list:sort-by", [ints(1, 2, 3), strs("z", "a", "m")]);
    expect(plain(top(r))).toEqual([2, 3, 1]);
  });

  test("by length with map", async () => {
    const r = await runtime.call("probe:by-length", [strs("ccc", "a", "bb", "d", "eee")]);
    expect(plain(top(r))).toEqual(["a", "d", "bb", "ccc", "eee"]);
  });

  test("case-insensitive with map", async () => {
    const r = await runtime.call("probe:by-lower", [strs("b", "A", "a", "B")]);
    expect(plain(top(r))).toEqual(["A", "a", "b", "B"]);
  });

  test("different lengths are E_RANGE", async () => {
    expect(code(await runtime.call("list:sort-by", [strs("a", "b"), ints(1)]))).toBe("E_RANGE");
  });

  test("keys that mix numbers and strings are E_COERCE", async () => {
    const r = await runtime.call("list:sort-by", [strs("a", "b"), list([int(1), str("x")])]);
    expect(code(r)).toBe("E_COERCE");
  });

  test("65,536 items by 65,536 keys", async () => {
    const n = 65536;
    const keys = list(Array.from({ length: n }, (_, i) => int((i * 40503) % 65537)));
    const items = list(Array.from({ length: n }, (_, i) => int(i)));
    const r = await runtime.call("list:sort-by", [items, keys]);
    const out = plain(top(r)) as number[];
    for (let i = 1; i < n; i++) {
      expect(((out[i - 1] as number) * 40503) % 65537).toBeLessThanOrEqual(
        ((out[i] as number) * 40503) % 65537,
      );
    }
  });
});

describe("list:shuffle", () => {
  test("it is a permutation", async () => {
    const r = await runtime.call("list:shuffle", [
      ints(...Array.from({ length: 100 }, (_, i) => i)),
    ]);
    const out = plain(top(r)) as number[];
    expect([...out].sort((a, b) => a - b)).toEqual(Array.from({ length: 100 }, (_, i) => i));
    expect(out).not.toEqual(Array.from({ length: 100 }, (_, i) => i));
  });

  test("empty and one-element lists need no randomness", async () => {
    vi.stubGlobal("crypto", undefined);
    expect(plain(top(await runtime.call("list:shuffle", [list([])])))).toEqual([]);
    expect(plain(top(await runtime.call("list:shuffle", [strs("only")])))).toEqual(["only"]);
  });

  test("it carries the +random effect", () => {
    expect(runtime.meta("list:shuffle").effects).toContain("+random");
  });

  test("a host with no random source is E_PRIMITIVE", async () => {
    vi.stubGlobal("crypto", undefined);
    expect(code(await runtime.call("list:shuffle", [ints(1, 2, 3)]))).toBe("E_PRIMITIVE");
  });

  test("every permutation of 3 comes out about equally often", async () => {
    const counts = new Map<string, number>();
    const draws = 6000;
    for (let i = 0; i < draws; i++) {
      const k = (plain(top(await runtime.call("list:shuffle", [ints(0, 1, 2)]))) as number[]).join(
        "",
      );
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    const expected = draws / 6;
    const chi = [...counts.values()].reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
    expect(chi).toBeLessThan(25);
  });

  test("a pinned source gives the Fisher-Yates result", async () => {
    // i = 2: bound 3 (2 bits) takes 0x01 -> j = 1; i = 1: bound 2 (1 bit) takes 0x00 -> j = 0.
    // [a,b,c] -> swap(2,1) = [a,c,b] -> swap(1,0) = [c,a,b]
    const seq = [[0x01], [0x00]];
    let i = 0;
    vi.stubGlobal("crypto", {
      getRandomValues: (a: Uint8Array) => {
        a.set(seq[i++] as number[]);
        return a;
      },
    });
    expect(plain(top(await runtime.call("list:shuffle", [strs("a", "b", "c")])))).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  test("shuffling 65,536 elements is within the default limits", async () => {
    const n = 65536;
    const t0 = Date.now();
    const r = await runtime.call("list:shuffle", [
      list(Array.from({ length: n }, (_, i) => int(i))),
    ]);
    expect((top(r) as Value[]).length).toBe(n);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
