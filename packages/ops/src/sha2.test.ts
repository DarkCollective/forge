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
 * Tests for the `sha2` vocabulary (vocab/sha2.fth, with the private primitive `_hash`). The
 * FIPS 180-4 example digests are in vocab/sha2.test.json; these cover the long messages, the
 * default and the bad sizes.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["sha2"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

async function digest(data: Uint8Array, size?: string) {
  const r = await runtime.call(
    "sha2:digest",
    size === undefined ? [bytes(data)] : [bytes(data), str(size)],
  );
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v };
}

describe("sha2:digest", () => {
  test("SHA-256 of abc (the default size is in sha2.test.json)", async () => {
    const abc = new TextEncoder().encode("abc");
    expect(hex((await digest(abc, "256")).out!)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  // FIPS 180-4 / NIST example: one million repetitions of 'a'.
  test("one million 'a' (FIPS 180-4 long message) for SHA-256 and SHA-512", async () => {
    const data = new Uint8Array(1_000_000).fill(0x61);
    expect(hex((await digest(data, "256")).out!)).toBe(
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    );
    expect(hex((await digest(data, "512")).out!)).toBe(
      "e718483d0ce769644e2e42c7bc15b4638e1f98b13b2044285632a803afa973ebde0ff244877ea60a4cb0432ce577c31beb009c5c2c49aa2e4eadb217ad8cc09b",
    );
  });

  // 64 KiB of the pattern (i * 31 + 7) mod 256; the digests were computed with an independent
  // implementation (OpenSSL through node:crypto) and are fixed here.
  test("64 KiB of every size", async () => {
    const data = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);
    const expected: Record<string, string> = {
      "224": "c36c47dd95ca2ce9deedc7e1c7c6e1b3ae2b76bbe4f022ffbfa2d97e",
      "256": "ef4636928161808e87035fa51983821677527ccd9661991c5d0126a778b2268a",
      "384":
        "37c3b89c791d705c8656d8fd4af4629cfed8996dca56b2e74797683d573b8bc44ca8090998681a65af64cba225706153",
      "512":
        "03229952cfe5c2753ba4420a4c2c01489f8737450c4ce1f749a60ece4903e9f9a7843d891c5ce2452f9e6c32b46bab5990af8cdeb5f4c30e0b32fe89bf3c629e",
      "512/224": "3f34b48a47a87ad4a4e8804450b1e951dfa77fb18a2b4284d39f5e79",
      "512/256": "02d8b886c2e1eeeba674c83fa37d522094f974148df9a59802b0b8d66265365f",
    };
    for (const [size, want] of Object.entries(expected)) {
      expect(hex((await digest(data, size)).out!)).toBe(want);
    }
  });

  test("a size that is not an option is rejected", async () => {
    expect((await digest(new Uint8Array(), "128")).code).toBeDefined();
  });
});
