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

// fractionating is FL (vocab/fractionating.fth); these tests drive its public words through the runtime.
// The published worked examples are in vocab/fractionating.test.json.
const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["fractionating"]));
const asciiBytes = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));
const asciiText = (b: Uint8Array): string => Array.from(b, (c) => String.fromCharCode(c)).join("");

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

function letters(next: () => number, n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) out += String.fromCharCode(65 + Math.floor(next() * 26));
  return out;
}

async function call(word: string, data: string, key: string) {
  return runtime.call(`fractionating:${word}`, [bytes(asciiBytes(data)), str(key)]);
}

function outText(r: Awaited<ReturnType<typeof call>>): string {
  expect(r.ok).toBe(true);
  return asciiText(top(r).v as Uint8Array);
}

describe("fractionating: polybius", () => {
  test("plain square: HELLO is 2315313134", async () => {
    expect(outText(await call("polybius-encrypt", "HELLO", ""))).toBe("2315313134");
    expect(outText(await call("polybius-decrypt", "2315313134", ""))).toBe("HELLO");
  });

  test("round trip over random letters and keys (J is I)", async () => {
    const next = rng(51);
    for (let trial = 0; trial < 40; trial++) {
      const key = letters(next, Math.floor(next() * 12));
      const text = letters(next, Math.floor(next() * 50));
      const digits = outText(await call("polybius-encrypt", text, key));
      expect(digits.length).toBe(text.length * 2);
      expect(outText(await call("polybius-decrypt", digits, key))).toBe(text.replaceAll("J", "I"));
    }
  });

  test("64 KiB of letters round-trips inside the default limits", async () => {
    const next = rng(9);
    const text = letters(next, 65536);
    const digits = outText(await call("polybius-encrypt", text, "POLYBIUSCIPHER"));
    expect(digits.length).toBe(131072);
    expect(outText(await call("polybius-decrypt", digits, "POLYBIUSCIPHER"))).toBe(
      text.replaceAll("J", "I"),
    );
  }, 60_000);
});
