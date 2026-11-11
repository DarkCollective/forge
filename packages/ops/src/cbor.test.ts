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
 * Tests for the `cbor` vocabulary (vocab/cbor.fth, src/prims/cbor.ts). The op vectors (vocab/cbor.test.json) hold
 * the RFC 8949 Appendix A examples and the cases computed with Python's cbor2; these tests add the half-float
 * conversions, truncation at every cut point, mutated bytes, hostile lengths, the limits, round trips and the
 * cost at 64 KiB.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import {
  asBytes,
  code,
  cutPoints,
  fromHex,
  loadRuntime,
  message,
  mutations,
  randomJson,
  raw,
  rng,
  steps,
  text,
  toHex,
} from "./data-format-test.js";
import type { Limits } from "./data-format-test.js";
import { halfToNumber, numberToHalf } from "./prims/cbor.js";

const { int, str, bool } = valueHelpers;
const runtime = await loadRuntime(["cbor"]);

const decode = (d: Uint8Array, indent = 0, limits?: Limits) =>
  runtime.call(
    "cbor:decode",
    [asBytes(d), int(indent)],
    limits === undefined ? undefined : { limits },
  );
const encode = (json: string, typed = false, limits?: Limits) =>
  runtime.call(
    "cbor:encode",
    [str(json), bool(typed)],
    limits === undefined ? undefined : { limits },
  );
const dec = async (h: string) => text(await decode(fromHex(h)));
const enc = async (json: string, typed = false) => toHex(raw(await encode(json, typed)));

describe("half-precision floats", () => {
  test("every half converts to a number and back (NaN and the infinities aside)", () => {
    for (let h = 0; h < 0x10000; h++) {
      const x = halfToNumber(h);
      if (Number.isNaN(x)) continue;
      if (!Number.isFinite(x)) {
        expect(numberToHalf(x)).toBeUndefined();
        continue;
      }
      expect(numberToHalf(x)).toBe(h);
    }
  });
  test("a number half precision cannot hold is not converted", () => {
    expect(numberToHalf(1.1)).toBeUndefined();
    expect(numberToHalf(65520)).toBeUndefined();
    expect(numberToHalf(2 ** -25)).toBeUndefined();
    expect(numberToHalf(1 + 2 ** -11)).toBeUndefined();
    expect(numberToHalf(2 ** -24)).toBe(1);
  });
});

