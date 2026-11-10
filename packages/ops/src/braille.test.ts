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
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

// braille is FL (vocab/braille.fth); these tests drive its public words through the runtime.
const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["braille"]));

function top(r: { stack: readonly unknown[] }): { v: unknown } {
  return r.stack[r.stack.length - 1] as { v: unknown };
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe("braille round trip", () => {
  test("every byte value maps to U+2800 + byte and back", async () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    const enc = await runtime.call("braille:encode", [bytes(all)]);
    expect(enc.ok).toBe(true);
    const text = top(enc).v as string;
    expect([...text].map((c) => (c.codePointAt(0) as number) - 0x2800)).toEqual([...all]);
    const dec = await runtime.call("braille:decode", [str(text)]);
    expect(top(dec).v).toEqual(all);
  });

  test("decode(encode(x)) == x for random bytes", async () => {
    const next = rng(5);
    for (let trial = 0; trial < 60; trial++) {
      const data = Uint8Array.from({ length: Math.floor(next() * 50) }, () =>
        Math.floor(next() * 256),
      );
      const enc = await runtime.call("braille:encode", [bytes(data)]);
      const dec = await runtime.call("braille:decode", [str(top(enc).v as string)]);
      expect(top(dec).v).toEqual(data);
    }
  });

  test("64 KiB round trip", async () => {
    const data = Uint8Array.from({ length: 65536 }, (_, i) => (i * 2654435761) >>> 24);
    const enc = await runtime.call("braille:encode", [bytes(data)]);
    const dec = await runtime.call("braille:decode", [str(top(enc).v as string)]);
    expect(top(dec).v).toEqual(data);
  }, 60_000);
});

describe("braille:decode errors", () => {
  test("a character outside U+2800 to U+28FF is E_COERCE", async () => {
    const r = await runtime.call("braille:decode", [str("⠁x")]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_COERCE");
  });

  test("the blank pattern U+2800 is byte 0, not white space", async () => {
    const r = await runtime.call("braille:decode", [str("⠀ ⠀")]);
    expect(top(r).v).toEqual(Uint8Array.from([0, 0]));
  });
});

describe("module", () => {
  test("both words have a doc string and the Encodings category", () => {
    for (const w of ["braille:encode", "braille:decode"]) {
      const meta = runtime.meta(w);
      expect(meta.doc).toBeTruthy();
      expect(meta.category).toBe("Encodings");
    }
  });
});
