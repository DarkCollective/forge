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

// clean is FL (vocab/clean.fth); these tests drive its public words through the runtime.
const { bool, bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["clean", "raise"]));

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
const ws = (s: string, flags: boolean[]) =>
  runtime.call("clean:remove-whitespace", [str(s), ...flags.map((f) => bool(f))]);

describe("clean", () => {
  test("remove-whitespace agrees with a filter on random text for every option set", async () => {
    const next = rng(11);
    const pool = [" ", "\r", "\n", "\t", "\f", ".", "a", "b", "é", "😀"];
    const text = Array.from({ length: 400 }, () => pool[next() % pool.length]).join("");
    const chars = [" ", "\r", "\n", "\t", "\f", "."];
    for (let mask = 0; mask < 64; mask++) {
      const flags = chars.map((_, i) => ((mask >> i) & 1) === 1);
      const drop = chars.filter((_, i) => flags[i]);
      const expected = Array.from(text)
        .filter((c) => !drop.includes(c))
        .join("");
      expect(top(await ws(text, flags)).v).toBe(expected);
    }
  });

  test("remove-whitespace of 64 KiB is a handful of steps", async () => {
    const text = "ab \n\t".repeat(13_108);
    const r = await ws(text, [true, true, true, true, true, false]);
    expect(top(r).v).toBe("ab".repeat(13_108));
    expect(r.steps).toBeLessThan(1000);
  });

  test("remove-null-bytes agrees with a filter on random bytes", async () => {
    const next = rng(3);
    const data = Uint8Array.from({ length: 65_536 }, () => (next() % 4 === 0 ? 0 : next()));
    const r = await runtime.call("clean:remove-null-bytes", [bytes(data)]);
    expect(top(r).v).toEqual(data.filter((b) => b !== 0));
    expect(r.steps).toBeLessThan(1000);
  });

  test("remove-ansi removes every sequence of a mixed stream and nothing else", async () => {
    const seqs = [
      "\x1b[0m",
      "\x1b[38;5;196m",
      "\x1b[?1049h",
      "\x1b[2J",
      "\x1b]0;t\x07",
      "\x1b]8;;u\x1b\\",
      "\x1b(0",
    ];
    const words = ["alpha", "beta ", "γ", "[x]", "ESC", "\n"];
    const next = rng(5);
    let plain = "";
    let dirty = "";
    for (let i = 0; i < 300; i++) {
      const w = words[next() % words.length] as string;
      plain += w;
      dirty += w + (seqs[next() % seqs.length] as string);
    }
    expect(top(await runtime.call("clean:remove-ansi", [str(dirty)])).v).toBe(plain);
  });

  test("remove-ansi runs on 64 KiB of text", async () => {
    const dirty = "\x1b[1mbold\x1b[0m ".repeat(5000);
    const r = await runtime.call("clean:remove-ansi", [str(dirty)]);
    expect(top(r).v).toBe("bold ".repeat(5000));
  });

  test("the words are catalogue ops of the Text category", () => {
    for (const w of ["clean:remove-whitespace", "clean:remove-null-bytes", "clean:remove-ansi"]) {
      expect(runtime.meta(w).category).toBe("Text");
    }
  });
});
