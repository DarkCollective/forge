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

/*
 * Tests for `analysis:index-of-coincidence` and `analysis:chi-squared`. The fixed-answer vectors
 * are in vocab/analysis.test.json; these tests drive the words through the runtime for the
 * textbook values on larger samples, parameter validation and the 64 KiB limits check.
 */
import { valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bool, bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["analysis"]));

let seed = 0x1b873593;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Letter frequencies of English in 1/100000 (the table the word uses, Wikipedia "Letter frequency").
const ENGLISH = [
  8167, 1492, 2782, 4253, 12702, 2228, 2015, 6094, 6966, 153, 772, 4025, 2406, 6749, 7507, 1929, 95,
  5987, 6327, 9056, 2758, 978, 2360, 150, 1974, 74,
];
const TOTAL = ENGLISH.reduce((a, b) => a + b, 0);

/** n random letters drawn with English frequencies, in either case. */
function englishLetters(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let r = rand() * TOTAL;
    let k = 0;
    while (k < 25 && r >= (ENGLISH[k] as number)) r -= ENGLISH[k++] as number;
    out[i] = (rand() < 0.5 ? 65 : 97) + k;
  }
  return out;
}
function uniformLetters(n: number): Uint8Array {
  return Uint8Array.from({ length: n }, () => 97 + Math.floor(rand() * 26));
}
function randBytes(n: number): Uint8Array {
  return Uint8Array.from({ length: n }, () => Math.floor(rand() * 256));
}

async function num(word: string, args: Value[]): Promise<number> {
  const r = await runtime.call(word, args);
  if (!r.ok) throw new Error(`${word}: ${r.error.code} ${r.error.message}`);
  return (r.stack[r.stack.length - 1] as { v: number }).v;
}
const ioc = (d: Uint8Array, scope = "letters", norm = false) =>
  num("analysis:index-of-coincidence", [bytes(d), str(scope), bool(norm)]);
const chi = (d: Uint8Array, reference = "uniform") =>
  num("analysis:chi-squared", [bytes(d), str(reference)]);

describe("analysis:index-of-coincidence", () => {
  test("English letters give about 0.0667 and uniform letters about 0.0385", async () => {
    expect(Math.abs((await ioc(englishLetters(100_000))) - 0.0655)).toBeLessThan(0.002);
    expect(Math.abs((await ioc(uniformLetters(100_000))) - 1 / 26)).toBeLessThan(0.001);
  });

  test("normalising multiplies by the alphabet size", async () => {
    const d = englishLetters(5000);
    expect(await ioc(d, "letters", true)).toBeCloseTo((await ioc(d)) * 26, 12);
    expect(await ioc(d, "bytes", true)).toBeCloseTo((await ioc(d, "bytes")) * 256, 12);
  });

  test("it does not change when the letters are substituted one for one", async () => {
    const d = englishLetters(3000);
    const shifted = Uint8Array.from(d, (c) =>
      c >= 97 ? ((c - 97 + 5) % 26) + 97 : ((c - 65 + 5) % 26) + 65,
    );
    expect(await ioc(shifted)).toBe(await ioc(d));
  });

  test("the scope must be letters or bytes", async () => {
    const r = await runtime.call("analysis:index-of-coincidence", [
      bytes(randBytes(4)),
      str("words"),
      bool(false),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_PARAM_INVALID");
  });

  test("64 KiB within the default limits", { timeout: 60_000 }, async () => {
    const d = randBytes(65536);
    expect(await ioc(d, "bytes")).toBeGreaterThan(0.003);
    expect(await ioc(d, "bytes")).toBeLessThan(0.005);
    expect(await ioc(d, "letters", true)).toBeGreaterThanOrEqual(0);
  });
});

describe("analysis:chi-squared", () => {
  test("random bytes against uniform are near the 255 degrees of freedom", async () => {
    const v = await chi(randBytes(100_000));
    expect(v).toBeGreaterThan(180);
    expect(v).toBeLessThan(340);
  });

  test("English-distributed letters fit English far better than uniform letters do", async () => {
    const fit = await chi(englishLetters(20_000), "english");
    const noFit = await chi(uniformLetters(20_000), "english");
    expect(fit).toBeLessThan(80);
    expect(noFit).toBeGreaterThan(1000);
  });

  test("the reference must be uniform or english", async () => {
    const r = await runtime.call("analysis:chi-squared", [bytes(randBytes(4)), str("normal")]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_PARAM_INVALID");
  });

  test("64 KiB within the default limits, for both references", { timeout: 60_000 }, async () => {
    expect(await chi(randBytes(65536))).toBeGreaterThan(0);
    expect(await chi(englishLetters(65536), "english")).toBeGreaterThan(0);
    expect(await chi(randBytes(65536), "english")).toBeGreaterThan(0);
  });
});
