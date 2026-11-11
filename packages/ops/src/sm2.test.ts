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
 * Tests of the `sm2` vocabulary (vocab/sm2.fth, with the private primitives of src/prims/sm2.ts). The decryption of
 * the GB/T 32918.5 annex example and of OpenSSL's ciphertexts, and the error cases, are in vocab/sm2.test.json.
 * These cover the encryption, whose k is random: the word is checked with a fixed k against an independent Python
 * implementation of GB/T 32918.4 (and against OpenSSL, which decrypts what it writes), round trips of the real
 * op, the effects, the cases of the standard (an empty message, the KDF over several blocks) and 64 KiB.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test, vi } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["sm2"]));
// The private words are reachable only from a unit in their own vocabulary, so the test adds probes.
runtime.load(`IN: sm2
: t-encrypt ( msg:bytes px:bytes py:bytes k:bytes format:str -- bytes ) msg px py _public-point k format _encrypt-k ;
: t-kdf ( z:bytes klen:int -- bytes ) z klen _kdf ;`);

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const top = (r: Result): unknown => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return (r.stack[r.stack.length - 1] as { v: unknown }).v;
};
const steps = (r: Result): number => (r.ok ? r.steps : -1);
const hex = (u: unknown) =>
  Array.from(u as Uint8Array, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));

// Known answers of a fixed k. The first is the SM2 encryption example of GB/T 32918.5-2017 annex A (d, k, C1, C3 and
// C2 as published); all of them were computed by an independent Python implementation of GB/T 32918.4 (point
// arithmetic on integers, SM3 from OpenSSL), and the two with an OpenSSL key were decrypted by `openssl pkeyutl
// -decrypt` after being regrouped as its DER SM2_Ciphertext.
const KNOWN = [
  {
    what: "annex example",
    d: "3945208f7b2144b13f36e38ac6d39f95889393692860b51a42fb81ef4df7c5b8",
    px: "09f9df311e5421a150dd7d161e4bc5c672179fad1833fc076bb08ff356f35020",
    py: "ccea490ce26775a52dc6ea718cc1aa600aed05fbf35e084a6632f6072da9ad13",
    k: "59276e27d506861a16680f3ad9c02dccef3cc1fa3cdbe4ce6d54b80deac1bc21",
    msg: "656e6372797074696f6e207374616e64617264",
    C1C3C2:
      "04ebfc718e8d1798620432268e77feb6415e2ede0e073c0f4f640ecd2e149a73e858f9d81e5430a57b36daab8f950a3c64e6ee6a63094d99283aff767e124df059983c18f809e262923c53aec295d30383b54e39d609d160afcb1908d0bd876621886ca989ca9c7d58087307ca93092d651efa",
    C1C2C3:
      "04ebfc718e8d1798620432268e77feb6415e2ede0e073c0f4f640ecd2e149a73e858f9d81e5430a57b36daab8f950a3c64e6ee6a63094d99283aff767e124df021886ca989ca9c7d58087307ca93092d651efa59983c18f809e262923c53aec295d30383b54e39d609d160afcb1908d0bd8766",
  },
  {
    what: "fixed k, 9 bytes, accepted by openssl pkeyutl -decrypt",
    d: "f94d80e51ce2d860a60d47467de0d18f7ebc09cb5fb65c03381cb827e9a5eb57",
    px: "7994b4086b36bd21f4b0168f782572d975818caca02e3efd7fab4216d756e77b",
    py: "84d86942a8ccbcbdedf9672af3df67d70611480d68886ce8310adfd35a1202bc",
    k: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    msg: "68656c6c6f20534d32",
    C1C3C2:
      "3cbb3d1177ffa1a21bb054ae613455eb409a77593d17221808977ecbfb0586479cf75393c8d257997f3fc1df9e952449746fd75ed1307e4dd493ae3dd0a800bd20f6f98cdd7facd754f2720a69e40cea0a724115b61dd12e7567dfc3dc7cf898a4518222c039e4f25d",
    C1C2C3:
      "3cbb3d1177ffa1a21bb054ae613455eb409a77593d17221808977ecbfb0586479cf75393c8d257997f3fc1df9e952449746fd75ed1307e4dd493ae3dd0a800bda4518222c039e4f25d20f6f98cdd7facd754f2720a69e40cea0a724115b61dd12e7567dfc3dc7cf898",
  },
  {
    what: "fixed k, 70 bytes, accepted by openssl pkeyutl -decrypt",
    d: "f94d80e51ce2d860a60d47467de0d18f7ebc09cb5fb65c03381cb827e9a5eb57",
    px: "7994b4086b36bd21f4b0168f782572d975818caca02e3efd7fab4216d756e77b",
    py: "84d86942a8ccbcbdedf9672af3df67d70611480d68886ce8310adfd35a1202bc",
    k: "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0",
    msg: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445",
    C1C3C2:
      "d2d14495815a955c95893f971e88c6d39e5382967b73b601a485a4a698eabec351d6ddc9e82d784e060d3ca01ae7ca2b5373b009b0169e9f653e7c5725d7b9dd199caebb7f33bee450a93e4f4658b1a769a163d0fae393276de408842da399112e6450594718b8de17b5893c64ef81dd766e3b8bea9e706408231e7285f9a75240522970a987b6f023636b24bde317016b3428e240b0668b1ceefe1abc897a1f442c8f256d25",
    C1C2C3:
      "d2d14495815a955c95893f971e88c6d39e5382967b73b601a485a4a698eabec351d6ddc9e82d784e060d3ca01ae7ca2b5373b009b0169e9f653e7c5725d7b9dd2e6450594718b8de17b5893c64ef81dd766e3b8bea9e706408231e7285f9a75240522970a987b6f023636b24bde317016b3428e240b0668b1ceefe1abc897a1f442c8f256d25199caebb7f33bee450a93e4f4658b1a769a163d0fae393276de408842da39911",
  },
] as const;

