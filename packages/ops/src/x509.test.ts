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
 * Tests for the `x509` vocabulary (vocab/x509.fth): Parse X.509 certificate, Parse X.509 certificate bundles,
 * Parse X.509 CRL, Parse CSR and Public Key from Certificate. The known-answer vectors (vocab/x509.test.json) hold
 * the reports of certificates, CRLs and CSRs made with openssl, with every value compared with `openssl x509 -text`
 * and Python's cryptography; these tests add what a vector cannot: truncation at every cut point, mutated input,
 * hostile lengths and nesting, the report of hand-built structures, and the cost at 64 KiB.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
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
const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const here = fileURLToPath(import.meta.url).replaceAll("\\", "/");
const vocabFile = (name: string): string =>
  readFileSync(`${here.slice(0, here.lastIndexOf("/"))}/../vocab/${name}`, "utf8");

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["x509"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const out = (r: Result): string => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return (r.stack[r.stack.length - 1] as { v: string }).v;
};
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const op = (name: string, data: Uint8Array, format: string): Promise<Result> =>
  runtime.call(`x509:${name}`, [bytes(data), str(format)] as Value[]);
const utf8 = (s: string) => new TextEncoder().encode(s);

interface Vector {
  name: string;
  input: { value: string };
  expect: { value?: string };
}
const vectors = JSON.parse(vocabFile("x509.test.json")) as Vector[];
const named = (prefix: string): Vector => {
  const v = vectors.find((x) => x.name.startsWith(prefix));
  if (v === undefined) throw new Error(`no vector ${prefix}`);
  return v;
};
const pemDer = (pem: string): Uint8Array =>
  fromBase64(
    pem
      .split("\n")
      .filter((l) => l !== "" && !l.startsWith("-----"))
      .join(""),
  );

const RSA_CERT = named("parse: RSA 2048 certificate").input.value;
const EC_CERT = named("parse: EC P-256 certificate").input.value;
const CRL = named("parse-crl: v2 CRL").input.value;
const CSR = named("parse-csr: RSA with attributes").input.value;
const ISRG = named("parse: ISRG Root X1").input.value;

/** A small deterministic generator (xorshift32), so a failure can be repeated. */
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

const SUBJECTS: ReadonlyArray<readonly [string, string, string]> = [
  ["parse", "an EC certificate", EC_CERT],
  ["parse", "an RSA certificate", RSA_CERT],
  ["parse-crl", "a CRL", CRL],
  ["parse-csr", "a CSR", CSR],
];

describe("truncation: a structure cut short is never accepted", () => {
  for (const [name, what, pem] of SUBJECTS) {
    test(`${what} cut at every byte`, { timeout: 60_000 }, async () => {
      const der = pemDer(pem);
      const bad: string[] = [];
      for (let n = 0; n < der.length; n++) {
        const r = await op(name, der.slice(0, n), "raw");
        if (code(r) !== "E_COERCE") bad.push(`${n}:${code(r)}`);
      }
      expect(bad).toEqual([]);
      expect(code(await op(name, der, "raw"))).toBe("ok");
    });
  }

  test("a PEM block cut short, and DER hex cut at every even and odd digit", async () => {
    const lines = RSA_CERT.split("\n");
    expect(code(await op("parse", utf8(lines.slice(0, 5).join("\n")), "pem"))).toBe("E_COERCE");
    const hex = toHex(pemDer(EC_CERT));
    for (let n = 0; n < hex.length; n += 7) {
      expect(code(await op("parse", utf8(hex.slice(0, n)), "der-hex"))).toBe("E_COERCE");
    }
  });
});

describe("mutated input gives a report or E_COERCE and nothing else", () => {
  for (const [name, what, pem] of SUBJECTS) {
    test(`${what}, 400 mutations`, { timeout: 120_000 }, async () => {
      const der = pemDer(pem);
      const next = prng(0x9e3779b9 ^ name.length);
      const seen = new Map<string, number>();
      for (let i = 0; i < 400; i++) {
        const m = Uint8Array.from(der);
        const k = 1 + (next() % 3);
        for (let j = 0; j < k; j++) m[next() % m.length] = next() & 255;
        const c = code(await op(name, m, "raw"));
        seen.set(c, (seen.get(c) ?? 0) + 1);
      }
      expect([...seen.keys()].filter((c) => c !== "ok" && c !== "E_COERCE")).toEqual([]);
    });
  }
});

