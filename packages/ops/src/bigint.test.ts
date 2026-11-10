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
 * Property tests for the `bigint` vocabulary (vocab/bigint.fth, no primitives). Fixed answers are in
 * vocab/bigint.test.json.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["bigint"]));

let seed = 0xb16171;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randBytes = (n: number) => Uint8Array.from({ length: n }, () => Math.floor(rand() * 256));

async function call(word: string, arg: ReturnType<typeof bytes> | ReturnType<typeof str>) {
  const r = await runtime.call(word, [arg]);
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array | string }).v };
}

const toBig = (b: Uint8Array) => b.reduce((acc, x) => (acc << 8n) | BigInt(x), 0n);

describe("bigint", () => {
  test("from-bytes agrees with BigInt, and to-bytes inverts it up to leading zeros", async () => {
    for (let i = 0; i < 60; i++) {
      const data = randBytes(1 + Math.floor(rand() * 300));
      const text = (await call("bigint:from-bytes", bytes(data))).out as string;
      expect(text).toBe(toBig(data).toString());
      const back = (await call("bigint:to-bytes", str(text))).out as Uint8Array;
      let start = 0;
      while (start < data.length - 1 && data[start] === 0) start++;
      expect(back).toEqual(data.slice(start));
    }
  });

  test("the language integer limit (65 536 bits) is E_LIMIT_VALUE", async () => {
    const ok = await call("bigint:from-bytes", bytes(new Uint8Array(8192).fill(255)));
    expect(ok.out).toBeDefined();
    const over = await call("bigint:from-bytes", bytes(new Uint8Array(8193).fill(255)));
    expect(over.code).toBe("E_LIMIT_VALUE");
    const text = (2n ** 65537n).toString();
    expect((await call("bigint:to-bytes", str(text))).code).toBe("E_LIMIT_VALUE");
  });

  test("64 KiB of leading zeros costs nothing; the largest value takes", async () => {
    const zeros = new Uint8Array(65536);
    expect((await call("bigint:from-bytes", bytes(zeros))).out).toBe("0");
    const big = randBytes(8192);
    big[0] = 255;
    const text = (await call("bigint:from-bytes", bytes(big))).out as string;
    const back = (await call("bigint:to-bytes", str(text))).out as Uint8Array;
    expect(back).toEqual(big);
  }, 60_000);
});
