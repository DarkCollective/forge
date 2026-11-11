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
 * Tests for the `chacha` vocabulary (vocab/chacha.fth, with the private primitive of src/prims/chacha.ts). The
 * RFC 8439 vectors and the 128-bit-key vector are in vocab/chacha.test.json. These cover a 64 KiB input against
 * OpenSSL's ChaCha20 (the digests were computed once with node:crypto, as in aes.test.ts), the block counter,
 * the reduced rounds, and the round trip at every length around the block size.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { int, str, valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["chacha"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const pattern = (n: number, seed = 0) =>
  Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7 + seed) & 0xff);
const KEY = pattern(32, 3);
const NONCE = pattern(12, 5);
const ZEROS = (n: number) => new Uint8Array(n);

async function chacha(
  data: Uint8Array,
  opts: { key?: Uint8Array; nonce?: Uint8Array; counter?: number; rounds?: string } = {},
) {
  const r = await runtime.call("chacha:encrypt", [
    bytes(data),
    bytes(opts.key ?? KEY),
    bytes(opts.nonce ?? NONCE),
    int(opts.counter ?? 0),
    str(opts.rounds ?? "20"),
  ]);
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v };
}

/**
 * SHA-256 of the 64 KiB ciphertext, produced by OpenSSL's ChaCha20 through node:crypto (16-byte IV: the
 * counter as 4 little-endian bytes, then the 12-byte nonce) and fixed here: the pattern (i * 31 + 7) mod 256
 * under the key pattern(32, 3), the nonce pattern(12, 5), and the counter 0 or 1.
 */
const DIGEST: Record<number, string> = {
  0: "21cc2a39df410e20a6e0b6f3080403066da1ab7636a2488511c19cf102d2b0eb",
  1: "1764635dcc363d7711850d30195c0fc92de7fbd45359efb6d24d395d3daf43ef",
};

describe("chacha:encrypt", () => {
  test.each([0, 1])("64 KiB against OpenSSL ChaCha20 at block counter %i", async (counter) => {
    const out = await chacha(pattern(65536), { counter });
    expect(out.out).toBeDefined();
    expect(hex(sha256(out.out!))).toBe(DIGEST[counter]);
  });

  test("the counter selects the block: counter 1 is the keystream from byte 64", async () => {
    const zero = (await chacha(ZEROS(128))).out!;
    const second = (await chacha(ZEROS(64), { counter: 1 })).out!;
    expect(hex(zero.slice(64))).toBe(hex(second));
  });

  test("the same call both ways: encrypting the output gives the input back", async () => {
    const data = pattern(1000, 11);
    for (const rounds of ["20", "12", "8"]) {
      const enc = (await chacha(data, { rounds, nonce: NONCE })).out!;
      expect(hex((await chacha(enc, { rounds, nonce: NONCE })).out!)).toBe(hex(data));
    }
  });

  test("the output has the input's length for every length around the 64-byte block", async () => {
    for (let n = 0; n <= 130; n++) {
      expect((await chacha(pattern(n))).out!.length).toBe(n);
    }
  });

  test("reduced rounds give different keystreams, and 20 rounds is the default", async () => {
    const a = hex((await chacha(ZEROS(64), { rounds: "20" })).out!);
    const b = hex((await chacha(ZEROS(64), { rounds: "12" })).out!);
    const c = hex((await chacha(ZEROS(64), { rounds: "8" })).out!);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  test("an 8-byte nonce runs the original layout at 20 rounds only", async () => {
    const nonce8 = pattern(8, 5);
    expect((await chacha(ZEROS(64), { nonce: nonce8, rounds: "20" })).out).toBeDefined();
    expect(await chacha(ZEROS(64), { nonce: nonce8, rounds: "12" })).toEqual({ code: "E_RANGE" });
  });

  test("bad key, nonce, counter and rounds raise E_RANGE", async () => {
    expect(await chacha(ZEROS(1), { key: ZEROS(20) })).toEqual({ code: "E_RANGE" });
    expect(await chacha(ZEROS(1), { nonce: ZEROS(9) })).toEqual({ code: "E_RANGE" });
    expect(await chacha(ZEROS(1), { key: ZEROS(16) })).toEqual({ code: "E_RANGE" });
    // The header constraints (int[0..], choice{...}) reject these before the body runs.
    expect(await chacha(ZEROS(1), { counter: -1 })).toEqual({ code: "E_PARAM_INVALID" });
    expect(await chacha(ZEROS(1), { rounds: "10" })).toEqual({ code: "E_PARAM_INVALID" });
  });
});
