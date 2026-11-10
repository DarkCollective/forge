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
import { valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { buildCatalogue } from "./catalogue.js";
import { loadBundleNode } from "./sources-node.js";
import { INTERNAL_VOCABS } from "./types.js";

// The util vocabulary (vocab/util.fth): shared FL helpers, internal, never in the catalogue.
const { int, str } = valueHelpers;
const bundle = await loadBundleNode("all");
const runtime = assembleRuntime(bundle);

function top(r: { stack: readonly Value[] }): Value | undefined {
  return r.stack[r.stack.length - 1];
}

async function value(qname: string, args: Value[]): Promise<unknown> {
  const r = await runtime.call(qname, args);
  expect(r.ok).toBe(true);
  return (top(r) as { v: unknown }).v;
}

describe("util:space?", () => {
  test("true exactly for 9 to 13 and 32", async () => {
    for (let b = 0; b < 256; b++) {
      expect(await value("util:space?", [int(b)])).toBe((b >= 9 && b <= 13) || b === 32);
    }
  });
});

describe("util:space-or-comma?", () => {
  test("true for white space and the comma only", async () => {
    for (let b = 0; b < 256; b++) {
      const expected = (b >= 9 && b <= 13) || b === 32 || b === 44;
      expect(await value("util:space-or-comma?", [int(b)])).toBe(expected);
    }
  });
});

describe("util:separator", () => {
  test.each([
    ["none", ""],
    ["space", " "],
    ["comma", ","],
    ["newline", "\n"],
  ])("%s", async (choice, expected) => {
    expect(await value("util:separator", [str(choice)])).toBe(expected);
  });
});

describe("util:decode-table", () => {
  const table = async (alpha: string, ws: number, pad: number) =>
    (await value("util:decode-table", [str(alpha), int(ws), int(pad)])) as Uint8Array;

  test("indexes the alphabet and gives 255 elsewhere", async () => {
    const t = await table("abc", 255, 255);
    expect(t.length).toBe(256);
    expect([t[97], t[98], t[99]]).toEqual([0, 1, 2]);
    expect(t[100]).toBe(255);
    expect(t[0]).toBe(255);
  });

  test("white space gives the ws marker, = the pad marker", async () => {
    const t = await table("abc", 254, 253);
    for (const b of [9, 10, 11, 12, 13, 32]) expect(t[b]).toBe(254);
    expect(t[61]).toBe(253);
    expect(t[8]).toBe(255);
    expect(t[14]).toBe(255);
  });

  test("a marker of 255 means none", async () => {
    const t = await table("abc", 255, 255);
    expect([t[32], t[61]]).toEqual([255, 255]);
  });

  test("a byte of the alphabet wins over a marker (= in the Ascii85 alphabet)", async () => {
    const t = await table("=ab", 254, 253);
    expect([t[61], t[97], t[98]]).toEqual([0, 1, 2]);
  });
});

describe("util:check-symbols", () => {
  const table = async (alpha: string, ws: number, pad: number) =>
    (await value("util:decode-table", [str(alpha), int(ws), int(pad)])) as Uint8Array;
  const check = (data: number[], t: Uint8Array) =>
    runtime.call("util:check-symbols", [
      valueHelpers.bytes(Uint8Array.from(data)),
      valueHelpers.bytes(t),
    ]);

  test("translates every byte through the table", async () => {
    const t = await table("abc", 255, 255);
    const r = await check([99, 97, 98, 98], t);
    expect(r.ok).toBe(true);
    expect((top(r) as { v: Uint8Array }).v).toEqual(Uint8Array.of(2, 0, 1, 1));
  });

  test("empty data gives empty bytes", async () => {
    const r = await check([], await table("abc", 255, 255));
    expect(r.ok).toBe(true);
    expect((top(r) as { v: Uint8Array }).v).toEqual(new Uint8Array(0));
  });

  test("other markers (white space 254, padding 253) are left for the caller", async () => {
    const r = await check([97, 32, 61], await table("abc", 254, 253));
    expect(r.ok).toBe(true);
    expect((top(r) as { v: Uint8Array }).v).toEqual(Uint8Array.of(0, 254, 253));
  });

  test("a byte outside the alphabet is E_COERCE", async () => {
    const r = await check([97, 122, 98], await table("abc", 254, 253));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_COERCE");
  });

  test("white space is an error when the table maps it to 255", async () => {
    const r = await check([97, 32], await table("abc", 255, 255));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_COERCE");
  });
});

describe("util:int>be-bytes", () => {
  const be = async (v: number | bigint, n: number) =>
    (await value("util:int>be-bytes", [int(v), int(n)])) as Uint8Array;

  test("the low n bytes, most significant first", async () => {
    expect(await be(0x01020304, 4)).toEqual(Uint8Array.of(1, 2, 3, 4));
    expect(await be(0x0102030405, 5)).toEqual(Uint8Array.of(1, 2, 3, 4, 5));
  });

  test("pads with zeros and truncates high bytes", async () => {
    expect(await be(0x0102, 4)).toEqual(Uint8Array.of(0, 0, 1, 2));
    expect(await be(0x01020304, 2)).toEqual(Uint8Array.of(3, 4));
    expect(await be(0, 3)).toEqual(Uint8Array.of(0, 0, 0));
  });

  test("n of 0 gives no bytes; a single byte masks to 255", async () => {
    expect(await be(0x1234, 0)).toEqual(new Uint8Array(0));
    expect(await be(0x1ff, 1)).toEqual(Uint8Array.of(255));
  });

  test("beyond 32 bits (a 64-bit value)", async () => {
    expect(await be(0x0102030405060708n, 8)).toEqual(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8));
  });
});

describe("util:digits>int", () => {
  const fold = async (digits: number[], radix: number) =>
    await value("util:digits>int", [valueHelpers.bytes(Uint8Array.from(digits)), int(radix)]);

  test("no digits is 0", async () => {
    expect(Number(await fold([], 58))).toBe(0);
  });

  test("most significant digit first", async () => {
    expect(Number(await fold([1, 2, 3], 10))).toBe(123);
    expect(Number(await fold([1, 0, 1], 2))).toBe(5);
    expect(Number(await fold([84, 84, 84, 84, 84], 85))).toBe(4437053124);
  });

  test("leading zero digits do not change the value", async () => {
    expect(Number(await fold([0, 0, 7], 58))).toBe(7);
  });

  test("grows past 64 bits", async () => {
    expect(BigInt((await fold(Array(12).fill(57), 58)) as bigint | number)).toBe(58n ** 12n - 1n);
  });
});

describe("util is internal", () => {
  test("is listed in INTERNAL_VOCABS", () => {
    expect(INTERNAL_VOCABS).toContain("util");
  });

  const catalogue = buildCatalogue(runtime);

  test("no util word is in the catalogue", () => {
    expect(
      catalogue.ops.filter((op) => op.vocab === "util" || op.qname.startsWith("util:")),
    ).toEqual([]);
    expect(catalogue.vocabs).not.toContain("util");
  });

  test("the words that use util are", () => {
    const names = catalogue.ops.map((op) => op.qname);
    expect(names).toContain("base32:decode");
    expect(names).toContain("decimal:encode");
  });

  test("a user unit cannot define into util", () => {
    const units = [{ name: "evil.fth", source: "IN: util\n: evil ( -- int ) 1 ;\n" }];
    expect(() => assembleRuntime(bundle, { units })).toThrowError(/read-only/);
  });
});
