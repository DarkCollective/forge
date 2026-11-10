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
import { assembleRuntime } from "../bundle.js";
import { loadBundleNode } from "../sources-node.js";
import { primitives } from "./base85.js";

// The operations are FL (vocab/base85.fth); the conformance vectors cover the known answers. These
// tests cover round trips, the size of the work, and the private primitives.
const { bytes, str, bool } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["base85"]));

function encode(data: Uint8Array, variant = "ascii85", delimiters = false) {
  return runtime.call("base85:encode", [bytes(data), str(variant), bool(delimiters)]);
}
function decode(text: string, variant = "ascii85") {
  const data = Uint8Array.from(text, (c) => c.charCodeAt(0));
  return runtime.call("base85:decode", [bytes(data), str(variant)]);
}
function top(r: { stack: readonly Value[] }): Value | undefined {
  return r.stack[r.stack.length - 1];
}

/** A small deterministic generator, so a failure is reproducible. */
function random(seed: number, zeroEvery = 0): () => number {
  let s = seed >>> 0;
  let i = 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    i++;
    return zeroEvery > 0 && i % zeroEvery < 6 ? 0 : s >>> 24;
  };
}

describe("base85 round trips", () => {
  test("random data of every small length, with runs of zeros, in both variants", async () => {
    const next = random(5, 11);
    for (let n = 0; n < 50; n++) {
      const data = Uint8Array.from({ length: n }, next);
      for (const delimiters of [false, true]) {
        const coded = top(await encode(data, "ascii85", delimiters)) as { v: string };
        const back = await decode(coded.v);
        expect(back.ok).toBe(true);
        expect((top(back) as { v: Uint8Array }).v).toEqual(data);
      }
      if (n % 4 === 0) {
        const coded = top(await encode(data, "z85")) as { v: string };
        expect(coded.v).toHaveLength((n / 4) * 5);
        const back = await decode(coded.v, "z85");
        expect((top(back) as { v: Uint8Array }).v).toEqual(data);
      }
    }
  });

  test("64 KiB fits well inside the default limits", async () => {
    const data = Uint8Array.from({ length: 65536 }, random(13, 29));
    for (const variant of ["ascii85", "z85"]) {
      const enc = await encode(data, variant);
      expect(enc.ok).toBe(true);
      expect(enc.steps).toBeLessThan(5_000_000);
      const back = await decode((top(enc) as { v: string }).v, variant);
      expect(back.ok).toBe(true);
      expect(back.steps).toBeLessThan(5_000_000);
      expect((top(back) as { v: Uint8Array }).v).toEqual(data);
    }
  });
});

describe("errors", () => {
  test("a bad Z85 length is E_RANGE", async () => {
    const r = await encode(Uint8Array.of(1, 2, 3), "z85");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_RANGE");
  });

  test("a decode failure is E_COERCE with the reason from the helper", async () => {
    const r = await decode("9jqzo^");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("E_COERCE");
      expect(r.error.detail.from).toBe("str");
      expect(r.error.detail.to).toBe("bytes");
      expect(String(r.error.detail.reason)).toContain("z is only allowed");
    }
  });
});

describe("module", () => {
  test("has only the private error helpers; the operations are FL", () => {
    expect(primitives.map((p) => `${p.vocab}:${p.name}`)).toEqual([
      "base85:_coerce-fail",
      "base85:_range-fail",
    ]);
  });

  test("the words carry doc, category and parameter help", () => {
    const meta = runtime.meta("base85:encode");
    expect(meta.params.map((p) => p.doc).every((d) => d && d.length > 0)).toBe(true);
    expect(meta.category).toBe("Encodings");
    expect(runtime.meta("base85:decode").doc).toBeTruthy();
  });
});
