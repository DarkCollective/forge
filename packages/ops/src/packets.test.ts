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
 * Tests for the `packets` vocabulary (vocab/packets.fth: Ethernet, IPv4, TCP, UDP, TLS records and the shared TLS
 * reader), its primitives (src/prims/packets.ts, the name tables of src/packets-names.ts) and the `http`
 * vocabulary (Strip HTTP headers, Dechunk HTTP response, src/prims/http.ts). The known-answer vectors are in
 * vocab/packets.test.json and vocab/http.test.json: packets built with Python struct and its own RFC 1071
 * checksum, hello messages captured between openssl 3.0.13 s_client and s_server (checked against
 * `s_client -trace`), chunked bodies decoded by Python's http.client. Here: the name tables against OpenSSL,
 * truncation at every cut point, mutated input, hostile lengths, the shared TLS words, and the VM step counts
 * on 64 KiB.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { valueHelpers } from "@forge/lang";
import type { Limits, Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { buildCatalogue } from "./catalogue.js";
import { NAME_TABLES, isGrease, nameOf, tableSize } from "./packets-names.js";
import { lookupName, walkOffsets } from "./prims/packets.js";
import { dechunk } from "./prims/http.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int, str, list } = valueHelpers;
const bundle = await loadBundleNode(["packets", "http"]);
const runtime = assembleRuntime(bundle);
const untrusted: Partial<Limits> = {
  maxSteps: 5_000_000,
  maxDataDepth: 10_000,
  maxValueBytes: 16 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxIntBits: 16_384,
  maxMillis: 10_000,
};
const strict = assembleRuntime(bundle, { limits: untrusted });

type Result = Awaited<ReturnType<typeof runtime.call>>;
const top = (r: Result): Value => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.stack[r.stack.length - 1] as Value;
};
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const call = (op: string, ...args: Value[]) => runtime.call(op, args);
const val = async (op: string, ...args: Value[]) => top(await call(op, ...args)).v;
const hex = (s: string): Uint8Array =>
  Uint8Array.from(s.replace(/\s+/g, "").match(/../g) ?? [], (h) => parseInt(h, 16));
const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const u16 = (n: number): Uint8Array => Uint8Array.from([n >> 8, n & 255]);
const u24 = (n: number): Uint8Array => Uint8Array.from([n >> 16, (n >> 8) & 255, n & 255]);
const rec = (type: number, version: number, frag: Uint8Array): Uint8Array =>
  cat(Uint8Array.from([type]), u16(version), u16(frag.length), frag);
const hs = (type: number, body: Uint8Array): Uint8Array =>
  cat(Uint8Array.from([type]), u24(body.length), body);

const latin1 = (b: Uint8Array): string => Array.from(b, (c) => String.fromCharCode(c)).join("");

interface Vector {
  name: string;
  op: string;
  params: Record<string, unknown>;
  input: { value: string; enc: string };
  expect: { value?: string; enc?: string; error?: string };
}
const load = (file: string): Vector[] =>
  JSON.parse(
    readFileSync(
      fileURLToPath(import.meta.url).replace(/[/\\]src[/\\][^/\\]*$/, `/vocab/${file}`),
      "utf8",
    ),
  );
const packetVectors = load("packets.test.json");
/** The packet bytes of a vector by the start of its name (its input is the hex of the packet, as text or as bytes). */
const packet = (name: string): Uint8Array => {
  const v = packetVectors.find((x) => x.name.startsWith(name));
  if (!v) throw new Error(`no vector ${name}`);
  return hex(v.input.value);
};

