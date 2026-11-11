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
 * Tests for the lightweight and legacy ciphers of WP 5.27 (vocab/rc4.fth, ciphersaber2.fth, rabbit.fth, tea.fth,
 * xtea.fth, xxtea.fth, present.fth, gost28147.fth and ror13.fth, with their private primitives in src/prims).
 * The published known answers are in the vocab/*.test.json files. These cover 64 KiB inputs against the SHA-256
 * of the output of throwaway independent references (Python, written from the specifications and kept out of the
 * repository), round trips at every length around the block size in every mode, the CipherSaber IV (random,
 * so the tests go through a decrypt round trip), the Rabbit byte orders, the step counts, and error codes.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str, int } = valueHelpers;
const runtime = assembleRuntime(
  await loadBundleNode([
    "rc4",
    "ciphersaber2",
    "rabbit",
    "tea",
    "xtea",
    "xxtea",
    "present",
    "gost28147",
    "ror13",
  ]),
);

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const pattern = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff);
const none = new Uint8Array(0);
const KEY16 = Uint8Array.from({ length: 16 }, (_, i) => i);
const IV8 = Uint8Array.from({ length: 8 }, (_, i) => 100 + i);
const GKEY = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 255);
const GIV = Uint8Array.from({ length: 8 }, (_, i) => (i * 11 + 5) & 255);

type Arg = Uint8Array | string | number;
async function call(word: string, args: Arg[]) {
  const vals = args.map((a) =>
    a instanceof Uint8Array ? bytes(a) : typeof a === "number" ? int(a) : str(a),
  );
  const r = await runtime.call(word, vals);
  if (!r.ok) return { code: r.error.code, steps: r.steps };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v, steps: r.steps };
}
async function ok(word: string, args: Arg[]): Promise<Uint8Array> {
  const r = await call(word, args);
  if (r.out === undefined) throw new Error(`${word}: ${String(r.code)}`);
  return r.out;
}

const digest = (u: Uint8Array) => hex(sha256(u));

describe("64 KiB against independent references", () => {
  const data = pattern(65536);

  test("rc4", async () => {
    const r = await call("rc4:crypt", [data, new TextEncoder().encode("Secret"), 0]);
    expect(digest(r.out!)).toBe("89b54695d0313b8b8afd3f61107a16d29eff3defa60dc3de5f0d1b285dbed734");
    expect(r.steps).toBeLessThan(1000);
  });

  test("xxtea", async () => {
    const r = await call("xxtea:encrypt", [data, KEY16]);
    expect(digest(r.out!)).toBe("a0709844997e6037aedecf35d252905ffc3ae29df2a49c24d0dbbaa0e8ae04bd");
    expect(r.out!.length).toBe(65540);
    const back = await ok("xxtea:decrypt", [r.out!, KEY16]);
    expect(hex(back)).toBe(hex(data));
  });

  test("tea CBC", async () => {
    const r = await call("tea:encrypt", [data, KEY16, IV8, "CBC", "pkcs7"]);
    expect(digest(r.out!)).toBe("188d4c3b4dafd2d4af2b8bf7a4674b2ef0fbf8866afab496591af61a8b78b3c2");
    expect(r.steps).toBeLessThan(2_000_000);
  });

  test("xtea CBC", async () => {
    const r = await call("xtea:encrypt", [data, KEY16, IV8, "CBC", "pkcs7", 32]);
    expect(digest(r.out!)).toBe("6114befe539ac7bb41972fccd3787b993dfb752a7c68b867aca8ae74fcab7530");
    expect(r.steps).toBeLessThan(2_000_000);
  });

  test("present CBC", async () => {
    const r = await call("present:encrypt", [data, KEY16.slice(0, 10), IV8, "CBC", "pkcs7"]);
    expect(digest(r.out!)).toBe("de0ec868257344292a9bc3c409c26ffcb47889f63bb2c92d463e7bb6a6d7d07e");
    expect(r.steps).toBeLessThan(2_000_000);
  });

  test("gost28147 CBC and CTR with key meshing", async () => {
    const cbc = await call("gost28147:encrypt", [data, GKEY, GIV, "CBC", "pkcs7", "E-A", "NO"]);
    expect(digest(cbc.out!)).toBe(
      "e48bdf96eb9728c998a21f73bf17ce894f7613767bf97a721c98fa730580434b",
    );
    expect(cbc.steps).toBeLessThan(2_000_000);
    const ctr = await call("gost28147:encrypt", [data, GKEY, GIV, "CTR", "pkcs7", "E-A", "CP"]);
    expect(digest(ctr.out!)).toBe(
      "e88174e2b94b6f7f2941f74642c7390013e7a0adec64abd9c75507dfa32418d0",
    );
  });

  test("rabbit and ciphersaber2 round trip", async () => {
    const enc = await ok("rabbit:crypt", [data, KEY16, IV8, "Big"]);
    expect(hex(await ok("rabbit:crypt", [enc, KEY16, IV8, "Big"]))).toBe(hex(data));
    expect(hex(enc)).not.toBe(hex(data));
    const cs = await ok("ciphersaber2:encrypt", [data, KEY16, 20]);
    expect(cs.length).toBe(65546);
    expect(hex(await ok("ciphersaber2:decrypt", [cs, KEY16, 20]))).toBe(hex(data));
  });
});

describe("modes round trip at every length", () => {
  const lengths = [0, 1, 7, 8, 9, 15, 16, 17, 23, 24, 25, 40];
  const modes = ["CBC", "CFB", "OFB", "CTR", "ECB"];
  for (const mode of modes) {
    test(`tea, xtea, present and gost28147 in ${mode}`, async () => {
      for (const n of lengths) {
        const d = pattern(n);
        const pairs: [string, Arg[]][] = [
          ["tea", [KEY16, IV8, mode, "pkcs7"]],
          ["xtea", [KEY16, IV8, mode, "pkcs7", 20]],
          ["present", [KEY16, IV8, mode, "pkcs7"]],
          ["gost28147", [GKEY, GIV, mode, "pkcs7", "E-D", "NO"]],
          ["gost28147", [GKEY, GIV, mode, "pkcs7", "E-Z", "CP"]],
        ];
        for (const [v, rest] of pairs) {
          const c = await ok(`${v}:encrypt`, [d, ...rest]);
          expect(hex(await ok(`${v}:decrypt`, [c, ...rest]))).toBe(hex(d));
          if (mode === "CFB" || mode === "OFB" || mode === "CTR") expect(c.length).toBe(n);
        }
      }
    });
  }

  test("padding none keeps whole blocks and rejects the rest", async () => {
    const whole = pattern(16);
    const c = await ok("tea:encrypt", [whole, KEY16, IV8, "CBC", "none"]);
    expect(c.length).toBe(16);
    expect(hex(await ok("tea:decrypt", [c, KEY16, IV8, "CBC", "none"]))).toBe(hex(whole));
    expect((await call("tea:encrypt", [pattern(9), KEY16, IV8, "CBC", "none"])).code).toBe(
      "E_COERCE",
    );
  });

  test("an empty IV is eight zero bytes", async () => {
    const a = await ok("xtea:encrypt", [pattern(20), KEY16, none, "CBC", "pkcs7", 32]);
    const b = await ok("xtea:encrypt", [pattern(20), KEY16, new Uint8Array(8), "CBC", "pkcs7", 32]);
    expect(hex(a)).toBe(hex(b));
    expect(
      (await call("xtea:encrypt", [pattern(20), KEY16, new Uint8Array(7), "CBC", "pkcs7", 32]))
        .code,
    ).toBe("E_RANGE");
  });

  test("keys of the wrong length are E_RANGE even for an empty input", async () => {
    expect((await call("tea:encrypt", [none, new Uint8Array(8), none, "CBC", "pkcs7"])).code).toBe(
      "E_RANGE",
    );
    expect(
      (await call("present:encrypt", [none, new Uint8Array(11), IV8, "CBC", "pkcs7"])).code,
    ).toBe("E_RANGE");
    expect(
      (
        await call("gost28147:encrypt", [
          none,
          new Uint8Array(16),
          none,
          "CBC",
          "pkcs7",
          "E-A",
          "NO",
        ])
      ).code,
    ).toBe("E_RANGE");
  });
});

describe("gost28147 key wrap", () => {
  test("wrap then unwrap for every S-box and both wrappings", async () => {
    const cek = pattern(32);
    const ukm = Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2]);
    for (const sbox of ["E-TEST", "E-A", "E-B", "E-C", "E-D", "E-Z", "D-TEST", "D-A"]) {
      for (const w of ["NO", "CP"]) {
        const wrapped = await ok("gost28147:wrap-key", [cek, GKEY, ukm, sbox, w]);
        expect(wrapped.length).toBe(36);
        expect(hex(await ok("gost28147:unwrap-key", [wrapped, GKEY, ukm, sbox, w]))).toBe(hex(cek));
        const bad = await call("gost28147:unwrap-key", [
          wrapped,
          GKEY,
          ukm,
          sbox,
          w === "NO" ? "CP" : "NO",
        ]);
        expect(bad.code).toBe("E_COERCE");
      }
    }
  });

  test("CP wrapping differs from NO", async () => {
    const cek = pattern(32);
    const ukm = new Uint8Array(8).fill(3);
    const a = await ok("gost28147:wrap-key", [cek, GKEY, ukm, "E-A", "NO"]);
    const b = await ok("gost28147:wrap-key", [cek, GKEY, ukm, "E-A", "CP"]);
    expect(hex(a)).not.toBe(hex(b));
  });
});

describe("rabbit byte orders", () => {
  test("Little is Big on the reversed key and IV with every key stream block reversed", async () => {
    const key = pattern(16);
    const iv = pattern(8);
    const zeros = new Uint8Array(48);
    const little = await ok("rabbit:crypt", [zeros, key, iv, "Little"]);
    const big = await ok("rabbit:crypt", [
      zeros,
      key.slice().reverse(),
      iv.slice().reverse(),
      "Big",
    ]);
    for (let b = 0; b < 3; b++)
      expect(hex(little.slice(16 * b, 16 * b + 16))).toBe(
        hex(big.slice(16 * b, 16 * b + 16).reverse()),
      );
  });

  test("a short last block is a cut of the full block", async () => {
    const key = pattern(16);
    const full = await ok("rabbit:crypt", [new Uint8Array(16), key, none, "Big"]);
    const part = await ok("rabbit:crypt", [new Uint8Array(5), key, none, "Big"]);
    expect(hex(part)).toBe(hex(full.slice(11)));
    const fullL = await ok("rabbit:crypt", [new Uint8Array(16), key, none, "Little"]);
    const partL = await ok("rabbit:crypt", [new Uint8Array(5), key, none, "Little"]);
    expect(hex(partL)).toBe(hex(fullL.slice(0, 5)));
  });
});

describe("ciphersaber2", () => {
  test("every encryption draws a fresh IV, and the first ten bytes are it", async () => {
    const d = pattern(30);
    const a = await ok("ciphersaber2:encrypt", [d, KEY16, 20]);
    const b = await ok("ciphersaber2:encrypt", [d, KEY16, 20]);
    expect(hex(a.slice(0, 10))).not.toBe(hex(b.slice(0, 10)));
    expect(hex(await ok("ciphersaber2:decrypt", [a, KEY16, 20]))).toBe(hex(d));
    expect(hex(await ok("ciphersaber2:decrypt", [b, KEY16, 20]))).toBe(hex(d));
    expect(hex(await ok("ciphersaber2:decrypt", [a, KEY16, 19]))).not.toBe(hex(d));
  });

  test("the IV is the front of the message: fixing it fixes the cipher text", async () => {
    // CipherSaber-1 (one round) with a zero IV and a one-byte key equals RC4 of the key followed by the IV.
    const iv = new Uint8Array(10);
    const msg = pattern(20);
    const viaCs = await ok("ciphersaber2:decrypt", [
      Uint8Array.from([...iv, ...msg]),
      Uint8Array.from([1]),
      1,
    ]);
    const viaRc4 = await ok("rc4:crypt", [msg, Uint8Array.from([1, ...iv]), 0]);
    expect(hex(viaCs)).toBe(hex(viaRc4));
  });
});

describe("rc4", () => {
  test("drop skips key stream bytes", async () => {
    const zeros = new Uint8Array(40);
    const all = await ok("rc4:crypt", [zeros, KEY16, 0]);
    const dropped = await ok("rc4:crypt", [zeros.slice(0, 30), KEY16, 10]);
    expect(hex(dropped)).toBe(hex(all.slice(10, 40)));
  });

  test("key length limits", async () => {
    expect((await call("rc4:crypt", [pattern(4), new Uint8Array(257), 0])).code).toBe("E_RANGE");
    expect((await call("rc4:crypt", [pattern(4), new Uint8Array(256), 0])).out).toBeDefined();
  });
});

describe("ror13", () => {
  test("65536 bytes fit the step budget", async () => {
    const r = await call("ror13:hash", [pattern(65536)]);
    expect(r.out!.length).toBe(4);
    expect(r.steps).toBeLessThan(5_000_000);
  });
});
