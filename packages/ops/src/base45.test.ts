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

// base45 is FL (vocab/base45.fth); the conformance vectors cover the RFC 9285 examples. These tests
// cover round trips, the size of the work and the error codes.
const { bytes } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["base45", "raise"]));

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
const encode = (d: Uint8Array) => runtime.call("base45:encode", [bytes(d)]);
const decode = (t: string) => runtime.call("base45:decode", [bytes(ascii(t))]);

describe("base45", () => {
  test("random data of every small length round trips", async () => {
    const next = rng(5);
    for (let n = 0; n < 40; n++) {
      const data = Uint8Array.from({ length: n }, next);
      const coded = top(await encode(data)).v as string;
      expect(coded.length).toBe(Math.floor(n / 2) * 3 + (n % 2) * 2);
      expect(top(await decode(coded)).v).toEqual(data);
    }
  });

  test("65536 bytes round trip well inside the default limits", async () => {
    const data = Uint8Array.from({ length: 65536 }, rng(9));
    const enc = await encode(data);
    expect(enc.ok).toBe(true);
    const back = await decode(top(enc).v as string);
    expect(back.ok).toBe(true);
    expect(top(back).v).toEqual(data);
  }, 60_000);

  test("the largest pair ffff is GGW's neighbour FGW and the next value is rejected", async () => {
    expect(top(await encode(Uint8Array.of(255, 255))).v).toBe("FGW");
    const r = await decode("GGW");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_COERCE");
  });

  test("a decode failure is E_COERCE", async () => {
    for (const bad of ["A", "AAAA", "ZZ", "a", "AB\n"]) {
      const r = await decode(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("E_COERCE");
    }
  });

  test("the words carry doc, category and parameter help", () => {
    const meta = runtime.meta("base45:encode");
    expect(meta.params.map((p) => p.doc).every((d) => d && d.length > 0)).toBe(true);
    expect(meta.category).toBe("Encodings");
    expect(runtime.meta("base45:decode").doc).toBeTruthy();
  });
});
