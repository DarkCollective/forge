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
 * Tests of the `ecdsa` vocabulary (vocab/ecdsa.fth, with the private primitives of src/prims/ecdsa.ts). The
 * signatures, formats and keys of the four CyberChef ops and the error cases are in vocab/ecdsa.test.json; these
 * cover what a vector cannot: the random key generator (pinned through its seed, and the real op), truncated and
 * mutated keys and signatures, hostile input, the effects, and the cost of 64 KiB.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test, vi } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["ecdsa"]));
// The private words are reachable only from a unit in their own vocabulary, so the test adds a probe.
runtime.load(`IN: ecdsa
: t-generate ( curve:str seed:bytes format:str -- str ) curve seed format _generate ;`);

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const out = (r: Result): string => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return (r.stack[r.stack.length - 1] as { v: string }).v;
};
const steps = (r: Result): number => (r.ok ? r.steps : -1);
const text = (s: string) => new TextEncoder().encode(s);

// Keys made by openssl ecparam -genkey, pkcs8 -topk8 and pkey -pubout (see the vectors in vocab/ecdsa.test.json).
const KEYS = {
  p256Sec1:
    "-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIHLGwbsc6mJo5I9MNBvjFJFmkehAcrmpU+y1LDsVRjgKoAoGCCqGSM49\nAwEHoUQDQgAEV7H/d/aJZe7uSg2oUSkPTpqXyPo40o/+ywZoh2dEl6dbQ+zDukt/\nh7HrpGgSrHJYgEBW9pnA20EKFINw1qJbMA==\n-----END EC PRIVATE KEY-----\n",
  p256P8:
    "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgcsbBuxzqYmjkj0w0\nG+MUkWaR6EByualT7LUsOxVGOAqhRANCAARXsf939oll7u5KDahRKQ9OmpfI+jjS\nj/7LBmiHZ0SXp1tD7MO6S3+HseukaBKscliAQFb2mcDbQQoUg3DWolsw\n-----END PRIVATE KEY-----\n",
  p256Pub:
    "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEV7H/d/aJZe7uSg2oUSkPTpqXyPo4\n0o/+ywZoh2dEl6dbQ+zDukt/h7HrpGgSrHJYgEBW9pnA20EKFINw1qJbMA==\n-----END PUBLIC KEY-----\n",
  p384Pub:
    "-----BEGIN PUBLIC KEY-----\nMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAEx+5HWzV+Z3lWpYgIABch/dXCmcMO7SgX\nmtzc0ZY3lItpRFbr4KI6dXphjcsSjzQtdva7gfdNDtB8kmGyu5JYI/DmHbHADZHD\nbhwqjm2oQp7gcd1r64s4rvjn0mX+UIXe\n-----END PUBLIC KEY-----\n",
  p384P8:
    "-----BEGIN PRIVATE KEY-----\nMIG2AgEAMBAGByqGSM49AgEGBSuBBAAiBIGeMIGbAgEBBDC5hEnxwhBiMEH3RnR7\n2lGMasDSi8j3wcSYDhXzWIlVHlEi85Ex6bJnhZAUH1Q1f3yhZANiAATH7kdbNX5n\neValiAgAFyH91cKZww7tKBea3NzRljeUi2lEVuvgojp1emGNyxKPNC129ruB900O\n0HySYbK7klgj8OYdscANkcNuHCqObahCnuBx3Wvriziu+OfSZf5Qhd4=\n-----END PRIVATE KEY-----\n",
  p521Pub:
    "-----BEGIN PUBLIC KEY-----\nMIGbMBAGByqGSM49AgEGBSuBBAAjA4GGAAQAMM0FNBq47CwOuTY/BNp6HgcnqoKR\nNh/2xI7hvUF+u+ozkgv75KbQGFA0HZSPYtyBts068A9uEA6nO4IjMROHMFIBdUK0\nhqKl6nmlrZfKnG7AMzqTFz2I7o+FF4eA/1S5j/UdkHM/utPmBejGtuNbekhk7XHw\nCoxGVAMPn/uYEGq/I8M=\n-----END PUBLIC KEY-----\n",
  p521Sec1:
    "-----BEGIN EC PRIVATE KEY-----\nMIHcAgEBBEIAMe5wWiEl+Exk8wwG0mU1T1y/+LhGgDZSeoDXP+I8L6MSVwkkf/KA\nRZ/G31FnJr2OX8wNXK7GUDfVZHZazsDUr2mgBwYFK4EEACOhgYkDgYYABAAwzQU0\nGrjsLA65Nj8E2noeByeqgpE2H/bEjuG9QX676jOSC/vkptAYUDQdlI9i3IG2zTrw\nD24QDqc7giMxE4cwUgF1QrSGoqXqeaWtl8qcbsAzOpMXPYjuj4UXh4D/VLmP9R2Q\ncz+60+YF6Ma241t6SGTtcfAKjEZUAw+f+5gQar8jww==\n-----END EC PRIVATE KEY-----\n",
  k1Sec1:
    "-----BEGIN EC PRIVATE KEY-----\nMHQCAQEEIC7Mc4cMCS+rg1uE2RSYsHwN8BQrQXGJvueuIpOi0SbBoAcGBSuBBAAK\noUQDQgAEDHv+EgIPqgr7qX4B64my/1Czqiv9cQHfzGU5VjxueT5Zlf35+aIj+sKf\nKO1fTAdZ3ErBinPvDfehZG2jfwaAMg==\n-----END EC PRIVATE KEY-----\n",
  k1Pub:
    "-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEDHv+EgIPqgr7qX4B64my/1Czqiv9cQHf\nzGU5VjxueT5Zlf35+aIj+sKfKO1fTAdZ3ErBinPvDfehZG2jfwaAMg==\n-----END PUBLIC KEY-----\n",
} as const;

