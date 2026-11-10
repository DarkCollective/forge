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
 * Tests for the `md5` vocabulary (vocab/md5.fth, with the private primitive `_hash`). The RFC 1321
 * vectors are in vocab/md5.test.json; this file runs the word through the runtime on a 64 KiB input.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["md5"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

async function digest(data: Uint8Array) {
  const r = await runtime.call("md5:digest", [bytes(data)]);
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v };
}

describe("md5:digest", () => {
  // 64 KiB of the pattern (i * 31 + 7) mod 256; the digest was computed with an independent
  // implementation (hashlib) and is fixed here.
  test("64 KiB input", async () => {
    const data = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);
    expect(hex((await digest(data)).out!)).toBe("f19c01fa0371e3c9070b45a85c696c48");
  });
});