/** OpenSSL 3.0.13 `openssl ciphers -stdname -V ALL:COMPLEMENTOFALL:@SECLEVEL=0` and the RFC names of <openssl/tls1.h>. */
const OPENSSL_SUITES: ReadonlyArray<readonly [number, string]> = [
  [0x0001, "TLS_RSA_WITH_NULL_MD5"],
  [0x0002, "TLS_RSA_WITH_NULL_SHA"],
  [0x002c, "TLS_PSK_WITH_NULL_SHA"],
  [0x002d, "TLS_DHE_PSK_WITH_NULL_SHA"],
  [0x002e, "TLS_RSA_PSK_WITH_NULL_SHA"],
  [0x002f, "TLS_RSA_WITH_AES_128_CBC_SHA"],
  [0x0032, "TLS_DHE_DSS_WITH_AES_128_CBC_SHA"],
  [0x0033, "TLS_DHE_RSA_WITH_AES_128_CBC_SHA"],
  [0x0034, "TLS_DH_anon_WITH_AES_128_CBC_SHA"],
  [0x0035, "TLS_RSA_WITH_AES_256_CBC_SHA"],
  [0x0038, "TLS_DHE_DSS_WITH_AES_256_CBC_SHA"],
  [0x0039, "TLS_DHE_RSA_WITH_AES_256_CBC_SHA"],
  [0x003a, "TLS_DH_anon_WITH_AES_256_CBC_SHA"],
  [0x003b, "TLS_RSA_WITH_NULL_SHA256"],
  [0x003c, "TLS_RSA_WITH_AES_128_CBC_SHA256"],
  [0x003d, "TLS_RSA_WITH_AES_256_CBC_SHA256"],
  [0x0040, "TLS_DHE_DSS_WITH_AES_128_CBC_SHA256"],
  [0x0041, "TLS_RSA_WITH_CAMELLIA_128_CBC_SHA"],
  [0x0044, "TLS_DHE_DSS_WITH_CAMELLIA_128_CBC_SHA"],
  [0x0045, "TLS_DHE_RSA_WITH_CAMELLIA_128_CBC_SHA"],
  [0x0046, "TLS_DH_anon_WITH_CAMELLIA_128_CBC_SHA"],
  [0x0067, "TLS_DHE_RSA_WITH_AES_128_CBC_SHA256"],
  [0x006a, "TLS_DHE_DSS_WITH_AES_256_CBC_SHA256"],
  [0x006b, "TLS_DHE_RSA_WITH_AES_256_CBC_SHA256"],
  [0x006c, "TLS_DH_anon_WITH_AES_128_CBC_SHA256"],
  [0x006d, "TLS_DH_anon_WITH_AES_256_CBC_SHA256"],
  [0x0084, "TLS_RSA_WITH_CAMELLIA_256_CBC_SHA"],
  [0x0087, "TLS_DHE_DSS_WITH_CAMELLIA_256_CBC_SHA"],
  [0x0088, "TLS_DHE_RSA_WITH_CAMELLIA_256_CBC_SHA"],
  [0x0089, "TLS_DH_anon_WITH_CAMELLIA_256_CBC_SHA"],
  [0x008a, "TLS_PSK_WITH_RC4_128_SHA"],
  [0x008b, "TLS_PSK_WITH_3DES_EDE_CBC_SHA"],
  [0x008c, "TLS_PSK_WITH_AES_128_CBC_SHA"],
  [0x008d, "TLS_PSK_WITH_AES_256_CBC_SHA"],
  [0x008e, "TLS_DHE_PSK_WITH_RC4_128_SHA"],
  [0x008f, "TLS_DHE_PSK_WITH_3DES_EDE_CBC_SHA"],
  [0x0090, "TLS_DHE_PSK_WITH_AES_128_CBC_SHA"],
  [0x0091, "TLS_DHE_PSK_WITH_AES_256_CBC_SHA"],
  [0x0092, "TLS_RSA_PSK_WITH_RC4_128_SHA"],
  [0x0093, "TLS_RSA_PSK_WITH_3DES_EDE_CBC_SHA"],
  [0x0094, "TLS_RSA_PSK_WITH_AES_128_CBC_SHA"],
  [0x0095, "TLS_RSA_PSK_WITH_AES_256_CBC_SHA"],
  [0x0096, "TLS_RSA_WITH_SEED_CBC_SHA"],
  [0x0099, "TLS_DHE_DSS_WITH_SEED_CBC_SHA"],
  [0x009a, "TLS_DHE_RSA_WITH_SEED_CBC_SHA"],
  [0x009b, "TLS_DH_anon_WITH_SEED_CBC_SHA"],
  [0x009c, "TLS_RSA_WITH_AES_128_GCM_SHA256"],
  [0x009d, "TLS_RSA_WITH_AES_256_GCM_SHA384"],
  [0x009e, "TLS_DHE_RSA_WITH_AES_128_GCM_SHA256"],
  [0x009f, "TLS_DHE_RSA_WITH_AES_256_GCM_SHA384"],
  [0x00a2, "TLS_DHE_DSS_WITH_AES_128_GCM_SHA256"],
  [0x00a3, "TLS_DHE_DSS_WITH_AES_256_GCM_SHA384"],
  [0x00a6, "TLS_DH_anon_WITH_AES_128_GCM_SHA256"],
  [0x00a7, "TLS_DH_anon_WITH_AES_256_GCM_SHA384"],
  [0x00a8, "TLS_PSK_WITH_AES_128_GCM_SHA256"],
  [0x00a9, "TLS_PSK_WITH_AES_256_GCM_SHA384"],
  [0x00aa, "TLS_DHE_PSK_WITH_AES_128_GCM_SHA256"],
  [0x00ab, "TLS_DHE_PSK_WITH_AES_256_GCM_SHA384"],
  [0x00ac, "TLS_RSA_PSK_WITH_AES_128_GCM_SHA256"],
  [0x00ad, "TLS_RSA_PSK_WITH_AES_256_GCM_SHA384"],
  [0x00ae, "TLS_PSK_WITH_AES_128_CBC_SHA256"],
  [0x00af, "TLS_PSK_WITH_AES_256_CBC_SHA384"],
  [0x00b0, "TLS_PSK_WITH_NULL_SHA256"],
  [0x00b1, "TLS_PSK_WITH_NULL_SHA384"],
  [0x00b2, "TLS_DHE_PSK_WITH_AES_128_CBC_SHA256"],
  [0x00b3, "TLS_DHE_PSK_WITH_AES_256_CBC_SHA384"],
  [0x00b4, "TLS_DHE_PSK_WITH_NULL_SHA256"],
  [0x00b5, "TLS_DHE_PSK_WITH_NULL_SHA384"],
  [0x00b6, "TLS_RSA_PSK_WITH_AES_128_CBC_SHA256"],
  [0x00b7, "TLS_RSA_PSK_WITH_AES_256_CBC_SHA384"],
  [0x00b8, "TLS_RSA_PSK_WITH_NULL_SHA256"],
  [0x00b9, "TLS_RSA_PSK_WITH_NULL_SHA384"],
  [0x00ba, "TLS_RSA_WITH_CAMELLIA_128_CBC_SHA256"],
  [0x00bd, "TLS_DHE_DSS_WITH_CAMELLIA_128_CBC_SHA256"],
  [0x00be, "TLS_DHE_RSA_WITH_CAMELLIA_128_CBC_SHA256"],
  [0x00bf, "TLS_DH_anon_WITH_CAMELLIA_128_CBC_SHA256"],
  [0x00c0, "TLS_RSA_WITH_CAMELLIA_256_CBC_SHA256"],
  [0x00c3, "TLS_DHE_DSS_WITH_CAMELLIA_256_CBC_SHA256"],
  [0x00c4, "TLS_DHE_RSA_WITH_CAMELLIA_256_CBC_SHA256"],
  [0x00c5, "TLS_DH_anon_WITH_CAMELLIA_256_CBC_SHA256"],
  [0x1301, "TLS_AES_128_GCM_SHA256"],
  [0x1302, "TLS_AES_256_GCM_SHA384"],
  [0x1303, "TLS_CHACHA20_POLY1305_SHA256"],
  [0x1304, "TLS_AES_128_CCM_SHA256"],
  [0x1305, "TLS_AES_128_CCM_8_SHA256"],
  [0xc006, "TLS_ECDHE_ECDSA_WITH_NULL_SHA"],
  [0xc007, "TLS_ECDHE_ECDSA_WITH_RC4_128_SHA"],
  [0xc008, "TLS_ECDHE_ECDSA_WITH_3DES_EDE_CBC_SHA"],
  [0xc009, "TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA"],
  [0xc00a, "TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA"],
  [0xc010, "TLS_ECDHE_RSA_WITH_NULL_SHA"],
  [0xc011, "TLS_ECDHE_RSA_WITH_RC4_128_SHA"],
  [0xc012, "TLS_ECDHE_RSA_WITH_3DES_EDE_CBC_SHA"],
  [0xc013, "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA"],
  [0xc014, "TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA"],
  [0xc015, "TLS_ECDH_anon_WITH_NULL_SHA"],
  [0xc016, "TLS_ECDH_anon_WITH_RC4_128_SHA"],
  [0xc017, "TLS_ECDH_anon_WITH_3DES_EDE_CBC_SHA"],
  [0xc018, "TLS_ECDH_anon_WITH_AES_128_CBC_SHA"],
  [0xc019, "TLS_ECDH_anon_WITH_AES_256_CBC_SHA"],
  [0xc01a, "TLS_SRP_SHA_WITH_3DES_EDE_CBC_SHA"],
  [0xc01b, "TLS_SRP_SHA_RSA_WITH_3DES_EDE_CBC_SHA"],
  [0xc01c, "TLS_SRP_SHA_DSS_WITH_3DES_EDE_CBC_SHA"],
  [0xc01d, "TLS_SRP_SHA_WITH_AES_128_CBC_SHA"],
  [0xc01e, "TLS_SRP_SHA_RSA_WITH_AES_128_CBC_SHA"],
  [0xc01f, "TLS_SRP_SHA_DSS_WITH_AES_128_CBC_SHA"],
  [0xc020, "TLS_SRP_SHA_WITH_AES_256_CBC_SHA"],
  [0xc021, "TLS_SRP_SHA_RSA_WITH_AES_256_CBC_SHA"],
  [0xc022, "TLS_SRP_SHA_DSS_WITH_AES_256_CBC_SHA"],
  [0xc023, "TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA256"],
  [0xc024, "TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA384"],
  [0xc027, "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256"],
  [0xc028, "TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA384"],
  [0xc02b, "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256"],
  [0xc02c, "TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384"],
  [0xc02f, "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256"],
  [0xc030, "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384"],
  [0xc033, "TLS_ECDHE_PSK_WITH_RC4_128_SHA"],
  [0xc034, "TLS_ECDHE_PSK_WITH_3DES_EDE_CBC_SHA"],
  [0xc035, "TLS_ECDHE_PSK_WITH_AES_128_CBC_SHA"],
  [0xc036, "TLS_ECDHE_PSK_WITH_AES_256_CBC_SHA"],
  [0xc037, "TLS_ECDHE_PSK_WITH_AES_128_CBC_SHA256"],
  [0xc038, "TLS_ECDHE_PSK_WITH_AES_256_CBC_SHA384"],
  [0xc039, "TLS_ECDHE_PSK_WITH_NULL_SHA"],
  [0xc03a, "TLS_ECDHE_PSK_WITH_NULL_SHA256"],
  [0xc03b, "TLS_ECDHE_PSK_WITH_NULL_SHA384"],
  [0xc050, "TLS_RSA_WITH_ARIA_128_GCM_SHA256"],
  [0xc051, "TLS_RSA_WITH_ARIA_256_GCM_SHA384"],
  [0xc052, "TLS_DHE_RSA_WITH_ARIA_128_GCM_SHA256"],
  [0xc053, "TLS_DHE_RSA_WITH_ARIA_256_GCM_SHA384"],
  [0xc054, "TLS_DH_RSA_WITH_ARIA_128_GCM_SHA256"],
  [0xc055, "TLS_DH_RSA_WITH_ARIA_256_GCM_SHA384"],
  [0xc056, "TLS_DHE_DSS_WITH_ARIA_128_GCM_SHA256"],
  [0xc057, "TLS_DHE_DSS_WITH_ARIA_256_GCM_SHA384"],
  [0xc058, "TLS_DH_DSS_WITH_ARIA_128_GCM_SHA256"],
  [0xc059, "TLS_DH_DSS_WITH_ARIA_256_GCM_SHA384"],
  [0xc05a, "TLS_DH_anon_WITH_ARIA_128_GCM_SHA256"],
  [0xc05b, "TLS_DH_anon_WITH_ARIA_256_GCM_SHA384"],
  [0xc05c, "TLS_ECDHE_ECDSA_WITH_ARIA_128_GCM_SHA256"],
  [0xc05d, "TLS_ECDHE_ECDSA_WITH_ARIA_256_GCM_SHA384"],
  [0xc05e, "TLS_ECDH_ECDSA_WITH_ARIA_128_GCM_SHA256"],
  [0xc05f, "TLS_ECDH_ECDSA_WITH_ARIA_256_GCM_SHA384"],
  [0xc060, "TLS_ECDHE_RSA_WITH_ARIA_128_GCM_SHA256"],
  [0xc061, "TLS_ECDHE_RSA_WITH_ARIA_256_GCM_SHA384"],
  [0xc062, "TLS_ECDH_RSA_WITH_ARIA_128_GCM_SHA256"],
  [0xc063, "TLS_ECDH_RSA_WITH_ARIA_256_GCM_SHA384"],
  [0xc06a, "TLS_PSK_WITH_ARIA_128_GCM_SHA256"],
  [0xc06b, "TLS_PSK_WITH_ARIA_256_GCM_SHA384"],
  [0xc06c, "TLS_DHE_PSK_WITH_ARIA_128_GCM_SHA256"],
  [0xc06d, "TLS_DHE_PSK_WITH_ARIA_256_GCM_SHA384"],
  [0xc06e, "TLS_RSA_PSK_WITH_ARIA_128_GCM_SHA256"],
  [0xc06f, "TLS_RSA_PSK_WITH_ARIA_256_GCM_SHA384"],
  [0xc072, "TLS_ECDHE_ECDSA_WITH_CAMELLIA_128_CBC_SHA256"],
  [0xc073, "TLS_ECDHE_ECDSA_WITH_CAMELLIA_256_CBC_SHA384"],
  [0xc076, "TLS_ECDHE_RSA_WITH_CAMELLIA_128_CBC_SHA256"],
  [0xc077, "TLS_ECDHE_RSA_WITH_CAMELLIA_256_CBC_SHA384"],
  [0xc094, "TLS_PSK_WITH_CAMELLIA_128_CBC_SHA256"],
  [0xc095, "TLS_PSK_WITH_CAMELLIA_256_CBC_SHA384"],
  [0xc096, "TLS_DHE_PSK_WITH_CAMELLIA_128_CBC_SHA256"],
  [0xc097, "TLS_DHE_PSK_WITH_CAMELLIA_256_CBC_SHA384"],
  [0xc098, "TLS_RSA_PSK_WITH_CAMELLIA_128_CBC_SHA256"],
  [0xc099, "TLS_RSA_PSK_WITH_CAMELLIA_256_CBC_SHA384"],
  [0xc09a, "TLS_ECDHE_PSK_WITH_CAMELLIA_128_CBC_SHA256"],
  [0xc09b, "TLS_ECDHE_PSK_WITH_CAMELLIA_256_CBC_SHA384"],
  [0xc09c, "TLS_RSA_WITH_AES_128_CCM"],
  [0xc09d, "TLS_RSA_WITH_AES_256_CCM"],
  [0xc09e, "TLS_DHE_RSA_WITH_AES_128_CCM"],
  [0xc09f, "TLS_DHE_RSA_WITH_AES_256_CCM"],
  [0xc0a0, "TLS_RSA_WITH_AES_128_CCM_8"],
  [0xc0a1, "TLS_RSA_WITH_AES_256_CCM_8"],
  [0xc0a2, "TLS_DHE_RSA_WITH_AES_128_CCM_8"],
  [0xc0a3, "TLS_DHE_RSA_WITH_AES_256_CCM_8"],
  [0xc0a4, "TLS_PSK_WITH_AES_128_CCM"],
  [0xc0a5, "TLS_PSK_WITH_AES_256_CCM"],
  [0xc0a6, "TLS_DHE_PSK_WITH_AES_128_CCM"],
  [0xc0a7, "TLS_DHE_PSK_WITH_AES_256_CCM"],
  [0xc0a8, "TLS_PSK_WITH_AES_128_CCM_8"],
  [0xc0a9, "TLS_PSK_WITH_AES_256_CCM_8"],
  [0xc0aa, "TLS_PSK_DHE_WITH_AES_128_CCM_8"],
  [0xc0ab, "TLS_PSK_DHE_WITH_AES_256_CCM_8"],
  [0xc0ac, "TLS_ECDHE_ECDSA_WITH_AES_128_CCM"],
  [0xc0ad, "TLS_ECDHE_ECDSA_WITH_AES_256_CCM"],
  [0xc0ae, "TLS_ECDHE_ECDSA_WITH_AES_128_CCM_8"],
  [0xc0af, "TLS_ECDHE_ECDSA_WITH_AES_256_CCM_8"],
  [0xcca8, "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256"],
  [0xcca9, "TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256"],
  [0xccaa, "TLS_DHE_RSA_WITH_CHACHA20_POLY1305_SHA256"],
  [0xccab, "TLS_PSK_WITH_CHACHA20_POLY1305_SHA256"],
  [0xccac, "TLS_ECDHE_PSK_WITH_CHACHA20_POLY1305_SHA256"],
  [0xccad, "TLS_DHE_PSK_WITH_CHACHA20_POLY1305_SHA256"],
  [0xccae, "TLS_RSA_PSK_WITH_CHACHA20_POLY1305_SHA256"],
];

