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
 * Tests for the internal `blockmode` vocabulary (vocab/blockmode.fth), the shared ECB/CBC/CFB/OFB/CTR layer and
 * PKCS#7 padding that the block cipher vocabularies drive with a block-function quotation. Two block functions
 * are used, both defined here as test-only primitives of a `tblock` vocabulary: a trivial 8-byte XOR "cipher"
 * (a block cipher of the other block size, with a known answer by hand) and raw AES blocks from @noble/ciphers
 * (independent of src/prims/aes.ts). With AES the layer must give the same bytes as noble's own modes and as
 * `aes:encrypt`, and a 64 KiB CBC encryption must stay inside the default limits.
 */
import { ecb, cbc, cfb, ctr } from "@noble/ciphers/aes.js";
import { definePrimitive, valueHelpers } from "@forge/lang";
import type { ForgeRuntime, RunResult } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str, bool } = valueHelpers;

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));
const pattern = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff);

// Test-only block functions. xor8: an 8-byte block XORed with the key (its own inverse). aes: a raw AES block.
const testPrimitives = [
  definePrimitive(
    "tblock",
    "xor8",
    "( block:bytes key:bytes -- bytes )",
    (b: Uint8Array, k: Uint8Array) => Uint8Array.from(b, (x, i) => x ^ (k[i] ?? 0)),
  ),
  definePrimitive(
    "tblock",
    "aes-enc",
    "( block:bytes key:bytes -- bytes )",
    (b: Uint8Array, k: Uint8Array) => ecb(k, { disablePadding: true }).encrypt(b),
  ),
  definePrimitive(
    "tblock",
    "aes-dec",
    "( block:bytes key:bytes -- bytes )",
    (b: Uint8Array, k: Uint8Array) => ecb(k, { disablePadding: true }).decrypt(b),
  ),
];

const bundle = await loadBundleNode(["blockmode", "aes"]);
const runtime: ForgeRuntime = assembleRuntime({
  ...bundle,
  primitives: [...bundle.primitives, ...testPrimitives],
});
runtime.load(
  `IN: tbtest
USING: blockmode tblock ;
: xenc ( data:bytes mode:str iv:bytes padding:bool key:bytes -- bytes )
  data mode iv 8 padding [ key tblock:xor8 ] blockmode:encrypt ;
: xdec ( data:bytes mode:str iv:bytes padding:bool key:bytes -- bytes )
  data mode iv 8 padding [ key tblock:xor8 ] [ key tblock:xor8 ] blockmode:decrypt ;
: aenc ( data:bytes mode:str iv:bytes padding:bool key:bytes -- bytes )
  data mode iv 16 padding [ key tblock:aes-enc ] blockmode:encrypt ;
: adec ( data:bytes mode:str iv:bytes padding:bool key:bytes -- bytes )
  data mode iv 16 padding [ key tblock:aes-enc ] [ key tblock:aes-dec ] blockmode:decrypt ;
`,
  { unit: "tbtest", trusted: true, scope: { current: "tbtest", using: [] } },
);

async function call(
  word: string,
  data: Uint8Array,
  mode: string,
  iv: Uint8Array,
  padding: boolean,
  key: Uint8Array,
) {
  const r: RunResult = await runtime.call(`tbtest:${word}`, [
    bytes(data),
    str(mode),
    bytes(iv),
    bool(padding),
    bytes(key),
  ]);
  if (!r.ok) return { code: r.error.code, steps: r.steps, message: r.error.message };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v, steps: r.steps };
}

