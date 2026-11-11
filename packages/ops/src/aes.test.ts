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
 * Tests for the `aes` vocabulary (vocab/aes.fth, with the private primitives of src/prims/aes.ts). The NIST SP 800-38A,
 * RFC 3602 and GCM specification vectors are in vocab/aes.test.json; these cover 64 KiB inputs in every mode against
 * node:crypto (OpenSSL), the defaults, round trips at every length around the block size, and the error codes.
 */
import { ecb } from "@noble/ciphers/aes.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["aes"]));

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const pattern = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff);
const KEY = pattern(16);
const IV = pattern(16).map((b) => b ^ 0x5a);

async function run(
  word: "encrypt" | "decrypt",
  data: Uint8Array,
  opts: {
    key?: Uint8Array;
    iv?: Uint8Array;
    mode?: string;
    padding?: string;
    aad?: Uint8Array;
  } = {},
) {
  const args = [
    bytes(data),
    bytes(opts.key ?? KEY),
    bytes(opts.iv ?? IV),
    str(opts.mode ?? "CBC"),
    str(opts.padding ?? "pkcs7"),
    bytes(opts.aad ?? new Uint8Array(0)),
  ];
  const r = await runtime.call(`aes:${word}`, args);
  if (!r.ok) return { code: r.error.code, steps: r.steps };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v, steps: r.steps };
}

/**
 * SHA-256 of the 64 KiB ciphertext, produced by OpenSSL through node:crypto (an independent implementation) and fixed
 * here: the pattern (i * 31 + 7) mod 256 under key pattern(klen) and IV pattern(16) xor 0x5a.
 */
const DIGESTS: Record<string, Record<number, string>> = {
  ECB: {
    16: "93497f699e1dace5600869780ed20807ad40c238ca76477085f8441e8269dc32",
    24: "64f7f21cc5dc6b6f6b2eb86c8efaacc99a745e860832e498411abfff294a1d0b",
    32: "9ec4da5c38ffde8bc90af9e86f48594014757600dac46d12a002ba686e455fc2",
  },
  CBC: {
    16: "a735ac8f57fd7cd2ae4c304c80e1afdfb59309f4ca10b10b00bbf69e00994520",
    24: "a5843cfebe1ecf75763594fc26087ee7f38a74a0e2adb27a8d0ab1d3ef34827e",
    32: "942d8508eaddd5cde51bc4411e9c8a7e778cf8da8ad2b07e9ad40349fa893f2f",
  },
  CFB: {
    16: "61c82276449d12d9abf6d6b7a96fa0112424280c8b3dee296b36b2ecb785b23d",
    24: "6bf35132c68bab6a5674829beb0deaabf4178f2bae3b7694e516c58142c52861",
    32: "c7bc78cce5ae76497545958969c863ce973e54f39f0ef7bd650f2ca064903f83",
  },
  OFB: {
    16: "5ab7c348d0ae762db2a7485ff613d2c8ad524471dd66d5d470ff8b3b23988904",
    24: "94f45b4f1fc45458f59631e0dcb2ad1940b7065ac25a02b4541646d0bcc68173",
    32: "457141de864b9b4685c3eb5e8698f3e39f6ee559403df6470105b5ffad29c1d1",
  },
  CTR: {
    16: "116d9ab146701a7d00b3de4ead7312cf3799d66395882509742843afdc2e0867",
    24: "372192c7d94a9c6f8a1e6df5b2f90f768221a4fb6ba65dfed8f2420414a16a7f",
    32: "25c7a92dddcddb659542f29b220aaf32c0a4589987a92e297d67876204a140ff",
  },
};
const GCM_DIGEST = "16f9d6c467452d1d03522f0423b98c3ce42ebcab661b4d347a4b58a37a08bebd";

