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
 * Tests for the `pbkdf2` vocabulary (vocab/pbkdf2.fth, with the private primitive `_derive`). The RFC
 * 6070 and RFC 7914 vectors and the error cases are in vocab/pbkdf2.test.json; these cover the
 * largest work allowed.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["pbkdf2"]));

const text = (s: string) => new TextEncoder().encode(s);

async function derive(size: number, iterations: number, hash: string) {
  const r = await runtime.call("pbkdf2:derive", [
    bytes(text("password")),
    int(size),
    int(iterations),
    str(hash),
    bytes(text("salt")),
  ]);
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v };
}

describe("pbkdf2:derive", () => {
  test("the largest work (2,000,000 HMAC iterations) runs", async () => {
    expect((await derive(20, 2_000_000, "sha1")).out).toHaveLength(20);
  }, 30_000);

  test("the key size of CyberChef's 128 bits is 16 bytes", async () => {
    expect((await derive(16, 1, "sha1")).out).toHaveLength(16);
  });

  test("an unknown hash is not a choice", async () => {
    expect((await derive(16, 1, "sha3")).code).toBeDefined();
  });
});
