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
 * Tests for the `gost` vocabulary (vocab/gost.fth, with the private primitive `_hash`). The RFC 5831 example digests
 * are in vocab/gost.test.json; these cover the word through the runtime: the default parameters,
 * bad parameters and a 64 KiB input.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["gost"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const data64k = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);

async function digest(data: Uint8Array, ...params: string[]) {
  const r = await runtime.call("gost:digest", [bytes(data), ...params.map((p) => str(p))]);
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v };
}

describe("gost:digest", () => {
  test("both S-boxes (the default is in gost.test.json)", async () => {
    const abc = new TextEncoder().encode("abc");
    expect(hex((await digest(abc, "cryptopro")).out!)).toBe(
      "b285056dbf18d7392d7677369524dd14747459ed8143997e163b2986f92fd42c",
    );
    expect(hex((await digest(abc, "test")).out!)).toBe(
      "f3134348c44fb1b2a277729e2285ebb5cb5e0f29c975bc753b70497c06a4d51d",
    );
  });

  test("an S-box that is not an option is rejected", async () => {
    expect((await digest(new Uint8Array(), "D-A")).code).toBeDefined();
  });

  // No independent implementation is at hand: fixed as a regression value.
  test("64 KiB", async () => {
    expect(hex((await digest(data64k, "test")).out!)).toBe(
      "2195a25eb416cd2002f5002b5bb1adadf7e08021924f672a00beac094ac09fdc",
    );
  });
});
