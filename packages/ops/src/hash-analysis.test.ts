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

  test("the table names the checksums and the less common functions of each size", async () => {
    const names: Record<number, string[]> = {
      1: ["Fletcher-8", "CRC-8"],
      2: ["BSD checksum", "SYSV checksum", "Fletcher-16"],
      4: ["Adler-32", "Fletcher-32"],
      8: ["RIPEMD-64", "SipHash-2-4"],
      16: ["MD6-128", "Tiger-128", "Snefru-128"],
      20: ["FSB-160", "HAVAL-160"],
      24: ["Tiger-192", "HAVAL-192"],
      28: ["ECOH-224", "FSB-224", "HAVAL-224"],
      32: ["BLAKE-256", "Groestl-256", "PANAMA", "GOST R 34.11-94", "Snefru-256", "RIPEMD-256"],
      40: ["RIPEMD-320"],
      48: ["ECOH-384", "FSB-384"],
      64: ["JH", "MD6-512", "Spectral Hash", "SWIFFT", "Whirlpool", "Groestl-512", "BLAKE-512"],
      128: ["FNV-1024"],
    };
    for (const [n, list] of Object.entries(names)) {
      const out = (await analyse("ab".repeat(Number(n)))).out!;
      for (const name of list) expect(out.split("\n"), `${n} bytes: ${name}`).toContain(name);
    }
  });

  test("an odd number of digits is a size in half bytes", async () => {
    expect((await analyse("f")).out).toMatch(
      /^Hash length: 1\nByte length: 0.5\nBit length: 4\n\n.*\nFletcher-4\nLuhn algorithm\nVerhoeff algorithm$/s,
    );
    expect((await analyse("fff")).out).toMatch(
      /^Hash length: 3\nByte length: 1.5\nBit length: 12\n/,
    );
  });

  test("whitespace inside the digits is ignored and a letter that is not hex is an error", async () => {
    expect((await analyse("a b\n")).out).toMatch(/^Hash length: 2\nByte length: 1\n/);
    expect(await analyse("ab g")).toEqual({ code: "E_COERCE" });
    expect(await analyse(" \n")).toEqual({ code: "E_COERCE" });
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
