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
 * Tests of the `gost3410` vocabulary (vocab/gost3410.fth, with the private primitives of src/prims/gost3410.ts). The
 * verification of signatures from an independent Python implementation of RFC 7091, the public keys and the error
 * cases are in vocab/gost3410.test.json. These cover the signature, whose k is random: the Streebog digest and the
 * primitive with a pinned k against the same implementation, round trips of the real op on every curve, the effects,
 * and 64 KiB. The RFC 7091 examples themselves are in src/prims/gost3410.test.ts (they give the digest number e
 * directly, so they say nothing about the hash and its byte order; see the vocabulary header).
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test, vi } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["gost3410"]));
// The private words are reachable only from a unit in their own vocabulary, so the test adds probes.
runtime.load(`IN: gost3410
: t-digest ( data:bytes curve:str -- bytes ) data curve _digest ;
: t-sign ( curve:str d:bytes digest:bytes k:bytes -- bytes ) curve d digest k _sign ;`);

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

// Made by an independent Python implementation of RFC 7091 (affine arithmetic on integers) over the published curves,
// with the digests of the streebog words: a fixed d and k per curve and message.
const KNOWN = [
  {
    curve: "test-256",
    msg: "73616d706c65",
    d: "1b2049c56f8fcec6ce00ee1eba62e1093fada9403a90b5ceeae822983632e9cb",
    k: "7ed281c95e8a742831d803520bb71d8cd50346620d8fcdba2a1186b7fb42021c",
    pub: "6d789f4a41d6d8422fbba7f6cfd15d8cb9d41c2004f62729de6e9e498c8f11fe12ee8ebd17fc22c484e5bd8599c56f7ba82ecab8d1f2c1fb7b49b834aa582f05",
    sig: "7b0fa47abd4e7688fa6bdd9853a95c8acf23cf8dacdd9d5a9a6914e23686e7d84e8ccfe1d2513d506352e90cb0a05dad3c5d34d0a22119d3293e8a6421c8f334",
  },
  {
    curve: "test-512",
    msg: "73616d706c65",
    d: "090ab81caf39c34e7cce44f3fa8bd0f53259f1d3a71568af0e2e66daa4e67f0726c37fc7b3c10818884264fea556b5127b0e3eb27279fae56743100faae4bab9",
    k: "1cac4ed84a17edd9e1a47fe4b5e36f01f39dfc5501978178b17ca05812f861b3e4fa064080a79853801a5c1a2748583a51f43b36908d41d01e421b3552f736d8",
    pub: "06584ed93b4389fdf86879b614cb74f0d777bd0c30361dcc4908eb789df61885a7b135c63c279b5e65640d0f31bc91d4d4e1899a73b8b2271c11148cdd19875a130446e7f1ce7aea31a22a104d8e5e1b4257dcabd48b6f3c9e19f6143f96c7a4414b458861158c293d1fe9a4b3cf52fc1621493ed6dd011b988852af07c08441",
    sig: "025d4777607a40c2c071bdc58cfe85998b8a4f15c2eb7c2793c270b109da1d89807a1d08fde5abcf9fe011142beb1572e0e0ec47a3ec6914ac90e12a231d96851810b9224260d0d98433341ca6659faa478ba4d566b27d397daf1e20197e5216c68c36e394fb7ad647fa292f42e3763899d356068b31f6144e744ba8a8fb9101",
  },
  {
    curve: "test-512",
    msg: "",
    d: "090ab81caf39c34e7cce44f3fa8bd0f53259f1d3a71568af0e2e66daa4e67f0726c37fc7b3c10818884264fea556b5127b0e3eb27279fae56743100faae4bab9",
    k: "1bc18efcfc1001ea58dd1fef4bd0c8065bbb05b58aa6f2f704ae33c830d63c4435e4f4168aed945a605bae3e0dde7ce810e21ba519bc93e2a26dc4f1d85928ee",
    pub: "06584ed93b4389fdf86879b614cb74f0d777bd0c30361dcc4908eb789df61885a7b135c63c279b5e65640d0f31bc91d4d4e1899a73b8b2271c11148cdd19875a130446e7f1ce7aea31a22a104d8e5e1b4257dcabd48b6f3c9e19f6143f96c7a4414b458861158c293d1fe9a4b3cf52fc1621493ed6dd011b988852af07c08441",
    sig: "32a68ed227f85642274f69fa2549d9cd41a495f2a57d1ab45a6e09cd538f6c15d48c481bf1d2e1bd8abb03b4f19f087d710e2583bcb28e40ba5594f03c176bd123dda3cb5851ea76164948ce10ea4dd7aafe0b4af40a2a2de089cdda80baead386a727b21ae528ca442235fc0392b91cf93b3c5eed07e7122c8ea00f552f25f5",
  },
  {
    curve: "test-512",
    msg: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9fa0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcecfd0d1d2d3d4d5d6d7d8d9dadbdcdddedfe0e1e2e3e4e5e6e7e8e9eaebecedeeeff0f1f2f3f4f5f6f7f8f9fafbfcfdfeff",
    d: "090ab81caf39c34e7cce44f3fa8bd0f53259f1d3a71568af0e2e66daa4e67f0726c37fc7b3c10818884264fea556b5127b0e3eb27279fae56743100faae4bab9",
    k: "200d330ccc2fd3dbe676bd567563948ef7f3adcc8a0c819fd26a41e3e62b6dcbc7919ef17e73a39936f6f72a44ee2428cf3c041ca2ab4116489cef75828934fd",
    pub: "06584ed93b4389fdf86879b614cb74f0d777bd0c30361dcc4908eb789df61885a7b135c63c279b5e65640d0f31bc91d4d4e1899a73b8b2271c11148cdd19875a130446e7f1ce7aea31a22a104d8e5e1b4257dcabd48b6f3c9e19f6143f96c7a4414b458861158c293d1fe9a4b3cf52fc1621493ed6dd011b988852af07c08441",
    sig: "20bc3030a204c190f84c338a42e39479c473074b2c1d46722f9b6d9bb33c2adb2198877f811efea5ea4a2c4a1050dca0685731c88e0a437d1627777996829c832c2f06265eb08e8e13cd6475fc6bbfbee8adff818ba66042432bb189f1ef59590c0b4dac63c255f9a3694148c872ffeb47b5438c99b18c01826f5118cf9be75a",
  },
  {
    curve: "cryptopro-a",
    msg: "73616d706c65",
    d: "f59df467a0bd85e02c42835803544bfdae21be34ada4c03698ab404f31f19fa9",
    k: "c5658a3f889a48e788f2529095bde609f71a1cefe8fcdb347ab2976ced193e9f",
    pub: "ed213bd6be94d9ca2a8a9f627198991b23ef4bf116fb56daa08ba78d5faa0c1e41ea12b0cc09ce79a2ce9a60ea32a34cf94479b2de7ed9cebed2697fcf53d884",
    sig: "0d1eee5f3cb8afca1221b00654768ff0649a4e9edeb8b8f4a193bb99fd7a86458e22a7af7925f126c3cd9cdfe5f889af3b374e0ce32d328df99c065dd7c4e00b",
  },
  {
    curve: "cryptopro-a",
    msg: "",
    d: "f59df467a0bd85e02c42835803544bfdae21be34ada4c03698ab404f31f19fa9",
    k: "c6693faf42fa6a86554fad32332e9ebdb5f726f7a77a1a9bbfa62c7488c701a1",
    pub: "ed213bd6be94d9ca2a8a9f627198991b23ef4bf116fb56daa08ba78d5faa0c1e41ea12b0cc09ce79a2ce9a60ea32a34cf94479b2de7ed9cebed2697fcf53d884",
    sig: "1a7bea78a07b1f37399c2949b629185f5e339767af51ae2a1d5ec84992983f03f91d2cd48884d866edeab422a1c533b6d22e0b69b0e4972d524fc9f1c1e9c88d",
  },
  {
    curve: "cryptopro-a",
    msg: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9fa0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcecfd0d1d2d3d4d5d6d7d8d9dadbdcdddedfe0e1e2e3e4e5e6e7e8e9eaebecedeeeff0f1f2f3f4f5f6f7f8f9fafbfcfdfeff",
    d: "f59df467a0bd85e02c42835803544bfdae21be34ada4c03698ab404f31f19fa9",
    k: "0b35d854d2601e31866cd773973821ea5866f85b87ba88026d4e7a415d18225d",
    pub: "ed213bd6be94d9ca2a8a9f627198991b23ef4bf116fb56daa08ba78d5faa0c1e41ea12b0cc09ce79a2ce9a60ea32a34cf94479b2de7ed9cebed2697fcf53d884",
    sig: "2d8b438914589c8a0f71f0c66047f4d86da837062ca8577d91153adb6799fb13fea36d747cdf0b8858f8fceec0784830cd6c79ef0c0ba369622cb28c5e11e963",
  },
  {
    curve: "cryptopro-b",
    msg: "73616d706c65",
    d: "19d5dccabda3620ea54b936ccb2d0a280140040c9a49e80f74ce94ca8fbcfe88",
    k: "166216267bb4761b3baf56826ca03d15a3d379d8924aa6873247d10ca653c02f",
    pub: "7b2a697f48a1580c65221a38c67b7e44b2f4164b4470d03529a795f040ee91c077c10844344945aaa59c9cc078d749be7e14bd84283f7a2d4155cbfba247c784",
    sig: "11c225e3cd838b538d2c98f0fff3aed93935a615a0f5fec6e099ea4c804a76c32e401e27e43603ea2926f303856040351cc960a41b52763c2f182e568695f3a8",
  },
  {
    curve: "cryptopro-c",
    msg: "73616d706c65",
    d: "41070102e18af5f87a49c1dc20805dedbfed3a91ddd35f6c7c931f9f4edd0754",
    k: "6c99481df2262b2ad4abd1fd5fdf1cbf1a6bee80fbfc2a831ee3501da9100ecc",
    pub: "89f905b97ee924e4e2e6b534098a1b531b1b074fae339e7d685ce8ba97a58a51612364aab0d6b3fd7147670eca75c7d59aa967a3fdfa1aee343a31137328c8c9",
    sig: "34292faf4bccecf91712abada8d82fa2d34ec580f05b015aae6fc433afacae3809547e17972c07c4a251d5c893de4f9d54abfa7c5c324fa7f85e9258d37a582e",
  },
  {
    curve: "tc26-512-a",
    msg: "73616d706c65",
    d: "c3b5747bf8f6d8f5c64c0b489ad134e8ae45f5fc0c753beee681da9c97e7b499fcc170568df0ad09aac1eb0e37fc31d4286062cba824c1745954c7c0fff4e6ea",
    k: "cf119bf49a41cb78764e963c597690e0fcab5ee726e24d76cc0f897c6e291069873589c21da924d43eee41567fba751dc0f5bd6eaac92bfacbb830e37f86edf1",
    pub: "1a871a0a5e85345162e8e167790a5fc070a9f2b899934f6d1820c631efb392c01ce297153fff1d3232d78d5c34c28468422e6b6bf0df126af28181c827ec476855f7b851beff228c70dc53a1946309009ff621333dff566210c7bf67b373ebeeba73a191c2571b8230e335ec9cedb6f7eaeb1ae20948dbd805bd0497ce30f204",
    sig: "7b99aa69c371b21706619e2a95fc6f9d257d36d7b192d5b24c7a510ff0c0e1af83436e8cabc38ea359c081ada4c740bd4a1cd1a726c04c9d79c5cab8863788896c1fbea456c7897a51fd89a90d2d9a0add2a9a7611878ee70d1de1dfaa418e9bb9c16a921da90031ece2db25f81f5cc2aa7eb8c9518bcad79ce5c3d45431169a",
  },
] as const;

