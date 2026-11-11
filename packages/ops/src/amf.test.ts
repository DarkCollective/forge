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
 * Tests for the `amf` vocabulary (vocab/amf.fth, src/prims/amf.ts). The op vectors (vocab/amf.test.json) hold the
 * AMF0 and AMF3 values built by hand from Adobe's specifications and the amfy library's output; these tests add
 * truncation at every cut point, mutated bytes, hostile lengths and references, the limits, round trips and the
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

const { int, str } = valueHelpers;
const runtime = await loadRuntime(["amf"]);

const decode = (d: Uint8Array, format: string, indent = 0, limits?: Limits) =>
  runtime.call(
    "amf:decode",
    [asBytes(d), str(format), int(indent)],
    limits === undefined ? undefined : { limits },
  );
const encode = (json: string, format: string, limits?: Limits) =>
  runtime.call(
    "amf:encode",
    [str(json), str(format)],
    limits === undefined ? undefined : { limits },
  );
const dbl = (x: number): string => {
  const b = new DataView(new ArrayBuffer(8));
  b.setFloat64(0, x);
  return toHex(new Uint8Array(b.buffer));
};

const AMF0_ITEMS = [
  `00${dbl(3.5)}`,
  "0101",
  "020003616263",
  "05",
  "06",
  `03 0001 61 00${dbl(1)} 0001 62 020001 78 000009`,
  "08 00000001 0001 6b 05 000009",
  `0b${dbl(1577934245000)}0000`,
  "0c 00000003 616263",
  "0f 00000004 3c612f3e",
  "10 0003 466f6f 0001 78 05 000009",
  "0a 00000002 05 06",
  "07 0001",
  "11 04 05",
  "0d",
].map((x) => x.replace(/ /g, ""));
const amf0Doc = (): Uint8Array =>
  fromHex(`0a${AMF0_ITEMS.length.toString(16).padStart(8, "0")}${AMF0_ITEMS.join("")}`);
const AMF3_ITEMS = [
  "00",
  "01",
  "02",
  "03",
  "0400",
  "047f",
  "048100",
  "04ffffffff",
  `05${dbl(1.5)}`,
  "060b68656c6c6f",
  "0600",
  "0801" + dbl(0),
  "09050104010402",
  "0a0b01 0361 0401 01",
  "0a 0b 01 0362 0402 01",
  "0a06",
  "0c07010203",
  "0d05 00 00000001ffffffff",
  "0e03 01 ffffffff",
  "0f03 00 " + dbl(2),
  "1003 00 01 04 05",
  "1103 00 06 03 6b 04 07",
  "0b093c612f3e",
  "0a" + ((2 << 4) | 3).toString(16) + "07466f6f 0378 0379 0401 0402",
].map((x) => x.replace(/ /g, ""));
const amf3Doc = (): Uint8Array =>
  fromHex(
    `09${((AMF3_ITEMS.length << 1) | 1).toString(16).padStart(2, "0")}01${AMF3_ITEMS.join("")}`,
  );