// The key pair a fixed seed gives (bytes (i * 7 + 3) mod 256): the PEM is byte for byte what Python cryptography/OpenSSL
// writes for the private key (seed mod (n - 1)) + 1, the JWK x, y and d match its public numbers.
const PINNED = {
  p256Pem:
    "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEEtlQgGDHEG/Iohr714n/WRSwGtzA\nvvwGIkPJwszOAEToyIsNVmkt21xjPi/QirnN1KtloGF5QJqksn3tMxBMng==\n-----END PUBLIC KEY-----\n\n-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgqXSXLSjrIZKxkZIR\nElkxUT7wsCaG9RtKLrVOTiz4Tg2hRANCAAQS2VCAYMcQb8iiGvvXif9ZFLAa3MC+\n/AYiQ8nCzM4AROjIiw1WaS3bXGM+L9CKuc3Uq2WgYXlAmqSyfe0zEEye\n-----END PRIVATE KEY-----\n",
  p256Der: "a974972d28eb2192b1919211125931513ef0b02686f51b4a2eb54e4e2cf84e0d",
  p256Jwk:
    '{\n    "keys": [\n        {\n            "kty": "EC",\n            "crv": "P-256",\n            "x": "EtlQgGDHEG_Iohr714n_WRSwGtzAvvwGIkPJwszOAEQ",\n            "y": "6MiLDVZpLdtcYz4v0Iq5zdSrZaBheUCapLJ97TMQTJ4",\n            "d": "qXSXLSjrIZKxkZIRElkxUT7wsCaG9RtKLrVOTiz4Tg0",\n            "key_ops": [\n                "sign"\n            ],\n            "kid": "PrivateKey"\n        },\n        {\n            "kty": "EC",\n            "crv": "P-256",\n            "x": "EtlQgGDHEG_Iohr714n_WRSwGtzAvvwGIkPJwszOAEQ",\n            "y": "6MiLDVZpLdtcYz4v0Iq5zdSrZaBheUCapLJ97TMQTJ4",\n            "key_ops": [\n                "verify"\n            ],\n            "kid": "PublicKey"\n        }\n    ]\n}',
  p521Pem:
    "-----BEGIN PUBLIC KEY-----\nMIGbMBAGByqGSM49AgEGBSuBBAAjA4GGAAQAQXZ2VLpkOKAnThTAF0sGfq9dVV71\nGloTvFV8SfHMSPJo21vepOwG2bwviFdWxAOT/E3+HHN8HWn0sEsa3RlvO8MBRxRJ\negcvDl75PM9RXr4lVq4prdx3O7Qb/tHigcNUZaQC+B8tq9Bj6JsdkobMaHmqx4Ga\nTQ9Js+MlK1O8Pu0egd8=\n-----END PUBLIC KEY-----\n\n-----BEGIN PRIVATE KEY-----\nMIHuAgEAMBAGByqGSM49AgEGBSuBBAAjBIHWMIHTAgEBBEIBlEgiqYok/wsAQ+2n\nXJVB6pk/zDBU+/7sYzuh7B9bkPJXn2iSHD3SEykctsrzxPMeNAGEZzy0lT5Juuw8\nsCky1uqhgYkDgYYABABBdnZUumQ4oCdOFMAXSwZ+r11VXvUaWhO8VXxJ8cxI8mjb\nW96k7AbZvC+IV1bEA5P8Tf4cc3wdafSwSxrdGW87wwFHFEl6By8OXvk8z1FeviVW\nrimt3Hc7tBv+0eKBw1RlpAL4Hy2r0GPomx2ShsxoearHgZpND0mz4yUrU7w+7R6B\n3w==\n-----END PRIVATE KEY-----\n",
  p384Der:
    "ac5ec9bef84d2ba3c66351aebd2960df4f0c519a3ccddc59b59d1dc696465ec1f1e6d232e3ec638e8b09759bd06176ed",
} as const;

