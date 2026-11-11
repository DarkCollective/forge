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
 * Tests for the `jwk` vocabulary (vocab/jwk.fth, src/prims/jwk.ts): PEM to JWK and JWK to PEM. The known-answer
 * vectors (vocab/jwk.test.json) hold keys made with openssl whose members come from Python's cryptography, the
 * PKCS #8 DER written by JWK to PEM compared byte for byte with openssl's, and the examples of RFC 7517 and RFC 8037;
 * these tests add the round trips, truncation at every cut point, mutated input, hostile input and the cost at
 * 64 KiB.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { onCurve, publicKey } from "./prims/jwk.js";
import { loadBundleNode } from "./sources-node.js";

// The package builds against ES2022 only (no Buffer, no URL): the few conversions the tests need.
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function toBase64(b: Uint8Array, url = false): string {
  let s = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = ((b[i] as number) << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63);
    s += i + 1 < b.length ? B64.charAt((n >> 6) & 63) : "=";
    s += i + 2 < b.length ? B64.charAt(n & 63) : "=";
  }
  return url ? s.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "") : s;
}
function fromBase64(s: string): Uint8Array {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const c of s.replaceAll("-", "+").replaceAll("_", "/")) {
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
const fromHex = (h: string): Uint8Array =>
  Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const here = fileURLToPath(import.meta.url).replaceAll("\\", "/");
const vocabFile = (name: string): string =>
  readFileSync(`${here.slice(0, here.lastIndexOf("/"))}/../vocab/${name}`, "utf8");

const { bytes, int, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["jwk"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const out = (r: Result): string => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return (r.stack[r.stack.length - 1] as { v: string }).v;
};
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const fromPem = (text: string | Uint8Array, indent = 0): Promise<Result> =>
  runtime.call("jwk:from-pem", [
    typeof text === "string" ? str(text) : bytes(text),
    int(indent),
  ] as Value[]);
const toPem = (text: string): Promise<Result> => runtime.call("jwk:to-pem", [str(text)] as Value[]);

interface Vector {
  name: string;
  input: { value: string };
  expect: { value?: string };
}
const vectors = JSON.parse(vocabFile("jwk.test.json")) as Vector[];
const named = (name: string): Vector => {
  const v = vectors.find((x) => x.name === name);
  if (v === undefined) throw new Error(`no vector ${name}`);
  return v;
};
const KINDS = [
  "RSA 1024",
  "P-256",
  "P-384",
  "P-521",
  "secp256k1",
  "Ed25519",
  "X25519",
  "Ed448",
  "X448",
];
const pemBody = (pem: string): Uint8Array =>
  fromBase64(
    pem
      .split("\n")
      .filter((l) => l !== "" && !l.startsWith("-----"))
      .join(""),
  );
const pemOf = (label: string, der: Uint8Array): string => {
  const b = toBase64(der);
  return `-----BEGIN ${label}-----\n${b.match(/.{1,64}/g)?.join("\n") ?? ""}\n-----END ${label}-----\n`;
};

function prng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
}

describe("round trips", () => {
  for (const kind of KINDS) {
    test(`${kind}: PEM to JWK to PEM gives the PEM back, private and public`, async () => {
      for (const part of ["private key (PKCS #8)", "public key (SPKI)"]) {
        const pem = named(`from-pem: ${kind} ${part}`).input.value;
        const jwk = out(await fromPem(pem, 0));
        expect(out(await toPem(jwk))).toBe(pem);
      }
    });
  }

  test("the members come in the order of RFC 7518", async () => {
    const order = async (kind: string) =>
      Object.keys(
        JSON.parse(
          out(await fromPem(named(`from-pem: ${kind} private key (PKCS #8)`).input.value)),
        ) as object,
      );
    expect(await order("RSA 1024")).toEqual(["kty", "n", "e", "d", "p", "q", "dp", "dq", "qi"]);
    expect(await order("P-384")).toEqual(["kty", "crv", "x", "y", "d"]);
    expect(await order("Ed25519")).toEqual(["kty", "crv", "x", "d"]);
  });
});

describe("a key cut short is never accepted", () => {
  for (const kind of KINDS) {
    test(`${kind}: the private and the public key cut at every byte`, async () => {
      for (const part of ["private key (PKCS #8)", "public key (SPKI)"]) {
        const label = part.startsWith("private") ? "PRIVATE KEY" : "PUBLIC KEY";
        const der = pemBody(named(`from-pem: ${kind} ${part}`).input.value);
        const bad: string[] = [];
        for (let n = 0; n < der.length; n++) {
          const c = code(await fromPem(pemOf(label, der.slice(0, n))));
          if (c !== "E_COERCE") bad.push(`${part} ${n}:${c}`);
        }
        expect(bad).toEqual([]);
      }
    });
  }

  test("JWK text cut at every character is E_COERCE", async () => {
    for (const kind of ["RSA 1024", "P-256", "Ed25519"]) {
      const jwk = out(
        await fromPem(named(`from-pem: ${kind} private key (PKCS #8)`).input.value, 0),
      );
      for (let n = 0; n < jwk.length; n++)
        expect(code(await toPem(jwk.slice(0, n)))).toBe("E_COERCE");
    }
  });
});

describe("mutated input gives a result or E_COERCE and nothing else", () => {
  test("DER bytes of every key kind", { timeout: 120_000 }, async () => {
    const seen = new Set<string>();
    const next = prng(0xc0ffee);
    for (const kind of KINDS) {
      const der = pemBody(named(`from-pem: ${kind} private key (PKCS #8)`).input.value);
      for (let i = 0; i < 150; i++) {
        const m = Uint8Array.from(der);
        const k = 1 + (next() % 3);
        for (let j = 0; j < k; j++) m[next() % m.length] = next() & 255;
        seen.add(code(await fromPem(pemOf("PRIVATE KEY", m))));
      }
    }
    expect([...seen].filter((c) => c !== "ok" && c !== "E_COERCE")).toEqual([]);
  });

  test("characters of the JWK text", { timeout: 120_000 }, async () => {
    const seen = new Set<string>();
    const next = prng(0xbeef);
    const chars = 'AZaz09-_"{}[],: \\';
    for (const kind of KINDS) {
      const jwk = out(
        await fromPem(named(`from-pem: ${kind} private key (PKCS #8)`).input.value, 0),
      );
      for (let i = 0; i < 120; i++) {
        const a = jwk.split("");
        for (let j = 0; j < 1 + (next() % 2); j++)
          a[next() % a.length] = chars[next() % chars.length] as string;
        seen.add(code(await toPem(a.join(""))));
      }
    }
    expect([...seen].filter((c) => c !== "ok" && c !== "E_COERCE")).toEqual([]);
  });
});

describe("details", () => {
  const u8 = (h: string) => fromHex(h);

  test("a private key shorter than the curve is padded with zeros (RFC 7518 section 6.2.2.1)", async () => {
    // SEC 1: SEQUENCE { 1, OCTET STRING d = 01, [0] OID prime256v1 }; the key is the generator of P-256 (FIPS 186-4 D.1.2.3)
    const der = u8("3012020101040101a00a06082a8648ce3d030107");
    const jwk = JSON.parse(out(await fromPem(pemOf("EC PRIVATE KEY", der)))) as Record<
      string,
      string
    >;
    const b64u = (h: string) => toBase64(fromHex(h), true);
    expect(jwk).toEqual({
      kty: "EC",
      crv: "P-256",
      x: b64u("6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296"),
      y: b64u("4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5"),
      d: b64u("00".repeat(31) + "01"),
    });
  });

  test("a private key longer than the curve is E_COERCE", async () => {
    const der = u8("3032020101042101" + "01".repeat(32) + "a00a06082a8648ce3d030107");
    expect(code(await fromPem(pemOf("EC PRIVATE KEY", der)))).toBe("E_COERCE");
  });

  test("the point check and the key derivation of the primitives", () => {
    const one = new Uint8Array(32);
    one[31] = 1;
    const g = publicKey("P-256", one);
    expect(g.length).toBe(65);
    expect(onCurve("P-256", g)).toBe(true);
    const bad = Uint8Array.from(g);
    bad[64] = (bad[64] ?? 0) ^ 1;
    expect(onCurve("P-256", bad)).toBe(false);
    expect(onCurve("Ed25519", new Uint8Array(32))).toBe(true);
    expect(() => publicKey("P-256", new Uint8Array(32))).toThrow();
    expect(() => publicKey("Ed25519", new Uint8Array(31))).toThrow();
    expect(() => publicKey("nope", one)).toThrow();
  });

  test("a certificate's key, several blocks and the indent", async () => {
    const cert = named("from-pem: the key of a P-384 certificate").input.value;
    const two = cert + named("from-pem: P-256 public key (SPKI)").input.value;
    const arr = JSON.parse(out(await fromPem(two, 2))) as unknown[];
    expect(arr).toHaveLength(2);
    expect(out(await fromPem(cert, 3))).toMatch(/^\{\n {3}"kty"/);
  });

  test("nesting deeper than the JSON limit is an error, not a crash", async () => {
    const deep = "[".repeat(100_000);
    expect(["E_COERCE", "E_LIMIT_VALUE"]).toContain(code(await toPem(deep)));
  });
});

describe("cost at 64 KiB", () => {
  test("PEM public keys to JWK", { timeout: 60_000 }, async () => {
    const pem = named("from-pem: P-256 public key (SPKI)").input.value;
    const text = pem.repeat(380);
    expect(text.length).toBeGreaterThan(64 * 1024);
    const t = Date.now();
    const r = await fromPem(text, 0);
    const arr = JSON.parse(out(r)) as unknown[];
    expect(arr).toHaveLength(380);
    // measured: 277,427 VM steps (about 730 for each key), 0.14 s
    expect(r.ok && r.steps).toBeLessThan(2_000_000);
    expect(Date.now() - t).toBeLessThan(20_000);
  });

  test("JWKs to PEM", { timeout: 60_000 }, async () => {
    const jwk = out(await fromPem(named("from-pem: P-256 public key (SPKI)").input.value, 0));
    const text = `[${Array(950).fill(jwk).join(",")}]`;
    expect(text.length).toBeGreaterThan(64 * 1024);
    const t = Date.now();
    const r = await toPem(text);
    expect(out(r).match(/BEGIN PUBLIC KEY/g)).toHaveLength(950);
    // measured: 1,133,373 VM steps (about 1,200 for each key), 0.44 s
    expect(r.ok && r.steps).toBeLessThan(3_000_000);
    expect(Date.now() - t).toBeLessThan(20_000);
  });
});
