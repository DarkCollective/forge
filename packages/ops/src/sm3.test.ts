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
 * Tests for the `sm3` vocabulary (vocab/sm3.fth, with the private primitive `_hash`). The GB/T 32905-2016 example digests
 * are in vocab/sm3.test.json; these cover the word through the runtime: the default parameters,
 * bad parameters and a 64 KiB input.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["sm3"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const data64k = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);

async function digest(data: Uint8Array, ...params: string[]) {
  const r = await runtime.call("sm3:digest", [bytes(data), ...params.map((p) => str(p))]);
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v };
}

describe("sm3:digest", () => {
  test("abc", async () => {
    expect(hex((await digest(new TextEncoder().encode("abc"))).out!)).toBe(
      "66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0",
    );
  });

  // The digest was computed with OpenSSL (node's crypto "sm3") and is fixed here.
  test("64 KiB", async () => {
    expect(hex((await digest(data64k)).out!)).toBe(
      "0e4a2be9b211e58f0dc0320fad99a8d61ebc57410878feea4853afd94b20c80b",
    );
  });
});
