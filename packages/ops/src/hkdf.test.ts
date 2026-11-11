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
 * Tests for the `hkdf` vocabulary (vocab/hkdf.fth, written in FL over hmac:digest). The RFC 5869
 * appendix A vectors and node:crypto cross-checks are in vocab/hkdf.test.json; these hold every hash
 * choice equal to a TypeScript RFC 5869 over the same hmac words, and measure the step cost.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["hkdf", "hmac"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const text = (s: string) => new TextEncoder().encode(s);

const HASHES = [
  "md2",
  "md4",
  "md5",
  "sha0",
  "sha1",
  "sha224",
  "sha256",
  "sha384",
  "sha512",
  "sha512/224",
  "sha512/256",
  "ripemd128",
  "ripemd160",
  "ripemd256",
  "ripemd320",
  "has160",
  "whirlpool",
  "snefru",
];

async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  hash: string,
  extract: string,
  length: number,
) {
  const r = await runtime.call("hkdf:derive", [
    bytes(ikm),
    bytes(salt),
    bytes(info),
    str(hash),
    str(extract),
    int(length),
  ]);
  if (!r.ok) return { code: r.error.code, steps: undefined };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v, steps: r.steps };
}

async function hmac(key: Uint8Array, data: Uint8Array, hash: string) {
  const r = await runtime.call("hmac:digest", [bytes(data), str(hash), bytes(key)]);
  if (!r.ok) throw new Error(r.error.code);
  return (r.stack[r.stack.length - 1] as { v: Uint8Array }).v;
}

/** RFC 5869 sections 2.2 and 2.3 in TypeScript over the hmac words. */
async function reference(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  hash: string,
  length: number,
) {
  const prk = await hmac(salt, ikm, hash);
  const parts: number[] = [];
  let t: Uint8Array = new Uint8Array(0);
  for (let i = 1; parts.length < length; i++) {
    const data = new Uint8Array([...t, ...info, i]);
    t = await hmac(prk, data, hash);
    parts.push(...t);
  }
  return Uint8Array.from(parts.slice(0, length));
}

describe("hkdf:derive", () => {
  test.each(HASHES)(
    "%s equals RFC 5869 over hmac:digest (L spans several blocks)",
    async (hash) => {
      const ikm = text("input keying material");
      const salt = text("a salt");
      const info = text("context info");
      const got = await hkdf(ikm, salt, info, hash, "with salt", 100);
      expect(hex(got.out!)).toBe(hex(await reference(ikm, salt, info, hash, 100)));
    },
  );

  test("no salt is the same as a salt of hash-length zero bytes, and as an empty salt", async () => {
    const ikm = text("ikm");
    const none = (await hkdf(ikm, new Uint8Array(0), text("i"), "sha256", "no salt", 40)).out!;
    const zeros = (await hkdf(ikm, new Uint8Array(32), text("i"), "sha256", "with salt", 40)).out!;
    const empty = (await hkdf(ikm, new Uint8Array(0), text("i"), "sha256", "with salt", 40)).out!;
    expect(hex(none)).toBe(hex(zeros));
    expect(hex(none)).toBe(hex(empty));
  });

  test("skip makes the input the PRK, so the salt is ignored", async () => {
    const a = await hkdf(text("prk"), text("one"), text("i"), "sha1", "skip", 30);
    const b = await hkdf(text("prk"), text("two"), text("i"), "sha1", "skip", 30);
    expect(hex(a.out!)).toBe(hex(b.out!));
    const prk = text("prk");
    const t1 = await hmac(prk, new Uint8Array([...text("i"), 1]), "sha1");
    expect(hex(a.out!.subarray(0, 20))).toBe(hex(t1));
  });

  test("a prefix of a longer output is the shorter output", async () => {
    const long = (await hkdf(text("k"), text("s"), text("i"), "sha256", "with salt", 70)).out!;
    const short = (await hkdf(text("k"), text("s"), text("i"), "sha256", "with salt", 33)).out!;
    expect(hex(long.subarray(0, 33))).toBe(hex(short));
  });

  test("the limit is 255 times the hash length, and the cost is well inside the step budget", async () => {
    const big = await hkdf(text("k"), text("s"), text("i"), "sha512", "with salt", 255 * 64);
    expect(big.out).toHaveLength(255 * 64);
    // The untrusted bake budget is 5,000,000 steps.
    expect(big.steps).toBeLessThan(2_000_000);
    expect(
      (await hkdf(text("k"), text("s"), text("i"), "sha512", "with salt", 255 * 64 + 1)).code,
    ).toBe("E_RANGE");
    expect(
      (await hkdf(text("k"), text("s"), text("i"), "md5", "with salt", 255 * 16 + 1)).code,
    ).toBe("E_RANGE");
    expect((await hkdf(text("k"), text("s"), text("i"), "md5", "with salt", -1)).code).toBe(
      "E_RANGE",
    );
  });

  test("length 0 gives no bytes", async () => {
    expect(
      (await hkdf(text("k"), text("s"), text("i"), "sha256", "with salt", 0)).out,
    ).toHaveLength(0);
  });
});