const sign = (msg: Uint8Array | string, key: string, digest = "sha256", format = "asn1-hex") =>
  runtime.call("ecdsa:sign", [
    bytes(typeof msg === "string" ? text(msg) : msg),
    str(key),
    str(digest),
    str(format),
  ]);
const verify = (
  sig: string,
  pub: string,
  msg: string | Uint8Array,
  format = "auto",
  digest = "sha256",
) =>
  runtime.call("ecdsa:verify", [
    str(sig),
    str(format),
    str(digest),
    str(pub),
    bytes(typeof msg === "string" ? text(msg) : msg),
  ]);
const convert = (sig: string, from = "auto", to = "asn1-hex") =>
  runtime.call("ecdsa:convert-signature", [str(sig), str(from), str(to)]);
const publicKey = (key: string) => runtime.call("ecdsa:public-key", [str(key)]);
const seedOf = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 255);
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64(bytes: Uint8Array, url = false): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chunk = [18, 12, 6, 0].map((s) => B64.charAt((n >> s) & 63)).join("");
    out +=
      chunk.slice(0, Math.min(4, bytes.length - i + 1)) +
      "=".repeat(Math.max(0, i + 3 - bytes.length));
  }
  return url ? out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : out;
}
function unb64(text: string): Uint8Array {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const c of text) {
    const v = B64.indexOf(c);
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 255);
    }
  }
  return Uint8Array.from(out);
}
const pem = (label: string, der: Uint8Array) =>
  `-----BEGIN ${label}-----\n${b64(der)}\n-----END ${label}-----\n`;
const derOf = (p: string) =>
  unb64(
    p
      .split("\n")
      .filter((l) => !l.startsWith("-----"))
      .join(""),
  );

