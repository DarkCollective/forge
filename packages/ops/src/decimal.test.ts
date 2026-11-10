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

// decimal is FL (vocab/decimal.fth); these tests drive its public words through the runtime.
const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["decimal"]));

/** The outputs under test are ASCII, so a char-code copy is the UTF-8 bytes. */
function ascii(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

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

describe("decimal round trip", () => {
  test("decode(encode(x)) == x for random bytes and every delimiter", async () => {
    const next = rng(777);
    for (let trial = 0; trial < 60; trial++) {
      const length = Math.floor(next() * 40);
      const data = Uint8Array.from({ length }, () => Math.floor(next() * 256));
      for (const delimiter of ["space", "comma", "newline"]) {
        const encoded = await runtime.call("decimal:encode", [bytes(data), str(delimiter)]);
        expect(encoded.ok).toBe(true);
        const text = top(encoded).v as string;
        const decoded = await runtime.call("decimal:decode", [bytes(ascii(text))]);
        expect(decoded.ok).toBe(true);
        expect(top(decoded).v).toEqual(data);
      }
    }
  });
});
