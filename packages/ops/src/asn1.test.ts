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
 * Tests for the shared `asn1` vocabulary (vocab/asn1.fth, primitives in src/prims/asn1.ts, the name table in
 * src/asn1-oids.ts) and the ops built on it (asn1-dump, oid, pem; their known-answer vectors are in
 * vocab/*.test.json). Reference values come from independent tools: `openssl asn1parse -genstr` for the DER
 * of integers, tags and object identifiers, `openssl enc -base64` for PEM, `openssl req` for the certificate.
 * Here: the node records, the bounds (depth, truncation at every cut point, lying lengths, the size limit),
 * mutated input, the writers against openssl, the name table, PEM, and the VM step counts on 61 KB.
 */
import { valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { OID_TABLE } from "./asn1-oids.js";
import { oidDecode, oidEncode, parseIn, stringOf } from "./prims/asn1.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int, str, bool, list } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["asn1", "asn1-dump", "oid", "pem"]));

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
const utf8 = (s: string): Value => bytes(new TextEncoder().encode(s));
const rec = (v: unknown): Map<string, Value> => v as Map<string, Value>;
const field = (node: unknown, key: string): unknown => (rec(node).get(key) as Value).v;
const nodes = (v: unknown): Value[] => v as Value[];
/** A node record (as a Value) read from DER hex. */
const nodeOf = async (h: string): Promise<Value> => top(await call("asn1:parse", bytes(hex(h))));

/** An EC P-256 self-signed certificate made by `openssl req -x509` (482 bytes of DER). */
const CERT = hex(
  "308201de30820185a0030201020214600a0f7db714787bff29ec0cfb252e92f7b2b694300a06082a8648ce3d0403023036310b30090603550406130255533111300f060355040a0c0854657374204f72673114301206035504030c0b6578616d706c652e636f6d301e170d3236313131313139353433395a170d3236313231313139353433395a3036310b30090603550406130255533111300f060355040a0c0854657374204f72673114301206035504030c0b6578616d706c652e636f6d3059301306072a8648ce3d020106082a8648ce3d03010703420004527e03e94eca5485402b679af1ee88c0096d513392cc7440dca423a41d3bff1da57e5de45633af68c8c4d2172fbe87e0588747c8cc80950dff46cb925f7a5df0a371306f301d0603551d0e04160414d6a11fb6ae8c4f20bf454efc16ad1c36425b52f7301f0603551d23041830168014d6a11fb6ae8c4f20bf454efc16ad1c36425b52f7300f0603551d130101ff040530030101ff301c0603551d1104153013820b6578616d706c652e636f6d87040a000001300a06082a8648ce3d040302034700304402203549949f1c1cc9579794f33487bcad31bf426c896f6a8e437c4351342f33eccc022044a6c1f6eb9541875d8a77b8e856cac6fbf9c6b3a5195ff1fc1a337fdac3bd42",
);

/** `openssl asn1parse -genstr INTEGER:n`: the whole element. */
const INTEGERS: ReadonlyArray<readonly [string, string]> = [
  ["0", "020100"],
  ["1", "020101"],
  ["127", "02017f"],
  ["128", "02020080"],
  ["255", "020200ff"],
  ["256", "02020100"],
  ["-1", "0201ff"],
  ["-127", "020181"],
  ["-128", "020180"],
  ["-129", "0202ff7f"],
  ["-255", "0202ff01"],
  ["-256", "0202ff00"],
  ["-32768", "02028000"],
  ["-32769", "0203ff7fff"],
  ["32767", "02027fff"],
  ["32768", "0203008000"],
  ["65535", "020300ffff"],
  ["65536", "0203010000"],
  ["2147483647", "02047fffffff"],
  ["2147483648", "02050080000000"],
  ["9223372036854775808", "0209008000000000000000"],
  ["-9223372036854775808", "02088000000000000000"],
  ["-9223372036854775809", "0209ff7fffffffffffffff"],
  ["18446744073709551616", "0209010000000000000000"],
  ["170141183460469231731687303715884105728", "02110080000000000000000000000000000000"],
  ["-170141183460469231731687303715884105728", "021080000000000000000000000000000000"],
  [
    "57896044618658097711785492504343953926634992332820282019728792003956564832313",
    "0221008000000000000000000000000000000000000000000000000000000000003039",
  ],
  [
    "-57896044618658097711785492504343953926634992332820282019728792003956564819973",
    "0221ff7ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffb",
  ],
  [
    "32317006071311007300714876688669951960444102669715484032130345427524655138867890893197201411522913463688717960921898019494119559150490921095088152386448283120630877367300996091750197750389652106796057638384067568276792218642619756161838094338476170470581645852036305042887575891541065808607552399123930385521914333389668342420684974786564569494856176035326322058077805659331026192708460314150258592864177116725943603718461857357598351152301645904403697613233287231227125684710820209725157101726931323469678542580656697935045997268352998638215525166389437335543602135433229604645318478604952148193555853611059596230655",
    "0282010100ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  ],
];

/** A SEQUENCE nested `n` levels deep, the innermost empty. */
function nest(n: number): Uint8Array {
  let d = hex("3000");
  for (let i = 1; i < n; i++) {
    const l = d.length;
    const head = l < 128 ? [0x30, l] : l < 256 ? [0x30, 0x81, l] : [0x30, 0x82, l >> 8, l & 255];
    d = Uint8Array.from([...head, ...d]);
  }
  return d;
}

describe("asn1:parse-all and parse: the node records", () => {
  test("a SEQUENCE of INTEGER, OCTET STRING and NULL", async () => {
    const der = hex("300b0201010404aabbccdd0500");
    const root = nodes(await val("asn1:parse-all", bytes(der)));
    expect(root.length).toBe(1);
    const seq = root[0]?.v;
    expect([...rec(seq).keys()]).toEqual([
      "class",
      "constructed",
      "tag",
      "offset",
      "hlen",
      "len",
      "value",
      "children",
    ]);
    expect(field(seq, "class")).toBe("universal");
    expect(field(seq, "constructed")).toBe(true);
    expect(field(seq, "tag")).toBe(16);
    expect(field(seq, "offset")).toBe(0);
    expect(field(seq, "hlen")).toBe(2);
    expect(field(seq, "len")).toBe(11);
    expect(toHex(field(seq, "value") as Uint8Array)).toBe("");
    const kids = nodes(field(seq, "children"));
    expect(kids.map((k) => field(k.v, "tag"))).toEqual([2, 4, 5]);
    expect(kids.map((k) => field(k.v, "offset"))).toEqual([2, 5, 11]);
    expect(toHex(field(kids[1]?.v, "value") as Uint8Array)).toBe("aabbccdd");
    expect(nodes(field(kids[1]?.v, "children"))).toEqual([]);
  });

  test("classes, constructed bit and tag numbers (low and high form)", async () => {
    const der = hex("a003020102 820161 6103020105 e500 9f1f01aa 5f810001bb bf810000");
    const kids = nodes(await val("asn1:parse-all", bytes(der)));
    expect(
      kids.map((k) => [field(k.v, "class"), field(k.v, "constructed"), field(k.v, "tag")]),
    ).toEqual([
      ["context", true, 0],
      ["context", false, 2],
      ["application", true, 1],
      ["private", true, 5],
      ["context", false, 31],
      ["application", false, 128],
      ["context", true, 128],
    ]);
  });

  test("parse takes exactly one element", async () => {
    expect(field(await val("asn1:parse", bytes(hex("020105"))), "tag")).toBe(2);
    expect(code(await call("asn1:parse", bytes(hex(""))))).toBe("E_COERCE");
    expect(code(await call("asn1:parse", bytes(hex("0201050500"))))).toBe("E_COERCE");
    expect(nodes(await val("asn1:parse-all", bytes(hex(""))))).toEqual([]);
  });

  test("raw and content cut the element out of the data it was read from", async () => {
    const root = await val("asn1:parse", bytes(CERT));
    expect(field(root, "len")).toBe(478);
    const tbs = nodes(field(root, "children"))[0] as Value;
    const raw = await val("asn1:raw", bytes(CERT), tbs);
    expect(toHex(raw as Uint8Array)).toBe(toHex(CERT.subarray(4, 4 + 4 + 389)));
    const content = await val("asn1:content", bytes(CERT), tbs);
    expect(toHex(content as Uint8Array)).toBe(toHex(CERT.subarray(8, 8 + 389)));
  });

  test("the typed readers", async () => {
    const root = await val("asn1:parse", bytes(CERT));
    const tbs = nodes(field(root, "children"))[0]?.v;
    const [version, serial, sigAlg] = nodes(field(tbs, "children"));
    const ver = nodes(field(version?.v, "children"))[0] as Value;
    expect(await val("asn1:node>int", ver)).toBe(2);
    expect(String(await val("asn1:node>int", serial as Value))).toBe(
      BigInt("0x600a0f7db714787bff29ec0cfb252e92f7b2b694").toString(),
    );
    const oid = nodes(field(sigAlg?.v, "children"))[0] as Value;
    expect(await val("asn1:node>oid", oid)).toBe("1.2.840.10045.4.3.2");
    const name = nodes(field(tbs, "children"))[3]?.v;
    const rdn = nodes(field(name, "children"))[0]?.v;
    const atv = nodes(field(rdn, "children"))[0]?.v;
    const value = nodes(field(atv, "children"))[1] as Value;
    expect(await val("asn1:node>text", value)).toBe("US");
    // a wrong type is E_COERCE and names what was expected
    const r = await call("asn1:node>oid", ver);
    expect(r.ok ? "" : r.error.message).toMatch(
      /expected an OBJECT IDENTIFIER at offset 10, found universal 2/,
    );
    expect(code(await call("asn1:node>int", oid))).toBe("E_COERCE");
    expect(code(await call("asn1:node>text", ver))).toBe("E_COERCE");
  });

  test("node>bits, node>bool and child", async () => {
    const r = await call("asn1:node>bits", await nodeOf("030205a0"));
    expect(r.ok && r.stack.map((v) => (v.v instanceof Uint8Array ? toHex(v.v) : v.v))).toEqual([
      "a0",
      5,
    ]);
    for (const bad of ["0300", "030208a0", "030105"]) {
      expect(code(await call("asn1:node>bits", await nodeOf(bad))), bad).toBe("E_COERCE");
    }
    expect(await val("asn1:node>bool", await nodeOf("0101ff"))).toBe(true);
    expect(await val("asn1:node>bool", await nodeOf("010100"))).toBe(false);
    expect(code(await call("asn1:node>bool", await nodeOf("01020000")))).toBe("E_COERCE");
    const seq = await nodeOf("3006020101020102");
    expect(field(await val("asn1:child", seq, int(1)), "offset")).toBe(5);
    expect(code(await call("asn1:child", seq, int(2)))).toBe("E_COERCE");
  });

  test("is?, universal?, context? and expect", async () => {
    const n = await nodeOf("a003020102");
    expect(await val("asn1:context?", n, int(0))).toBe(true);
    expect(await val("asn1:context?", n, int(1))).toBe(false);
    expect(await val("asn1:universal?", n, int(0))).toBe(false);
    expect(await val("asn1:is?", n, str("context"), int(0))).toBe(true);
    expect(code(await call("asn1:expect", n, str("universal"), int(16), str("a SEQUENCE")))).toBe(
      "E_COERCE",
    );
    expect(code(await call("asn1:expect", n, str("context"), int(0), str("[0]")))).toBe("ok");
  });
});

describe("asn1: strings", () => {
  test("string types", () => {
    expect(stringOf(12, hex("68c3a96c6c6f"))).toBe("héllo");
    expect(stringOf(30, hex("00480069"))).toBe("Hi");
    expect(stringOf(30, hex("d83dde00"))).toBe("\u{1F600}");
    expect(stringOf(28, hex("0001f600"))).toBe("\u{1F600}");
    expect(stringOf(19, hex("414243"))).toBe("ABC");
    expect(stringOf(20, hex("e9"))).toBe("é");
    expect(() => stringOf(12, hex("ff"))).toThrow(/UTF-8/);
    expect(() => stringOf(30, hex("004800"))).toThrow(/odd/);
    expect(() => stringOf(30, hex("d83d0041"))).toThrow(/surrogate/);
    expect(() => stringOf(28, hex("00110000"))).toThrow(/code point/);
    expect(() => stringOf(28, hex("000041"))).toThrow(/multiple of 4/);
  });
});

describe("the reader's bounds", () => {
  test("every proper prefix of a certificate is E_COERCE", async () => {
    for (let n = 1; n < CERT.length; n++) {
      const r = await call("asn1:parse-all", bytes(CERT.subarray(0, n)));
      expect(code(r), `prefix ${n}`).toBe("E_COERCE");
    }
    expect(code(await call("asn1:parse-all", bytes(CERT)))).toBe("ok");
  });

  test("depth: 64 levels are read, 65 are E_COERCE, and the limit can be set", async () => {
    expect(code(await call("asn1:parse-all", bytes(nest(64))))).toBe("ok");
    const r = await call("asn1:parse-all", bytes(nest(65)));
    expect(code(r)).toBe("E_COERCE");
    expect(r.ok ? "" : r.error.message).toMatch(/nested deeper than 64 levels/);
    expect(parseIn(nest(3), 0, 6, 3, 1 << 20).length).toBe(1);
    expect(() => parseIn(nest(3), 0, 6, 2, 1 << 20)).toThrow(/deeper than 2/);
    expect(() => parseIn(nest(3), 0, 6, 0, 1 << 20)).toThrow(/1 to 256/);
    expect(() => parseIn(nest(3), 0, 6, 257, 1 << 20)).toThrow(/1 to 256/);
    // thousands of levels do not overflow the stack: the depth check stops the descent at level 65
    let deep = hex("3000");
    while (deep.length < 60_000) {
      const l = deep.length;
      deep = Uint8Array.from([0x30, 0x82, l >> 8, l & 255, ...deep]);
    }
    expect(code(await call("asn1:parse-all", bytes(deep)))).toBe("E_COERCE");
  });

  test("indefinite length, end-of-contents and the reserved length byte are E_COERCE", async () => {
    for (const h of ["30800000", "0000", "04ff", "0480", "3080050000"]) {
      expect(code(await call("asn1:parse-all", bytes(hex(h)))), h).toBe("E_COERCE");
    }
    const r = await call("asn1:parse-all", bytes(hex("30800000")));
    expect(r.ok ? "" : r.error.message).toMatch(/indefinite length at offset 0/);
  });

  test("a length that lies allocates nothing and is E_COERCE", async () => {
    const lies = [
      "0484ffffffff00",
      "048800000000ffffffff00",
      "04887fffffffffffffff00",
      "0489010000000000000000" + "00",
      "3084ffffffff0500",
    ];
    for (const h of lies) {
      const t = Date.now();
      expect(code(await call("asn1:parse-all", bytes(hex(h)))), h).toBe("E_COERCE");
      expect(Date.now() - t).toBeLessThan(500);
    }
    // 126 length bytes, all but the last zero: legal in BER and read as a length of 2
    const padded = Uint8Array.from([4, 0x80 | 126, ...new Array(125).fill(0), 2, 0xab, 0xcd]);
    const node = await val("asn1:parse", bytes(padded));
    expect(toHex(field(node, "value") as Uint8Array)).toBe("abcd");
    expect(field(node, "hlen")).toBe(128);
  });

  test("a window outside the data is E_RANGE", () => {
    expect(() => parseIn(hex("0500"), 0, 3, 64, 1 << 20)).toThrow(/not inside/);
    expect(() => parseIn(hex("0500"), 2, 1, 64, 1 << 20)).toThrow(/not inside/);
    expect(() => parseIn(hex("0500"), -1, 1, 64, 1 << 20)).toThrow(/not inside/);
    expect(parseIn(hex("aa0500"), 1, 3, 64, 1 << 20).length).toBe(1);
  });

  test("offsets in a window are offsets into the data", () => {
    const r = parseIn(hex("aabb020107"), 2, 5, 64, 1 << 20);
    expect(field(r[0]?.v, "offset")).toBe(2);
  });

  test("the tree is stopped at the value limit before it is built", async () => {
    const nulls = Uint8Array.from(Array.from({ length: 6000 }, () => [5, 0]).flat());
    const limits = { maxValueBytes: 1_000_000 };
    const r = await runtime.call("asn1:parse-all", [bytes(nulls)], { limits });
    expect(code(r)).toBe("E_LIMIT_VALUE");
    const ok = await runtime.call("asn1:parse-all", [bytes(nulls.subarray(0, 2000))], { limits });
    expect(code(ok)).toBe("ok");
  });

  test("mutated certificates either parse or are E_COERCE (never another error)", async () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    let parsed = 0;
    for (let i = 0; i < 400; i++) {
      const m = Uint8Array.from(CERT);
      for (let k = 0; k < 1 + (rnd() % 4); k++) m[rnd() % m.length] = rnd() & 255;
      const r = await call("asn1:parse-all", bytes(m));
      expect(["ok", "E_COERCE"]).toContain(code(r));
      if (r.ok) parsed++;
    }
    expect(parsed).toBeGreaterThan(50);
  });

  test("a certificate is read into the expected tree", async () => {
    const root = await val("asn1:parse", bytes(CERT));
    const count = (n: unknown): number =>
      1 + nodes(field(n, "children")).reduce((s, c) => s + count(c.v), 0);
    expect(count(root)).toBe(59);
  });
});

describe("OBJECT IDENTIFIER", () => {
  test("decode and encode against openssl and X.690", () => {
    const cases: Array<[string, string]> = [
      ["2a864886f70d01010b", "1.2.840.113549.1.1.11"],
      ["813403", "2.100.3"],
      ["8837", "2.999"],
      ["00", "0.0"],
      ["4f", "1.39"],
      ["27", "0.39"],
      ["6983f09da7ebcfdee0c7a1a7b2c0948cc8f9d776", "2.25.329800735698586629295641978511506172918"],
      ["2a82808080808080808000", "1.2.18446744073709551616"],
    ];
    for (const [h, dotted] of cases) {
      expect(oidDecode(hex(h))).toBe(dotted);
      expect(toHex(oidEncode(dotted))).toBe(h);
    }
  });

  test("errors", () => {
    expect(() => oidDecode(hex(""))).toThrow(/no bytes/);
    expect(() => oidDecode(hex("2a86"))).toThrow(/cut short/);
    expect(() => oidDecode(hex("802a"))).toThrow(/leading zero/);
    expect(() => oidDecode(new Uint8Array(4097).fill(1))).toThrow(/4096/);
    for (const t of ["", "1", "3.1", "1.40", "1.2.", "1..2", "01.2", "1.2.x", "1.-2", ".1.2"]) {
      expect(() => oidEncode(t), t).toThrow(/object identifier|arc/);
    }
    expect(() =>
      oidEncode("1.2." + Array.from({ length: 5000 }, () => "1000000").join(".")),
    ).toThrow(/4096/);
    expect(oidEncode("2.1000000000000000000000000000000").length).toBeGreaterThan(10);
  });

  test("the words: oid-label, oid-name, oid-short, oid-find", async () => {
    expect(await val("asn1:oid-name", str("1.2.840.113549.1.1.11"))).toBe(
      "sha256WithRSAEncryption",
    );
    expect(await val("asn1:oid-name", str("1.2.3"))).toBe("");
    expect(await val("asn1:oid-label", str("1.2.3"))).toBe("1.2.3");
    expect(await val("asn1:oid-label", str("2.5.4.3"))).toBe("commonName");
    expect(await val("asn1:oid-short", str("2.5.4.3"))).toBe("CN");
    expect(await val("asn1:oid-short", str("2.5.29.19"))).toBe("");
    expect(await val("asn1:oid-find", str("prime256v1"))).toBe("1.2.840.10045.3.1.7");
    expect(await val("asn1:oid-find", str("PRIME256V1"))).toBe("1.2.840.10045.3.1.7");
    expect(await val("asn1:oid-find", str("CN"))).toBe("2.5.4.3");
    expect(await val("asn1:oid-find", str("nope"))).toBe("");
  });

  test("the name table: every OID is valid and unique, every name is unique", () => {
    const dotted = new Set<string>();
    const names = new Set<string>();
    const shorts = new Set<string>();
    for (const e of OID_TABLE) {
      expect(oidDecode(oidEncode(e[0])), e[0]).toBe(e[0]);
      expect(dotted.has(e[0]), `duplicate OID ${e[0]}`).toBe(false);
      expect(names.has(e[1]), `duplicate name ${e[1]}`).toBe(false);
      dotted.add(e[0]);
      names.add(e[1]);
      if (e[2] !== undefined) {
        expect(shorts.has(e[2]), `duplicate short name ${e[2]}`).toBe(false);
        shorts.add(e[2]);
      }
    }
    expect(OID_TABLE.length).toBeGreaterThan(200);
    // the names were checked against openssl while the table was written; a sample is pinned here
    const sample: Array<[string, string]> = [
      ["2.5.29.17", "subjectAltName"],
      ["2.5.29.19", "basicConstraints"],
      ["1.3.6.1.5.5.7.3.1", "serverAuth"],
      ["1.2.840.10045.4.3.2", "ecdsa-with-SHA256"],
      ["1.3.132.0.34", "secp384r1"],
      ["1.3.132.0.10", "secp256k1"],
      ["1.3.101.112", "ED25519"],
      ["2.16.840.1.101.3.4.2.1", "sha256"],
      ["1.2.840.113549.1.1.10", "rsassaPss"],
      ["1.3.36.3.3.2.8.1.1.7", "brainpoolP256r1"],
      ["0.9.2342.19200300.100.1.25", "domainComponent"],
    ];
    const byOid = new Map(OID_TABLE.map((e) => [e[0], e[1]]));
    for (const [o, n] of sample) expect(byOid.get(o), o).toBe(n);
  });
});

describe("DER writers", () => {
  test("der-length", async () => {
    const cases: Array<[number, string]> = [
      [0, "00"],
      [127, "7f"],
      [128, "8180"],
      [255, "81ff"],
      [256, "820100"],
      [65535, "82ffff"],
      [65536, "83010000"],
      [16777216, "8401000000"],
    ];
    for (const [n, h] of cases) {
      expect(toHex((await val("asn1:der-length", int(n))) as Uint8Array), String(n)).toBe(h);
    }
    expect(code(await call("asn1:der-length", int(-1)))).toBe("E_RANGE");
  });

  test("tlv", async () => {
    expect(toHex((await val("asn1:tlv", int(4), bytes(hex("ab")))) as Uint8Array)).toBe("0401ab");
    const long = (await val("asn1:tlv", int(48), bytes(new Uint8Array(200)))) as Uint8Array;
    expect(toHex(long.subarray(0, 3))).toBe("3081c8");
    expect(long.length).toBe(203);
    expect(code(await call("asn1:tlv", int(256), bytes(hex(""))))).toBe("E_RANGE");
    expect(code(await call("asn1:tlv", int(-1), bytes(hex(""))))).toBe("E_RANGE");
  });

  test("tlv-tagged against openssl (high tags, classes)", async () => {
    const t = async (cls: string, cons: boolean, tag: number, content: string) =>
      toHex(
        (await val(
          "asn1:tlv-tagged",
          str(cls),
          bool(cons),
          int(tag),
          bytes(hex(content)),
        )) as Uint8Array,
      );
    expect(await t("context", false, 31, "6162")).toBe("9f1f026162");
    expect(await t("context", false, 128, "6162")).toBe("9f8100026162");
    expect(await t("context", false, 16383, "6162")).toBe("9fff7f026162");
    expect(await t("context", false, 16384, "6162")).toBe("9f818000026162");
    expect(await t("application", false, 5, "6162")).toBe("45026162");
    expect(await t("private", false, 200, "6162")).toBe("df8148026162");
    expect(await t("context", true, 0, "020105")).toBe("a003020105");
    expect(await t("context", true, 31, "020105")).toBe("bf1f03020105");
    expect(await t("universal", true, 16, "")).toBe("3000");
    const bad = (cls: string, tag: number) =>
      call("asn1:tlv-tagged", str(cls), bool(false), int(tag), bytes(hex("")));
    expect(code(await bad("nope", 1))).toBe("E_RANGE");
    expect(code(await bad("context", -1))).toBe("E_RANGE");
  });

  test("INTEGER against openssl, and der>int is the inverse", async () => {
    for (const [n, h] of INTEGERS) {
      expect(toHex((await val("asn1:tlv-int", int(BigInt(n)))) as Uint8Array), n).toBe(h);
      expect(String(await val("asn1:node>int", await nodeOf(h))), n).toBe(n);
    }
    for (let n = -1200; n <= 1200; n += 7) {
      const content = (await val("asn1:int>der", int(n))) as Uint8Array;
      expect(String(await val("asn1:der>int", bytes(content)))).toBe(String(n));
      expect(content.length).toBeLessThanOrEqual(2);
    }
    expect(code(await call("asn1:der>int", bytes(hex(""))))).toBe("E_COERCE");
  });

  test("NULL, BOOLEAN, OCTET STRING, BIT STRING, UTF8String, OID, SEQUENCE, SET, explicit", async () => {
    const h = async (op: string, ...a: Value[]) => toHex((await val(op, ...a)) as Uint8Array);
    expect(await h("asn1:tlv-oid", str("1.2.840.113549.1.1.11"))).toBe("06092a864886f70d01010b");
    expect(await h("asn1:tlv-null")).toBe("0500");
    expect(await h("asn1:tlv-bool", bool(true))).toBe("0101ff");
    expect(await h("asn1:tlv-bool", bool(false))).toBe("010100");
    expect(await h("asn1:tlv-octets", bytes(hex("aabb")))).toBe("0402aabb");
    expect(await h("asn1:tlv-bits", bytes(hex("a0")), int(5))).toBe("030205a0");
    expect(await h("asn1:tlv-bits", bytes(hex("")), int(0))).toBe("030100");
    expect(await h("asn1:tlv-utf8", str("hé"))).toBe("0c03" + "68c3a9");
    const items = list([bytes(hex("020101")), bytes(hex("0500"))]);
    expect(await h("asn1:tlv-seq", items)).toBe("3005020101" + "0500");
    expect(await h("asn1:tlv-set", items)).toBe("3105020101" + "0500");
    expect(await h("asn1:tlv-seq", list([]))).toBe("3000");
    expect(await h("asn1:tlv-explicit", int(0), bytes(hex("020105")))).toBe("a003020105");
    expect(code(await call("asn1:tlv-bits", bytes(hex("a0")), int(8)))).toBe("E_RANGE");
    expect(code(await call("asn1:tlv-bits", bytes(hex("")), int(3)))).toBe("E_RANGE");
    expect(code(await call("asn1:tlv-oid", str("3.1")))).toBe("E_COERCE");
  });

  test("what the writers produce is read back by the reader", async () => {
    const parts = [
      await val("asn1:tlv-int", int(-129)),
      await val("asn1:tlv-oid", str("2.5.4.3")),
      await val("asn1:tlv-explicit", int(3), bytes(hex("0500"))),
    ].map((v) => bytes(v as Uint8Array));
    const seq = (await val("asn1:tlv-seq", list(parts))) as Uint8Array;
    expect(toHex(seq)).toBe("300d" + "0202ff7f" + "0603550403" + "a3020500");
    const root = await val("asn1:parse", bytes(seq));
    expect(nodes(field(root, "children")).length).toBe(3);
  });
});

describe("PEM", () => {
  test("decode: label, headers, data, several blocks, text around", async () => {
    const text =
      "junk\n-----BEGIN A B-----\nAAEC\nAw==\n-----END A B-----\nmore junk\n" +
      "-----BEGIN ENCRYPTED KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,0011\n  continued\n\nBAUG\n-----END ENCRYPTED KEY-----\n";
    const blocks = nodes(await val("asn1:pem-decode", utf8(text)));
    expect(blocks.length).toBe(2);
    expect(field(blocks[0]?.v, "label")).toBe("A B");
    expect(toHex(field(blocks[0]?.v, "data") as Uint8Array)).toBe("00010203");
    expect([...rec(field(blocks[0]?.v, "headers")).keys()]).toEqual([]);
    expect(field(blocks[1]?.v, "label")).toBe("ENCRYPTED KEY");
    expect(toHex(field(blocks[1]?.v, "data") as Uint8Array)).toBe("040506");
    const h = rec(field(blocks[1]?.v, "headers"));
    expect(h.get("Proc-Type")?.v).toBe("4,ENCRYPTED");
    expect(h.get("DEK-Info")?.v).toBe("AES-128-CBC,0011 continued");
  });

  test("decode: no block gives an empty list; damage is E_COERCE", async () => {
    expect(nodes(await val("asn1:pem-decode", utf8("hello")))).toEqual([]);
    for (const s of [
      "-----BEGIN A-----\nAAAA\n",
      "-----BEGIN A-----\nAAAA\n-----END B-----\n",
      "-----BEGIN A-----\n-----BEGIN B-----\n",
      "-----BEGIN A-----\nA\n-----END A-----\n",
      "-----BEGIN A-----\nAA*A\n-----END A-----\n",
    ]) {
      expect(code(await call("asn1:pem-decode", utf8(s))), s).toBe("E_COERCE");
    }
  });

  test("encode: lines of 64, empty data, and the round trip", async () => {
    for (let n = 0; n <= 200; n += 13) {
      const data = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 255);
      const pem = (await val("asn1:pem-encode", str("TEST DATA"), bytes(data))) as string;
      expect(pem.startsWith("-----BEGIN TEST DATA-----\n")).toBe(true);
      expect(pem.endsWith("-----END TEST DATA-----\n")).toBe(true);
      for (const line of pem.split("\n").slice(1, -2)) expect(line.length).toBeLessThanOrEqual(64);
      const back = nodes(await val("asn1:pem-decode", utf8(pem)));
      expect(toHex(field(back[0]?.v, "data") as Uint8Array)).toBe(toHex(data));
    }
    expect(await val("asn1:pem-encode", str("X"), bytes(hex("")))).toBe(
      "-----BEGIN X-----\n-----END X-----\n",
    );
    for (const label of ["", "A\nB", "A-----B", "É"]) {
      expect(code(await call("asn1:pem-encode", str(label), bytes(hex("00")))), label).toBe(
        "E_RANGE",
      );
    }
  });
});

describe("the ops", () => {
  test("the five ops are ops", () => {
    for (const op of [
      "asn1-dump:parse",
      "oid:from-hex",
      "oid:to-hex",
      "pem:to-hex",
      "pem:from-hex",
    ]) {
      expect(runtime.meta(op).op, op).toBe(true);
    }
    expect(runtime.meta("pem:from-hex").params.map((p) => p.name)).toEqual(["header"]);
    expect(runtime.meta("asn1-dump:parse").params.map((p) => p.name)).toEqual([
      "start",
      "truncate",
    ]);
  });

  test("a certificate through pem:from-hex, pem:to-hex and asn1-dump:parse", async () => {
    const pem = (await val("pem:from-hex", str(toHex(CERT)), str("CERTIFICATE"))) as string;
    expect(pem.split("\n").length).toBe(14);
    const back = await val("pem:to-hex", str(pem));
    expect(back).toBe(toHex(CERT));
    const dump = (await val("asn1-dump:parse", str(back as string), int(0), int(32))) as string;
    expect(dump.split("\n")[0]).toBe("SEQUENCE");
    expect(dump).toContain("ObjectIdentifier ecdsa-with-SHA256 (1 2 840 10045 4 3 2)");
    expect(dump).toContain("[2] example.com");
    expect(dump).toContain("[7] 0a000001");
  });
});

describe("cost (61 KB of DER: 4,000 elements)", () => {
  const item = hex(
    "30" + "3b" + "0204" + "01020304" + "0609" + "2a864886f70d01010b" + "0428" + "07".repeat(40),
  );
  const items = Array.from({ length: 1000 }, () => [...item]).flat();
  const big = Uint8Array.from([0x30, 0x82, items.length >> 8, items.length & 255, ...items]);

  test("parse-all is a handful of VM steps and fast", async () => {
    const t = Date.now();
    const r = await call("asn1:parse-all", bytes(big));
    expect(r.ok && r.steps).toBeLessThan(100);
    expect(Date.now() - t).toBeLessThan(2000);
  });

  test(
    "the outline of 4,000 elements fits the default step limit with room to spare",
    {
      timeout: 60_000,
    },
    async () => {
      const r = await call("asn1-dump:parse", str(toHex(big)), int(0), int(32));
      if (!r.ok) throw new Error(r.error.code + r.error.message);
      expect(r.steps).toBeLessThan(2_000_000);
      expect(top(r).v as string).toContain(
        "OCTETSTRING " + "07".repeat(16) + "..(total 40bytes).." + "07".repeat(16),
      );
    },
  );

  test("PEM of 61 KB is cheap in both directions", async () => {
    const r = await call("pem:from-hex", str(toHex(big)), str("X"));
    expect(r.ok && r.steps).toBeLessThan(50_000);
    const back = await call("pem:to-hex", top(r));
    expect(back.ok && back.steps).toBeLessThan(500);
    expect(top(back).v).toBe(toHex(big));
  });
});
