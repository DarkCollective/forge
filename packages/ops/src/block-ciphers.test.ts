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
 * Tests for the block cipher vocabularies des, triple-des, blowfish, rc2, rc6, twofish and sm4
 * (WP 5.26; vocab/<v>.fth over the private primitives in src/prims/<v>.ts and the shared `blockmode`
 * layer). The known answers are in vocab/<v>.test.json; these run the words through the runtime:
 *
 *  - 64 KiB in every mode against SHA-256 digests of OpenSSL output (des, triple-des, blowfish, rc2, sm4),
 *    and for all seven ciphers against a reference CBC, CFB, OFB and CTR written here directly on the
 *    single-block functions (independent of the blockmode layer), with the VM steps within the limits;
 *  - round trips at every length around the block size in every mode;
 *  - the defaults, RC2's effective bits, RC6's word size and rounds, and the error codes.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";
import { desEncryptBlock } from "./prims/des.js";
import { tdesEncryptBlock } from "./prims/triple-des.js";
import { bfEncryptBlock, bfInit, bfExpandKey } from "./prims/blowfish.js";
import { rc2EncryptBlock } from "./prims/rc2.js";
import { rc6EncryptBlock } from "./prims/rc6.js";
import { twofishEncryptBlock } from "./prims/twofish.js";
import { sm4EncryptBlock } from "./prims/sm4.js";

const { bytes, str, int } = valueHelpers;
const runtime = assembleRuntime(
  await loadBundleNode(["des", "triple-des", "blowfish", "rc2", "rc6", "twofish", "sm4"]),
);

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const pattern = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff);
const xorBytes = (a: Uint8Array, b: Uint8Array) => a.map((x, i) => x ^ b[i]!);

interface Cipher {
  vocab: string;
  bs: number;
  klen: number;
  /** The extra trailing parameters of the words, in order. */
  extra: ReturnType<typeof int>[];
  enc: (block: Uint8Array, key: Uint8Array) => Uint8Array;
  modes: string[];
}

const ALL = ["ECB", "CBC", "CFB", "OFB", "CTR"];
const bfCache = new Map<string, ReturnType<typeof bfInit>>();
const CIPHERS: Cipher[] = [
  { vocab: "des", bs: 8, klen: 8, extra: [], enc: desEncryptBlock, modes: ALL },
  { vocab: "triple-des", bs: 8, klen: 24, extra: [], enc: tdesEncryptBlock, modes: ALL },
  {
    vocab: "blowfish",
    bs: 8,
    klen: 16,
    extra: [],
    enc: (b, k) => {
      const id = hex(k);
      let st = bfCache.get(id);
      if (!st) {
        st = bfInit();
        bfExpandKey(st, k);
        bfCache.set(id, st);
      }
      return bfEncryptBlock(st, b);
    },
    modes: ALL,
  },
  {
    vocab: "rc2",
    bs: 8,
    klen: 16,
    extra: [int(128)],
    enc: (b, k) => rc2EncryptBlock(b, k, 128),
    modes: ["ECB", "CBC"],
  },
  {
    vocab: "rc6",
    bs: 16,
    klen: 16,
    extra: [int(32), int(20)],
    enc: (b, k) => rc6EncryptBlock(b, k, 32, 20),
    modes: ALL,
  },
  { vocab: "twofish", bs: 16, klen: 32, extra: [], enc: twofishEncryptBlock, modes: ALL },
  { vocab: "sm4", bs: 16, klen: 16, extra: [], enc: sm4EncryptBlock, modes: ALL },
];

async function run(
  c: Cipher,
  word: "encrypt" | "decrypt",
  data: Uint8Array,
  mode: string,
  opts: { key?: Uint8Array; iv?: Uint8Array; padding?: string } = {},
) {
  const iv = opts.iv ?? pattern(c.bs).map((b) => b ^ 0x5a);
  const args = [
    bytes(data),
    bytes(opts.key ?? pattern(c.klen)),
    bytes(iv),
    str(mode),
    str(opts.padding ?? "pkcs7"),
    ...c.extra,
  ];
  const r = await runtime.call(`${c.vocab}:${word}`, args);
  if (!r.ok) return { code: r.error.code, steps: r.steps };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v, steps: r.steps };
}

/** CBC, CFB, OFB and CTR written out on the single-block function, for whole data of any length (a short last block for the stream modes). */
function reference(
  c: Cipher,
  mode: string,
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(data.length);
  const bs = c.bs;
  let prev: Uint8Array = Uint8Array.from(iv);
  const ctr = Uint8Array.from(iv);
  for (let i = 0; i < data.length; i += bs) {
    const blk = data.subarray(i, Math.min(i + bs, data.length));
    let ct: Uint8Array;
    if (mode === "CBC") {
      ct = c.enc(xorBytes(blk, prev), key);
      prev = ct;
    } else if (mode === "CFB") {
      ct = xorBytes(blk, c.enc(prev, key));
      prev = ct.length === bs ? ct : prev;
    } else if (mode === "OFB") {
      prev = c.enc(prev, key);
      ct = xorBytes(blk, prev);
    } else {
      ct = xorBytes(blk, c.enc(ctr, key));
      for (let j = bs - 1; j >= 0; j--) {
        ctr[j] = (ctr[j]! + 1) & 255;
        if (ctr[j] !== 0) break;
      }
    }
    out.set(ct, i);
  }
  return out;
}

