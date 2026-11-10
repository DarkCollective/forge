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
 * Tests for the `murmur3` vocabulary (vocab/murmur3.fth, all FL). The fixed answers are in
 * vocab/murmur3.test.json. Here: the SMHasher verification value (Austin Appleby's own self-test
 * for MurmurHash3_x86_32), the seed range, and a 64 KiB input inside the default limits.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["murmur3"]));

async function digest(data: Uint8Array, seed: number) {
  const r = await runtime.call("murmur3:digest", [bytes(data), int(seed)]);
  if (!r.ok) return { code: r.error.code, msg: r.error.message };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v };
}

const u32 = (b: Uint8Array) => ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;

describe("murmur3:digest", () => {
  // SMHasher KeysetTest.cpp VerificationTest: hash the keys {}, {0}, {0,1}, ... {0..254} with seed
  // 256 - length, append each result (written as a native little-endian uint32), hash that 1020
  // byte buffer with seed 0, and read the first four bytes as a little-endian uint32. For
  // MurmurHash3_x86_32 the published value is 0xB0F57EE3 (SMHasher main.cpp, g_hashes table).
  test("SMHasher verification value 0xB0F57EE3", async () => {
    const acc: number[] = [];
    for (let n = 0; n < 256; n++) {
      const key = Uint8Array.from({ length: n }, (_, i) => i);
      const h = (await digest(key, 256 - n)).out!;
      acc.push(h[3]!, h[2]!, h[1]!, h[0]!);
    }
    const final = (await digest(Uint8Array.from(acc), 0)).out!;
    // First four bytes of the final little-endian output, read as a little-endian uint32, are the
    // big-endian bytes of the word: the word itself is what digest returns.
    expect(u32(final)).toBe(0xb0f57ee3);
  });

  test("the output is 4 bytes, even for an empty input", async () => {
    expect(await digest(new Uint8Array(), 0)).toEqual({ out: new Uint8Array(4) });
  });

  test("seeds beyond 32 bits or negative are rejected", async () => {
    expect((await digest(new Uint8Array(1), 4294967296)).code).toBeDefined();
    expect((await digest(new Uint8Array(1), -1)).code).toBeDefined();
  });

  test("a different seed gives a different hash", async () => {
    const a = (await digest(new TextEncoder().encode("hello"), 0)).out!;
    const b = (await digest(new TextEncoder().encode("hello"), 1)).out!;
    expect(u32(a)).not.toBe(u32(b));
  });

  // Compared with `ref` below, a separate TypeScript implementation of the published algorithm
  // (Math.imul, no shared code with the FL word).
  test("64 KiB of (i * 31 + 7) mod 256, seed 0x9747b28c", async () => {
    const data = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);
    expect(u32((await digest(data, 0x9747b28c)).out!)).toBe(REFERENCE_64K);
  });
});

/** Independent implementation of MurmurHash3_x86_32 for the 64 KiB check. */
function ref(data: Uint8Array, seed: number): number {
  const rotl = (x: number, r: number) => ((x << r) | (x >>> (32 - r))) >>> 0;
  let h = seed >>> 0;
  const nb = data.length >> 2;
  for (let i = 0; i < nb; i++) {
    let k =
      (data[4 * i]! |
        (data[4 * i + 1]! << 8) |
        (data[4 * i + 2]! << 16) |
        (data[4 * i + 3]! << 24)) >>>
      0;
    k = Math.imul(k, 0xcc9e2d51);
    k = rotl(k, 15);
    k = Math.imul(k, 0x1b873593);
    h = (h ^ k) >>> 0;
    h = rotl(h, 13);
    h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
  }
  let k = 0;
  const t = data.length & 3;
  for (let j = t - 1; j >= 0; j--) k = (k << 8) | data[4 * nb + j]!;
  if (t > 0) {
    k = Math.imul(k >>> 0, 0xcc9e2d51);
    k = rotl(k, 15);
    k = Math.imul(k, 0x1b873593);
    h = (h ^ k) >>> 0;
  }
  h = (h ^ data.length) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

const REFERENCE_64K = ref(
  Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff),
  0x9747b28c,
);
