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
 * Tests for the `nthash` vocabulary (MS-NLMP NTOWFv1). The vectors are in vocab/nthash.test.json.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["nthash", "md4"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

async function run(word: string, arg: Uint8Array | string) {
  const r = await runtime.call(word, [typeof arg === "string" ? str(arg) : bytes(arg)]);
  if (!r.ok) return { code: r.error.code };
  return { out: hex((r.stack[r.stack.length - 1] as { v: Uint8Array }).v) };
}
describe("nthash:digest", () => {
  test("a non-ASCII password is encoded as UTF-16LE (OpenSSL MD4 over the UTF-16LE bytes)", async () => {
    expect((await run("nthash:digest", "pässwörd")).out).toBe("0553152250ac01adb4213cb9938663e4");
  });

  test("a character outside the BMP is a surrogate pair", async () => {
    // MD4 of the UTF-16LE bytes 3d d8 00 de (U+1F600).
    const direct = await run("md4:digest", Uint8Array.of(0x3d, 0xd8, 0x00, 0xde));
    expect((await run("nthash:digest", "\u{1F600}")).out).toBe(direct.out);
  });

  // 32768 characters are 64 KiB of UTF-16LE, within the default limits.
  test("a 32768-character password (64 KiB of UTF-16LE)", async () => {
    const utf16 = new Uint8Array(65536);
    for (let i = 0; i < 65536; i += 2) utf16[i] = 0x61;
    const direct = await run("md4:digest", utf16);
    expect((await run("nthash:digest", "a".repeat(32768))).out).toBe(direct.out);
  });
});