const CURVES = [
  "cryptopro-a",
  "cryptopro-b",
  "cryptopro-c",
  "tc26-512-a",
  "test-256",
  "test-512",
] as const;
const wide = (c: string) => (c.includes("512") ? 64 : 32);

const sign = (m: Uint8Array, d: string, curve: string) =>
  runtime.call("gost3410:sign", [bytes(m), bytes(unhex(d)), str(curve)]);
const verify = (sig: string, pub: string, curve: string, m: Uint8Array) =>
  runtime.call("gost3410:verify", [str(sig), bytes(unhex(pub)), str(curve), bytes(m)]);

describe("gost3410:sign with a pinned k", () => {
  for (const kn of KNOWN) {
    test(`${kn.curve}: ${kn.msg.length / 2} bytes, the signature of the independent implementation`, async () => {
      const m = unhex(kn.msg);
      const digest = top(
        await runtime.call("gost3410:t-digest", [bytes(m), str(kn.curve)]),
      ) as Uint8Array;
      expect(digest).toHaveLength(wide(kn.curve));
      const r = await runtime.call("gost3410:t-sign", [
        str(kn.curve),
        bytes(unhex(kn.d)),
        bytes(digest),
        bytes(unhex(kn.k)),
      ]);
      expect(hex(top(r))).toBe(kn.sig);
    });
  }

  test("the digest is Streebog-256 for a 32-byte curve and Streebog-512 for a 64-byte one", async () => {
    const m = new TextEncoder().encode(
      "012345678901234567890123456789012345678901234567890123456789012",
    );
    expect(hex(top(await runtime.call("gost3410:t-digest", [bytes(m), str("cryptopro-a")])))).toBe(
      "9d151eefd8590b89daa6ba6cb74af9275dd051026bb149a452fd84e5e57b5500",
    );
    expect(hex(top(await runtime.call("gost3410:t-digest", [bytes(m), str("tc26-512-a")])))).toBe(
      "1b54d01a4af5b9d5cc3d86d68d285462b19abc2475222f35c085122be4ba1ffa00ad30f8767b3a82384c6574f024c311e2a481332b08ef7f41797891c1646f48",
    );
  });
});