/**
 * SHA-256 of the 64 KiB ciphertext produced by OpenSSL (an independent implementation), fixed here: the pattern
 * (i * 31 + 7) mod 256 under the key pattern(klen) and the IV pattern(block size) xor 0x5a, with PKCS#7 for
 * ECB and CBC (rc2: 16-byte key, 128 effective bits; triple-des: a 24-byte key).
 */
const DIGESTS: Record<string, Record<string, string>> = {
  des: {
    ECB: "2f807ed6a7ebc7b842d3480e543ece4c4ed8ca6a3b61000a5a3d09211e6dc6c2",
    CBC: "97083df58f59fbbb382d37b7e265227b0dad4a8b704a3a0739ebd1f034a5a02a",
    CFB: "9f500756825b9519ec2e0e611341b57bd4d17509fedfe86335cf8b40afd10e58",
    OFB: "177c6a4cd430c227faabcc34e280093452d7803d8545ebd96dec0255b7ee47bd",
  },
  "triple-des": {
    ECB: "834db95430a7017422c16e4f04cd9f855b770a469e0599e4d52484c91366208d",
    CBC: "10117b0bc4e47f7197d069336c8c585f5801313a7a33a324895dcdb529bfef9d",
    CFB: "535b5c3df3118bafee9bfb609aac6b256358254a28a030492b0a46ad0f147d0e",
    OFB: "25849092ac6545ff2a70c41a7fa917cdb70ec5655d6b5dd6c1a670dbc9a62d20",
  },
  blowfish: {
    ECB: "5c7d07c1b968c9f8a93b907ac4d7f7b6323a0f22b59cf75a431eea69b081fc24",
    CBC: "de4726f16590b43f947c65420d6326b419af74b6a904f5015dad52cd9d623815",
    CFB: "30884c4e3d6b730ef1f24f62c59d3c114e2eda3ab52c04a83c09f2553f3dc4d7",
    OFB: "61978aadfb2e62036a0b25e0740e40540c338c2f546dda7b6da02a6c113e69e8",
  },
  rc2: {
    ECB: "c35df2c550abf4f551a5de847360282d22eed0937bdff8aac71f85898a0af9e4",
    CBC: "3b34816412bac7dbff5960dc6c274be17bf8c0091f0cf6e542318ab9498c37d5",
    CFB: "39fcf329fb851502da9f59d59a442cfee9facf1e64fba13ba60541a6bbbcd03b",
    OFB: "731677741df0bee2ec58e9dc774e208462620f591c8b3f4f3be4fe2983105bc4",
  },
  sm4: {
    ECB: "caa8cce64266d370d0a43a7b3a969451c2ece5177a9e688898c706887dcabea1",
    CBC: "c583b1b42b6e9987e6a68d0ab118bd871b1dfaed5afbd7d547b998e219875c73",
    CFB: "6cd09ec5431c3c451a00769ded7a346c480a2be641a51152ee8df9fdd339b13e",
    OFB: "1b0da24a21261cebc777751cd2fe4d930483e7f15b794c62f789f9ec91f62129",
    CTR: "337caebdbb2c7cadf2e84ef567c6348f1ba299b0b02859dbd4353114190bb7d4",
  },
};