const encryptK = (m: Uint8Array, px: string, py: string, k: string, format: string) =>
  runtime.call("sm2:t-encrypt", [
    bytes(m),
    bytes(unhex(px)),
    bytes(unhex(py)),
    bytes(unhex(k)),
    str(format),
  ]);
const encrypt = (m: Uint8Array, px: string, py: string, format = "C1C3C2") =>
  runtime.call("sm2:encrypt", [
    bytes(m),
    bytes(unhex(px)),
    bytes(unhex(py)),
    str(format),
    str("sm2p256v1"),
  ]);
const decrypt = (ct: string, d: string, format = "C1C3C2") =>
  runtime.call("sm2:decrypt", [str(ct), bytes(unhex(d)), str(format), str("sm2p256v1")]);

describe("sm2:encrypt with a fixed k", () => {
  for (const kn of KNOWN) {
    test(`${kn.what}: C1C3C2 and C1C2C3 as the independent implementation writes them`, async () => {
      const m = unhex(kn.msg);
      expect(hex(top(await encryptK(m, kn.px, kn.py, kn.k, "C1C3C2")))).toBe(kn.C1C3C2);
      expect(hex(top(await encryptK(m, kn.px, kn.py, kn.k, "C1C2C3")))).toBe(kn.C1C2C3);
    });
  }

  test("an empty message has only C1 and C3, and decrypts to nothing", async () => {
    const kn = KNOWN[0];
    const ct = hex(top(await encryptK(new Uint8Array(0), kn.px, kn.py, kn.k, "C1C3C2")));
    expect(ct).toHaveLength(2 * 96);
    expect(hex(top(await decrypt(ct, kn.d)))).toBe("");
  });

  test("the key derivation over several blocks: the first block is SM3(z || 1), the next SM3(z || 2)", async () => {
    const z = new Uint8Array(64).fill(9);
    const one = top(
      await runtime.call("sm2:t-kdf", [bytes(z), { tag: "int", v: 32 } as never]),
    ) as Uint8Array;
    expect(one).toHaveLength(32);
    const many = top(
      await runtime.call("sm2:t-kdf", [bytes(z), { tag: "int", v: 70 } as never]),
    ) as Uint8Array;
    expect(many).toHaveLength(70);
    expect(hex(many.subarray(0, 32))).toBe(hex(one));
  });
});