describe("gost3410:sign, verify and public-key, the real ops", () => {
  const d256 = KNOWN.find((k) => k.curve === "cryptopro-a")!;

  test("every curve: a signature verifies, differs from the next one, and a changed message does not verify", async () => {
    for (const curve of CURVES) {
      const k = KNOWN.find((x) => x.curve === curve)!;
      const pub = top(await runtime.call("gost3410:public-key", [str(k.d), str(curve)])) as string;
      expect(pub).toBe(k.pub);
      const m = new TextEncoder().encode(`message for ${curve}`);
      const a = top(await sign(m, k.d, curve)) as string;
      const b = top(await sign(m, k.d, curve)) as string;
      expect(a).toHaveLength(4 * wide(curve));
      expect(a).not.toBe(b);
      expect(top(await verify(a, pub, curve, m))).toBe("Verified OK");
      expect(top(await verify(b, pub, curve, m))).toBe("Verified OK");
      expect(top(await verify(a, pub, curve, new TextEncoder().encode("another")))).toBe(
        "Verification Failure",
      );
    }
  });

  test("it carries the +random effect; verify and public-key are pure", () => {
    expect(runtime.meta("gost3410:sign").effects).toContain("+random");
    expect(runtime.meta("gost3410:verify").effects).toEqual([]);
    expect(runtime.meta("gost3410:public-key").effects).toEqual([]);
  });

  test("k comes from the host generator: a stub pins the signature, none is E_PRIMITIVE", async () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (a: Uint8Array) => {
        a.fill(0x33);
        return a;
      },
    });
    const m = new TextEncoder().encode("pinned");
    const a = top(await sign(m, d256.d, "cryptopro-a"));
    expect(top(await sign(m, d256.d, "cryptopro-a"))).toBe(a);
    expect(top(await verify(a as string, d256.pub, "cryptopro-a", m))).toBe("Verified OK");
    vi.stubGlobal("crypto", undefined);
    expect(code(await sign(m, d256.d, "cryptopro-a"))).toBe("E_PRIMITIVE");
    vi.unstubAllGlobals();
  });

  test("a signature cut at any point, or with a changed byte, is a failure or E_COERCE, never an accept", async () => {
    const m = new TextEncoder().encode("cut");
    const sig = top(await sign(m, d256.d, "cryptopro-a")) as string;
    for (let cut = 0; cut < sig.length; cut += 2) {
      expect(top(await verify(sig.slice(0, cut), d256.pub, "cryptopro-a", m))).toBe(
        "Verification Failure",
      );
    }
    for (let i = 0; i < sig.length; i += 2) {
      const changed =
        sig.slice(0, i) +
        (parseInt(sig.slice(i, i + 2), 16) ^ 0x10).toString(16).padStart(2, "0") +
        sig.slice(i + 2);
      expect(top(await verify(changed, d256.pub, "cryptopro-a", m))).toBe("Verification Failure");
    }
  });

  test("a message of 64 KiB: few steps (the hash is a primitive)", async () => {
    const m = new Uint8Array(65536).map((_, i) => (i * 7) & 255);
    const s = await sign(m, d256.d, "cryptopro-a");
    const sig = top(s) as string;
    const v = await verify(sig, d256.pub, "cryptopro-a", m);
    expect(top(v)).toBe("Verified OK");
    expect(steps(s)).toBeLessThan(5000);
    expect(steps(v)).toBeLessThan(5000);
    const s5 = await sign(m, KNOWN.find((k) => k.curve === "test-512")!.d, "test-512");
    expect(steps(s5)).toBeLessThan(5000);
  }, 60_000);
});
