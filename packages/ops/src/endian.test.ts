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
 * Property tests for the `endian` vocabulary (vocab/endian.fth, no primitives). Fixed answers are in
 * vocab/endian.test.json.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int, bool } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["endian"]));

let seed = 0xe1d1a4;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randBytes = (n: number) => Uint8Array.from({ length: n }, () => Math.floor(rand() * 256));

async function swap(data: Uint8Array, width: number, pad: boolean) {
  const r = await runtime.call("endian:swap", [bytes(data), int(width), bool(pad)]);
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v };
}

describe("endian:swap", () => {
  test("swapping twice is the identity, for every width", async () => {
    for (const width of [2, 4, 8]) {
      for (let i = 0; i < 20; i++) {
        const data = randBytes(width * Math.floor(rand() * 40));
        const once = (await swap(data, width, false)).out!;
        expect(once.length).toBe(data.length);
        expect((await swap(once, width, false)).out).toEqual(data);
      }
    }
  });

  test("agrees with a DataView read of the same words", async () => {
    const data = randBytes(64);
    const swapped = (await swap(data, 4, false)).out!;
    const a = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const b = new DataView(swapped.buffer, swapped.byteOffset, swapped.byteLength);
    for (let i = 0; i < 64; i += 4) expect(b.getUint32(i, false)).toBe(a.getUint32(i, true));
  });

  test("a partial word is E_RANGE, and with pad the result is a whole number of words", async () => {
    for (const width of [2, 4, 8]) {
      for (let extra = 1; extra < width; extra++) {
        const data = randBytes(width * 3 + extra);
        expect((await swap(data, width, false)).code).toBe("E_RANGE");
        const padded = (await swap(data, width, true)).out!;
        expect(padded.length).toBe(width * 4);
      }
    }
  });

  test("64 KiB", async () => {
    const data = randBytes(65536);
    const t0 = Date.now();
    const out = (await swap(data, 4, false)).out!;
    console.log(`endian:swap 64 KiB width 4: ${Date.now() - t0} ms`);
    expect(out[0]).toBe(data[3]);
  }, 60_000);
});
