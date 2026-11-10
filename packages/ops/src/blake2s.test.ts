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
 * Tests for the `blake2s` vocabulary (vocab/blake2s.fth, with the private primitive `_hash`). The RFC
 * 7693 vectors are in vocab/blake2s.test.json; these cover a 64 KiB input, keyed and unkeyed.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["blake2s"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const key32 = Uint8Array.from({ length: 32 }, (_, i) => i);

async function digest(data: Uint8Array, size: number, key: Uint8Array) {
  const r = await runtime.call("blake2s:digest", [bytes(data), int(size), bytes(key)]);
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v };
}

describe("blake2s:digest", () => {
  // 64 KiB of the pattern (i * 31 + 7) mod 256; the digests were computed with an independent
  // implementation (hashlib, keyed with bytes 00..1f) and are fixed here.
  test("64 KiB input, unkeyed and keyed", async () => {
    const data = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);
    expect(hex((await digest(data, 32, new Uint8Array(0))).out!)).toBe(
      "45880ca68746e6d20dbd875241a0f2e640f49650a25cb925eae052079fa6c804",
    );
    expect(hex((await digest(data, 32, key32)).out!)).toBe(
      "f72c6fbf804504c74fe8472e64de85f69708bbc92d4e2e6ad0709bf1472efd45",
    );
  });

  test("a key of 33 bytes or a size not offered is rejected", async () => {
    expect((await digest(new Uint8Array(), 32, new Uint8Array(33))).code).toBeDefined();
    expect((await digest(new Uint8Array(), 64, new Uint8Array(0))).code).toBeDefined();
  });
});
