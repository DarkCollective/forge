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

// The operations are FL (vocab/base32.fth); the conformance vectors cover the known answers. These
// tests cover round trips, the size of the work, and the one private primitive.
const { bytes, str, bool } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["base32", "raise"]));

function encode(data: Uint8Array, alphabet = "standard", padding = true) {
  return runtime.call("base32:encode", [bytes(data), str(alphabet), bool(padding)]);
}
function decode(text: string, alphabet = "standard") {
  const data = Uint8Array.from(text, (c) => c.charCodeAt(0));
  return runtime.call("base32:decode", [bytes(data), str(alphabet)]);
}
function top(r: { stack: readonly Value[] }): Value | undefined {
  return r.stack[r.stack.length - 1];
}

/** A small deterministic generator, so a failure is reproducible. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s >>> 24;
  };
}

describe("base32 round trips", () => {
  test("random data of every small length, both alphabets, with and without padding", async () => {
    const next = random(7);
    for (let n = 0; n < 60; n++) {
      const data = Uint8Array.from({ length: n }, next);
      for (const alphabet of ["standard", "hex"]) {
        for (const padding of [true, false]) {
          const coded = top(await encode(data, alphabet, padding)) as { v: string };
          expect(coded.v).toMatch(
            padding ? /^[A-Z2-7]*=*$|^[0-9A-V]*=*$/ : /^[A-Z2-7]*$|^[0-9A-V]*$/,
          );
          const back = await decode(coded.v, alphabet);
          expect(back.ok).toBe(true);
          expect((top(back) as { v: Uint8Array }).v).toEqual(data);
        }
      }
    }
  });

  test("64 KiB fits well inside the default limits", async () => {
    const next = random(11);
    const data = Uint8Array.from({ length: 65536 }, next);
    const enc = await encode(data);
    expect(enc.ok).toBe(true);
    expect(enc.steps).toBeLessThan(5_000_000);
    const back = await decode((top(enc) as { v: string }).v);
    expect(back.ok).toBe(true);
    expect(back.steps).toBeLessThan(5_000_000);
    expect((top(back) as { v: Uint8Array }).v).toEqual(data);
  });
});

describe("module", () => {
  test("a decode failure is E_COERCE with the reason from the helper", async () => {
    const r = await decode("MZ======");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("E_COERCE");
      expect(r.error.detail.from).toBe("str");
      expect(r.error.detail.to).toBe("bytes");
      expect(String(r.error.detail.reason)).toContain("non-zero bits");
    }
  });

  test("the words carry doc, category and parameter help", () => {
    const meta = runtime.meta("base32:encode");
    expect(meta.params.map((p) => p.doc).every((d) => d && d.length > 0)).toBe(true);
    expect(meta.category).toBe("Encodings");
    expect(runtime.meta("base32:decode").doc).toBeTruthy();
  });
});
