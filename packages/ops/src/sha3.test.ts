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
 * Tests for the `sha3` vocabulary (vocab/sha3.fth, with the private primitive `_hash`). The FIPS 202
 * vectors are in vocab/sha3.test.json; these cover a 64 KiB input at every size and the bad sizes.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["sha3"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

async function digest(data: Uint8Array, size?: string) {
  const r = await runtime.call(
    "sha3:digest",
    size === undefined ? [bytes(data)] : [bytes(data), str(size)],
  );
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v };
}

describe("sha3:digest", () => {
  // 64 KiB of the pattern (i * 31 + 7) mod 256; the digests were computed with an independent
  // implementation (hashlib) and are fixed here.
  test("64 KiB input at every size", async () => {
    const data = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);
    const expected: Record<string, string> = {
      "224": "b000d531859124671dc4a47a97669b4f9e8ea998fe4959b3ad31d772",
      "256": "9c720e330a12c6dcbfa3243b4263b4fa1c3df62bc251c8d68ef652d274b4990c",
      "384":
        "9c7044d798d6e43d8d6a8a1d57748604b3295fd1f371149a37baa8d082b1a291270a9bdbd52d28d71fc77aa0f7aefc1c",
      "512":
        "a663021217acb60c5386eaca3f4156dd3261350988563b381a7bec26267695134b995ed1a5a60147ddbfa1c43188f9b1ef34974e6d340a450173a9ae9c61679c",
    };
    for (const [size, want] of Object.entries(expected)) {
      expect(hex((await digest(data, size)).out!)).toBe(want);
    }
  });

  test("a size that is not an option is rejected", async () => {
    expect((await digest(new Uint8Array(), "128")).code).toBeDefined();
  });
});