describe("ecdsa:generate-key-pair", () => {
  test("a pinned seed gives the key pair OpenSSL's writer gives for the same private key (P-256)", async () => {
    const g = (format: string) =>
      runtime.call("ecdsa:t-generate", [str("P-256"), bytes(seedOf(48)), str(format)]);
    expect(out(await g("PEM"))).toBe(PINNED.p256Pem);
    expect(out(await g("DER"))).toBe(PINNED.p256Der);
    expect(out(await g("JWK"))).toBe(PINNED.p256Jwk);
  });

  test("P-384 and P-521 pinned (DER is the scalar, PEM is OpenSSL's)", async () => {
    const g = (c: string, n: number, format: string) =>
      runtime.call("ecdsa:t-generate", [str(c), bytes(seedOf(n)), str(format)]);
    expect(out(await g("P-384", 72, "DER"))).toBe(PINNED.p384Der);
    expect(out(await g("P-521", 99, "PEM"))).toBe(PINNED.p521Pem);
  });

  test("the generated private key signs and its public key verifies, for every curve and format", async () => {
    for (const [curve, n] of [
      ["P-256", 48],
      ["P-384", 72],
      ["P-521", 99],
    ] as const) {
      const both = out(
        await runtime.call("ecdsa:t-generate", [str(curve), bytes(seedOf(n)), str("PEM")]),
      );
      const i = both.indexOf("-----BEGIN PRIVATE KEY-----");
      const pub = both.slice(0, i).trim() + "\n";
      const priv = both.slice(i);
      expect(both.startsWith("-----BEGIN PUBLIC KEY-----")).toBe(true);
      expect(both.slice(0, i).endsWith("\n\n")).toBe(true);
      expect(out(await publicKey(priv))).toBe(pub);
      const sig = out(await sign("round trip", priv, "sha256", "p1363-hex"));
      expect(out(await verify(sig, pub, "round trip"))).toBe("Verified OK");
      expect(out(await verify(sig, pub, "another"))).toBe("Verification Failure");
    }
  });

  test("the real op: two key pairs differ, each is a valid key, and it carries the +random effect", async () => {
    const a = out(
      await runtime.call("ecdsa:generate-key-pair", [
        bytes(new Uint8Array(0)),
        str("P-256"),
        str("PEM"),
      ]),
    );
    const b = out(
      await runtime.call("ecdsa:generate-key-pair", [
        bytes(new Uint8Array(0)),
        str("P-256"),
        str("PEM"),
      ]),
    );
    expect(a).not.toBe(b);
    const priv = a.slice(a.indexOf("-----BEGIN PRIVATE KEY-----"));
    expect(out(await publicKey(priv))).toBe(
      a.slice(0, a.indexOf("-----BEGIN PRIVATE")).trim() + "\n",
    );
    expect(runtime.meta("ecdsa:generate-key-pair").effects).toContain("+random");
    expect(runtime.meta("ecdsa:sign").effects).toEqual([]);
  });

  test("the random bytes come from the host generator: a stub pins the key, no generator is E_PRIMITIVE", async () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (a: Uint8Array) => {
        a.fill(7);
        return a;
      },
    });
    const one = out(
      await runtime.call("ecdsa:generate-key-pair", [
        bytes(new Uint8Array(0)),
        str("P-384"),
        str("DER"),
      ]),
    );
    const two = out(
      await runtime.call("ecdsa:generate-key-pair", [
        bytes(new Uint8Array(0)),
        str("P-384"),
        str("DER"),
      ]),
    );
    expect(one).toBe(two);
    expect(one).toHaveLength(96);
    vi.stubGlobal("crypto", undefined);
    const r = await runtime.call("ecdsa:generate-key-pair", [
      bytes(new Uint8Array(0)),
      str("P-256"),
      str("PEM"),
    ]);
    expect(code(r)).toBe("E_PRIMITIVE");
    vi.unstubAllGlobals();
  });

  test("the JWK output is {keys: [private, public]} with the CyberChef extras, indent 4", async () => {
    const j = JSON.parse(
      out(await runtime.call("ecdsa:t-generate", [str("P-256"), bytes(seedOf(48)), str("JWK")])),
    );
    expect(Object.keys(j)).toEqual(["keys"]);
    expect(j.keys[0]).toMatchObject({
      kty: "EC",
      crv: "P-256",
      key_ops: ["sign"],
      kid: "PrivateKey",
    });
    expect(j.keys[1]).toMatchObject({
      kty: "EC",
      crv: "P-256",
      key_ops: ["verify"],
      kid: "PublicKey",
    });
    expect(j.keys[1].d).toBeUndefined();
    expect(
      out(await runtime.call("ecdsa:t-generate", [str("P-256"), bytes(seedOf(48)), str("JWK")])),
    ).toContain('\n    "keys": [');
  });

  test("a seed of the wrong length is E_RANGE", async () => {
    expect(
      code(
        await runtime.call("ecdsa:t-generate", [
          str("P-256"),
          bytes(new Uint8Array(32)),
          str("PEM"),
        ]),
      ),
    ).toBe("E_RANGE");
  });
});