describe("blockmode: PKCS#7 padding", () => {
  const key = unhex("0102030405060708");
  const iv = unhex("a0a1a2a3a4a5a6a7");

  test("pads to a multiple of the block size, a whole block of padding for whole input", async () => {
    // ECB with the all-zero key is the identity, so the output is the padded input.
    const zero = new Uint8Array(8);
    expect(hex((await call("xenc", unhex("616263"), "ECB", iv, true, zero)).out!)).toBe(
      "6162630505050505",
    );
    expect(hex((await call("xenc", new Uint8Array(0), "ECB", iv, true, zero)).out!)).toBe(
      "0808080808080808",
    );
    expect(hex((await call("xenc", unhex("0011223344556677"), "ECB", iv, true, zero)).out!)).toBe(
      "00112233445566770808080808080808",
    );
  });

  test("round trip in every padded length from 0 to 17", async () => {
    for (let n = 0; n <= 17; n++) {
      const data = pattern(n);
      for (const mode of ["ECB", "CBC"]) {
        const enc = (await call("xenc", data, mode, iv, true, key)).out!;
        expect(enc.length).toBe((Math.floor(n / 8) + 1) * 8);
        expect(Array.from((await call("xdec", enc, mode, iv, true, key)).out!)).toEqual(
          Array.from(data),
        );
      }
    }
  });

  test("padding off needs whole blocks (E_COERCE) and keeps them", async () => {
    expect((await call("xenc", pattern(9), "CBC", iv, false, key)).code).toBe("E_COERCE");
    expect((await call("xdec", pattern(9), "ECB", iv, false, key)).code).toBe("E_COERCE");
    const enc = (await call("xenc", pattern(16), "CBC", iv, false, key)).out!;
    expect(enc).toHaveLength(16);
    expect(Array.from((await call("xdec", enc, "CBC", iv, false, key)).out!)).toEqual(
      Array.from(pattern(16)),
    );
  });

  test("bad padding is E_COERCE", async () => {
    const zero = new Uint8Array(8);
    // ECB with the zero key is the identity, so the "ciphertext" is the padded block we write.
    for (const bad of [
      "0102030405060700",
      "0102030405060709",
      "0102030405040404",
      "0102030405060000",
    ]) {
      expect((await call("xdec", unhex(bad), "ECB", iv, true, zero)).code).toBe("E_COERCE");
    }
    expect((await call("xdec", new Uint8Array(0), "ECB", iv, true, zero)).code).toBe("E_COERCE");
    expect((await call("xdec", unhex("0102030405060708"), "ECB", iv, true, zero)).code).toBe(
      "E_COERCE",
    );
    expect(hex((await call("xdec", unhex("4142434404040404"), "ECB", iv, true, zero)).out!)).toBe(
      "41424344",
    );
  });
});

describe("blockmode: the modes with a trivial 8-byte block cipher", () => {
  const key = unhex("0f1e2d3c4b5a6978");
  const iv = unhex("0102030405060708");
  const data = unhex("00112233445566778899aabbccddeeff0011");

  test("CBC encrypts block by block, chaining the previous ciphertext", async () => {
    // Hand computed: c1 = (p1 ^ iv) ^ key, c2 = (p2 ^ c1) ^ key, and so on; the last block is padded.
    const out = (await call("xenc", data, "CBC", iv, true, key)).out!;
    const x = (a: Uint8Array, b: Uint8Array) => Uint8Array.from(a, (v, i) => v ^ b[i]!);
    const padded = Uint8Array.from([...data, 6, 6, 6, 6, 6, 6]);
    let prev = iv;
    const want: number[] = [];
    for (let i = 0; i < padded.length; i += 8) {
      prev = x(x(padded.slice(i, i + 8), prev), key);
      want.push(...prev);
    }
    expect(hex(out)).toBe(hex(Uint8Array.from(want)));
  });

  test.each(["ECB", "CBC", "CFB", "OFB", "CTR"])(
    "%s decrypts what it encrypts, at every length",
    async (mode) => {
      for (let n = 0; n <= 25; n++) {
        const d = pattern(n);
        const enc = (await call("xenc", d, mode, iv, true, key)).out!;
        if (mode === "CFB" || mode === "OFB" || mode === "CTR") expect(enc).toHaveLength(n);
        expect(Array.from((await call("xdec", enc, mode, iv, true, key)).out!)).toEqual(
          Array.from(d),
        );
      }
    },
  );

  test("OFB and CTR are their own inverse and CTR counts the whole block", async () => {
    const zero = new Uint8Array(8);
    // With the zero key the block function is the identity, so CTR output is the counter blocks themselves.
    const ivEnd = unhex("00000000000000fe");
    const out = (await call("xenc", new Uint8Array(24), "CTR", ivEnd, true, zero)).out!;
    expect(hex(out)).toBe("00000000000000fe" + "00000000000000ff" + "0000000000000100");
    // The counter wraps at the block size.
    const wrap = (
      await call("xenc", new Uint8Array(16), "CTR", unhex("ffffffffffffffff"), true, zero)
    ).out!;
    expect(hex(wrap)).toBe("ffffffffffffffff" + "0000000000000000");
  });

  test("a bad IV length or an unknown mode is E_RANGE", async () => {
    expect((await call("xenc", data, "CBC", unhex("0102"), true, key)).code).toBe("E_RANGE");
    expect((await call("xdec", data, "CTR", new Uint8Array(0), true, key)).code).toBe("E_RANGE");
    expect((await call("xenc", data, "XTS", iv, true, key)).code).toBe("E_RANGE");
    expect((await call("xenc", data, "ECB", new Uint8Array(0), true, key)).out).toBeDefined();
  });
});

