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
 * Tests for the `hash-analysis` vocabulary (vocab/hash-analysis.fth, all FL). The reports for
 * MD5, SHA-1 and SHA-256 are in vocab/hash-analysis.test.json; these cover every table row and a
 * 64 KiB input.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["hash-analysis"]));

async function analyse(text: string) {
  const r = await runtime.call("hash-analysis:analyse", [str(text)]);
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: string }).v };
}

describe("hash-analysis:analyse", () => {
  test("every digest size in the table names algorithms, the well-known ones included", async () => {
    const known: Record<number, string> = {
      2: "CRC-16",
      4: "CRC-32",
      16: "MD5",
      20: "SHA-1",
      28: "SHA-224",
      32: "SHA-256",
      48: "SHA-384",
      64: "SHA-512",
    };
    for (const [n, name] of Object.entries(known)) {
      const out = (await analyse("ab".repeat(Number(n)))).out!;
      expect(out).toContain(`Byte length: ${n}\n`);
      expect(out.split("\n")).toContain(name);
    }
  });

  test("the lengths are in hex characters, bytes and bits", async () => {
    expect((await analyse("00".repeat(100))).out).toMatch(
      /^Hash length: 200\nByte length: 100\nBit length: 800\n\nNo common hashing function/,
    );
  });

  test("a 64 KiB digest (128 Ki hex characters) is inside the default limits", async () => {
    const out = (await analyse("ff".repeat(65536))).out!;
    expect(out).toMatch(/^Hash length: 131072\nByte length: 65536\nBit length: 524288\n/);
  });
});