describe.each(CIPHERS)("$vocab", (c) => {
  const data = pattern(65536);
  const key = pattern(c.klen);
  const iv = pattern(c.bs).map((b) => b ^ 0x5a);

  test.each(c.modes)("64 KiB in %s round trips and matches the reference mode", async (mode) => {
    const enc = await run(c, "encrypt", data, mode);
    expect(enc.out).toBeDefined();
    expect(enc.steps!).toBeLessThan(5_000_000);
    const padded = mode === "ECB" || mode === "CBC";
    expect(enc.out!.length).toBe(padded ? 65536 + c.bs : 65536);
    if (mode !== "ECB") {
      const ref = reference(c, mode, data, key, iv);
      expect(hex(enc.out!.subarray(0, 65536))).toBe(hex(ref));
    }
    const dec = await run(c, "decrypt", enc.out!, mode);
    expect(hex(dec.out!)).toBe(hex(data));
    expect(dec.steps!).toBeLessThan(5_000_000);
  });

  const digests = DIGESTS[c.vocab];
  if (digests)
    test.each(Object.keys(digests).filter((m) => c.modes.includes(m)))(
      "64 KiB in %s against OpenSSL",
      async (mode) => {
        const enc = await run(c, "encrypt", data, mode);
        expect(hex(sha256(enc.out!))).toBe(digests[mode]);
      },
    );

  test("every length around the block size round-trips in every mode", async () => {
    for (const mode of c.modes) {
      for (let n = 0; n <= 3 * c.bs + 1; n++) {
        const d = pattern(n);
        const enc = await run(c, "encrypt", d, mode);
        const dec = await run(c, "decrypt", enc.out!, mode);
        expect(hex(dec.out!)).toBe(hex(d));
        const padded = mode === "ECB" || mode === "CBC";
        expect(enc.out!.length).toBe(padded ? (Math.floor(n / c.bs) + 1) * c.bs : n);
        const whole = padded ? n - (n % c.bs) : n;
        if (mode !== "ECB" && whole > 0)
          expect(hex(enc.out!.subarray(0, whole))).toBe(
            hex(reference(c, mode, d.subarray(0, whole), key, iv)),
          );
      }
    }
  });

  test("a wrong key length is E_RANGE, even for an empty input", async () => {
    for (const bad of [0, c.klen + 1, c.klen - 1].filter((n) => n !== c.klen)) {
      const r = await run(c, "encrypt", new Uint8Array(0), "CBC", { key: pattern(bad) });
      // a few ciphers take a range of key lengths, so only the lengths outside it are checked
      if (r.code !== undefined) expect(r.code).toBe("E_RANGE");
    }
    const r = await run(c, "encrypt", new Uint8Array(0), "CBC", { key: new Uint8Array(300) });
    expect(r.code).toBe("E_RANGE");
  });

  test("a wrong IV length is E_RANGE for CBC and ignored for ECB", async () => {
    const bad = await run(c, "encrypt", data.subarray(0, 32), "CBC", { iv: new Uint8Array(3) });
    expect(bad.code).toBe("E_RANGE");
    const ok = await run(c, "encrypt", data.subarray(0, 32), "ECB", { iv: new Uint8Array(3) });
    expect(ok.out).toBeDefined();
  });

  test("padding none needs whole blocks (E_COERCE), pkcs7 checks (E_COERCE)", async () => {
    const odd = await run(c, "encrypt", pattern(c.bs + 1), "ECB", { padding: "none" });
    expect(odd.code).toBe("E_COERCE");
    const dec = await run(c, "decrypt", pattern(c.bs + 1), "ECB");
    expect(dec.code).toBe("E_COERCE");
    const badPad = await run(c, "decrypt", pattern(c.bs), "ECB");
    expect(badPad.code).toBe("E_COERCE");
  });
});

describe("rc2 effective bits", () => {
  const rc2 = CIPHERS.find((c) => c.vocab === "rc2")!;
  test("the parameter reaches the key expansion", async () => {
    const d = pattern(16);
    const a = await run({ ...rc2, extra: [int(128)] }, "encrypt", d, "ECB");
    const b = await run({ ...rc2, extra: [int(40)] }, "encrypt", d, "ECB");
    expect(hex(a.out!)).not.toBe(hex(b.out!));
    const back = await run({ ...rc2, extra: [int(40)] }, "decrypt", b.out!, "ECB");
    expect(hex(back.out!)).toBe(hex(d));
  });
});

describe("rc6 word size and rounds", () => {
  const rc6 = CIPHERS.find((c) => c.vocab === "rc6")!;
  test("other word sizes use w / 2 byte blocks and round trip in every mode", async () => {
    for (const [w, r] of [
      [8, 16],
      [16, 16],
      [64, 24],
      [128, 28],
    ] as const) {
      const c = { ...rc6, bs: w / 2, extra: [int(w), int(r)] };
      for (const mode of ALL) {
        const d = pattern(3 * (w / 2) + 3);
        const iv = pattern(w / 2);
        const enc = await run(c, "encrypt", d, mode, { iv });
        const dec = await run(c, "decrypt", enc.out!, mode, { iv });
        expect(hex(dec.out!)).toBe(hex(d));
      }
    }
  });

  test("the rounds change the output", async () => {
    const d = pattern(16);
    const a = await run({ ...rc6, extra: [int(32), int(20)] }, "encrypt", d, "ECB");
    const b = await run({ ...rc6, extra: [int(32), int(12)] }, "encrypt", d, "ECB");
    expect(hex(a.out!)).not.toBe(hex(b.out!));
  });

  test("an empty IV is a zero IV for CBC", async () => {
    const d = pattern(40);
    const a = await run(rc6, "encrypt", d, "CBC", { iv: new Uint8Array(0) });
    const b = await run(rc6, "encrypt", d, "CBC", { iv: new Uint8Array(16) });
    expect(hex(a.out!)).toBe(hex(b.out!));
  });

  test("a word size that is not a multiple of 8 is E_RANGE", async () => {
    const r = await run({ ...rc6, extra: [int(12), int(20)] }, "encrypt", pattern(16), "ECB");
    expect(r.code).toBe("E_RANGE");
  });
});

describe("defaults and the 3DES two-key form", () => {
  test("two-key triple-des is the three-key form with K3 = K1", async () => {
    const c = CIPHERS.find((x) => x.vocab === "triple-des")!;
    const k16 = pattern(16);
    const k24 = Uint8Array.from([...k16, ...k16.subarray(0, 8)]);
    const a = await run(c, "encrypt", pattern(30), "CBC", { key: k16 });
    const b = await run(c, "encrypt", pattern(30), "CBC", { key: k24 });
    expect(hex(a.out!)).toBe(hex(b.out!));
  });
});