describe("aes:encrypt and aes:decrypt", () => {
  // The 64 KiB inputs stay far inside the default limits (OFB, which runs on the FL mode layer, is the costliest).
  test.each(["ECB", "CBC", "CFB", "OFB", "CTR"])(
    "64 KiB in %s against OpenSSL digests, all key sizes",
    async (mode) => {
      const data = pattern(65536);
      for (const klen of [16, 24, 32]) {
        const key = pattern(klen);
        const enc = await run("encrypt", data, { key, mode });
        expect(enc.out).toBeDefined();
        expect(hex(sha256(enc.out!))).toBe(DIGESTS[mode]![klen]);
        expect(enc.steps!).toBeLessThan(5_000_000);
        const dec = await run("decrypt", enc.out!, { key, mode });
        expect(hex(dec.out!)).toBe(hex(data));
        expect(dec.steps!).toBeLessThan(5_000_000);
      }
    },
  );

  test("64 KiB in GCM, the tag appended, with additional data", async () => {
    const data = pattern(65536);
    const iv = IV.slice(0, 12);
    const aad = new TextEncoder().encode("header");
    const enc = await run("encrypt", data, { key: pattern(32), iv, mode: "GCM", aad });
    expect(hex(sha256(enc.out!))).toBe(GCM_DIGEST);
    expect(enc.out!.length).toBe(65536 + 16);
    const dec = await run("decrypt", enc.out!, { key: pattern(32), iv, mode: "GCM", aad });
    expect(hex(dec.out!)).toBe(hex(data));
  });

  test("every length around the block size round-trips in every mode", async () => {
    for (const mode of ["ECB", "CBC", "CFB", "OFB", "CTR", "GCM"]) {
      const iv = mode === "GCM" ? IV.slice(0, 12) : IV;
      for (let n = 0; n <= 49; n++) {
        const data = pattern(n);
        const enc = await run("encrypt", data, { iv, mode });
        const dec = await run("decrypt", enc.out!, { iv, mode });
        expect(hex(dec.out!)).toBe(hex(data));
        const expectLen =
          mode === "ECB" || mode === "CBC"
            ? (Math.floor(n / 16) + 1) * 16
            : mode === "GCM"
              ? n + 16
              : n;
        expect(enc.out!.length).toBe(expectLen);
      }
    }
  });

  // SP 800-38A leaves the incrementing function to the application. CyberChef's AES is node-forge, which adds one
  // to the last four bytes of the counter block, modulo 2^32, with no carry into the other twelve; Forge follows
  // it. The expected key stream is built here from raw ECB blocks of the counters that convention gives.
  test("CTR adds one to the last four bytes only, wrapping without a carry", async () => {
    for (const klen of [16, 24, 32]) {
      for (const low of [0xfffffffe, 0xffffffff, 0xfffffffd, 0]) {
        const iv = Uint8Array.from({ length: 16 }, (_, i) => (i < 12 ? 0x30 + i : 0));
        new DataView(iv.buffer).setUint32(12, low, false);
        const data = pattern(16 * 5 + 3);
        const key = pattern(klen);
        const counter = Uint8Array.from(iv);
        const stream = new Uint8Array(16 * 6);
        for (let b = 0; b < 6; b++) {
          stream.set(ecb(key, { disablePadding: true }).encrypt(counter), b * 16);
          const v = new DataView(counter.buffer);
          v.setUint32(12, (v.getUint32(12, false) + 1) >>> 0, false);
        }
        const want = data.map((x, i) => x ^ stream[i]!);
        const got = await run("encrypt", data, { mode: "CTR", key, iv });
        expect(hex(got.out!), `${klen} bytes, low word ${low.toString(16)}`).toBe(hex(want));
        const back = await run("decrypt", got.out!, { mode: "CTR", key, iv });
        expect(hex(back.out!)).toBe(hex(data));
      }
    }
  });

  test("padding none keeps whole blocks and rejects other lengths with E_COERCE", async () => {
    const data = pattern(32);
    for (const mode of ["ECB", "CBC"]) {
      const enc = await run("encrypt", data, { mode, padding: "none" });
      expect(enc.out!.length).toBe(32);
      expect(enc.out!.length).toBe(32);
      expect((await run("encrypt", pattern(31), { mode, padding: "none" })).code).toBe("E_COERCE");
      expect((await run("decrypt", pattern(31), { mode, padding: "none" })).code).toBe("E_COERCE");
    }
  });

  test("a wrong key or IV for CBC gives bad padding (E_COERCE) or garbage, never a crash", async () => {
    const enc = (await run("encrypt", pattern(20))).out!;
    const wrong = await run("decrypt", enc, { key: pattern(16).map((b) => b ^ 1) });
    expect(wrong.code === "E_COERCE" || wrong.out !== undefined).toBe(true);
  });

  test("GCM rejects a flipped bit anywhere in the ciphertext or tag", async () => {
    const iv = IV.slice(0, 12);
    const enc = (await run("encrypt", pattern(20), { iv, mode: "GCM" })).out!;
    for (const i of [0, 19, 20, 35]) {
      const bad = enc.slice();
      bad[i] = (bad[i] ?? 0) ^ 0x80;
      expect((await run("decrypt", bad, { iv, mode: "GCM" })).code).toBe("E_COERCE");
    }
  });

  test("key and IV length errors are E_RANGE", async () => {
    for (const n of [0, 1, 15, 17, 31, 33]) {
      expect((await run("encrypt", pattern(5), { key: pattern(n) })).code).toBe("E_RANGE");
      expect(
        (await run("encrypt", pattern(5), { key: pattern(n), mode: "GCM", iv: IV.slice(0, 12) }))
          .code,
      ).toBe("E_RANGE");
    }
    for (const mode of ["CBC", "CFB", "OFB", "CTR"]) {
      expect((await run("encrypt", pattern(5), { mode, iv: pattern(12) })).code).toBe("E_RANGE");
    }
    expect((await run("encrypt", pattern(5), { mode: "GCM", iv: pattern(7) })).code).toBe(
      "E_RANGE",
    );
    // ECB ignores the IV, whatever its length.
    expect((await run("encrypt", pattern(5), { mode: "ECB", iv: pattern(3) })).out).toBeDefined();
  });

  test("an unknown mode or padding name is refused by the choice parameter", async () => {
    expect((await run("encrypt", pattern(5), { mode: "XTS" })).code).toBe("E_PARAM_INVALID");
    expect((await run("encrypt", pattern(5), { padding: "zeros" })).code).toBe("E_PARAM_INVALID");
  });
});
