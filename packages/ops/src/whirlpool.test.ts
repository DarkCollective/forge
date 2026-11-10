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
 * Tests for the `whirlpool` vocabulary (vocab/whirlpool.fth, with the private primitive `_hash`). The Whirlpool digests
 * are in vocab/whirlpool.test.json; these cover the word through the runtime: the default parameters,
 * bad parameters and a 64 KiB input.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["whirlpool"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const data64k = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);

async function digest(data: Uint8Array, ...params: string[]) {
  const r = await runtime.call("whirlpool:digest", [bytes(data), ...params.map((p) => str(p))]);
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v };
}

describe("whirlpool:digest", () => {
  test("abc", async () => {
    expect(hex((await digest(new TextEncoder().encode("abc"))).out!)).toBe(
      "4e2448a4c6f486bb16b6562c73b4020bf3043e3a731bce721ae1b303d97e6d4c7181eebdb6c57e277d0e34957114cbd6c797fc9d95d8b582d225292076d4eef5",
    );
  });

  // The digest was computed with OpenSSL's whirlpool (legacy provider) and is fixed here.
  test("64 KiB", async () => {
    expect(hex((await digest(data64k)).out!)).toBe(
      "3b5ad54a6bbc961e5019f2261a3c873b28203bd32911c0f771f832a9719091de8b0a3c7bb727a4b005f9e2b4cf4fcb4d9cc5ef60be28f64963451e38a36207ac",
    );
  });
});