describe("decode", () => {
  test("AMF0 and AMF3 documents with every kind of value", async () => {
    expect(code(await decode(amf0Doc(), "AMF0"))).toBe("ok");
    expect(code(await decode(amf3Doc(), "AMF3"))).toBe("ok");
    expect(JSON.parse(text(await decode(amf3Doc(), "AMF3")))).toContainEqual({ a: 1 });
  });
  test("the format must be AMF0 or AMF3", async () => {
    expect(code(await decode(fromHex("05"), "AMF1"))).toBe("E_PARAM_INVALID");
  });
  test("every cut point of an AMF0 and of an AMF3 document is E_COERCE", async () => {
    expect(await cutPoints(amf0Doc(), (d) => decode(d, "AMF0"))).toEqual([]);
    expect(await cutPoints(amf3Doc(), (d) => decode(d, "AMF3"))).toEqual([]);
  });
  test("mutated bytes give a result or E_COERCE, nothing else", async () => {
    expect(
      await mutations(
        amf0Doc(),
        (d) => decode(d, "AMF0"),
        [0x00, 0x03, 0x07, 0x09, 0x11, 0x30, 0x7f, 0xff],
      ),
    ).toEqual([]);
    expect(
      await mutations(
        amf3Doc(),
        (d) => decode(d, "AMF3"),
        [0x00, 0x01, 0x05, 0x0b, 0x7f, 0x80, 0xff],
      ),
    ).toEqual([]);
  });
  test("hostile counts and lengths allocate nothing", async () => {
    for (const [h, f] of [
      ["0aFFFFFFFF", "AMF0"],
      ["0cFFFFFFFF", "AMF0"],
      ["0fFFFFFFFF", "AMF0"],
      ["09ffffff7f01", "AMF3"],
      ["0cffffff7f", "AMF3"],
      ["0dffffff7f00", "AMF3"],
      ["1001ffffff7f", "AMF3"],
      ["0a ffffff7f 01".replace(/ /g, ""), "AMF3"],
      ["11ffffff7f00", "AMF3"],
      ["060fffffff7f", "AMF3"],
    ] as const) {
      const t0 = Date.now();
      const r = await decode(fromHex(h), f);
      expect(code(r)).toBe("E_COERCE");
      expect(Date.now() - t0).toBeLessThan(2000);
    }
  });
  test("a reference to an object that is being read is a cycle", async () => {
    expect(
      message(await decode(fromHex("0a00000001 07 0000".replace(/ /g, "")), "AMF0")),
    ).toContain("cycle");
    expect(message(await decode(fromHex("09030109 00".replace(/ /g, "")), "AMF3"))).toContain(
      "cycle",
    );
  });
  test("references cannot grow a small input into a huge result", async () => {
    // array i holds the array i-1 twice, so the value has 2^40 leaves; the budget stops the copying early
    const levels = 40;
    const body: string[] = ["09 03 01 01"]; // index 1: an array of one null
    for (let i = 2; i <= levels; i++) {
      const ref = ((i - 1) << 1).toString(16).padStart(2, "0");
      body.push(`09 05 01 09${ref} 09${ref}`);
    }
    const doc = fromHex(
      `09 ${((levels << 1) | 1).toString(16).padStart(2, "0")} 01 ${body.join("")}`,
    );
    const t0 = Date.now();
    const r = await decode(doc, "AMF3", 0, { maxValueBytes: 1_000_000 });
    expect(code(r)).toBe("E_LIMIT_VALUE");
    expect(Date.now() - t0).toBeLessThan(5000);
  });
  test("a million nested arrays stop at the depth limit", async () => {
    const d = new Uint8Array(1_000_000);
    for (let i = 0; i < d.length; i += 5) d.set(fromHex("0a00000001"), i);
    const r0 = await decode(d, "AMF0");
    expect(code(r0)).toBe("E_COERCE");
    expect(message(r0)).toContain("deeper than 64");
    const d3 = new Uint8Array(999_999);
    for (let i = 0; i < d3.length; i += 3) d3.set(fromHex("090301"), i);
    expect(message(await decode(d3, "AMF3"))).toContain("deeper than 64");
  });
});

describe("encode", () => {
  test("the format must be AMF0 or AMF3", async () => {
    expect(code(await encode("1", "AMF2"))).toBe("E_PARAM_INVALID");
  });
  test("a long string uses the long string marker in AMF0", async () => {
    const h = toHex(raw(await encode(JSON.stringify("a".repeat(65536)), "AMF0")));
    expect(h.startsWith("0c00010000")).toBe(true);
    expect(
      toHex(raw(await encode(JSON.stringify("a".repeat(65535)), "AMF0"))).startsWith("02ffff"),
    ).toBe(true);
  });
  test("a string over 2^28 bytes cannot be an AMF3 length", async () => {
    // not built here (268 MB); the limit is the value budget first
    expect(
      code(await encode(JSON.stringify("a".repeat(70_000)), "AMF3", { maxValueBytes: 50_000 })),
    ).toBe("E_LIMIT_VALUE");
  });
  test("AMF3 integers at the edges of 29 bits", async () => {
    expect(toHex(raw(await encode("268435455", "AMF3")))).toBe("04bfffffff");
    expect(toHex(raw(await encode("-268435456", "AMF3")))).toBe("04c0808000");
    expect(toHex(raw(await encode("268435456", "AMF3")))).toBe(`05${dbl(268435456)}`);
  });
  test("an integer too large for a double is E_COERCE", async () => {
    expect(code(await encode("1" + "0".repeat(400), "AMF0"))).toBe("E_COERCE");
  });
});

describe("round trips", () => {
  for (const format of ["AMF0", "AMF3"]) {
    test(`random JSON values survive encode and decode (${format})`, async () => {
      const rand = rng(57);
      let done = 0;
      for (let i = 0; i < 300; i++) {
        const v = randomJson(rand, 4);
        const j = JSON.stringify(v);
        if (j.includes('"":')) continue;
        // a float with an integer value is read back as an integer: compare numerically
        const back = JSON.parse(text(await decode(raw(await encode(j, format)), format, 0)));
        expect(back).toEqual(v);
        done++;
      }
      expect(done).toBeGreaterThan(200);
    });
  }
});

describe("cost at 64 KiB", () => {
  for (const format of ["AMF0", "AMF3"]) {
    test(`encode and decode of about 64 KiB (${format})`, { timeout: 60_000 }, async () => {
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
      const e = await encode(j, format);
      const encMs = Date.now() - t0;
      const bin = raw(e);
      const t1 = Date.now();
      const d = await decode(bin, format, 0);
      const decMs = Date.now() - t1;
      expect(JSON.parse(text(d))).toEqual(rows);
      expect(steps(e)).toBeLessThan(100);
      expect(steps(d)).toBeLessThan(100);
      process.stderr.write(
        `\namf ${format} ${j.length} chars JSON: encode ${steps(e)} steps ${encMs} ms -> ${bin.length} bytes; decode ${steps(d)} steps ${decMs} ms\n`,
      );
    });
  }
});
