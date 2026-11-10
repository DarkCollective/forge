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
 * Tests for the `blake3` vocabulary (vocab/blake3.fth, with the private primitive `_hash`). The official
 * BLAKE3 vectors are in vocab/blake3.test.json; these cover a 64 KiB input, keyed and unkeyed.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["blake3"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const elvish = new TextEncoder().encode("whats the Elvish word for friend");

async function digest(data: Uint8Array, length: number, key: Uint8Array) {
  const r = await runtime.call("blake3:digest", [bytes(data), int(length), bytes(key)]);
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v };
}

describe("blake3:digest", () => {
  // 64 KiB of the pattern (i * 31 + 7) mod 256. BLAKE3 has no node:crypto implementation: these are
  // from @noble/hashes, which matches the official BLAKE3 vectors (see the report).
  test("64 KiB input, unkeyed and keyed", async () => {
    const data = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);
    expect(hex((await digest(data, 32, new Uint8Array(0))).out!)).toBe(
      "b934806efb9e01837336c44a00b6bf58ceeda18617697d33300c2bed3cecb178",
    );
    expect(hex((await digest(data, 32, elvish)).out!)).toBe(
      "0c57dd42195116792aab60b612fe9f3f9026fe6540bf109df99c16c4ba2af72d",
    );
  });

  test("a key that is not 32 bytes is rejected", async () => {
    expect((await digest(new Uint8Array(), 32, new Uint8Array(16))).code).toBeDefined();
  });
});