describe("name tables (src/packets-names.ts, packets:_name)", () => {
  test("every cipher suite of OpenSSL's list and tls1.h has the same name", () => {
    expect(OPENSSL_SUITES.length).toBeGreaterThan(180);
    for (const [n, name] of OPENSSL_SUITES) expect(nameOf("tls-cipher", n), name).toBe(name);
  });

  test("the cipher table has about 335 suites, with unique numbers and names", () => {
    expect(tableSize("tls-cipher")).toBeGreaterThanOrEqual(330);
    expect(tableSize("tls-cipher")).toBeLessThanOrEqual(345);
    const names = new Set<string>();
    for (let n = 0; n < 65536; n++) {
      const name = nameOf("tls-cipher", n);
      if (name && name !== "GREASE") {
        expect(names.has(name), name).toBe(false);
        names.add(name);
      }
    }
    expect(names.size).toBe(tableSize("tls-cipher"));
    expect(nameOf("tls-cipher", 0x1301)).toBe("TLS_AES_128_GCM_SHA256");
    expect(nameOf("tls-cipher", 0xc02f)).toBe("TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256");
    expect(nameOf("tls-cipher", 0x00ff)).toBe("TLS_EMPTY_RENEGOTIATION_INFO_SCSV");
    expect(nameOf("tls-cipher", 0x5600)).toBe("TLS_FALLBACK_SCSV");
    expect(nameOf("tls-cipher", 0xd001)).toBe("TLS_ECDHE_PSK_WITH_AES_128_GCM_SHA256");
    expect(nameOf("tls-cipher", 0x1234)).toBe("");
  });

  test("the other tables: a sample of each, unique numbers", () => {
    expect(nameOf("ethertype", 0x0800)).toBe("IPv4");
    expect(nameOf("ethertype", 0x86dd)).toBe("IPv6");
    expect(nameOf("ethertype", 0x0806)).toBe("ARP");
    expect(nameOf("ip-protocol", 6)).toBe("TCP");
    expect(nameOf("ip-protocol", 17)).toBe("UDP");
    expect(nameOf("ip-protocol", 250)).toBe("");
    expect(nameOf("tcp-option", 8)).toBe("Timestamps");
    expect(nameOf("tls-extension", 0)).toBe("server_name");
    expect(nameOf("tls-extension", 65281)).toBe("renegotiation_info");
    expect(nameOf("tls-extension", 51)).toBe("key_share");
    expect(nameOf("tls-group", 29)).toBe("x25519");
    expect(nameOf("tls-group", 4588)).toBe("X25519MLKEM768");
    expect(nameOf("tls-signature", 0x0807)).toBe("ed25519");
    expect(nameOf("tls-version", 0x0304)).toBe("TLS 1.3");
    expect(nameOf("tls-handshake", 1)).toBe("client_hello");
    expect(nameOf("tls-alert", 40)).toBe("handshake_failure");
    expect(nameOf("tls-content", 22)).toBe("Handshake");
    for (const t of NAME_TABLES) expect(tableSize(t), t).toBeGreaterThan(0);
  });

  test("GREASE values (RFC 8701) are named in the TLS tables that allow them", () => {
    for (let hi = 0; hi < 16; hi++) {
      const v = (hi << 12) | 0x0a00 | (hi << 4) | 0x0a;
      expect(isGrease(v)).toBe(true);
      for (const t of ["tls-cipher", "tls-extension", "tls-group", "tls-version", "tls-signature"])
        expect(nameOf(t, v), `${t} ${v}`).toBe("GREASE");
      expect(nameOf("ethertype", v)).toBe("");
    }
    expect(isGrease(0x0a0b)).toBe(false);
    expect(isGrease(0x1a2a)).toBe(false);
    expect(nameOf("tls-cipher", 0x0a0b)).toBe("");
  });

  test("the primitive: an unknown table or a bad key is E_RANGE", () => {
    expect(() => lookupName("nope", 1)).toThrow(/unknown name table/);
    expect(() => lookupName("ethertype", 1.5)).toThrow(/integer/);
    expect(() => lookupName(7, 1)).toThrow(/text/);
    expect(lookupName("ethertype", 2048)).toBe("IPv4");
    expect(lookupName("ethertype", -1)).toBe("");
  });
});

