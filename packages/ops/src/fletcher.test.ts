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
 * Tests for the `fletcher` vocabulary (vocab/fletcher.fth, no primitives). Known answers are in
 * vocab/fletcher.test.json; these compare with the step-by-step loops of CyberChef's four
 * Fletcher operations (words read little-endian, a short last word zero-padded, reduced at every
 * step) and measure 64 KiB.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["fletcher"]));

function reference(data: Uint8Array, bits: number): Uint8Array {
  const wordBytes = Math.max(1, bits / 16);
  const half = BigInt(bits / 2);
  const m = (1n << half) - 1n;
  let a = 0n;
  let b = 0n;
  for (let i = 0; i < data.length; i += wordBytes) {
    let w = 0n;
    for (let j = 0; j < wordBytes && i + j < data.length; j++) {
      w |= BigInt(data[i + j] as number) << BigInt(8 * j);
    }
    a = (a + w) % m;
    b = (b + a) % m;
  }
  const v = (b << half) | a;
  return Uint8Array.from({ length: bits / 8 }, (_, i) =>
    Number((v >> BigInt(8 * (bits / 8 - 1 - i))) & 255n),
  );
}

async function run(data: Uint8Array, size: number) {
  const r = await runtime.call("fletcher:checksum", [bytes(data), str(String(size))]);
  if (!r.ok) throw new Error(JSON.stringify(r));
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v, steps: r.steps };
}

function randBytes(n: number, seed: number): Uint8Array {
  let s = seed >>> 0;
  return Uint8Array.from({ length: n }, () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s >>> 24;
  });
}

describe("fletcher:checksum", () => {
  test("agrees with the step-by-step loop for every size and tail length", async () => {
    for (const size of [8, 16, 32, 64]) {
      for (let n = 0; n < 40; n++) {
        const data = randBytes(n * 5, n + size);
        expect((await run(data, size)).out, `size ${size} length ${n * 5}`).toEqual(
          reference(data, size),
        );
      }
    }
  });

  test("agrees on all-ones data, where every sum wraps", async () => {
    const data = new Uint8Array(5000).fill(255);
    for (const size of [8, 16, 32, 64]) {
      expect((await run(data, size)).out).toEqual(reference(data, size));
    }
  }, 60_000);

  for (const size of [8, 16, 32, 64]) {
    test(`Fletcher-${size} over 65536 bytes fits well inside the default limits`, async () => {
      // Measured: about 1.6 million steps; the default limit is 10 million. No primitive is needed.
      const data = randBytes(65536, 3);
      const { out, steps } = await run(data, size);
      expect(out).toEqual(reference(data, size));
      expect(steps).toBeLessThan(2_000_000);
    }, 60_000);
  }
});
