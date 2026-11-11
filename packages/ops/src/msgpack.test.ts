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
 * Tests for the `msgpack` vocabulary (vocab/msgpack.fth, src/prims/msgpack.ts). The op vectors
 * (vocab/msgpack.test.json) hold the cases computed with Python's msgpack; these tests add the timestamp edges,
 * truncation at every cut point, mutated bytes, hostile lengths, the limits, round trips and the cost at 64 KiB.
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

const { int, str, bool } = valueHelpers;
const runtime = await loadRuntime(["msgpack"]);

const decode = (d: Uint8Array, indent = 0, limits?: Limits) =>
  runtime.call(
    "msgpack:decode",
    [asBytes(d), int(indent)],
    limits === undefined ? undefined : { limits },
  );
const encode = (json: string, typed = false, limits?: Limits) =>
  runtime.call(
    "msgpack:encode",
    [str(json), bool(typed)],
    limits === undefined ? undefined : { limits },
  );
const dec = async (h: string) => text(await decode(fromHex(h)));
const enc = async (json: string, typed = false) => toHex(raw(await encode(json, typed)));

describe("decode", () => {
  test("the examples of the specification", async () => {
    expect(await dec("c0")).toBe("null");
    expect(await dec("93010203")).toBe("[1,2,3]");
    expect(await dec("82a161 01 a162 c403010203".replace(/ /g, ""))).toBe(
      '{"a":1,"b":{"type":"Buffer","data":[1,2,3]}}',
    );
    expect(await dec("cf ffffffffffffffff".replace(/ /g, ""))).toBe("18446744073709551615");
    expect(await dec("d3 8000000000000000".replace(/ /g, ""))).toBe("-9223372036854775808");
  });
  test("timestamps: 32, 64 and 96 bits", async () => {
    expect(await dec("d6ff00000000")).toBe('"1970-01-01T00:00:00.000Z"');
    expect(await dec("d6ffffffffff")).toBe('"2106-02-07T06:28:15.000Z"');
    expect(await dec("d7ff 0000000100000000".replace(/ /g, ""))).toBe('"2106-02-07T06:28:16.000Z"');
    expect(await dec("d7ff 0000002800000001".replace(/ /g, ""))).toBe(
      '"1970-01-01T00:00:01.000000010Z"',
    );
    expect(await dec("c70cff 00000000 0000000000000000".replace(/ /g, ""))).toBe(
      '"1970-01-01T00:00:00.000Z"',
    );
    expect(await dec("c70cff 3b9ac9ff ffffffffffffffff".replace(/ /g, ""))).toBe(
      '"1969-12-31T23:59:59.999999999Z"',
    );
    expect(await dec("c70cff 000f4240 0000000000000000".replace(/ /g, ""))).toBe(
      '"1970-01-01T00:00:00.001Z"',
    );
    expect(code(await decode(fromHex("c70cff 3b9aca00 0000000000000000".replace(/ /g, ""))))).toBe(
      "E_COERCE",
    );
    expect(code(await decode(fromHex("c703ff000000")))).toBe("E_COERCE");
  });
  test("other extension types are shown with their bytes", async () => {
    expect(await dec("d47f05")).toBe('{"ext":127,"data":{"type":"Buffer","data":[5]}}');
    expect(await dec("c8 0001 80 ff".replace(/ /g, ""))).toBe(
      '{"ext":-128,"data":{"type":"Buffer","data":[255]}}',
    );
    expect(await dec("c9 00000000 05".replace(/ /g, ""))).toBe(
      '{"ext":5,"data":{"type":"Buffer","data":[]}}',
    );
  });
  test("every cut point of a document with every format is E_COERCE", async () => {
    const items = fromHex(
      "c0 c2 c3 7f ff cc80 cd0100 ce00010000 cf0000000100000000 d0ff d1ff00 d2ffffff00 d3ffffffffffff0000 ca3fc00000 cb3ff0000000000000 a161 d90161 c40101 c5000102 d40501 d6ff00000001 c70107 01 d705 0000000000000001 82a161 01 a162 92 0102",
    );
    const d = new Uint8Array(3 + items.length);
    d.set(fromHex("dc0018"), 0);
    d.set(items, 3);
    expect(code(await decode(d))).toBe("ok");
    expect(await cutPoints(d, (x) => decode(x))).toEqual([]);
  });
  test("mutated bytes give a result or E_COERCE, nothing else", async () => {
    const d = fromHex(
      "93 82 a161 c4 03 010203 a162 d6ff00000001 d7ff0000000100000002 cb3ff0000000000000".replace(
        / /g,
        "",
      ),
    );
    expect(
      await mutations(d, (x) => decode(x), [0x00, 0xc1, 0xc4, 0xc7, 0xdb, 0xdd, 0xdf, 0xff]),
    ).toEqual([]);
  });
  test("a hostile length allocates nothing", async () => {
    for (const h of [
      "dd ffffffff 00",
      "df ffffffff 00",
      "db ffffffff 61",
      "c6 ffffffff 00",
      "c9 ffffffff ff 00",
      "dd 7fffffff 00",
    ]) {
      const t0 = Date.now();
      const r = await decode(fromHex(h));
      expect(code(r)).toBe("E_COERCE");
      expect(message(r)).toContain("truncated");
      expect(Date.now() - t0).toBeLessThan(2000);
    }
  });
  test("a million nested arrays stop at the depth limit", async () => {
    const r = await decode(new Uint8Array(1_000_000).fill(0x91));
    expect(code(r)).toBe("E_COERCE");
    expect(message(r)).toContain("deeper than 64");
  });
  test("the value budget stops a result that is too big", async () => {
    const big = new Uint8Array(3 + 20_000);
    big.set(fromHex("dc4e20"));
    expect(code(await decode(big, 0, { maxValueBytes: 100_000 }))).toBe("E_LIMIT_VALUE");
    expect(code(await decode(big, 0))).toBe("ok");
  });
  test("indent", async () => {
    expect(text(await decode(fromHex("81a16192 0102"), 2))).toBe(
      '{\n  "a": [\n    1,\n    2\n  ]\n}',
    );
  });
});