describe("sm2:encrypt and sm2:decrypt, the real ops", () => {
  const kn = KNOWN[1];

  test("they round trip in both orders, for lengths around the 32-byte blocks of the KDF", async () => {
    for (const format of ["C1C3C2", "C1C2C3"]) {
      for (const n of [0, 1, 31, 32, 33, 64, 65, 200]) {
        const m = Uint8Array.from({ length: n }, (_, i) => (i * 5 + 1) & 255);
        const ct = top(await encrypt(m, kn.px, kn.py, format)) as string;
        expect(ct).toMatch(/^[0-9a-f]+$/);
        expect(ct).toHaveLength(2 * (96 + n));
        expect(hex(top(await decrypt(ct, kn.d, format)))).toBe(hex(m));
      }
    }
  });

  test("two encryptions of the same message differ (random k), and it carries the +random effect", async () => {
    const m = new TextEncoder().encode("same");
    const a = top(await encrypt(m, kn.px, kn.py));
    const b = top(await encrypt(m, kn.px, kn.py));
    expect(a).not.toBe(b);
    expect(runtime.meta("sm2:encrypt").effects).toContain("+random");
    expect(runtime.meta("sm2:decrypt").effects).toEqual([]);
  });

  test("k comes from the host generator: a stub pins it, none is E_PRIMITIVE", async () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (a: Uint8Array) => {
        a.fill(0x11);
        return a;
      },
    });
    const m = new TextEncoder().encode("pinned");
    const a = top(await encrypt(m, kn.px, kn.py));
    const b = top(await encrypt(m, kn.px, kn.py));
    expect(a).toBe(b);
    expect((a as string).slice(0, 8)).toHaveLength(8);
    vi.stubGlobal("crypto", undefined);
    expect(code(await encrypt(m, kn.px, kn.py))).toBe("E_PRIMITIVE");
    vi.unstubAllGlobals();
  });

  test("decrypting with the wrong key, order or damaged data is E_COERCE", async () => {
    const m = new TextEncoder().encode("secret");
    const ct = top(await encrypt(m, kn.px, kn.py)) as string;
    expect(code(await decrypt(ct, KNOWN[0].d))).toBe("E_COERCE");
    expect(code(await decrypt(ct, kn.d, "C1C2C3"))).toBe("E_COERCE");
    for (let i = 0; i < ct.length; i += 2) {
      const flipped =
        ct.slice(0, i) +
        (parseInt(ct.slice(i, i + 2), 16) ^ 1).toString(16).padStart(2, "0") +
        ct.slice(i + 2);
      expect(code(await decrypt(flipped, kn.d)), `byte ${i / 2}`).toBe("E_COERCE");
    }
  });

  test("a ciphertext cut at any point is E_COERCE", async () => {
    const m = new TextEncoder().encode("cut me at every point");
    const ct = top(await encrypt(m, kn.px, kn.py)) as string;
    for (let cut = 0; cut < ct.length; cut += 2) {
      expect(code(await decrypt(ct.slice(0, cut), kn.d)), `cut at ${cut / 2}`).toBe("E_COERCE");
    }
  });

  test("mutated ciphertext of any byte, in any order, is a result or E_COERCE only", async () => {
    const m = new TextEncoder().encode("mutate");
    const ct = top(await encrypt(m, kn.px, kn.py, "C1C2C3")) as string;
    for (let i = 0; i < ct.length; i += 2) {
      const mutated = ct.slice(0, i) + "a5" + ct.slice(i + 2);
      expect(["ok", "E_COERCE"]).toContain(code(await decrypt(mutated, kn.d, "C1C2C3")));
    }
  });

  test("a 64 KiB message round trips; the KDF dominates the cost (steps measured)", async () => {
    const m = new Uint8Array(65536).map((_, i) => (i * 13) & 255);
    const e = await encrypt(m, kn.px, kn.py);
    const ct = top(e) as string;
    const d = await decrypt(ct, kn.d);
    expect(hex(top(d))).toBe(hex(m));
    expect(steps(e)).toBeLessThan(2_000_000);
    expect(steps(d)).toBeLessThan(2_000_000);
  }, 60_000);

  test("white space and upper case in the ciphertext are accepted", async () => {
    const m = new TextEncoder().encode("spaces");
    const ct = top(await encrypt(m, kn.px, kn.py)) as string;
    const spaced = ct.toUpperCase().replace(/(.{40})/g, "$1 \n");
    expect(hex(top(await decrypt(spaced, kn.d)))).toBe(hex(m));
  });
});
