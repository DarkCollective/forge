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
 * Tests for the `blake2b` vocabulary (vocab/blake2b.fth, with the private primitive `_hash`). The RFC
 * 7693 and KAT vectors are in vocab/blake2b.test.json; these cover a 64 KiB input, keyed and unkeyed.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["blake2b"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const key64 = Uint8Array.from({ length: 64 }, (_, i) => i);

async function digest(data: Uint8Array, size: number, key: Uint8Array) {
  const r = await runtime.call("blake2b:digest", [bytes(data), int(size), bytes(key)]);
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v };
}

describe("blake2b:digest", () => {
  // 64 KiB of the pattern (i * 31 + 7) mod 256; the digests were computed with an independent
  // implementation (hashlib, keyed with bytes 00..3f) and are fixed here.
  test("64 KiB input, unkeyed and keyed", async () => {
    const data = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);
    const none = new Uint8Array(0);
    expect(hex((await digest(data, 64, none)).out!)).toBe(
      "108f2925ef0b3b43e7c7049823f4f3b903c0f35ddb89bedd21e13c166a662963200d8a358a9d7e410bba550ef4a55fc9f2ace3d143f23ffea61378fecb4e3303",
    );
    expect(hex((await digest(data, 64, key64)).out!)).toBe(
      "bca4147e8e4a5c2dfc0f75863fec8e437efcc414ec242d54ddb1ea560b47d1c513a59417e60dc5d5b9efd5b18e867f0d656fec205c72b1db3e0e295348179da3",
    );
    expect(hex((await digest(data, 32, none)).out!)).toBe(
      "08723870552f7110fa29bdd85fdede884e02718c58aada22cc8018c087649c17",
    );
    expect(hex((await digest(data, 16, key64)).out!)).toBe("0c8fd8a0e6cd1b1186f894a55a7ffc25");
  });

  test("a key of 65 bytes or a size not offered is rejected", async () => {
    expect((await digest(new Uint8Array(), 64, new Uint8Array(65))).code).toBeDefined();
    expect((await digest(new Uint8Array(), 17, new Uint8Array(0))).code).toBeDefined();
  });
});
