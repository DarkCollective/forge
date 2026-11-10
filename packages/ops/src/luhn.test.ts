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
 * Tests for the `luhn` vocabulary (vocab/luhn.fth, no primitives). Known answers are in
 * vocab/luhn.test.json; these compare with Wikipedia's Luhn mod N algorithm, check that a number
 * with its check digit appended validates, and measure 64 KiB of digits.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { str, int } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["luhn", "raise"]));

/** The Luhn mod N check character, as on Wikipedia ("Luhn mod N algorithm"). */
function reference(digits: string, n: number): string {
  let factor = 2;
  let sum = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    const add = factor * parseInt(digits[i] as string, 36);
    factor = factor === 2 ? 1 : 2;
    sum += Math.floor(add / n) + (add % n);
  }
  return ((n - (sum % n)) % n).toString(n);
}

async function checkDigit(digits: string, radix: number) {
  const r = await runtime.call("luhn:check-digit", [str(digits), int(radix)]);
  if (!r.ok) throw new Error(JSON.stringify(r));
  return { out: (r.stack[r.stack.length - 1] as { v: string }).v, steps: r.steps };
}
async function validate(digits: string, radix: number) {
  const r = await runtime.call("luhn:validate", [str(digits), int(radix)]);
  if (!r.ok) throw new Error(JSON.stringify(r));
  return { out: (r.stack[r.stack.length - 1] as { v: boolean }).v, steps: r.steps };
}

function randDigits(n: number, radix: number, seed: number): string {
  let s = seed >>> 0;
  let out = "";
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out += (s % radix).toString(radix);
  }
  return out;
}

describe("luhn", () => {
  test("check-digit agrees with Luhn mod N for every even radix", async () => {
    for (let radix = 2; radix <= 36; radix += 2) {
      for (let n = 1; n < 12; n++) {
        const digits = randDigits(n, radix, n * radix);
        expect((await checkDigit(digits, radix)).out, `${digits} radix ${radix}`).toBe(
          reference(digits, radix),
        );
      }
    }
  });

  test("a number with its check digit appended validates, and a changed digit does not", async () => {
    for (const radix of [2, 10, 16, 36]) {
      for (let n = 1; n < 15; n++) {
        const digits = randDigits(n, radix, n + radix);
        const full = digits + reference(digits, radix);
        expect((await validate(full, radix)).out).toBe(true);
        const wrong = ((parseInt(full.slice(-1), radix) + 1) % radix).toString(radix);
        expect((await validate(full.slice(0, -1) + wrong, radix)).out).toBe(false);
      }
    }
  });

  test("65536 digits fit well inside the default limits", async () => {
    // Measured: about 3.0 million steps for each word; the default limit is 10 million.
    const digits = randDigits(65536, 10, 9);
    const c = await checkDigit(digits, 10);
    expect(c.out).toBe(reference(digits, 10));
    expect(c.steps).toBeLessThan(5_000_000);
    const v = await validate(digits + c.out, 10);
    expect(v.out).toBe(true);
    expect(v.steps).toBeLessThan(5_000_000);
  }, 60_000);
});