describe("the walk over length-prefixed items (packets:_walk)", () => {
  const w = (d: Uint8Array, s: number, e: number, skip: number, width: number, partial = false) =>
    walkOffsets(d, s, e, skip, width, partial, "item");

  test("items with a one-byte length, none, and several", () => {
    expect(w(hex(""), 0, 0, 0, 1)).toEqual([]);
    expect(w(hex("00"), 0, 1, 0, 1)).toEqual([0]);
    expect(w(hex("02aabb01cc"), 0, 5, 0, 1)).toEqual([0, 3]);
    expect(w(hex("ff02aabb01cc"), 1, 6, 0, 1)).toEqual([1, 4]);
  });

  test("a skip, wide lengths", () => {
    expect(w(hex("16030100020102"), 0, 7, 3, 2)).toEqual([0]);
    expect(w(hex("01000002010202000000"), 0, 10, 1, 3)).toEqual([0, 6]);
    expect(w(hex("00000000"), 0, 4, 0, 4)).toEqual([0]);
  });

  test("an item that runs past the end is E_COERCE with the offset, or the last offset when partial", () => {
    expect(() => w(hex("05aabb"), 0, 3, 0, 1)).toThrow(/declares 5 bytes but only 2 are left/);
    expect(() => w(hex("020000"), 0, 3, 1, 3)).toThrow(/cut short/);
    expect(w(hex("05aabb"), 0, 3, 0, 1, true)).toEqual([0]);
    expect(w(hex("01aa05bb"), 0, 4, 0, 1, true)).toEqual([0, 2]);
    expect(w(hex("01aa01"), 0, 3, 1, 2, true)).toEqual([0]);
  });

  test("a hostile length allocates nothing and a bad window is E_RANGE", () => {
    const huge = hex("ffffffff");
    expect(() => w(huge, 0, 4, 0, 4)).toThrow(/declares 4294967295 bytes/);
    expect(w(huge, 0, 4, 0, 4, true)).toEqual([0]);
    expect(() => w(hex("00"), 0, 2, 0, 1)).toThrow(/outside/);
    expect(() => w(hex("00"), 1, 0, 0, 1)).toThrow(/outside/);
    expect(() => w(hex("00"), 0, 1, 0, 0)).toThrow(/width/);
    expect(() => w(hex("00"), 0, 1, 0, 5)).toThrow(/width/);
    expect(() => w(hex("00"), 0, 1, 17, 1)).toThrow(/skip/);
  });

  test("65,534 empty items are listed at once", () => {
    const d = new Uint8Array(65_534);
    expect(w(d, 0, d.length, 0, 1).length).toBe(65_534);
  });
});

