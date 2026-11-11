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
 * Tests for the `scrypt` vocabulary (vocab/scrypt.fth, with the private primitive `_derive`). The
 * RFC 7914 vectors (all but the 1 GiB one, which is over the memory cap) and the cap cases are in
 * vocab/scrypt.test.json; these run CyberChef's defaults and the largest cost allowed.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["scrypt"]));

const text = (s: string) => new TextEncoder().encode(s);

async function derive(n: number, r: number, p: number, length: number) {
  const res = await runtime.call("scrypt:derive", [
    bytes(text("password")),
    bytes(text("salt")),
    int(n),
    int(r),
    int(p),
    int(length),
  ]);
  if (!res.ok) return { code: res.error.code };
  return { out: (res.stack[res.stack.length - 1] as { v: Uint8Array }).v };
}

describe("scrypt:derive", () => {
  test("CyberChef's defaults (N 16384, r 8, p 1, 64 bytes)", async () => {
    expect((await derive(16384, 8, 1, 64)).out).toHaveLength(64);
  });

  test("the largest work allowed runs: 256 MiB, N * r * p = 2^23", async () => {
    expect((await derive(2 ** 18, 8, 4, 16)).out).toHaveLength(16);
  }, 30_000);

  test("a cost over the cap is E_RANGE", async () => {
    expect((await derive(2 ** 20, 8, 1, 16)).code).toBe("E_RANGE");
  });
});
