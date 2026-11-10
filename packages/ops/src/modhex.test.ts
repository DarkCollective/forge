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

// modhex is FL (vocab/modhex.fth); these tests drive its public words through the runtime.
const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["modhex", "raise"]));

const ALPHA = "cbdefghijklnrtuv";
function ascii(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
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
const encode = (d: Uint8Array, delimiter = "none") =>
  runtime.call("modhex:encode", [bytes(d), str(delimiter)]);
const decode = (t: string) => runtime.call("modhex:decode", [bytes(ascii(t))]);

describe("modhex", () => {
  test("encoding is hex with the digits renamed", async () => {
    const data = Uint8Array.from({ length: 300 }, rng(6));
    const hex = Array.from(data, (b) => b.toString(16).padStart(2, "0")).join("");
    const expected = [...hex].map((c) => ALPHA[parseInt(c, 16)]).join("");
    expect(top(await encode(data)).v).toBe(expected);
    expect(top(await decode(expected)).v).toEqual(data);
  });

  test("random data round trips with and without spaces", async () => {
    const next = rng(2);
    for (const delimiter of ["none", "space"]) {
      for (const n of [0, 1, 2, 31, 64]) {
        const data = Uint8Array.from({ length: n }, next);
        const coded = top(await encode(data, delimiter)).v as string;
        expect(top(await decode(coded)).v).toEqual(data);
      }
    }
  });

  test("65536 bytes round trip well inside the default limits", async () => {
    const data = Uint8Array.from({ length: 65536 }, rng(8));
    const enc = await encode(data);
    expect(enc.ok).toBe(true);
    const back = await decode(top(enc).v as string);
    expect(back.ok).toBe(true);
    expect(top(back).v).toEqual(data);
  }, 120_000);

  test("a decode failure is E_COERCE", async () => {
    for (const bad of ["ca", "cbd", "0f", "c-"]) {
      const r = await decode(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("E_COERCE");
    }
  });

  test("the words carry doc, category and parameter help", () => {
    const meta = runtime.meta("modhex:encode");
    expect(meta.params.map((p) => p.doc).every((d) => d && d.length > 0)).toBe(true);
    expect(meta.category).toBe("Encodings");
    expect(runtime.meta("modhex:decode").doc).toBeTruthy();
  });
});