describe("the ops and the shared words", () => {
  const catalogue = buildCatalogue(runtime, { bundleVocabs: ["packets", "http"] });
  const ops = catalogue.ops
    .map((o) => o.qname)
    .filter((q) => q.startsWith("packets:") || q.startsWith("http:"));

  test("ten ops, in Networking, and the shared TLS words are not ops", () => {
    expect(ops).toEqual([
      "http:dechunk",
      "http:strip-headers",
      "packets:parse-ethernet",
      "packets:parse-ipv4",
      "packets:parse-tcp",
      "packets:parse-tls",
      "packets:parse-udp",
      "packets:strip-ipv4",
      "packets:strip-tcp",
      "packets:strip-udp",
    ]);
    for (const op of catalogue.ops.filter((o) => ops.includes(o.qname)))
      expect(op.category).toBe("Networking");
    for (const w of ["packets:tls-records", "packets:tls-handshakes", "packets:tls-hellos"]) {
      expect(runtime.meta(w).op, w).toBe(true);
      expect(ops).not.toContain(w);
    }
  });

  test("the parameter lists: format hex or raw, default hex", () => {
    for (const op of ops.filter((o) => o.startsWith("packets:"))) {
      const p = runtime.meta(op).params;
      expect(
        p.map((x) => x.name),
        op,
      ).toEqual(["format"]);
      expect(p[0]?.options, op).toEqual(["hex", "raw"]);
      expect(p[0]?.default, op).toBe("hex");
    }
    expect(runtime.meta("http:dechunk").params).toEqual([]);
    expect(runtime.meta("http:strip-headers").params).toEqual([]);
  });

  test("hex and raw give the same answer", async () => {
    const frame = packet("Ethernet: IPv4 over Ethernet II");
    for (const op of ["parse-ethernet", "parse-ipv4", "parse-tcp", "parse-udp", "parse-tls"]) {
      const a = await val(
        `packets:${op}`,
        bytes(new TextEncoder().encode(toHex(frame))),
        str("hex"),
      ).catch(() => "error");
      const b = await val(`packets:${op}`, bytes(frame), str("raw")).catch(() => "error");
      expect(a, op).toBe(b);
    }
  });
});

/** Every op on every cut of a realistic input: no crash, only E_COERCE below the header. */
describe("truncation at every cut point", () => {
  const cases: ReadonlyArray<readonly [string, string, Uint8Array, number]> = [
    ["parse-ethernet", "Ethernet: 802.1ad outer", packet("Ethernet: 802.1ad outer"), 14 + 8],
    ["parse-ethernet", "Ethernet: IPv4 over", packet("Ethernet: IPv4 over"), 14],
    ["parse-ipv4", "IPv4: Router Alert", packet("IPv4: Router Alert"), 36],
    ["parse-ipv4", "IPv4: Loose Source", packet("IPv4: Loose Source"), 40],
    [
      "strip-ipv4",
      "Strip IPv4 header: header with options",
      packet("Strip IPv4 header: header with options"),
      36,
    ],
    ["parse-tcp", "TCP: a SYN with MSS", packet("TCP: a SYN with MSS"), 40],
    ["parse-tcp", "TCP: two SACK blocks", packet("TCP: two SACK blocks"), 40],
    ["strip-tcp", "TCP: a SYN with MSS", packet("TCP: a SYN with MSS"), 40],
    ["parse-udp", "UDP: a DNS query", packet("UDP: a DNS query"), 8],
    ["strip-udp", "UDP: a DNS query", packet("UDP: a DNS query"), 8],
  ];
  for (const [op, name, data, headerLen] of cases) {
    test(`${op} on ${name} (${data.length} bytes, header ${headerLen})`, async () => {
      for (let cut = 0; cut <= data.length; cut++) {
        const r = await call(`packets:${op}`, bytes(data.subarray(0, cut)), str("raw"));
        if (cut < headerLen) expect(code(r), `${op} cut ${cut}`).toBe("E_COERCE");
        else expect(["ok", "E_COERCE"], `${op} cut ${cut}`).toContain(code(r));
        if (cut === data.length) expect(code(r)).toBe("ok");
      }
    });
  }

  test("parse-tls: every cut of a record stream is E_COERCE except at a record boundary", async () => {
    const flight = packet("TLS 1.3 handshake: ClientHello");
    const boundaries = new Set<number>([0]);
    for (
      let p = 0;
      p < flight.length;
      p += 5 + ((flight[p + 3] as number) << 8) + (flight[p + 4] as number)
    )
      boundaries.add(p);
    boundaries.add(flight.length);
    for (let cut = 0; cut <= flight.length; cut++) {
      const r = await call("packets:parse-tls", bytes(flight.subarray(0, cut)), str("raw"));
      if (boundaries.has(cut) && cut > 0) expect(code(r), `cut ${cut}`).toBe("ok");
      else expect(code(r), `cut ${cut}`).toBe("E_COERCE");
    }
  });

  test("parse-tls: a complete record around every cut of a hello message is ok or E_COERCE", async () => {
    for (const name of [
      "TLS 1.3 handshake: ClientHello",
      "TLS 1.3: ServerHello and encrypted",
      "TLS 1.0: ClientHello and ServerHello",
    ]) {
      const flight = packet(name);
      const len = (flight[3] as number) * 256 + (flight[4] as number);
      const message = flight.subarray(5, 5 + len);
      for (let cut = 0; cut <= message.length; cut++) {
        const r = await call(
          "packets:parse-tls",
          bytes(rec(22, 0x0301, message.subarray(0, cut))),
          str("raw"),
        );
        expect(["ok", "E_COERCE"], `${name} cut ${cut}`).toContain(code(r));
        // the message declares more than the record holds: shown as going on, never as a parsed hello
        if (cut > 0 && cut < message.length && r.ok)
          expect(top(r).v as string).toMatch(/goes on in the next one|cut short/);
      }
      expect(
        code(await call("packets:parse-tls", bytes(rec(22, 0x0301, message)), str("raw"))),
      ).toBe("ok");
    }
  });

  test("tls-hellos: a hello whose own lengths are cut at every point is E_COERCE", async () => {
    // Build the hello with the declared message length matching the cut, so only the inner fields are short.
    const flight = packet("TLS 1.3 handshake: ClientHello");
    const body = flight.subarray(
      5 + 4,
      5 + 4 + ((flight[6] as number) * 65536 + (flight[7] as number) * 256 + (flight[8] as number)),
    );
    for (let cut = 0; cut < body.length; cut++) {
      const r = await call(
        "packets:tls-hellos",
        bytes(rec(22, 0x0301, hs(1, body.subarray(0, cut)))),
        list([]),
      );
      // a cut at the end of the compression methods leaves a valid hello without extensions
      if (r.ok) expect((top(r).v as unknown[]).length, `cut ${cut}`).toBe(1);
      else expect(r.error.code, `cut ${cut}`).toBe("E_COERCE");
    }
  });
});

