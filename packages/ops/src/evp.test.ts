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
 * Tests for the `evp` vocabulary (vocab/evp.fth, EVP_BytesToKey written in FL over md5, sha1 and
 * sha2). The `openssl enc -P` vectors and the independent reference with iterations are in
 * vocab/evp.test.json; these cover the cost, the prefix property and the limits.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["evp"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const text = (s: string) => new TextEncoder().encode(s);

async function evp(
  pw: Uint8Array,
  size: number,
  iterations: number,
  hash: string,
  salt: Uint8Array,
) {
  const r = await runtime.call("evp:derive", [
    bytes(pw),
    int(size),
    int(iterations),
    str(hash),
    bytes(salt),
  ]);
  if (!r.ok) return { code: r.error.code, steps: undefined };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v, steps: r.steps };
}

describe("evp:derive", () => {
  test("a shorter key is a prefix of a longer one", async () => {
    const salt = text("12345678");
    for (const hash of ["md5", "sha1", "sha256", "sha384", "sha512"]) {
      const long = (await evp(text("pw"), 100, 1, hash, salt)).out!;
      const short = (await evp(text("pw"), 21, 1, hash, salt)).out!;
      expect(long).toHaveLength(100);
      expect(hex(long.subarray(0, 21))).toBe(hex(short));
    }
  });

  test("the first block is the hash of the passphrase and the salt", async () => {
    // MD5("password" + 8 bytes of salt) is the first 16 bytes of the aes-256-cbc key in evp.test.json.
    const got = (
      await evp(text("password"), 16, 1, "md5", Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))
    ).out!;
    expect(hex(got)).toBe("e7b0971e52ca5cc8d0539fb3412f6316");
  });

  test("the cost is a few dozen steps per iteration, well inside the step budget", async () => {
    // The untrusted bake budget is 5,000,000 steps.
    const big = await evp(text("pw"), 1024, 1, "md5", text("12345678"));
    expect(big.out).toHaveLength(1024);
    expect(big.steps).toBeLessThan(100_000);
    const iterated = await evp(text("pw"), 48, 10000, "sha256", text("12345678"));
    expect(iterated.out).toHaveLength(48);
    expect(iterated.steps).toBeLessThan(2_000_000);
  });

  test("the limits are E_RANGE, and a huge iteration count hits the step limit", async () => {
    expect((await evp(text("pw"), 0, 1, "sha1", text(""))).code).toBe("E_RANGE");
    expect((await evp(text("pw"), 1025, 1, "sha1", text(""))).code).toBe("E_RANGE");
    expect((await evp(text("pw"), 16, 0, "sha1", text(""))).code).toBe("E_RANGE");
    expect((await evp(text("pw"), 16, 100_000_000, "sha1", text(""))).code).toBe("E_LIMIT_STEPS");
  });
});
