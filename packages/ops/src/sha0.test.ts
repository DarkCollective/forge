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
 * Tests for the `sha0` vocabulary. The FIPS 180 vectors are in vocab/sha0.test.json.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["sha0"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const KiB64 = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);

async function run(word: string, arg: Uint8Array | string) {
  const r = await runtime.call(word, [typeof arg === "string" ? str(arg) : bytes(arg)]);
  if (!r.ok) return { code: r.error.code };
  return { out: hex((r.stack[r.stack.length - 1] as { v: Uint8Array }).v) };
}
describe("sha0:digest", () => {
  // Pinned from this implementation, which reproduces the FIPS 180 vectors.
  test("64 KiB", async () => {
    expect((await run("sha0:digest", KiB64)).out).toBe("caab5a091f63ff4ccc73ec77e78380bd467449c5");
  });

  // FIPS 180 (1993): one million repetitions of 'a'.
  test("one million 'a'", async () => {
    const data = new Uint8Array(1_000_000).fill(0x61);
    expect((await run("sha0:digest", data)).out).toBe("3232affa48628a26653b5aaa44541fd90d690603");
  });
});
