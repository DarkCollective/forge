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

// base92 is FL (vocab/base92.fth); the vectors come from an independent port of the reference
// implementation. These tests cover round trips, the size of the work and the error codes.
const { bytes } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["base92", "raise"]));

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
const encode = (d: Uint8Array) => runtime.call("base92:encode", [bytes(d)]);
const decode = (t: string) => runtime.call("base92:decode", [bytes(ascii(t))]);

describe("base92", () => {
  test("random data of every length up to 80 round trips, with the length the scheme gives", async () => {
    const next = rng(11);
    for (let n = 1; n < 80; n++) {
      const data = Uint8Array.from({ length: n }, next);
      const coded = top(await encode(data)).v as string;
      const t = (n * 8) % 13;
      expect(coded.length).toBe(Math.floor((n * 8) / 13) * 2 + (t === 0 ? 0 : t < 7 ? 1 : 2));
      expect(/^[!#-_a-}]+$/.test(coded)).toBe(true);
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
  }, 120_000);

  test("a decode failure is E_COERCE", async () => {
    for (const bad of ['F"', "F`", "Fc~", "}}", "}", "~~", "éé"]) {
      const r = await decode(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("E_COERCE");
    }
  });

  test("the words carry doc, category and parameter help", () => {
    const meta = runtime.meta("base92:encode");
    expect(meta.params.map((p) => p.doc).every((d) => d && d.length > 0)).toBe(true);
    expect(meta.category).toBe("Encodings");
    expect(runtime.meta("base92:decode").doc).toBeTruthy();
  });
});
