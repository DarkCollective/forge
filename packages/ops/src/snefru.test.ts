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
 * Tests for the `snefru` vocabulary (vocab/snefru.fth, with the private primitive `_hash`). The Xerox distribution digests
 * are in vocab/snefru.test.json; these cover the word through the runtime: the default parameters,
 * bad parameters and a 64 KiB input.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["snefru"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const data64k = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);

async function digest(data: Uint8Array, ...params: string[]) {
  const r = await runtime.call("snefru:digest", [bytes(data), ...params.map((p) => str(p))]);
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v };
}

describe("snefru:digest", () => {
  test("explicit parameters (the defaults are in snefru.test.json)", async () => {
    const nl = new TextEncoder().encode("\n");
    expect(hex((await digest(nl, "128", "8")).out!)).toBe("d9fcb3171c097fbba8c8f12aa0906bad");
    expect((await digest(nl, "256", "8")).out).toHaveLength(32);
  });

  test("every size and rounds option gives a digest of the right length", async () => {
    for (const size of ["128", "256"]) {
      for (const rounds of ["2", "4", "8"]) {
        expect((await digest(data64k.subarray(0, 100), size, rounds)).out).toHaveLength(
          Number(size) / 8,
        );
      }
    }
  });

  test("a size or rounds that is not an option is rejected", async () => {
    expect((await digest(new Uint8Array(), "192", "8")).code).toBeDefined();
    expect((await digest(new Uint8Array(), "128", "3")).code).toBeDefined();
  });

  // No independent implementation is at hand: fixed as a regression value.
  test("64 KiB", async () => {
    expect(hex((await digest(data64k, "256", "8")).out!)).toBe(
      "3b28c5bd7d4b609dccb899cd05811bda5ccae35c7e88571e9953078fbe169b1e",
    );
  });
});
