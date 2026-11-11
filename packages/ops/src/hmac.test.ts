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
 * Tests for the `hmac` vocabulary (vocab/hmac.fth, written in FL over the digest words of md2, md4, md5, sha0, sha1,
 * sha2, sha3, ripemd, ripemd160, has160, whirlpool and snefru). The RFC 2202 and RFC 4231 vectors are in vocab/hmac.test.json; these cover
 * a 64 KiB message under every hash choice, and a key of exactly one block.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["hmac"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const key = new TextEncoder().encode("key-for-64k-test");

async function mac(data: Uint8Array, alg: string, k: Uint8Array) {
  const r = await runtime.call("hmac:digest", [bytes(data), str(alg), bytes(k)]);
  if (!r.ok) return { code: r.error.code, steps: undefined };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v, steps: r.steps };
}

describe("hmac:digest", () => {
  // 64 KiB of the pattern (i * 31 + 7) mod 256 under the key "key-for-64k-test". The MACs were computed
  // with node:crypto (OpenSSL) and fixed here; for md4 and whirlpool with the OpenSSL 3 legacy provider, and for
  // md2, sha0, ripemd128/256/320, has160 and snefru with an RFC 2104 script over Forge's own digests. The 64 KiB inputs stay well inside the default limits.
  test("64 KiB message under every hash choice", async () => {
    const data = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);
    const expected: Record<string, string> = {
      md5: "16a79522e5496a69a94ad006483c9142",
      sha1: "60a46b8ba925b5db22f8be0aa2ade171b21123db",
      sha224: "d5f5288f15daca9d62b578547858961422c26fa9d68401e5ebcf494d",
      sha256: "5988c55baf98f0352a5e9bbea5c1d3f5366d22f92f81f78eb9b634581e87c09b",
      sha384:
        "09ef725fb9f72189988a45e164ccec418603c11c7fea1270106c38fe2c7ae3ead8447698a1fdf1edf96a36222127454e",
      sha512:
        "7ccb56244b0bb0833e0bc97afd9aaf29d1aaf037ecafe358080b64ccb8b44d4b712eaaa9d1c6bc76a9dc3262afcf2512941c22b073aa657e18b8155dc311ed2e",
      "sha512/224": "a1805f1a8dbe8a8815dd12358a66e28225173b3e96311cab2b7b54d1",
      "sha512/256": "cbcce4210a51da7ebbdd1f96a048fc75cd120e04604c9f414d17d841a9e834bc",
      "sha3-224": "0370a73765207a49a24eec5c8f76e64e177777a833f02fc79e1dc10a",
      "sha3-256": "6bb968003453e7601a0a50fafabf48055065b007d69184ecc1a0c15afde01517",
      "sha3-384":
        "3bc73daed400b293c7dc66a65c959384c460435e9250eb329eae012052d352486132f219bdad161dd8c42acb6d0a63ff",
      "sha3-512":
        "fd3569d85990ac1a22e67a7fbcc9e23ab5727fe5418bae8bc44f789a2f4972c9184d0a11eaf6177cefcd237ff717f2805ebd0e36706ea96e799d2359a5ac6cc2",
      ripemd160: "8f22e6d9b07eed34b3efd8e1dcb1a036435704ae",
      md2: "ea30f7c1638c1ece4418fcda988d32df",
      md4: "7d28ad96e90f45173be6951cb842ff0d",
      sha0: "17a92627576d9ba966eab04ce6f0f0e5f121a302",
      ripemd128: "ef48d1884e9ea64064c40e4d0d621e74",
      ripemd256: "22fa8bbe72c8e4fb118b3171a3f75445006f4c34fc78c6bb9d3dd45b53b63186",
      ripemd320: "da57ec712b90afa964288ec26ddcd6d2d61837e16926e8cc12b16a33f3d7668f2d36188647f671e9",
      has160: "fb074cccd5c2189a8eeb6556e10ebfc02c6c5d60",
      whirlpool:
        "5cdbd94e782cf050947d531769607e363bd1bc6f81f507638f34b68bae0aaeb874a8717b1c3b3ef821dae30170914eb221f2f7bcdbbbfc2847b01e387f7288b5",
      snefru: "5f3e35c8775bf2688ea1ff1bed3abfaa",
    };
    for (const [alg, want] of Object.entries(expected)) {
      const r = await mac(data, alg, key);
      expect(r.out && hex(r.out), alg).toBe(want);
    }
  });

  test("a key of exactly one block (64 bytes for md5) is used as is, not hashed", async () => {
    // RFC 2104: a key of the block size is used unchanged; this checks the boundary of the hashed-key path.
    const oneBlock = new Uint8Array(64).fill(0x0b);
    const r = await mac(new TextEncoder().encode("Hi There"), "md5", oneBlock);
    expect(r.out).toBeDefined();
    const longer = await mac(
      new TextEncoder().encode("Hi There"),
      "md5",
      new Uint8Array(65).fill(0x0b),
    );
    expect(longer.out && hex(longer.out)).not.toBe(r.out && hex(r.out));
  });

  test("a hash that is not offered is rejected", async () => {
    expect((await mac(new Uint8Array(), "sha512/128", key)).code).toBeDefined();
    expect((await mac(new Uint8Array(), "blake2b", key)).code).toBeDefined();
  });
});
