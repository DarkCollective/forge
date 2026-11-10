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

// base62 is FL (vocab/base62.fth); the vectors cover known answers. These tests cover round trips,
// the size of the work and the error codes.
const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["base62", "raise"]));

function ascii(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
function top(r: { stack: readonly Value[] }): { v: unknown } {
  return r.stack[r.stack.length - 1] as { v: unknown };
}
/** A deterministic generator; every `zeroEvery`th pair of values is zero so leading zeros occur. */
function rng(seed: number, zeroEvery = 0): () => number {
  let s = seed >>> 0;
  let i = 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    i++;
    return zeroEvery > 0 && i % zeroEvery < 2 ? 0 : s >>> 24;
  };
}
const encode = (d: Uint8Array, a = "standard") => runtime.call("base62:encode", [bytes(d), str(a)]);
const decode = (t: string, a = "standard") =>
  runtime.call("base62:decode", [bytes(ascii(t)), str(a)]);

describe("base62", () => {
  test("random data of every small length, with leading zeros, in both alphabets", async () => {
    const next = rng(3, 9);
    for (let n = 0; n < 45; n++) {
      const data = Uint8Array.from({ length: n }, next);
      for (const alphabet of ["standard", "inverted"]) {
        const coded = top(await encode(data, alphabet)).v as string;
        const back = await decode(coded, alphabet);
        expect(back.ok).toBe(true);
        expect(top(back).v).toEqual(data);
      }
    }
  });

  test("the alphabets differ only in the case order", async () => {
    const std = top(await encode(Uint8Array.of(0, 0xff, 0xee), "standard")).v as string;
    const inv = top(await encode(Uint8Array.of(0, 0xff, 0xee), "inverted")).v as string;
    const swap = (s: string) =>
      [...s]
        .map((c) => (/[A-Z]/.test(c) ? c.toLowerCase() : /[a-z]/.test(c) ? c.toUpperCase() : c))
        .join("");
    expect(inv).toBe(swap(std));
  });

  test("all-zero data is all first-alphabet characters", async () => {
    expect(top(await encode(new Uint8Array(40))).v).toBe("0".repeat(40));
    expect(top(await decode("0".repeat(40))).v).toEqual(new Uint8Array(40));
  });

  test("8000 bytes (near the integer limit) fit inside the default limits", async () => {
    const data = Uint8Array.from({ length: 8000 }, rng(17));
    data[0] = 1;
    const enc = await encode(data);
    expect(enc.ok).toBe(true);
    expect(enc.steps).toBeLessThan(5_000_000);
    const back = await decode(top(enc).v as string);
    expect(back.ok).toBe(true);
    expect(top(back).v).toEqual(data);
  }, 60_000);

  test("data past the integer limit is E_LIMIT_VALUE, not a hang", async () => {
    const r = await encode(new Uint8Array(9000).fill(255));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_LIMIT_VALUE");
  });

  test("a character outside the alphabet is E_COERCE", async () => {
    const r = await decode("ab-");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_COERCE");
  });

  test("the words carry doc, category and parameter help", () => {
    const meta = runtime.meta("base62:encode");
    expect(meta.params.map((p) => p.doc).every((d) => d && d.length > 0)).toBe(true);
    expect(meta.category).toBe("Encodings");
    expect(runtime.meta("base62:decode").doc).toBeTruthy();
  });
});
