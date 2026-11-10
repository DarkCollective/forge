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
 * Tests for the `shake` vocabulary (vocab/shake.fth, with the private primitive `_hash`). The SHAKE
 * vectors are in vocab/shake.test.json; these cover a 64 KiB input and the length bounds.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str, int } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["shake"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

async function digest(data: Uint8Array, variant: string, length: number) {
  const r = await runtime.call("shake:digest", [bytes(data), str(variant), int(length)]);
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v };
}

describe("shake:digest", () => {
  // 64 KiB of the pattern (i * 31 + 7) mod 256; the digests were computed with an independent
  // implementation (hashlib) and are fixed here.
  test("64 KiB input, SHAKE128 and SHAKE256", async () => {
    const data = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);
    expect(hex((await digest(data, "128", 32)).out!)).toBe(
      "9be7fe4bd39d2ba7a4f7813b2854797812e58433e06f928e20799c6978efd193",
    );
    expect(hex((await digest(data, "256", 64)).out!)).toBe(
      "d9fb0cedf9a29f8a73effb50af434ff9751e76b585794ccf6d97d7f36b7c5b995e7a7dd7ab3b39e6aecaf88ff8af5671a3607f8b0ee520f7a11ff8b00c8b4b6c",
    );
  });

  test("a length of 0 or a bad variant is rejected", async () => {
    expect((await digest(new Uint8Array(), "128", 0)).code).toBeDefined();
    expect((await digest(new Uint8Array(), "192", 32)).code).toBeDefined();
  });
});