describe("mutated input gives a result or E_COERCE, nothing else", () => {
  let seed = 20260611;
  const next = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed >>> 8;
  };
  const targets: ReadonlyArray<readonly [string, Uint8Array]> = [
    ["parse-ethernet", packet("Ethernet: 802.1ad outer")],
    ["parse-ipv4", packet("IPv4: Router Alert")],
    ["parse-tcp", packet("TCP: a SYN with MSS")],
    ["parse-tcp", packet("TCP: the Fast Open")],
    ["parse-udp", packet("UDP: a DNS query")],
    ["strip-ipv4", packet("Strip IPv4 header: Ethernet padding")],
    ["strip-tcp", packet("Strip TCP header: options and data")],
    ["strip-udp", packet("Strip UDP header: link padding")],
    ["parse-tls", packet("TLS 1.3 ClientHello with GREASE")],
    ["parse-tls", packet("TLS 1.3 handshake: ClientHello")],
    ["parse-tls", packet("TLS 1.3: ServerHello and encrypted")],
    ["parse-tls", packet("TLS 1.3: HelloRetryRequest flight")],
  ];
  for (const [op, data] of targets) {
    test(`${op} on ${data.length} bytes, 300 mutations`, async () => {
      for (let i = 0; i < 300; i++) {
        const m = Uint8Array.from(data);
        for (let k = 0, n = 1 + (next() % 3); k < n; k++) m[next() % m.length] = next() & 255;
        const r = await call(`packets:${op}`, bytes(m), str("raw"));
        expect(["ok", "E_COERCE"], `${op} ${toHex(m)}`).toContain(code(r));
      }
    }, 60_000);
  }
});

describe("hostile lengths", () => {
  test("IPv4 IHL 15 and TCP data offset 15 on short data, UDP length 65535", async () => {
    expect(
      code(await call("packets:parse-ipv4", bytes(hex("4f00" + "00".repeat(30))), str("raw"))),
    ).toBe("E_COERCE");
    expect(
      code(
        await call(
          "packets:parse-tcp",
          bytes(hex("0001000200000000000000005000" + "00".repeat(6))),
          str("raw"),
        ),
      ),
    ).toBe("ok");
    expect(
      code(
        await call(
          "packets:parse-tcp",
          bytes(hex("000100020000000000000000f000" + "00".repeat(6))),
          str("raw"),
        ),
      ),
    ).toBe("E_COERCE");
    const udp = await call(
      "packets:parse-udp",
      bytes(hex("00010002ffff0000" + "aabb")),
      str("raw"),
    );
    expect(top(udp).v as string).toContain("Length: 65535 bytes (only 10 are present)");
  });

  test("a TLS record of 65535 bytes, a handshake message of 16 MiB, a 64 KiB cipher list", async () => {
    const big = hex("1703030" + "000" + "ffff").length; // keep the arithmetic honest
    expect(big).toBeGreaterThan(0);
    expect(
      code(
        await call("packets:parse-tls", bytes(hex("170303ffff" + "00".repeat(100))), str("raw")),
      ),
    ).toBe("E_COERCE");
    const msg = cat(Uint8Array.from([1]), hex("ffffff"), new Uint8Array(40));
    const r = await call("packets:parse-tls", bytes(rec(22, 0x0303, msg)), str("raw"));
    expect(top(r).v as string).toContain("length 16777215 (only 40 bytes are in this record");
    const body = cat(
      u16(0x0303),
      new Uint8Array(32),
      Uint8Array.from([0]),
      hex("ffff"),
      new Uint8Array(100),
    );
    expect(
      code(await call("packets:parse-tls", bytes(rec(22, 0x0303, hs(1, body))), str("raw"))),
    ).toBe("E_COERCE");
  });

  test("a VLAN tag chain of 16,000 tags is a bounded walk", async () => {
    const tags = new Uint8Array(4 * 16_000);
    for (let i = 0; i < 16_000; i++) tags.set(hex("8100000a"), i * 4);
    const frame = cat(new Uint8Array(12), tags, hex("0800"));
    const r = await call("packets:parse-ethernet", bytes(frame), str("raw"));
    expect(r.ok).toBe(true);
    expect((top(r).v as string).split("VLAN tag").length - 1).toBe(16_000);
  }, 60_000);
});

