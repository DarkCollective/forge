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
 * Tests for the `cmac` vocabulary. The RFC 4493 and SP 800-38B vectors are in vocab/cmac.test.json; these
 * cover a 64 KiB message under every key size (against OpenSSL's CMAC), the two-key Triple DES key, and
 * the errors.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["cmac"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => Number.parseInt(x, 16));

async function cmac(data: Uint8Array, key: Uint8Array, alg: string) {
  const r = await runtime.call("cmac:digest", [bytes(data), bytes(key), str(alg)]);
  if (!r.ok) return { code: r.error.code };
  return { out: hex((r.stack[r.stack.length - 1] as { v: Uint8Array }).v) };
}

describe("cmac:digest", () => {
  // 64 KiB of the pattern (i * 31 + 7) mod 256. The tags come from `openssl mac -cipher <cbc cipher> CMAC`
  // (OpenSSL 3, legacy provider for Triple DES), with the keys of SP 800-38B appendix D.
  const data = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);
  test.each([
    ["AES-128", "2b7e151628aed2a6abf7158809cf4f3c", "AES", "ce83e127d3b39b1b1d0da530c2fc98dd"],
    [
      "AES-192",
      "8e73b0f7da0e6452c810f32b809079e562f8ead2522c6b7b",
      "AES",
      "2e52044778a693679818946c16ef9711",
    ],
    [
      "AES-256",
      "603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4",
      "AES",
      "8aa9f92763c3b9f464f01d20693a9cf3",
    ],
    ["3-key TDES", "8aa83bf8cbda10620bc1bf19fbb6cd58bc313d4a371ca8b5", "TDES", "c1747c395462c0e3"],
    ["2-key TDES", "8aa83bf8cbda10620bc1bf19fbb6cd58", "TDES", "20b1dd73a635d790"],
  ])("64 KiB message, %s", async (_name, key, alg, tag) => {
    expect(await cmac(data, unhex(key), alg)).toEqual({ out: tag });
  });

  test("a 16-byte Triple DES key is K1 K2 K1", async () => {
    const k2 = "8aa83bf8cbda10620bc1bf19fbb6cd58";
    const msg = unhex("6bc1bee22e409f96e93d7e117393172a");
    expect((await cmac(msg, unhex(k2), "TDES")).out).toBe(
      (await cmac(msg, unhex(k2 + "8aa83bf8cbda1062"), "TDES")).out,
    );
  });

  test("bad key lengths are E_RANGE; a cipher outside the choice is E_PARAM_INVALID", async () => {
    const m = new Uint8Array(3);
    expect((await cmac(m, new Uint8Array(15), "AES")).code).toBe("E_RANGE");
    expect((await cmac(m, new Uint8Array(8), "TDES")).code).toBe("E_RANGE");
    expect((await cmac(m, new Uint8Array(32), "TDES")).code).toBe("E_RANGE");
    expect((await cmac(m, new Uint8Array(16), "DES")).code).toBe("E_PARAM_INVALID");
    expect((await cmac(m, new Uint8Array(16), "toString")).code).toBe("E_PARAM_INVALID");
  });
});