describe("encode", () => {
  test("shortest formats", async () => {
    expect(await enc("127")).toBe("7f");
    expect(await enc("128")).toBe("cc80");
    expect(await enc("-32")).toBe("e0");
    expect(await enc("-33")).toBe("d0df");
    expect(await enc("1.5")).toBe("ca3fc00000");
    expect(await enc("0.1")).toBe("cb3fb999999999999a");
    expect(await enc("-0.0")).toBe("ca80000000");
    expect(await enc("[" + "0,".repeat(15) + "0]")).toBe("dc0010" + "00".repeat(16));
    expect(await enc('"' + "a".repeat(31) + '"')).toBe("bf" + "61".repeat(31));
    expect(await enc('"' + "a".repeat(32) + '"')).toBe("d920" + "61".repeat(32));
    expect(await enc('"' + "a".repeat(65536) + '"')).toBe("db00010000" + "61".repeat(65536));
  });
  test("an integer outside the formats is E_COERCE", async () => {
    expect(code(await encode("18446744073709551616"))).toBe("E_COERCE");
    expect(code(await encode("-9223372036854775809"))).toBe("E_COERCE");
    expect(await enc("18446744073709551615")).toBe("cfffffffffffffffff");
    expect(await enc("-9223372036854775808")).toBe("d38000000000000000");
  });
  test("typed-objects reads back what decode writes", async () => {
    for (const h of [
      "c40201ff",
      "d4050a",
      "d6ff4b5e1c00",
      "d7ff0000000100000002",
      "c70cff 3b9ac9ff ffffffffffffffff".replace(/ /g, ""),
      "c7 03 fb 010203".replace(/ /g, ""),
    ]) {
      const j = await dec(h);
      const back = toHex(raw(await encode(j, true)));
      expect(await dec(back)).toBe(j);
    }
  });
  test("timestamps take the shortest of the three layouts", async () => {
    const ts = async (iso: string) => enc(JSON.stringify({ timestamp: iso }), true);
    expect(await ts("1970-01-01T00:00:00Z")).toBe("d6ff00000000");
    expect(await ts("2106-02-07T06:28:15.000Z")).toBe("d6ffffffffff");
    expect(await ts("2106-02-07T06:28:16.000Z")).toBe("d7ff0000000100000000");
    expect(await ts("1969-12-31T23:59:59.999999999Z")).toBe("c70cff3b9ac9ffffffffffffffffff");
    expect((await ts("1970-01-01T00:00:00.5Z")).length).toBe(2 + 2 + 16);
    expect(code(await encode('{"timestamp":"2020-13-01T00:00:00Z"}', true))).toBe("E_COERCE");
    expect(await enc('{"timestamp":"2020-01-01T00:00:00Z"}', false)).toBe(
      "81" + "a974696d657374616d70" + "b4" + "323032302d30312d30315430303a30303a30305a",
    );
  });
  test("ext types outside -128..127 are not extensions", async () => {
    expect(await enc('{"ext":128,"data":{"type":"Buffer","data":[1]}}', true)).toBe(
      "82a3657874cc80a464617461c40101",
    );
  });
});

describe("round trips", () => {
  test("random JSON values survive encode and decode", async () => {
    const rand = rng(56);
    for (let i = 0; i < 300; i++) {
      const v = randomJson(rand, 4);
      const back = JSON.parse(text(await decode(raw(await encode(JSON.stringify(v))), 0)));
      expect(back).toEqual(v);
    }
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
      `\nmsgpack ${j.length} chars JSON: encode ${steps(e)} steps ${encMs} ms -> ${bin.length} bytes; decode ${steps(d)} steps ${decMs} ms\n`,
    );
  });
});
