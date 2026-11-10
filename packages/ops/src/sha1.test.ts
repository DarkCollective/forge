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
 * Tests for the `sha1` vocabulary (vocab/sha1.fth, with the private primitive `_hash`). The FIPS 180-4
 * vectors are in vocab/sha1.test.json; these cover the long message and a 64 KiB input.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["sha1"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

async function digest(data: Uint8Array) {
  const r = await runtime.call("sha1:digest", [bytes(data)]);
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v };
}

describe("sha1:digest", () => {
  // FIPS 180-4 example: one million repetitions of 'a'.
  test("one million 'a' (FIPS 180-4 long message)", async () => {
    const data = new Uint8Array(1_000_000).fill(0x61);
    expect(hex((await digest(data)).out!)).toBe("34aa973cd4c4daa4f61eeb2bdbad27316534016f");
  });

  // 64 KiB of the pattern (i * 31 + 7) mod 256; the digest was computed with an independent
  // implementation (hashlib) and is fixed here.
  test("64 KiB input", async () => {
    const data = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);
    expect(hex((await digest(data)).out!)).toBe("5c8ac5c8b9e529b72d47d42878e0896f3018324b");
  });
});
