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
 * Tests for the `xor-checksum` vocabulary (vocab/xor-checksum.fth, no primitives). Known answers
 * are in vocab/xor-checksum.test.json; these compare with a plain column-wise loop and measure
 * 64 KiB at the smallest, the default and the largest block size.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["xor-checksum"]));

function reference(data: Uint8Array, bs: number): Uint8Array {
  const out = new Uint8Array(bs);
  data.forEach((b, i) => {
    out[i % bs] = (out[i % bs] as number) ^ b;
  });
  return out;
}

async function run(data: Uint8Array, bs: number) {
  const r = await runtime.call("xor-checksum:checksum", [bytes(data), int(bs)]);
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

describe("xor-checksum:checksum", () => {
  test("agrees with the column-wise loop for many lengths and block sizes", async () => {
    for (const bs of [1, 2, 3, 4, 7, 16, 100]) {
      for (const n of [0, 1, 2, 5, 16, 17, 99, 250]) {
        const data = randBytes(n, n + bs);
        expect((await run(data, bs)).out, `bs ${bs} length ${n}`).toEqual(reference(data, bs));
      }
    }
  });

  for (const bs of [1, 4, 65536]) {
    test(`65536 bytes in blocks of ${bs} fit well inside the default limits`, async () => {
      // Measured: about 0.79 million steps for blocks of 4 (2.4 million for 65536, one block per byte
      // column); the default limit is 10 million. No primitive is needed.
      const data = randBytes(65536, 11);
      const { out, steps } = await run(data, bs);
      expect(out).toEqual(reference(data, bs));
      expect(steps).toBeLessThan(5_000_000);
    }, 60_000);
  }
});