describe("decode", () => {
  test("the examples of RFC 8949 Appendix A", async () => {
    expect(await dec("1b000000e8d4a51000")).toBe("1000000000000");
    expect(await dec("c249010000000000000000")).toBe("18446744073709551616");
    expect(await dec("3bffffffffffffffff")).toBe("-18446744073709551616");
    expect(await dec("f93c00")).toBe("1.0");
    expect(await dec("fb7ff0000000000000")).toBe("null");
    expect(await dec("bf61610161629f0203ffff")).toBe('{"a":1,"b":[2,3]}');
    expect(await dec("5f42010243030405ff")).toBe('{"type":"Buffer","data":[1,2,3,4,5]}');
    expect(await dec("7f657374726561646d696e67ff")).toBe('"streaming"');
  });
  test("indent 4 is the default layout and 0 is compact", async () => {
    expect(text(await decode(fromHex("a1616101"), 4))).toBe('{\n    "a": 1\n}');
    expect(text(await decode(fromHex("a1616101"), 0))).toBe('{"a":1}');
    expect(code(await decode(fromHex("00"), 33))).toBe("E_RANGE");
  });
  test("tags: dates, bignums and the rest", async () => {
    expect(await dec("c11a514b67b0")).toBe('"2013-03-21T20:04:00.000Z"');
    const date = "2013-03-21T20:04:00.123+02:00";
    const hexText = Array.from(new TextEncoder().encode(date), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    expect(await dec(`c0781d${hexText}`)).toBe('"2013-03-21T18:04:00.123Z"');
    expect(await dec("c1fb41d452d9ec200000")).toBe('"2013-03-21T20:04:00.500Z"');
    expect(await dec("c24100")).toBe("0");
    expect(await dec("c34100")).toBe("-1");
    expect(await dec("c240")).toBe("0");
    expect(await dec("c2f6")).toBe('{"tag":2,"contents":null}'); // a bignum tag on a non-byte-string is shown as a tag
    expect(await dec("d9d9f700")).toBe('{"tag":55799,"contents":0}');
    expect(await dec("c1f97c00")).toBe('{"tag":1,"contents":null}'); // an infinite epoch time is null, so it is no date
    expect(code(await decode(fromHex("c1fb7fe0000000000000")))).toBe("E_COERCE"); // 1.3e308 seconds are out of range
  });
  test("simple values", async () => {
    expect(await dec("f7")).toBe("null");
    expect(await dec("f0")).toBe('{"simple":16}');
    expect(await dec("f820")).toBe('{"simple":32}');
    expect(code(await decode(fromHex("f81f")))).toBe("E_COERCE");
  });
  test("a text map key must have a JSON form", async () => {
    expect(await dec("a2f5 01 f6 02".replace(/ /g, ""))).toBe('{"true":1,"null":2}');
    expect(code(await decode(fromHex("a141000a")))).toBe("E_COERCE");
    expect(code(await decode(fromHex("a1a0 01".replace(/ /g, ""))))).toBe("E_COERCE");
  });
  test("every cut point of a document with every major type is E_COERCE", async () => {
    const doc = fromHex(
      "a8 6161 c249010000000000000000 6162 9f01 3903e7 fb3ff199999999999a 5f4201024103ff ff 6163 7f6161 62c3bc ff 6164 d82076687474703a2f2f7777772e6578616d706c652e636f6d 6165 f93c00 6166 a2f5f4f6f7 6167 83f0f820c11a514b67b0 6168 c11a514b67b0",
    );
    expect(code(await decode(doc))).toBe("ok");
    expect(await cutPoints(doc, (d) => decode(d))).toEqual([]);
  });
  test("mutated bytes give a result or E_COERCE, nothing else", async () => {
    const doc = fromHex(
      "a4 6161 83 01 3903e7 f93c00 6162 5f4201024103ff 6163 bf 6161 c24901000000000000000000 ff 6164 7f6161ff".replace(
        / /g,
        "",
      ),
    );
    expect(
      await mutations(
        doc,
        (d) => decode(d),
        [0x00, 0x1f, 0x3b, 0x5f, 0x7f, 0x9f, 0xbf, 0xc2, 0xff],
      ),
    ).toEqual([]);
  });
  test("a hostile length allocates nothing", async () => {
    for (const h of [
      "9bffffffffffffffff",
      "bbffffffffffffffff",
      "5bffffffffffffffff",
      "7bffffffffffffffff",
      "9b0000000100000000",
      "5a7fffffff",
      "9a7fffffff00",
    ]) {
      const t0 = Date.now();
      const r = await decode(fromHex(h));
      expect(code(r)).toBe("E_COERCE");
      expect(message(r)).toContain("truncated");
      expect(Date.now() - t0).toBeLessThan(2000);
    }
  });
  test("a million nested indefinite arrays stop at the depth limit", async () => {
    const r = await decode(new Uint8Array(1_000_000).fill(0x9f));
    expect(code(r)).toBe("E_COERCE");
    expect(message(r)).toContain("deeper than 64");
  });
  test("the value budget stops a result that is too big", async () => {
    const big = new Uint8Array(3 + 20_000);
    big[0] = 0x99;
    big[1] = 0x4e;
    big[2] = 0x20;
    expect(code(await decode(big.subarray(0, 3 + 20000), 0, { maxValueBytes: 100_000 }))).toBe(
      "E_LIMIT_VALUE",
    );
    expect(code(await decode(big.subarray(0, 3 + 20000), 0))).toBe("ok");
  });
  test("a bignum over the integer limit is E_LIMIT_VALUE", async () => {
    const body = new Uint8Array(40_000).fill(1);
    const head = fromHex("c25a00009c40");
    const d = new Uint8Array(head.length + body.length);
    d.set(head);
    d.set(body, head.length);
    expect(code(await decode(d, 0, { maxIntBits: 1024 }))).toBe("E_LIMIT_VALUE");
  });
});

describe("encode", () => {
  test("shortest integer heads", async () => {
    for (const [j, h] of [
      ["0", "00"],
      ["23", "17"],
      ["24", "1818"],
      ["255", "18ff"],
      ["256", "190100"],
      ["65535", "19ffff"],
      ["65536", "1a00010000"],
      ["4294967295", "1affffffff"],
      ["4294967296", "1b0000000100000000"],
      ["-1", "20"],
      ["-24", "37"],
      ["-25", "3818"],
      ["-256", "38ff"],
      ["-257", "390100"],
    ] as const)
      expect(await enc(j)).toBe(h);
  });
  test("bignums are the tags 2 and 3", async () => {
    expect(await enc("18446744073709551616")).toBe("c249010000000000000000");
    expect(await enc("-18446744073709551617")).toBe("c349010000000000000000");
    expect(await enc("-18446744073709551616")).toBe("3bffffffffffffffff");
  });
  test("floats take the shortest exact form", async () => {
    expect(await enc("0.0")).toBe("f90000");
    expect(await enc("-0.0")).toBe("f98000");
    expect(await enc("1.5")).toBe("f93e00");
    expect(await enc("65504.0")).toBe("f97bff");
    expect(await enc("65505.0")).toBe("fa477fe100");
    expect(await enc("1.1")).toBe("fb3ff199999999999a");
    expect(await enc("3.4028234663852886e38")).toBe("fa7f7fffff");
    expect(await enc("1.0000001192092896")).toBe("fa3f800001");
    expect(await enc("5.960464477539063e-8")).toBe("f90001");
  });
  test("map keys are sorted bytewise by their encoding (RFC 8949 4.2.1)", async () => {
    expect(await enc('{"b":1,"a":2}')).toBe("a2616102616201");
    expect(await enc('{"aa":1,"b":2,"":3}')).toBe("a3" + "6003" + "616202" + "62616101");
    const keys = ["z".repeat(24), "y".repeat(23), "x".repeat(255), "w"];
    const obj = Object.fromEntries(keys.map((k, i) => [k, i]));
    const h = await enc(JSON.stringify(obj));
    const at = [
      `6177`,
      `77${"79".repeat(23)}`,
      `7818${"7a".repeat(24)}`,
      `78ff${"78".repeat(255)}`,
    ].map((k) => h.indexOf(k));
    expect(at.every((x) => x > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
  test("typed-objects reads back what decode writes", async () => {
    for (const h of [
      "4401020304",
      "d82076687474703a2f2f7777772e6578616d706c652e636f6d",
      "f0",
      "f8ff",
      "d818456449455446",
      "d9d9f783010203",
      "5f4101ff",
    ]) {
      const j = await dec(h);
      const back = toHex(raw(await encode(j, true)));
      expect(await dec(back)).toBe(j);
    }
  });
  test("the Buffer shape is a plain map without typed-objects", async () => {
    expect(await enc('{"type":"Buffer","data":[1]}')).toBe(
      "a2646461746181" + "01" + "6474797065" + "66" + "427566666572",
    );
  });
  test("a lone surrogate is refused by the JSON reader", async () => {
    expect(code(await encode('"\\ud800"'))).toBe("E_COERCE");
  });
});

describe("round trips", () => {
  test("random JSON values survive encode and decode", async () => {
    const rand = rng(55);
    for (let i = 0; i < 300; i++) {
      const v = randomJson(rand, 4);
      const j = JSON.stringify(v);
      const back = JSON.parse(text(await decode(raw(await encode(j)), 0)));
      expect(back).toEqual(v);
    }
  });
  test("an integer outside 64 bits and a float keep their type", async () => {
    const j = "[123456789012345678901234567890,-123456789012345678901234567890,1.0,2,0.1]";
    expect(text(await decode(raw(await encode(j))))).toBe(
      "[123456789012345678901234567890,-123456789012345678901234567890,1.0,2,0.1]",
    );
  });
});

describe("cost at 64 KiB", () => {
  test("encode and decode of about 64 KiB", { timeout: 60_000 }, async () => {
    const rows = Array.from({ length: 800 }, (_, i) => ({
      id: i,
      name: `name ${i}`,
      tags: ["a", "b", i],
      score: i / 8 + 0.1,
      ok: i % 2 === 0,
      none: null,
    }));
    const j = JSON.stringify(rows);
    expect(j.length).toBeGreaterThan(60_000);
    const t0 = Date.now();
    const e = await encode(j);
    const encMs = Date.now() - t0;
    const bin = raw(e);
    const t1 = Date.now();
    const d = await decode(bin, 0);
    const decMs = Date.now() - t1;
    expect(JSON.parse(text(d))).toEqual(rows);
    expect(steps(e)).toBeLessThan(100);
    expect(steps(d)).toBeLessThan(100);
    process.stderr.write(
      `\ncbor ${j.length} chars JSON: encode ${steps(e)} steps ${encMs} ms -> ${bin.length} bytes; decode ${steps(d)} steps ${decMs} ms\n`,
    );
    const bigArray = new Uint8Array(65_536 + 3);
    bigArray[0] = 0x99;
    bigArray[1] = 0xff;
    bigArray[2] = 0xff;
    const t2 = Date.now();
    const flat = await decode(bigArray.subarray(0, 3 + 65_535), 0);
    process.stderr.write(`cbor 65,535 zeros: decode ${steps(flat)} steps ${Date.now() - t2} ms\n`);
    expect(code(flat)).toBe("ok");
  });
});