describe("ecdsa:sign", () => {
  test("the same key and message always give the same signature (RFC 6979), and it verifies", async () => {
    const a = out(await sign("hello", KEYS.p256Sec1));
    expect(out(await sign("hello", KEYS.p256Sec1))).toBe(a);
    expect(out(await sign("hello", KEYS.p256P8))).toBe(a);
    expect(out(await verify(a, KEYS.p256Pub, "hello"))).toBe("Verified OK");
    expect(out(await sign("hellp", KEYS.p256Sec1))).not.toBe(a);
  });

  test("an EC PARAMETERS block in front of the key is skipped, and a key with spaces around is read", async () => {
    const withParams =
      "-----BEGIN EC PARAMETERS-----\nBggqhkjOPQMBBw==\n-----END EC PARAMETERS-----\n" +
      KEYS.p256Sec1;
    expect(out(await sign("x", "  \n" + withParams + "\n  "))).toBe(
      out(await sign("x", KEYS.p256Sec1)),
    );
  });

  test("secp256k1, P-384 and P-521 keys sign and verify", async () => {
    const pairs: [string, string][] = [
      [KEYS.k1Sec1, KEYS.k1Pub],
      [KEYS.p384P8, KEYS.p384Pub],
      [KEYS.p521Sec1, KEYS.p521Pub],
    ];
    for (const [priv, pub] of pairs) {
      for (const digest of ["sha1", "sha256", "sha384", "sha512", "md5"]) {
        const sig = out(await sign("m", priv, digest, "jws"));
        expect(out(await verify(sig, pub, "m", "jws", digest))).toBe("Verified OK");
      }
    }
  });

  test("a message of 64 KiB: the cost in VM steps is small and fixed", async () => {
    const msg = new Uint8Array(65536).map((_, i) => i * 31);
    const r = await sign(msg, KEYS.p256Sec1);
    const small = await sign("x", KEYS.p256Sec1);
    expect(Math.abs(steps(r) - steps(small))).toBeLessThan(100);
    expect(steps(r)).toBeLessThan(6000);
    const sig = out(r);
    const v = await verify(sig, KEYS.p256Pub, msg);
    expect(out(v)).toBe("Verified OK");
    expect(steps(v)).toBeLessThan(20000);
  }, 60_000);

  test("an unknown digest or format is a recipe error (the choice list)", async () => {
    expect(code(await sign("x", KEYS.p256Sec1, "sha3"))).not.toBe("ok");
    expect(code(await sign("x", KEYS.p256Sec1, "sha256", "der"))).not.toBe("ok");
  });
});

describe("keys, cut at every point and mutated", () => {
  const ders: [string, string][] = [
    ["EC PRIVATE KEY", KEYS.p256Sec1],
    ["PRIVATE KEY", KEYS.p256P8],
    ["PUBLIC KEY", KEYS.p256Pub],
  ];

  test("a key cut at any point is E_COERCE (never a signature, never another error)", async () => {
    for (const [label, p] of ders) {
      const der = derOf(p);
      for (let cut = 0; cut < der.length; cut++) {
        const key = pem(label, der.subarray(0, cut));
        const r =
          label === "PUBLIC KEY"
            ? await verify("3006020101020102", key, "m")
            : await sign("m", key);
        expect(code(r), `${label} cut at ${cut}`).toBe(cut === 0 ? "E_COERCE" : "E_COERCE");
      }
    }
  });

  test("a key with any byte changed is a result or E_COERCE, nothing else", async () => {
    for (const [label, p] of ders) {
      const der = derOf(p);
      for (let i = 0; i < der.length; i++) {
        const m = Uint8Array.from(der);
        m[i] = (m[i] ?? 0) ^ 0xa5;
        const key = pem(label, m);
        const r =
          label === "PUBLIC KEY"
            ? await verify("3006020101020102", key, "m")
            : await sign("m", key);
        expect(["ok", "E_COERCE"], `${label} byte ${i}`).toContain(code(r));
      }
    }
  });

  test("lengths that lie allocate nothing and are E_COERCE", async () => {
    const huge = Uint8Array.from([0x30, 0x84, 0x7f, 0xff, 0xff, 0xff, 0x02, 0x01, 0x01]);
    expect(code(await sign("m", pem("EC PRIVATE KEY", huge)))).toBe("E_COERCE");
    const octet = Uint8Array.from([
      0x30, 0x0b, 0x02, 0x01, 0x01, 0x04, 0x84, 0xff, 0xff, 0xff, 0xff, 0x00,
    ]);
    expect(code(await sign("m", pem("EC PRIVATE KEY", octet)))).toBe("E_COERCE");
  });

  test("a private key longer than the order, zero, or equal to the order is refused", async () => {
    const der = derOf(KEYS.p256Sec1);
    const at = der.indexOf(0x20, 5); // the 32 of the OCTET STRING
    expect(der[at - 1]).toBe(4);
    for (const fill of [0x00, 0xff]) {
      const m = Uint8Array.from(der);
      m.fill(fill, at + 1, at + 33);
      expect(code(await sign("m", pem("EC PRIVATE KEY", m)))).toBe("E_COERCE");
    }
  });

  test("a shorter private scalar is left-padded, as OpenSSL writes keys with leading zero bytes", async () => {
    // d = 1 as a one-byte OCTET STRING with the named curve in [0]
    const oid = [0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07];
    const der = Uint8Array.from([
      0x30,
      0x10 + 5 - 4 + 4,
      0x02,
      0x01,
      0x01,
      0x04,
      0x01,
      0x01,
      0xa0,
      oid.length,
      ...oid,
    ]);
    der[1] = der.length - 2;
    const one = out(await publicKey(pem("EC PRIVATE KEY", der)));
    const full = Uint8Array.from(derOf(KEYS.p256Sec1));
    full.fill(0, 7, 39);
    full[38] = 1;
    expect(out(await publicKey(pem("EC PRIVATE KEY", full)))).toBe(one);
  });
});

