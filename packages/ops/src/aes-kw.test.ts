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
 * Tests for the `aes-kw` vocabulary (vocab/aes-kw.fth, with the private primitives of src/prims/aes-kw.ts). The RFC
 * 3394 section 4 vectors are in vocab/aes-kw.test.json. These cover a 64 KiB key wrap against OpenSSL's AES key wrap
 * (the digests were computed once with node:crypto, id-aes128-wrap and id-aes256-wrap with the default IV), every
 * byte of a wrapped key corrupted in turn, and the length rules.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["aes-kw"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const pattern = (n: number, seed = 0) =>
  Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7 + seed) & 0xff);

async function call(word: "wrap" | "unwrap", data: Uint8Array, kek: Uint8Array) {
  const r = await runtime.call(`aes-kw:${word}`, [bytes(data), bytes(kek)]);
  if (!r.ok) return { code: r.error.code, steps: r.steps };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v, steps: r.steps };
}

/**
 * SHA-256 of the wrapped 64 KiB key data (65544 bytes), from OpenSSL through node:crypto, with the default IV, the
 * key data the pattern (i * 31 + 8) mod 256 and the KEK pattern(16 or 32, 9).
 */
const DIGEST: Record<number, string> = {
  16: "c8a401ad9efa02b3c3167caf285062696f8ca6a832c278274c97e05f9badbc83",
  32: "8e1a63dfe7a933852e055ac59b381a32552e82b87d883a1baf468c329e6c5d4f",
};

describe("aes-kw:wrap and aes-kw:unwrap", () => {
  test.each([16, 32])(
    "64 KiB wrap with a %i-byte KEK matches OpenSSL, and unwraps",
    async (klen) => {
      const kek = pattern(klen, 9);
      const keyData = pattern(65536, 1);
      const w = await call("wrap", keyData, kek);
      expect(w.out).toBeDefined();
      expect(w.out!.length).toBe(65536 + 8);
      expect(hex(sha256(w.out!))).toBe(DIGEST[klen]);
      expect(w.steps!).toBeLessThan(5_000_000);
      const u = await call("unwrap", w.out!, kek);
      expect(hex(u.out!)).toBe(hex(keyData));
    },
  );

  test("the wrapped key is 8 bytes longer, and it unwraps, for every length from 16 to 96", async () => {
    const kek = pattern(16, 2);
    for (let n = 16; n <= 96; n += 8) {
      const w = await call("wrap", pattern(n, 1), kek);
      expect(w.out!.length).toBe(n + 8);
      expect(hex((await call("unwrap", w.out!, kek)).out!)).toBe(hex(pattern(n, 1)));
    }
  });

  test("corrupting any byte of a wrapped key fails the integrity check with E_COERCE", async () => {
    const kek = pattern(16, 2);
    const w = (await call("wrap", pattern(24, 1), kek)).out!;
    for (let i = 0; i < w.length; i++) {
      const bad = w.slice();
      bad[i] = (bad[i] ?? 0) ^ 0x01;
      expect((await call("unwrap", bad, kek)).code).toBe("E_COERCE");
    }
  });

  test("the length rules: wrap needs a multiple of 8 and at least 16, unwrap at least 24", async () => {
    const kek = pattern(16, 2);
    expect((await call("wrap", pattern(8), kek)).code).toBe("E_COERCE");
    expect((await call("wrap", pattern(20), kek)).code).toBe("E_COERCE");
    expect((await call("wrap", new Uint8Array(0), kek)).code).toBe("E_COERCE");
    expect((await call("unwrap", pattern(16), kek)).code).toBe("E_COERCE");
    expect((await call("unwrap", pattern(28), kek)).code).toBe("E_COERCE");
  });

  test("a key-encryption key that is not 16, 24 or 32 bytes is E_RANGE", async () => {
    expect((await call("wrap", pattern(16), pattern(15))).code).toBe("E_RANGE");
    expect((await call("unwrap", pattern(24), pattern(20))).code).toBe("E_RANGE");
  });
});