describe("blockmode driven by raw AES blocks is byte-identical to noble's modes and to aes:encrypt", () => {
  const key = unhex("2b7e151628aed2a6abf7158809cf4f3c");
  const iv = unhex("000102030405060708090a0b0c0d0e0f");

  const nobleModes: Record<
    string,
    (k: Uint8Array, i: Uint8Array) => { encrypt(d: Uint8Array): Uint8Array }
  > = {
    ECB: (k) => ecb(k),
    CBC: (k, i) => cbc(k, i),
    CFB: (k, i) => cfb(k, i),
    CTR: (k, i) => ctr(k, i),
  };

  test.each(["ECB", "CBC", "CFB", "CTR"])(
    "%s at lengths 0 to 70, 128/192/256-bit keys",
    async (mode) => {
      for (const klen of [16, 24, 32]) {
        const k = pattern(klen);
        for (const n of [0, 1, 15, 16, 17, 31, 32, 33, 70]) {
          const d = pattern(n);
          const mine = (await call("aenc", d, mode, iv, true, k)).out!;
          expect(hex(mine)).toBe(hex(nobleModes[mode]!(k, iv).encrypt(d)));
          expect(hex((await call("adec", mine, mode, iv, true, k)).out!)).toBe(hex(d));
        }
      }
    },
  );

  test("OFB (which noble lacks) matches the NIST SP 800-38A F.4.1 vector", async () => {
    const p = unhex(
      "6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710",
    );
    const want =
      "3b3fd92eb72dad20333449f8e83cfb4a7789508d16918f03f53c52dac54ed8259740051e9c5fecf64344f7a82260edcc304c6528f659c77866a510d9c1d6ae5e";
    expect(hex((await call("aenc", p, "OFB", iv, true, key)).out!)).toBe(want);
  });

  test("the same bytes as aes:encrypt, in every mode including OFB", async () => {
    for (const mode of ["ECB", "CBC", "CFB", "OFB", "CTR"]) {
      for (const n of [0, 5, 16, 40]) {
        const d = pattern(n);
        const a = await runtime.call("aes:encrypt", [
          bytes(d),
          bytes(key),
          bytes(iv),
          str(mode),
          str("pkcs7"),
          bytes(new Uint8Array(0)),
        ]);
        if (!a.ok) throw a.error;
        const theirs = (a.stack[a.stack.length - 1] as { v: Uint8Array }).v;
        expect(hex((await call("aenc", d, mode, iv, true, key)).out!)).toBe(hex(theirs));
      }
    }
  });

  // A 64 KiB CBC encryption through the FL mode layer driving a block primitive: the measure that decides that
  // the mode layer is FL (CLAUDE.md / PLAN.md section 3). The default limit is 10,000,000 steps.
  test("64 KiB CBC encryption stays inside the default limits", async () => {
    const d = pattern(65536);
    const r = await call("aenc", d, "CBC", iv, true, key);
    expect(r.out).toBeDefined();
    expect(hex(r.out!)).toBe(hex(cbc(key, iv).encrypt(d)));
    // Measured: about 98,500 steps (ECB 70 thousand, CFB and OFB 98 thousand, CBC decryption 103 thousand, CTR
    // 1.07 million because of the counter arithmetic), against the default limit of 10 million.
    expect(r.steps!).toBeLessThan(200_000);
    const back = await call("adec", r.out!, "CBC", iv, true, key);
    expect(hex(back.out!)).toBe(hex(d));
    expect(back.steps!).toBeLessThan(200_000);
    for (const mode of ["ECB", "CFB", "OFB", "CTR"]) {
      const m = await call("aenc", d, mode, iv, true, key);
      expect(hex(m.out!)).toBe(hex(nobleModes[mode]?.(key, iv).encrypt(d) ?? m.out!));
      expect(m.steps!).toBeLessThan(2_000_000);
    }
  });
});