describe("signatures: hostile and large input", () => {
  test("deeply nested JSON is an error, not a crash", async () => {
    const r = await convert("[".repeat(100_000));
    expect(["E_COERCE", "E_LIMIT_VALUE"]).toContain(code(r));
    const o = await convert('{"r":' + "[".repeat(100_000));
    expect(["E_COERCE", "E_LIMIT_VALUE"]).toContain(code(o));
  });

  test("a DER signature cut at every point is E_COERCE", async () => {
    const der =
      "3045022100f83c06749871d6c53b1a1a6cf0c32bf74d2d3b5a5e5b0e8fb1cbe6ecf5c0c1f50220" +
      "11".repeat(32);
    for (let cut = 0; cut < der.length; cut += 2) {
      const r = await convert(der.slice(0, cut), "asn1-hex", "p1363-hex");
      expect(code(r), `cut at ${cut / 2}`).toBe("E_COERCE");
    }
    expect(code(await convert(der, "asn1-hex", "p1363-hex"))).toBe("ok");
  });

  test("64 KiB of hex or JSON is read or refused quickly and in few steps", async () => {
    const big = "ab".repeat(32768);
    // two integers of 256 Kbit each: converted, or refused by the integer size limit, never a crash
    const r = await convert(big, "auto", "asn1-hex");
    expect(["ok", "E_LIMIT_VALUE"]).toContain(code(r));
    expect(steps(r)).toBeLessThan(2_000_000);
    expect(code(await convert(big, "asn1-hex", "p1363-hex"))).toBe("E_COERCE");
    const mid = "ab".repeat(2000);
    const m = await convert(mid, "p1363-hex", "asn1-hex");
    expect(code(m)).toBe("ok");
    expect(steps(m)).toBeLessThan(200_000);
    const json = '{"r":"' + "a".repeat(8000) + '","s":"1"}';
    expect(code(await convert(json, "raw-json", "asn1-hex"))).toBe("ok");
    const junk = await convert("!?".repeat(32768), "auto", "asn1-hex");
    expect(code(junk)).toBe("E_COERCE");
    expect(steps(junk)).toBeLessThan(2_000_000);
  }, 60_000);

  test("white space in the signature is ignored for hex and Base64url but a bad character is E_COERCE", async () => {
    expect(out(await convert(" 30 06 02 01 01 02 01 02 \n", "asn1-hex", "raw-json"))).toBe(
      '{"r":"01","s":"02"}',
    );
    expect(code(await convert("30060201010201zz", "asn1-hex", "raw-json"))).toBe("E_COERCE");
    expect(code(await convert("AAAA*AAA", "jws", "raw-json"))).toBe("E_COERCE");
  });

  test("auto: JSON first, then hex (30 + DER is DER, else P1363), then Base64url", async () => {
    const p1363 = "00".repeat(31) + "01" + "00".repeat(31) + "02";
    const jws = b64(
      Uint8Array.from(p1363.match(/../g) ?? [], (h) => parseInt(h, 16)),
      true,
    );
    expect(out(await convert(p1363, "auto", "raw-json"))).toBe('{"r":"01","s":"02"}');
    expect(out(await convert(jws, "auto", "raw-json"))).toBe('{"r":"01","s":"02"}');
    expect(out(await convert("3006020101020102", "auto", "raw-json"))).toBe('{"r":"01","s":"02"}');
    // hex that starts with 30 but is not DER is P1363
    expect(out(await convert("3001", "auto", "p1363-hex"))).toBe(
      "00".repeat(31) + "30" + "00".repeat(31) + "01",
    );
  });
});