describe("the shared TLS words", () => {
  const clientFlight = packet("TLS 1.3 handshake: ClientHello");
  const serverFlight = packet("TLS 1.3: ServerHello and encrypted");
  const rec_ = async (data: Uint8Array, types: number[] = []) =>
    (await val(
      "packets:tls-records",
      bytes(data),
      list(types.map((n) => int(n))),
    )) as unknown as Array<{ v: Map<string, Value> }>;
  const f = (r: { v: Map<string, Value> }, k: string): unknown => (r.v.get(k) as Value).v;

  test("tls-records: types, versions, lengths, offsets and fragments", async () => {
    const all = await rec_(clientFlight);
    expect(all.map((r) => f(r, "type"))).toEqual([22, 20, 23, 23]);
    expect(all.map((r) => f(r, "version"))).toEqual([0x0301, 0x0303, 0x0303, 0x0303]);
    expect(all.map((r) => f(r, "offset"))).toEqual([0, 331, 337, 411]);
    expect(f(all[0] as never, "length")).toBe(326);
    expect(toHex(f(all[1] as never, "fragment") as Uint8Array)).toBe("01");
    expect((await rec_(clientFlight, [22])).length).toBe(1);
    expect((await rec_(clientFlight, [23, 20])).length).toBe(3);
    expect(await rec_(clientFlight, [21])).toEqual([]);
    expect(await val("packets:tls-records", bytes(new Uint8Array(0)), list([]))).toEqual([]);
    expect(code(await call("packets:tls-records", bytes(hex("16030100")), list([])))).toBe(
      "E_COERCE",
    );
  });

  test("tls-handshakes: the messages of a record; a record that is not a handshake is E_RANGE", async () => {
    const flight = packet("ServerHello and ServerHelloDone in one record");
    const records = (await runtime.call("packets:tls-records", [
      bytes(flight),
      list([]),
    ])) as Result;
    const first = (top(records).v as Value[])[0] as Value;
    const msgs = (await val("packets:tls-handshakes", first, list([]))) as unknown as Array<{
      v: Map<string, Value>;
    }>;
    expect(msgs.map((m) => f(m, "type"))).toEqual([2, 14, 11]);
    expect(msgs.map((m) => f(m, "complete"))).toEqual([true, true, false]);
    expect(f(msgs[2] as never, "length")).toBe(500);
    expect((f(msgs[2] as never, "body") as Uint8Array).length).toBe(20);
    const only = (await val("packets:tls-handshakes", first, list([int(14)]))) as unknown[];
    expect(only.length).toBe(1);
    const ccs = (
      top(await call("packets:tls-records", bytes(rec(20, 0x0303, hex("01"))), list([])))
        .v as Value[]
    )[0] as Value;
    expect(code(await call("packets:tls-handshakes", ccs, list([])))).toBe("E_RANGE");
  });

  const hellos = async (data: Uint8Array, kinds: number[] = []) =>
    (await val(
      "packets:tls-hellos",
      bytes(data),
      list(kinds.map((n) => int(n))),
    )) as unknown as Array<{ v: Map<string, Value> }>;
  const lst = (h: { v: Map<string, Value> }, k: string): unknown[] =>
    (f(h, k) as Value[]).map((x) => x.v);

  test("tls-hellos: a ClientHello with decoded extensions (JA3 and JA4 input)", async () => {
    const [h] = await hellos(clientFlight);
    expect(f(h as never, "kind")).toBe("client_hello");
    expect(f(h as never, "version")).toBe(0x0303);
    expect(lst(h as never, "ciphers").slice(0, 3)).toEqual([0x1302, 0x1303, 0x1301]);
    expect(lst(h as never, "ciphers").length).toBe(31);
    expect(lst(h as never, "compression")).toEqual([0]);
    expect(lst(h as never, "ext-types")).toEqual([0, 11, 10, 35, 16, 22, 23, 13, 43, 45, 51]);
    expect(lst(h as never, "sni")).toEqual(["example.com"]);
    expect(lst(h as never, "alpn")).toEqual(["h2", "http/1.1"]);
    expect(lst(h as never, "groups").slice(0, 3)).toEqual([29, 23, 30]);
    expect(lst(h as never, "point-formats")).toEqual([0, 1, 2]);
    expect(lst(h as never, "versions")).toEqual([0x0304, 0x0303]);
    expect(lst(h as never, "psk-modes")).toEqual([1]);
    expect(lst(h as never, "sig-algs")[0]).toBe(0x0403);
    expect(lst(h as never, "sig-algs").length).toBe(20);
    const shares = f(h as never, "key-shares") as Value[];
    expect(shares.length).toBe(1);
    expect((shares[0]?.v as Map<string, Value>).get("group")?.v).toBe(29);
    expect(((shares[0]?.v as Map<string, Value>).get("key")?.v as Uint8Array).length).toBe(32);
    expect(f(h as never, "has-extensions")).toBe(true);
    expect(f(h as never, "hrr")).toBe(false);
    expect((f(h as never, "random") as Uint8Array).length).toBe(32);
    expect((f(h as never, "session-id") as Uint8Array).length).toBe(32);
  });

  test("tls-hellos: a ServerHello, kinds filter, a HelloRetryRequest", async () => {
    expect((await hellos(serverFlight, [1])).length).toBe(0);
    const [s] = await hellos(serverFlight, [2]);
    expect(f(s as never, "kind")).toBe("server_hello");
    expect(lst(s as never, "ciphers")).toEqual([0x1302]);
    expect(lst(s as never, "versions")).toEqual([0x0304]);
    expect(lst(s as never, "ext-types")).toEqual([43, 51]);
    expect(f(s as never, "hrr")).toBe(false);
    const shares = f(s as never, "key-shares") as Value[];
    expect(shares.length).toBe(1);
    const hrr = packet("TLS 1.3: HelloRetryRequest flight");
    const [r] = await hellos(hrr);
    expect(f(r as never, "hrr")).toBe(true);
    const k = (await val("packets:tls-hellos", bytes(hrr), list([int(2)]))) as unknown as Array<{
      v: Map<string, Value>;
    }>;
    const shares2 = f(k[0] as never, "key-shares") as Value[];
    expect(((shares2[0]?.v as Map<string, Value>).get("key")?.v as Uint8Array).length).toBe(0);
    expect((await hellos(cat(clientFlight, serverFlight))).length).toBe(2);
    expect((await hellos(cat(clientFlight, serverFlight), [2])).length).toBe(1);
  });

  test("tls-hellos: GREASE values are kept; a hello without extensions; no hello gives an empty list", async () => {
    const [g] = await hellos(packet("TLS 1.3 ClientHello with GREASE"));
    expect(lst(g as never, "ciphers")[0]).toBe(0x2a2a);
    expect(lst(g as never, "ext-types")[0]).toBe(0x0a0a);
    expect(lst(g as never, "groups")[0]).toBe(0x3a3a);
    expect(lst(g as never, "versions")[0]).toBe(0x4a4a);
    const [old] = await hellos(packet("SSL 3.0 ClientHello"));
    expect(f(old as never, "has-extensions")).toBe(false);
    expect(lst(old as never, "ext-types")).toEqual([]);
    expect(lst(old as never, "compression")).toEqual([1, 0]);
    expect(await hellos(packet("Alerts, ChangeCipherSpec"))).toEqual([]);
    expect(await hellos(new Uint8Array(0))).toEqual([]);
    expect(
      code(
        await call(
          "packets:tls-hellos",
          bytes(packet("TLS 1.0 ServerHello with no")),
          list([int(3)]),
        ),
      ),
    ).toBe("ok");
  });

  test("tls-hellos: errors are E_COERCE (a hello that goes on in the next record, damage)", async () => {
    const cut = rec(22, 0x0303, hs(1, new Uint8Array(100)).subarray(0, 50));
    expect(code(await call("packets:tls-hellos", bytes(cut), list([])))).toBe("E_COERCE");
    expect(code(await call("packets:tls-hellos", bytes(hex("160303")), list([])))).toBe("E_COERCE");
  });
});

describe("cost on 64 KiB (steps are VM steps, measured)", () => {
  test("Parse Ethernet frame of 64 KiB: a few hundred steps", async () => {
    const frame = cat(new Uint8Array(12), hex("0800"), new Uint8Array(65_522));
    const r = await strict.call("packets:parse-ethernet", [bytes(frame), str("raw")]);
    expect(r.ok && r.steps).toBeLessThan(2000);
    const hexed = await strict.call("packets:parse-ethernet", [
      bytes(new TextEncoder().encode(toHex(frame))),
      str("hex"),
    ]);
    expect(hexed.ok && hexed.steps).toBeLessThan(2000);
    expect(top(hexed).v).toBe(top(r).v);
  });

  test("IPv4, TCP and UDP of 64 KiB payloads: parse and strip", async () => {
    const ip = cat(hex("4500ffff00014000400600000a0000010a000002"), new Uint8Array(65_515));
    for (const [op, data] of [
      ["parse-ipv4", ip],
      ["strip-ipv4", ip],
      ["parse-tcp", cat(hex("0050005000000001000000025010ffff00000000"), new Uint8Array(65_000))],
      ["strip-tcp", cat(hex("0050005000000001000000025010ffff00000000"), new Uint8Array(65_000))],
      ["parse-udp", cat(hex("00350035ffff0000"), new Uint8Array(65_527))],
      ["strip-udp", cat(hex("00350035ffff0000"), new Uint8Array(65_527))],
    ] as const) {
      const r = await strict.call(`packets:${op}`, [bytes(data), str("raw")]);
      expect(r.ok, op).toBe(true);
      expect(r.ok && r.steps, op).toBeLessThan(3000);
    }
  });

  test("TLS: 4,000 extensions in one hello", async () => {
    const exts = cat(
      ...Array.from({ length: 4000 }, (_, i) => cat(u16(0xff00 + (i % 200)), u16(0))),
    );
    const body = cat(
      u16(0x0303),
      new Uint8Array(32),
      Uint8Array.from([0]),
      hex("00021301"),
      hex("0100"),
      u16(exts.length),
      exts,
    );
    const r = await strict.call("packets:parse-tls", [
      bytes(rec(22, 0x0303, hs(1, body))),
      str("raw"),
    ]);
    expect(r.ok).toBe(true);
    expect(r.ok && r.steps).toBeLessThan(1_500_000);
  }, 60_000);

  test("TLS: 8,000 cipher suites in one hello", async () => {
    const suites = cat(...Array.from({ length: 8000 }, (_, i) => u16(0x1300 + (i % 400))));
    const body = cat(
      u16(0x0303),
      new Uint8Array(32),
      Uint8Array.from([0]),
      u16(suites.length),
      suites,
      hex("0100"),
    );
    const r = await strict.call("packets:parse-tls", [
      bytes(rec(22, 0x0303, hs(1, body))),
      str("raw"),
    ]);
    expect(r.ok).toBe(true);
    expect(r.ok && r.steps).toBeLessThan(1_500_000);
  }, 60_000);

  test("TLS: 64 KiB of records (empty ChangeCipherSpec-sized records)", async () => {
    const records = cat(
      ...Array.from({ length: 13_000 }, () => rec(23, 0x0303, new Uint8Array(0))),
    );
    const r = await strict.call("packets:parse-tls", [bytes(records), str("raw")]);
    expect(r.ok).toBe(true);
    expect(r.ok && r.steps).toBeLessThan(5_000_000);
  }, 60_000);

  test("tls-records and tls-hellos on 13,000 records: about 160 steps per record", async () => {
    const records = cat(
      ...Array.from({ length: 13_000 }, () => rec(23, 0x0303, new Uint8Array(0))),
    );
    const r = await strict.call("packets:tls-records", [bytes(records), list([])]);
    expect(r.ok && r.steps).toBeLessThan(2_500_000);
    const h = await strict.call("packets:tls-hellos", [bytes(records), list([])]);
    expect(h.ok && h.steps).toBeLessThan(2_600_000);
  }, 60_000);
});

