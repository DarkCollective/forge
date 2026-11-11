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
 * Tests for `x509:parse-ssh-host-key` (vocab/x509.fth): Parse SSH Host Key. The known-answer vectors
 * (vocab/x509.test.json) hold the reports of keys made with Python's cryptography, with the fingerprints
 * computed by hashlib over the blob; these tests add truncation at every cut point of every key type, mutated
 * blobs, hostile lengths and the cost of a 64 KiB key.
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
const parse = (text: string, format = "auto"): Promise<Result> =>
  runtime.call("x509:parse-ssh-host-key", [
    bytes(new TextEncoder().encode(text)),
    str(format),
  ] as Value[]);
const b64 = (b: Uint8Array) => toBase64(b);

interface Vector {
  name: string;
  input: { value: string };
}
const vectors = JSON.parse(vocabFile("x509.test.json")) as Vector[];
const blobOf = (prefix: string): Uint8Array => {
  const v = vectors.find((x) => x.name.startsWith(prefix));
  if (v === undefined) throw new Error(`no vector ${prefix}`);
  const words = v.input.value.trim().split(/\s+/);
  const i = words.findIndex((w) => /^(ssh-|ecdsa-|sk-)/.test(w));
  return fromBase64(i >= 0 ? (words[i + 1] as string) : (words[0] as string));
};
const KEYS: ReadonlyArray<readonly [string, string]> = [
  ["an ssh-rsa line", "ssh-rsa"],
  ["an ssh-dss line", "ssh-dss"],
  ["an ecdsa-sha2-nistp256 line", "ecdsa-sha2-nistp256"],
  ["an ecdsa-sha2-nistp384 line", "ecdsa-sha2-nistp384"],
  ["an ecdsa-sha2-nistp521 line", "ecdsa-sha2-nistp521"],
  ["an ssh-ed25519 line", "ssh-ed25519"],
  ["an ssh-ed448 blob", "ssh-ed448"],
  ["a FIDO sk-ssh-ed25519 line", "sk-ssh-ed25519@openssh.com"],
];

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

describe("a key blob cut short is never accepted", () => {
  for (const [name, type] of KEYS) {
    test(`${type}: every cut point`, async () => {
      const blob = blobOf(name);
      expect(out(await parse(b64(blob)))).toContain(`Key type:             ${type}\n`);
      const bad: string[] = [];
      for (let n = 0; n < blob.length; n++) {
        const c = code(await parse(b64(blob.slice(0, n))));
        const h = code(await parse(toHex(blob.slice(0, n)), "hex"));
        if (c !== "E_COERCE") bad.push(`b64 ${n}:${c}`);
        if (h !== "E_COERCE") bad.push(`hex ${n}:${h}`);
      }
      expect(bad).toEqual([]);
    });

    test(`${type}: bytes after the fields are refused`, async () => {
      const blob = blobOf(name);
      expect(code(await parse(b64(Uint8Array.from([...blob, 0]))))).toBe("E_COERCE");
    });
  }
});

describe("mutated blobs give a report or E_COERCE and nothing else", () => {
  for (const [name, type] of KEYS) {
    test(`${type}, 300 mutations`, async () => {
      const blob = blobOf(name);
      const next = prng(0x1234567 ^ type.length);
      const seen = new Set<string>();
      for (let i = 0; i < 300; i++) {
        const m = Uint8Array.from(blob);
        const k = 1 + (next() % 3);
        for (let j = 0; j < k; j++) m[next() % m.length] = next() & 255;
        seen.add(code(await parse(b64(m))));
      }
      expect([...seen].filter((c) => c !== "ok" && c !== "E_COERCE")).toEqual([]);
    });
  }
});

describe("hostile lengths", () => {
  test("a string longer than the blob allocates nothing", async () => {
    for (const len of [0xffffffff, 0x80000000, 0x7fffffff, 0x10000, 100]) {
      const b = Uint8Array.from([
        len >>> 24,
        (len >>> 16) & 255,
        (len >>> 8) & 255,
        len & 255,
        0x73,
        0x73,
      ]);
      expect(code(await parse(b64(b)))).toBe("E_COERCE");
    }
  });

  const u32 = (v: number) => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const rsa = (n: number) => {
    const type = [...new TextEncoder().encode("ssh-rsa")];
    const modulus = [0, ...Array.from({ length: n }, (_, i) => 0x80 | (i & 0x7f))];
    return Uint8Array.from([
      ...u32(type.length),
      ...type,
      ...u32(3),
      1,
      0,
      1,
      ...u32(modulus.length),
      ...modulus,
    ]);
  };

  test("a modulus of 8,000 bytes (a 64,000-bit key) is read in full", async () => {
    const t = Date.now();
    const r = await parse(b64(rsa(8000)));
    const text = out(r);
    expect(text).toContain("Length:               64000 bits");
    expect(text).toContain("Exponent:             65537 (0x10001)");
    // measured: 651,577 VM steps (the 8,000-byte modulus is written as 500 lines of octets)
    expect(r.ok && r.steps).toBeLessThan(3_000_000);
    expect(Date.now() - t).toBeLessThan(20_000);
  });

  test("an integer over the language limit of 65,536 bits is E_LIMIT_VALUE, not a crash", async () => {
    expect(code(await parse(b64(rsa(9000))))).toBe("E_LIMIT_VALUE");
  });

  test("a 64 KiB comment is measured and its control characters are escaped", async () => {
    const blob = blobOf("an ssh-ed25519 line");
    const comment = "c\u0001d".repeat(10_000) + "x".repeat(34_000);
    const t = Date.now();
    const r = await parse(`ssh-ed25519 ${b64(blob)} ${comment}`);
    const text = out(r);
    expect(text).toContain("Comment:              c\\x01dc\\x01d");
    // measured: 2,268,180 VM steps on the slow path (about 35 a character, 64,000 characters, 10,000 of them escaped);
    // a comment without control characters costs a few steps
    expect(r.ok && r.steps).toBeLessThan(3_000_000);
    expect(Date.now() - t).toBeLessThan(20_000);
  }, 60_000);
});
