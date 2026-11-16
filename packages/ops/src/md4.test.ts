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
 * Tests for the `md4` vocabulary. The RFC 1320 suite is in vocab/md4.test.json.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["md4"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const KiB64 = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);

async function run(word: string, arg: Uint8Array | string) {
  const r = await runtime.call(word, [typeof arg === "string" ? str(arg) : bytes(arg)]);
  if (!r.ok) return { code: r.error.code };
  return { out: hex((r.stack[r.stack.length - 1] as { v: Uint8Array }).v) };
}
const enc = (s: string) => new TextEncoder().encode(s);

describe("md4:digest", () => {
  // RFC 1320 appendix A.5.
  test("RFC 1320 test suite", async () => {
    const suite: [string, string][] = [
      ["", "31d6cfe0d16ae931b73c59d7e0c089c0"],
      ["a", "bde52cb31de33e46245e05fbdbd6fb24"],
      ["abc", "a448017aaf21d8525fc10ae87aa6729d"],
      ["message digest", "d9130a8164549fe818874806e1c7014b"],
      ["abcdefghijklmnopqrstuvwxyz", "d79e1c308aa5bbcdeea8ed63df412da9"],
      [
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
        "043f8582f241db351ce627e153e7f0e4",
      ],
      [
        "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
        "e33b4ddc9c38f2199c3e7b164fcc0536",
      ],
    ];
    for (const [input, want] of suite) {
      expect((await run("md4:digest", enc(input))).out, input).toBe(want);
    }
  });

  // Digests of n times "a" from OpenSSL (legacy provider); the length field spills into a second block from 56.
  test("padding-edge lengths 0, 55, 56, 63, 64 and 65", async () => {
    const want: [number, string][] = [
      [0, "31d6cfe0d16ae931b73c59d7e0c089c0"],
      [55, "c889c81dd86c4d2e025778944ea02881"],
      [56, "d5f9a9e9257077a5f08b0b92f348b0ad"],
      [63, "7ea3da77432d44c323671097d1348fc8"],
      [64, "52f5076fabd22680234a3fa9f9dc5732"],
      [65, "330e377bf231f3cacfecc2c182fe7e5b"],
    ];
    for (const [n, digest] of want) {
      expect((await run("md4:digest", new Uint8Array(n).fill(0x61))).out, `${n} bytes`).toBe(
        digest,
      );
    }
  });

  test("64 KiB", async () => {
    expect((await run("md4:digest", KiB64)).out).toBe("3b2afe210a8c8378e23f5f007c259937");
  });

  // The hash is FL (about 38 steps a byte), so 64 KiB must fit the untrusted limits (5,000,000 steps, 256 MiB).
  // The explicit timeout allows for CI runners about 3.5 times slower.
  test("64 KiB stays inside the untrusted limits", { timeout: 60_000 }, async () => {
    const r = await runtime.call("md4:digest", [bytes(KiB64)], {
      limits: { maxSteps: 5_000_000, maxTotalBytes: 256 * 1024 * 1024 },
    });
    expect(r.ok).toBe(true);
    expect(r.steps).toBeLessThan(2_800_000);
  });
});