describe("hostile structure", () => {
  const len = (n: number) => [0x30, 0x84, n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

  test("lengths far past the input allocate nothing and are E_COERCE", async () => {
    for (const n of [0x7fffffff, 0xffffffff, 0x10000, 300])
      for (const name of ["parse", "parse-crl", "parse-csr", "public-key"])
        expect(code(await op(name, Uint8Array.from([...len(n), 1, 2, 3]), "raw"))).toBe("E_COERCE");
  });

  test("an indefinite length and an end-of-contents marker are E_COERCE", async () => {
    expect(code(await op("parse", Uint8Array.from([0x30, 0x80, 0, 0]), "raw"))).toBe("E_COERCE");
  });

  test("nesting 100 deep is E_COERCE", async () => {
    let inner: number[] = [5, 0];
    for (let i = 0; i < 100; i++) {
      const l = inner.length;
      inner = l < 128 ? [0x30, l, ...inner] : [0x30, 0x82, l >> 8, l & 255, ...inner];
    }
    expect(code(await op("parse", Uint8Array.from(inner), "raw"))).toBe("E_COERCE");
    expect(code(await op("parse-crl", Uint8Array.from(inner), "raw"))).toBe("E_COERCE");
  });

  test("a certificate with bytes after it is E_COERCE", async () => {
    const der = pemDer(EC_CERT);
    expect(code(await op("parse", Uint8Array.from([...der, 0]), "raw"))).toBe("E_COERCE");
  });
});

describe("the reports", () => {
  test("every input format gives the same report", async () => {
    const der = pemDer(RSA_CERT);
    const pem = out(await op("parse", utf8(RSA_CERT), "pem"));
    expect(out(await op("parse", utf8(toHex(der)), "der-hex"))).toBe(pem);
    expect(out(await op("parse", utf8(toBase64(der)), "base64"))).toBe(pem);
    expect(out(await op("parse", der, "raw"))).toBe(pem);
  });

  test("the bundle report is the certificate reports under numbered headings", async () => {
    const one = out(await op("parse", utf8(EC_CERT), "pem"));
    const two = out(await op("parse", utf8(RSA_CERT), "pem"));
    const bundle = out(await op("parse-bundle", utf8(EC_CERT + RSA_CERT), "pem"));
    expect(bundle).toBe(`Certificate 1 of 2\n${one}\n\nCertificate 2 of 2\n${two}`);
  });

  test("the public key is the SubjectPublicKeyInfo of the certificate, byte for byte", async () => {
    const pem = out(await op("public-key", utf8(RSA_CERT), "pem"));
    const spki = pemDer(pem);
    const cert = pemDer(RSA_CERT);
    const at = toHex(cert).indexOf(toHex(spki));
    expect(at).toBeGreaterThan(0);
    expect(at % 2).toBe(0);
    expect(pem.startsWith("-----BEGIN PUBLIC KEY-----\n")).toBe(true);
    expect(pem.endsWith("-----END PUBLIC KEY-----\n")).toBe(true);
  });

  test("a malformed extension is shown as hex with the reason, the report goes on", async () => {
    const r = out(
      await op(
        "parse",
        utf8(vectors.find((v) => v.name.includes("unknown critical"))!.input.value),
        "pem",
      ),
    );
    expect(r).toContain(
      "X509v3 Basic Constraints:\n    (not decoded: expected BasicConstraints at offset 0, found universal 2)\n    02:01:05",
    );
    expect(r).toContain("  1.2.3.4.5.6: critical\n    04:03:aa:bb:cc");
  });

  test("the control characters of a name are written as escapes", async () => {
    const r = out(
      await op(
        "parse",
        utf8(vectors.find((v) => v.name.includes("control characters"))!.input.value),
        "pem",
      ),
    );
    expect(r).toContain("  CN = evil\\x0aVersion: 99\\x01");
    expect(r.split("\n").filter((l) => l.startsWith("Version:"))).toHaveLength(1);
  });
});

describe("cost at 64 KiB", () => {
  test("a bundle of 33 certificates of 1.9 KB (64 KiB of PEM)", { timeout: 60_000 }, async () => {
    const text = ISRG.repeat(34);
    expect(text.length).toBeGreaterThan(64 * 1024);
    const t = Date.now();
    const r = await op("parse-bundle", utf8(text), "pem");
    const report = out(r);
    expect(report.match(/^Certificate \d+ of 34$/gm)).toHaveLength(34);
    // measured: 1,131,769 VM steps (about 33,000 for each 4096-bit certificate), 0.8 s
    expect(r.ok && r.steps).toBeLessThan(6_000_000);
    expect(Date.now() - t).toBeLessThan(30_000);
  });

  test("a CRL of 3,000 revoked certificates (66 KB of DER)", { timeout: 60_000 }, async () => {
    const u = (tag: number, body: number[]) => [tag, body.length, ...body];
    const long = (tag: number, body: number[]) =>
      body.length < 128
        ? [tag, body.length, ...body]
        : [tag, 0x83, body.length >> 16, (body.length >> 8) & 255, body.length & 255, ...body];
    const alg = u(
      0x30,
      [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b, 0x05, 0x00],
    );
    const issuer = u(
      0x30,
      [0x31, 0x0b, 0x30, 0x09, 0x06, 0x03, 0x55, 0x04, 0x03, 0x0c, 0x02, 0x43, 0x41],
    );
    const time = u(0x17, [...utf8("261111000000Z")]);
    const entries: number[] = [];
    for (let i = 0; i < 3000; i++)
      entries.push(...u(0x30, [...u(0x02, [0x01, (i >> 8) & 255, i & 255]), ...time]));
    const revoked = long(0x30, entries);
    const tbs = long(0x30, [...alg, ...issuer, ...time, ...revoked]);
    const sig = u(0x03, [0, 1, 2, 3]);
    const crl = Uint8Array.from(long(0x30, [...tbs, ...alg, ...sig]));
    expect(crl.length).toBeGreaterThan(64 * 1024);
    const t = Date.now();
    const r = await op("parse-crl", crl, "raw");
    const report = out(r);
    expect(report.match(/Serial Number: /g)).toHaveLength(3000);
    // measured: 2,339,524 VM steps (about 780 for each entry), 0.7 s; the 10 million step default allows about 12,000 entries
    expect(r.ok && r.steps).toBeLessThan(6_000_000);
    expect(Date.now() - t).toBeLessThan(30_000);
  });
});
