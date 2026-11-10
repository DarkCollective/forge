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

// morse is FL (vocab/morse.fth); these tests drive its public words through the runtime.
const { str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["morse"]));

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

/** Every character the Morse table has, as the decoder must return it. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,?'!/()&:;=+-_\"$@";

describe("morse round trip", () => {
  test("decode(encode(x)) == x for random words, both word separators", async () => {
    const next = rng(8080);
    for (let trial = 0; trial < 40; trial++) {
      const words: string[] = [];
      const wordCount = 1 + Math.floor(next() * 4);
      for (let w = 0; w < wordCount; w++) {
        let word = "";
        const length = 1 + Math.floor(next() * 6);
        for (let i = 0; i < length; i++) {
          word += ALPHABET.charAt(Math.floor(next() * ALPHABET.length));
        }
        words.push(word);
      }
      const text = words.join(" ");
      for (const separator of ["slash", "newline"]) {
        const encoded = await runtime.call("morse:encode", [str(text), str(separator)]);
        expect(encoded.ok).toBe(true);
        const decoded = await runtime.call("morse:decode", [str(top(encoded).v as string)]);
        expect(decoded.ok).toBe(true);
        expect(top(decoded).v).toBe(text);
      }
    }
  });

  test("lower-case letters encode like upper-case", async () => {
    const lower = await runtime.call("morse:encode", [str("abc xyz"), str("slash")]);
    const upper = await runtime.call("morse:encode", [str("ABC XYZ"), str("slash")]);
    expect(top(lower).v).toBe(top(upper).v);
  });
});
