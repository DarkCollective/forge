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
import { primitives } from "./base58.js";

// The operations are FL (vocab/base58.fth); the conformance vectors cover the known answers. These
// tests cover round trips, the size of the work, and the private primitive.
const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["base58"]));

function encode(data: Uint8Array, alphabet = "bitcoin") {
  return runtime.call("base58:encode", [bytes(data), str(alphabet)]);
}
function decode(text: string, alphabet = "bitcoin") {
  const data = Uint8Array.from(text, (c) => c.charCodeAt(0));
  return runtime.call("base58:decode", [bytes(data), str(alphabet)]);
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
    return zeroEvery > 0 && i % zeroEvery < 2 ? 0 : s >>> 24;
  };
}

describe("base58 round trips", () => {
  test("random data of every small length, with leading zeros, in all alphabets", async () => {
    const next = random(3, 9);
    for (let n = 0; n < 45; n++) {
      const data = Uint8Array.from({ length: n }, next);
      for (const alphabet of ["bitcoin", "flickr", "ripple"]) {
        const coded = top(await encode(data, alphabet)) as { v: string };
        const back = await decode(coded.v, alphabet);
        expect(back.ok).toBe(true);
        expect((top(back) as { v: Uint8Array }).v).toEqual(data);
      }
    }
  });

  test("all-zero data is all first-alphabet characters", async () => {
    const data = new Uint8Array(40);
    expect(top(await encode(data))).toEqual(str("1".repeat(40)));
    expect((top(await decode("1".repeat(40))) as { v: Uint8Array }).v).toEqual(data);
  });

  test("8000 bytes (near the integer limit) fits inside the default limits", async () => {
    const data = Uint8Array.from({ length: 8000 }, random(17));
    data[0] = 1;
    const enc = await encode(data);
    expect(enc.ok).toBe(true);
    expect(enc.steps).toBeLessThan(5_000_000);
    const back = await decode((top(enc) as { v: string }).v);
    expect(back.ok).toBe(true);
    expect(back.steps).toBeLessThan(5_000_000);
    expect((top(back) as { v: Uint8Array }).v).toEqual(data);
  });

  test("data past the integer limit is E_LIMIT_VALUE, not a hang", async () => {
    const r = await encode(new Uint8Array(9000).fill(255));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_LIMIT_VALUE");
  });
});

describe("module", () => {
  test("has only the private error helper; the operations are FL", () => {
    expect(primitives.map((p) => `${p.vocab}:${p.name}`)).toEqual(["base58:_coerce-fail"]);
  });

  test("a decode failure is E_COERCE with the reason from the helper", async () => {
    const r = await decode("2NEpo0");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("E_COERCE");
      expect(r.error.detail.from).toBe("str");
      expect(r.error.detail.to).toBe("bytes");
      expect(String(r.error.detail.reason)).toContain("alphabet");
    }
  });

  test("the words carry doc, category and parameter help", () => {
    const meta = runtime.meta("base58:encode");
    expect(meta.params.map((p) => p.doc).every((d) => d && d.length > 0)).toBe(true);
    expect(meta.category).toBe("Encodings");
    expect(runtime.meta("base58:decode").doc).toBeTruthy();
  });
});
