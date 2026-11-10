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

// bech32 is FL (vocab/bech32.fth); the vectors are the BIP-173 and BIP-350 ones. These tests cover
// round trips, the size limits and the error codes.
const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["bech32", "raise"]));

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
const encode = (d: Uint8Array, hrp = "bc", variant = "bech32") =>
  runtime.call("bech32:encode", [bytes(d), str(hrp), str(variant)]);
const decode = (t: string, part = "data") =>
  runtime.call("bech32:decode", [bytes(ascii(t)), str(part)]);

describe("bech32", () => {
  test("random data of every length up to 50 round trips in both variants", async () => {
    const next = rng(21);
    for (let n = 0; n <= 50; n++) {
      const data = Uint8Array.from({ length: n }, next);
      for (const variant of ["bech32", "bech32m"]) {
        const enc = await encode(data, "tb", variant);
        expect(enc.ok).toBe(true);
        const coded = top(enc).v as string;
        expect(coded.length).toBe(2 + 1 + Math.ceil((n * 8) / 5) + 6);
        expect(top(await decode(coded)).v).toEqual(data);
        expect(top(await decode(coded.toUpperCase())).v).toEqual(data);
        expect(top(await decode(coded, "hrp")).v).toEqual(ascii("tb"));
      }
    }
  });

  test("the two variants give different checksums for the same data", async () => {
    const a = top(await encode(Uint8Array.of(1, 2, 3), "x", "bech32")).v as string;
    const b = top(await encode(Uint8Array.of(1, 2, 3), "x", "bech32m")).v as string;
    expect(a.slice(0, -6)).toBe(b.slice(0, -6));
    expect(a).not.toBe(b);
  });

  test("a single changed character is caught by the checksum", async () => {
    const coded = top(await encode(Uint8Array.from({ length: 20 }, rng(2)), "bc")).v as string;
    for (let i = 3; i < coded.length; i++) {
      const other = coded[i] === "q" ? "p" : "q";
      const r = await decode(coded.slice(0, i) + other + coded.slice(i + 1));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("E_COERCE");
    }
  });

  test("90 characters is the longest result", async () => {
    const hrp = "a".repeat(83);
    expect((await encode(new Uint8Array(0), hrp)).ok).toBe(true);
    const r = await encode(new Uint8Array(1), hrp);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_RANGE");
  });

  test("the words carry doc, category and parameter help", () => {
    const meta = runtime.meta("bech32:encode");
    expect(meta.params.map((p) => p.doc).every((d) => d && d.length > 0)).toBe(true);
    expect(meta.category).toBe("Encodings");
    expect(runtime.meta("bech32:decode").params.every((p) => p.doc && p.doc.length > 0)).toBe(true);
  });
});