describe("Strip HTTP headers (http:strip-headers)", () => {
  const strip = async (s: string | Uint8Array) =>
    val("http:strip-headers", bytes(typeof s === "string" ? new TextEncoder().encode(s) : s));
  const text = (b: unknown) => latin1(b as Uint8Array);

  test("the body after the first empty line, whatever the line ends", async () => {
    expect(text(await strip("A: b\r\n\r\nbody"))).toBe("body");
    expect(text(await strip("A: b\n\nbody"))).toBe("body");
    expect(text(await strip("A: b\r\n\nbody"))).toBe("body");
    expect(text(await strip("A: b\n\r\nbody"))).toBe("body");
    expect(text(await strip("A: b\r\n\r\n"))).toBe("");
    expect(text(await strip("\nbody"))).toBe("body");
    expect(text(await strip("A\r\n\r\nB\r\n\r\nC"))).toBe("B\r\n\r\nC");
  });

  test("no empty line is E_COERCE", async () => {
    for (const s of ["", "A: b", "A: b\r\n", "A: b\r\nC: d\r\n", "a\r\rb"])
      expect(code(await call("http:strip-headers", bytes(new TextEncoder().encode(s)))), s).toBe(
        "E_COERCE",
      );
  });

  test("any bytes: binary bodies and 64 KiB cost a few steps", async () => {
    const body = Uint8Array.from({ length: 65_536 }, (_, i) => (i * 7) & 255);
    const msg = cat(new TextEncoder().encode("HTTP/1.1 200 OK\r\nX: y\r\n\r\n"), body);
    const r = await strict.call("http:strip-headers", [bytes(msg)]);
    expect(r.ok && r.steps).toBeLessThan(100);
    expect(toHex(top(r).v as Uint8Array)).toBe(toHex(body));
    // a header block that is nothing but line ends: still linear
    const dense = new Uint8Array(65_536).fill(0x0a);
    const d = await strict.call("http:strip-headers", [bytes(dense)]);
    expect(d.ok && (top(d).v as Uint8Array).length).toBe(65_535);
  });
});

describe("Dechunk HTTP response (http:dechunk, src/prims/http.ts)", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  const dec = (s: string, limit = 1 << 20) => latin1(dechunk(enc(s), limit));

  test("chunks, extensions, trailers, bare line feeds", () => {
    expect(dec("4\r\nWiki\r\n6;a=b\r\npedia \r\nE\r\nin \r\n\r\nchunks.\r\n0\r\n\r\n")).toBe(
      "Wikipedia in \r\n\r\nchunks.",
    );
    expect(dec("0\r\n\r\n")).toBe("");
    expect(dec("1\r\nx\r\n0\r\nT: 1\r\nU: 2\r\n\r\n")).toBe("x");
    expect(dec("1\nx\n0\n\n")).toBe("x");
    expect(dec("A\r\n0123456789\r\n0000\r\n\r\n")).toBe("0123456789");
    expect(dec("1 \t;e\r\nx\r\n0\r\n\r\n")).toBe("x");
  });

  test("errors are E_COERCE with an offset", () => {
    for (const s of [
      "",
      "1\r\nx",
      "1\r\nx\r\n",
      "1\r\nx\r\n0\r\n",
      "1\r\nxy\r\n0\r\n\r\n",
      "g\r\n",
      "1\r\nx\r\n0\r\n\r\nextra",
      "-1\r\nx\r\n0\r\n\r\n",
      "1\r\nx\r\n0\r\nT: 1\r\n",
      "fffffffffffffffff\r\nx",
      "1;\x00\r\nx\r\n0\r\n\r\n",
    ]) {
      expect(() => dechunk(enc(s), 1 << 20), JSON.stringify(s)).toThrow();
    }
    expect(() => dechunk(enc("1\r\nxy\r\n0\r\n\r\n"), 1 << 20)).toThrow(
      /not followed by a line end \(byte 0x79\)/,
    );
    expect(() => dechunk(enc("5\r\nab\r\n"), 1 << 20)).toThrow(
      /declares 5 bytes but only 4 are left/,
    );
  });

  test("every cut of a valid body is E_COERCE", () => {
    const body = enc("3;x=y\r\nabc\r\n5\r\n12345\r\n0\r\nTrail: v\r\n\r\n");
    expect(latin1(dechunk(body, 1 << 20))).toBe("abc12345");
    for (let cut = 0; cut < body.length; cut++)
      expect(() => dechunk(body.subarray(0, cut), 1 << 20), `cut ${cut}`).toThrow();
  });

  test("the output limit (maxValueBytes) is E_LIMIT_VALUE", () => {
    const body = enc("a\r\n0123456789\r\n0\r\n\r\n");
    expect(dechunk(body, 10).length).toBe(10);
    expect(() => dechunk(body, 9)).toThrow(/exceeds|limit/);
  });

  test("a size that lies allocates nothing; 64 KiB of one-byte chunks costs a few steps", async () => {
    expect(() => dechunk(enc("7fffffffffffff\r\nabc\r\n0\r\n\r\n"), 1 << 20)).toThrow(/but only/);
    expect(() =>
      dechunk(enc("0000000000000000000000000000000002\r\nabc\r\n0\r\n\r\n"), 1 << 20),
    ).toThrow(/not followed|but only|line end/);
    const parts: Uint8Array[] = [];
    for (let i = 0; i < 10_900; i++)
      parts.push(enc("1\r\n" + String.fromCharCode(97 + (i % 26)) + "\r\n"));
    parts.push(enc("0\r\n\r\n"));
    const msg = cat(...parts);
    const r = await strict.call("http:dechunk", [bytes(msg)]);
    expect(r.ok && r.steps).toBeLessThan(100);
    expect((top(r).v as Uint8Array).length).toBe(10_900);
    expect(code(await call("http:dechunk", bytes(new Uint8Array(0))))).toBe("E_COERCE");
  });
});
