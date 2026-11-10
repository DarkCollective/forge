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
 * Tests for the `has160` vocabulary (vocab/has160.fth, with the private primitive `_hash`). The TTAS.KO-12.0011 digests
 * are in vocab/has160.test.json; these cover the word through the runtime: the default parameters,
 * bad parameters and a 64 KiB input.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["has160"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const data64k = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);

async function digest(data: Uint8Array, ...params: string[]) {
  const r = await runtime.call("has160:digest", [bytes(data), ...params.map((p) => str(p))]);
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v };
}

describe("has160:digest", () => {
  test("abc", async () => {
    expect(hex((await digest(new TextEncoder().encode("abc"))).out!)).toBe(
      "975e810488cf2a3d49838478124afce4b1c78804",
    );
  });

  // No independent implementation is at hand: the value was computed by the primitive once its
  // spec vectors passed, and is fixed here as a regression value.
  test("64 KiB", async () => {
    expect(hex((await digest(data64k)).out!)).toBe("af2e9f228abb4e212b62ebff1e4c3242af1ad389");
  });
});
