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
 * Tests for the `md2` vocabulary. The RFC 1319 suite is in vocab/md2.test.json.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["md2"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const KiB64 = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);

async function run(word: string, arg: Uint8Array | string) {
  const r = await runtime.call(word, [typeof arg === "string" ? str(arg) : bytes(arg)]);
  if (!r.ok) return { code: r.error.code };
  return { out: hex((r.stack[r.stack.length - 1] as { v: Uint8Array }).v) };
}
describe("md2:digest", () => {
  // Pinned from this implementation, which reproduces every RFC 1319 vector in md2.test.json (no
  // independent tool has MD2).
  test("64 KiB", async () => {
    expect((await run("md2:digest", KiB64)).out).toBe("2b87ba01102901e8aab5ee01a65bf527");
  });

  test("block boundaries (15, 16, 17 bytes) all pad and differ", async () => {
    const seen = new Set<string>();
    for (const n of [15, 16, 17]) {
      seen.add((await run("md2:digest", new Uint8Array(n).fill(0x61))).out!);
    }
    expect(seen.size).toBe(3);
  });
});
