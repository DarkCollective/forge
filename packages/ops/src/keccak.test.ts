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
 * Tests for the `keccak` vocabulary (vocab/keccak.fth, with the private primitive `_hash`). The Keccak
 * vectors are in vocab/keccak.test.json; these cover a 64 KiB input at every size and the bad sizes.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["keccak"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

async function digest(data: Uint8Array, size?: string) {
  const r = await runtime.call(
    "keccak:digest",
    size === undefined ? [bytes(data)] : [bytes(data), str(size)],
  );
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v };
}

describe("keccak:digest", () => {
  // 64 KiB of the pattern (i * 31 + 7) mod 256. Keccak has no node:crypto implementation, so these are
  // from the independent Keccak-f reference that is checked against hashlib's SHA-3 (see the report).
  test("64 KiB input at every size", async () => {
    const data = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);
    const expected: Record<string, string> = {
      "224": "ec4bb051bfde6122511269c022a181665324966b5da1f1135c917330",
      "256": "22a59e1ad8088545e5e4130a53f4378aaf1a9c1166982f02ecd59923f9c33744",
      "384":
        "e213fbb8037a635f9a5d883177d7649ee163dce5081399693d990c78b256ac897a50bded122d3747ba24d08b3c3e6acf",
      "512":
        "4cd4dd4f5824fda7c1709411c5a0d1e36b00cd057d5ed9f49ce42846673f60842daacb6c130c102a3e143565707764e84cc2bd156e8d4d7e2a773b4d19685774",
    };
    for (const [size, want] of Object.entries(expected)) {
      expect(hex((await digest(data, size)).out!)).toBe(want);
    }
  });

  test("a size that is not an option is rejected", async () => {
    expect((await digest(new Uint8Array(), "128")).code).toBeDefined();
  });
});
