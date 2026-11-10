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

// charcode is FL (vocab/charcode.fth); these tests drive its public words through the runtime.
const { int, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["charcode"]));

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

/** A random string of scalar values: BMP (no surrogates), astral, and ASCII. */
function randomText(next: () => number, count: number): string {
  let out = "";
  for (let i = 0; i < count; i++) {
    const pick = next();
    let cp: number;
    if (pick < 0.4) cp = Math.floor(next() * 0x7f);
    else if (pick < 0.8) cp = Math.floor(next() * (0xd800 - 0x80)) + 0x80;
    else cp = 0x10000 + Math.floor(next() * (0x10ffff - 0x10000 + 1));
    out += String.fromCodePoint(cp);
  }
  return out;
}

describe("charcode round trip", () => {
  test("decode(encode(x)) == x for random code points, bases and delimiters", async () => {
    const next = rng(2024);
    const delimiters = ["space", "comma", "newline"];
    for (let trial = 0; trial < 60; trial++) {
      const text = randomText(next, Math.floor(next() * 30));
      const base = 2 + Math.floor(next() * 35);
      const delimiter = delimiters[trial % delimiters.length] as string;
      const encoded = await runtime.call("charcode:encode", [str(text), int(base), str(delimiter)]);
      expect(encoded.ok).toBe(true);
      const decoded = await runtime.call("charcode:decode", [
        str(top(encoded).v as string),
        int(base),
      ]);
      expect(decoded.ok).toBe(true);
      expect(top(decoded).v).toBe(text);
    }
  });
});
