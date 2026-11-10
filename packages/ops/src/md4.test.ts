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
describe("md4:digest", () => {
  // Expected value from OpenSSL (legacy provider) over the same bytes.
  test("64 KiB", async () => {
    expect((await run("md4:digest", KiB64)).out).toBe("3b2afe210a8c8378e23f5f007c259937");
  });

  test("block boundaries (55, 56, 63, 64, 65 bytes) differ and are 16 bytes", async () => {
    const seen = new Set<string>();
    for (const n of [55, 56, 63, 64, 65]) {
      const out = (await run("md4:digest", new Uint8Array(n).fill(0x61))).out!;
      expect(out).toHaveLength(32);
      seen.add(out);
    }
    expect(seen.size).toBe(5);
  });
});
