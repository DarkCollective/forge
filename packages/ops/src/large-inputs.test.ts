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
 * 16 MiB through the checksummed containers, under the default limits and under the untrusted limits of the
 * worker (UNTRUSTED_LIMITS: 5 million steps, 16 MiB values, 10 s). Before the checksums became primitives
 * (crc:_crc, adler32:_adler) a per-byte FL loop capped these near 750 KB: E_LIMIT_STEPS. The expected values
 * come from Node's zlib (an independent implementation) and, for the checksums, Python's zlib.
 */
import { deflateSync, gzipSync } from "node:zlib";
import { valueHelpers } from "@forge/lang";
import type { Limits } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bool, bytes, int, str } = valueHelpers;
const bundle = await loadBundleNode("all");

const SIZE = 16 * 1024 * 1024;
const data = new Uint8Array(SIZE);
{
  let s = 12345;
  for (let i = 0; i < SIZE; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    data[i] = (s >>> 16) & 15;
  }
}

const untrusted: Partial<Limits> = {
  maxSteps: 5_000_000,
  maxDataDepth: 10_000,
  maxValueBytes: 16 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxIntBits: 16_384,
  maxMillis: 10_000,
};

const same = (u: Uint8Array) => {
  for (let i = 0; i < SIZE; i++) if (u[i] !== data[i]) return false;
  return true;
};

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

for (const [label, limits] of [
  ["default limits", {}],
  ["untrusted limits", untrusted],
] as const) {
  describe(`16 MiB under the ${label}`, () => {
    const runtime = assembleRuntime(bundle, { limits });
    const run = async (name: string, args: Parameters<typeof runtime.call>[1]) => {
      const r = await runtime.call(name, args);
      if (!r.ok) throw new Error(`${name}: ${r.error.code} ${r.error.message}`);
      return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v, steps: r.steps };
    };

    test("deflate:gunzip", async () => {
      const { out, steps } = await run("deflate:gunzip", [
        bytes(new Uint8Array(gzipSync(data))),
        bool(true),
      ]);
      expect(out.length).toBe(SIZE);
      expect(same(out)).toBe(true);
      expect(steps).toBeLessThan(2000);
    }, 120_000);

    test("deflate:zlib-inflate", async () => {
      const { out, steps } = await run("deflate:zlib-inflate", [
        bytes(new Uint8Array(deflateSync(data))),
        int(0),
        bool(true),
      ]);
      expect(out.length).toBe(SIZE);
      expect(same(out)).toBe(true);
      expect(steps).toBeLessThan(2000);
    }, 120_000);

    test("crc:checksum CRC-32 (Python zlib.crc32 is 0x5abd3c44)", async () => {
      const { out, steps } = await run("crc:checksum", [bytes(data), str("CRC-32")]);
      expect(hex(out)).toBe("5abd3c44");
      expect(steps).toBeLessThan(500);
    }, 120_000);

    test("adler32:checksum (Python zlib.adler32 is 0x5d8b7081)", async () => {
      const { out, steps } = await run("adler32:checksum", [bytes(data)]);
      expect(hex(out)).toBe("5d8b7081");
      expect(steps).toBeLessThan(500);
    }, 120_000);
  });
}
