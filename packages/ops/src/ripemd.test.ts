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
 * Tests for the `ripemd` vocabulary (RIPEMD-128, -256, -320). The Bosselaers test strings are in
 * vocab/ripemd.test.json; these cover the default, the bad sizes and the long inputs.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["ripemd"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

async function digest(data: Uint8Array, size?: string) {
  const r = await runtime.call(
    "ripemd:digest",
    size === undefined ? [bytes(data)] : [bytes(data), str(size)],
  );
  if (!r.ok) return { code: r.error.code };
  return { out: hex((r.stack[r.stack.length - 1] as { v: Uint8Array }).v) };
}

describe("ripemd:digest", () => {
  test("RIPEMD-128 of abc (the default size is in ripemd.test.json)", async () => {
    const abc = new TextEncoder().encode("abc");
    expect((await digest(abc, "128")).out).toBe("c14a12199c66e4ba84636b0f69144c77");
  });

  // Bosselaers' RIPEMD page: one million repetitions of 'a'.
  test("one million 'a' for RIPEMD-128", async () => {
    const data = new Uint8Array(1_000_000).fill(0x61);
    expect((await digest(data, "128")).out).toBe("4a7f5723f954eba1216c9d8f6320431f");
  });

  // Pinned from this implementation, which reproduces every Bosselaers vector (no tool has these).
  test("64 KiB of every size", async () => {
    const data = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);
    expect((await digest(data, "128")).out).toBe("43441a976766ab80f3485c0d45ff5eb2");
    expect((await digest(data, "256")).out).toBe(
      "13333dc4afeba612f92eb685c16d4667ab6ef6989e6abb34217f50c7fd79a752",
    );
    expect((await digest(data, "320")).out).toBe(
      "492c84a212aa2bdc6193c35f362da3b88534080e15dcc2eb998b8174f049d36c14ce8c0c0050e9fc",
    );
  });

  test("an unknown size, including 160 and an Object.prototype name, is an error", async () => {
    for (const size of ["160", "toString", "", "512"]) {
      expect((await digest(new Uint8Array(), size)).code).toBeDefined();
    }
  });
});
