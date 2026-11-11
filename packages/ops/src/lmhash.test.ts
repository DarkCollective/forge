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
 * Tests for the `lmhash` vocabulary. The well-known hashes are in vocab/lmhash.test.json; these cover
 * the construction against OpenSSL DES-ECB, the truncation at 14 bytes, upper-casing before it, and a
 * 64 KiB password.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["lmhash"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

async function lm(text: string) {
  const r = await runtime.call("lmhash:digest", [str(text)]);
  if (!r.ok) return { code: r.error.code };
  return { out: hex((r.stack[r.stack.length - 1] as { v: Uint8Array }).v) };
}

describe("lmhash:digest", () => {
  // The halves are DES-ECB of "KGS!@#$%" under the 7-byte half spread into a DES key. With the zero key
  // (the empty password) OpenSSL gives aad3b435b51404ee: `printf 'KGS!@#$%' | openssl enc -des-ecb
  // -K 0000000000000000 -nopad -provider legacy -provider default`.
  test("the empty password is the DES encryption under the zero key, twice", async () => {
    expect((await lm("")).out).toBe("aad3b435b51404eeaad3b435b51404ee");
  });

  // "PASSWORD" is the halves "PASSWOR" and "D" (zero padded). Spread into DES keys (seven bits to a
  // byte, the byte being the group << 1) they are 5020546a34ba3ca4 and 4400000000000000, and OpenSSL
  // (`printf 'KGS!@#$%' | openssl enc -des-ecb -nopad -K <key> -provider legacy -provider default`)
  // gives e52cac67419a9a22 and 4a3b108f3fa6cb6d: the published LM hash of "password".
  test("PASSWORD: the halves are the OpenSSL DES-ECB results under the spread keys", async () => {
    expect((await lm("password")).out).toBe("e52cac67419a9a224a3b108f3fa6cb6d");
  });

  test("upper-casing comes before the cut at 14 bytes, and the rest is ignored", async () => {
    expect((await lm("Password")).out).toBe((await lm("PASSWORD")).out);
    expect((await lm("abcdefghijklmnopqrstuvwxyz")).out).toBe((await lm("ABCDEFGHIJKLMN")).out);
    // ß upper-cases to SS before the cut (as CyberChef does), so it fills two of the 14 bytes.
    expect((await lm("ßabcdefghijklmn")).out).toBe((await lm("SSABCDEFGHIJKL")).out);
  });

  test("a 64 KiB password is cut at 14 characters", async () => {
    expect((await lm("a".repeat(65536))).out).toBe((await lm("A".repeat(14))).out);
  });
});
