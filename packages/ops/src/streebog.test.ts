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
 * Tests for the `streebog` vocabulary (vocab/streebog.fth, with the private primitive `_hash`). The RFC 6986 example digests
 * are in vocab/streebog.test.json; these cover the word through the runtime: the default parameters,
 * bad parameters and a 64 KiB input.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["streebog"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const data64k = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);

async function digest(data: Uint8Array, ...params: string[]) {
  const r = await runtime.call("streebog:digest", [bytes(data), ...params.map((p) => str(p))]);
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v };
}

describe("streebog:digest", () => {
  test("both sizes (the default is in streebog.test.json)", async () => {
    const m = new TextEncoder().encode(
      "012345678901234567890123456789012345678901234567890123456789012",
    );
    const d256 = hex((await digest(m, "256")).out!);
    expect(d256).toBe("9d151eefd8590b89daa6ba6cb74af9275dd051026bb149a452fd84e5e57b5500");
    expect((await digest(m, "512")).out).toHaveLength(64);
  });

  test("a size that is not an option is rejected", async () => {
    expect((await digest(new Uint8Array(), "384")).code).toBeDefined();
  });

  // No independent implementation is at hand: fixed as a regression value.
  test("64 KiB", async () => {
    expect(hex((await digest(data64k, "256")).out!)).toBe(
      "37afac6100b835e412a9cb43a3ef039376d27d86e59b1718d6697cb902bf6008",
    );
    expect(hex((await digest(data64k, "512")).out!)).toBe(
      "67329da70370c1fe0000669464763201a934d3ad8eccf94a0e881b821a44eb1b8d9f02994f5fc100bff7763638f776ff51994f588f6ddf2958cc6b9b5734ddc1",
    );
  });
});
