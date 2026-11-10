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

// ---- the words promoted at the close-out of Phase 5 wave 1 ----

const bytesV = (...xs: number[]): Value => valueHelpers.bytes(Uint8Array.from(xs));
const listV = (...xs: number[]): Value => valueHelpers.list(xs.map((x) => int(x)));
const u8 = (v: unknown): number[] => [...(v as Uint8Array)];

/** Runs FL source and gives the top of the stack (the run must succeed). */
async function fl(src: string): Promise<unknown> {
  const r = await runtime.run(src);
  expect(r.ok, src).toBe(true);
  return (top(r as { stack: readonly Value[] }) as { v: unknown }).v;
}

async function failure(qname: string, args: Value[]): Promise<{ code: string; message: string }> {
  const r = await runtime.call(qname, args);
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("expected a failure");
  return { code: r.error.code, message: r.error.message };
}

describe("util:cp>str", () => {
  test.each([
    [0, "\0"],
    [65, "A"],
    [233, "é"],
    [0x2800, "⠀"],
    [0x1f600, "\u{1f600}"],
  ])("%i", async (cp, expected) => {
    expect(await value("util:cp>str", [int(cp)])).toBe(expected);
  });

  test("a surrogate or a value over 0x10FFFF is an error", async () => {
    expect((await runtime.call("util:cp>str", [int(0xd800)])).ok).toBe(false);
    expect((await runtime.call("util:cp>str", [int(0x110000)])).ok).toBe(false);
  });
});

describe("digit predicates", () => {
  test("dec-digit? and hex-digit? agree with the definition for every byte", async () => {
    for (let c = 0; c < 256; c++) {
      const ch = String.fromCharCode(c);
      expect(await value("util:dec-digit?", [int(c)])).toBe(/[0-9]/.test(ch));
      expect(await value("util:hex-digit?", [int(c)])).toBe(/[0-9a-fA-F]/.test(ch));
    }
  });

  test("a code above 255 is not a digit", async () => {
    expect(await value("util:hex-digit?", [int(0xff10)])).toBe(false);
  });
});

describe("util:between?", () => {
  test.each([
    [5, 5, 9, true],
    [9, 5, 9, true],
    [4, 5, 9, false],
    [10, 5, 9, false],
    [7, 9, 5, false],
  ])("%i in %i..%i is %s", async (n, lo, hi, expected) => {
    expect(await value("util:between?", [int(n), int(lo), int(hi)])).toBe(expected);
  });
});

describe("util:byte>hex and util:pad-hex", () => {
  test("byte>hex is two upper-case digits", async () => {
    for (const b of [0, 9, 10, 15, 16, 127, 171, 255]) {
      expect(await value("util:byte>hex", [int(b)])).toBe(
        b.toString(16).toUpperCase().padStart(2, "0"),
      );
    }
  });

  test.each([
    [255, 4, "00ff"],
    [255, 2, "ff"],
    [255, 1, "ff"],
    [0, 0, "0"],
    [0, 3, "000"],
    [4096, 8, "00001000"],
    [0xdeadbeef, 8, "deadbeef"],
    [0x123456789, 8, "123456789"],
  ])("pad-hex %i to %i digits is %s", async (v, n, expected) => {
    expect(await value("util:pad-hex", [int(v), int(n)])).toBe(expected);
  });
});

describe("util:starts-with? and util:ends-with?", () => {
  test.each([
    ["abc", "a", true, false],
    ["abc", "abc", true, true],
    ["abc", "c", false, true],
    ["abc", "bc", false, true],
    ["abc", "ab", true, false],
    ["abc", "", true, true],
    ["", "", true, true],
    ["", "a", false, false],
    ["ab", "abc", false, false],
    ["\u{1f600}x", "\u{1f600}", true, false],
  ])("%j with %j", async (s, p, starts, ends) => {
    expect(await value("util:starts-with?", [str(s), str(p)])).toBe(starts);
    expect(await value("util:ends-with?", [str(s), str(p)])).toBe(ends);
  });
});

describe("util:strip-space", () => {
  test("removes ASCII white space everywhere and nothing else", async () => {
    expect(await value("util:strip-space", [str(" a b\tc\r\nd\u000be\u000cf ")])).toBe("abcdef");
    expect(await value("util:strip-space", [str("")])).toBe("");
    expect(await value("util:strip-space", [str(" \n ")])).toBe("");
    expect(await value("util:strip-space", [str("a b")])).toBe("a b");
  });
});

describe("util:repeat-str and util:zero-bytes", () => {
  test("repeat-str", async () => {
    expect(await value("util:repeat-str", [str("ab"), int(3)])).toBe("ababab");
    expect(await value("util:repeat-str", [str("ab"), int(0)])).toBe("");
    expect(await value("util:repeat-str", [str(""), int(5)])).toBe("");
  });

  test("zero-bytes", async () => {
    expect(u8(await value("util:zero-bytes", [int(0)]))).toEqual([]);
    expect(u8(await value("util:zero-bytes", [int(4)]))).toEqual([0, 0, 0, 0]);
  });
});

describe("util:count-leading, util:trim-start and util:trim-end", () => {
  test("count-leading on bytes, lists and the empty sequence", async () => {
    expect(await fl("#[ 00 00 01 00 ] [ 0 = ] util:count-leading")).toBe(2);
    expect(await fl("#[ 01 00 ] [ 0 = ] util:count-leading")).toBe(0);
    expect(await fl("#[ 00 00 ] [ 0 = ] util:count-leading")).toBe(2);
    expect(await fl("#[ ] [ 0 = ] util:count-leading")).toBe(0);
    expect(await fl("{ 1 2 3 10 2 } [ 5 < ] util:count-leading")).toBe(3);
  });

  test("trim-start and trim-end remove only the matching edge characters", async () => {
    expect(await fl('"  ab  " [ 32 = ] util:trim-start')).toBe("ab  ");
    expect(await fl('"  ab  " [ 32 = ] util:trim-end')).toBe("  ab");
    expect(await fl('"a b" [ 32 = ] util:trim-start')).toBe("a b");
    expect(await fl('"a b" [ 32 = ] util:trim-end')).toBe("a b");
    expect(await fl('"    " [ 32 = ] util:trim-start')).toBe("");
    expect(await fl('"    " [ 32 = ] util:trim-end')).toBe("");
    expect(await fl('"" [ 32 = ] util:trim-end')).toBe("");
    expect(await fl('" \\t x \\t " [ dup 32 = swap 9 = or ] util:trim-end')).toBe(" \t x");
  });

  test("a code point above U+FFFF counts as one character", async () => {
    expect(await fl('"\\u{1F600}\\u{1F600}a" [ 128512 = ] util:trim-start')).toBe("a");
    expect(await fl('"a\\u{1F600}" [ 128512 = ] util:trim-end')).toBe("a");
  });
});

describe("util:number-tokens and util:numbers>bytes", () => {
  test("number-tokens splits at white space and commas and drops empty pieces", async () => {
    const tokens = async (s: string) =>
      ((await value("util:number-tokens", [str(s)])) as { v: string }[]).map((t) => t.v);
    expect(await tokens(" 1,2 ,, 3\n4\t ")).toEqual(["1", "2", "3", "4"]);
    expect(await tokens("")).toEqual([]);
    expect(await tokens(" , ")).toEqual([]);
    expect(await tokens("a;b")).toEqual(["a;b"]);
  });

  const decode = (text: string, radix: number) =>
    runtime.call("util:numbers>bytes", [
      valueHelpers.bytes(Uint8Array.from(text, (c) => c.charCodeAt(0))),
      int(radix),
      str("not a byte"),
    ]);

  test("decodes byte values of the radix", async () => {
    const r = await decode("1, 2 255\n0", 10);
    expect(r.ok).toBe(true);
    expect(u8((top(r) as { v: unknown }).v)).toEqual([1, 2, 255, 0]);
    expect(u8((top(await decode("ff 10 0A", 16)) as { v: unknown }).v)).toEqual([255, 16, 10]);
    expect(u8((top(await decode("377 0", 8)) as { v: unknown }).v)).toEqual([255, 0]);
    expect(u8((top(await decode("", 10)) as { v: unknown }).v)).toEqual([]);
  });

  test.each([["256"], ["-1"], ["-0"]])("%s is E_COERCE with the given message", async (bad) => {
    const r = await decode(bad, 10);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("E_COERCE");
      expect(r.error.message).toContain("not a byte");
    }
  });

  test.each([
    ["12x", 10],
    ["1.5", 10],
    ["+1", 10],
    ["8", 8],
    ["g", 16],
  ] as const)(
    "%s in radix %i is not a number: E_COERCE from the conversion",
    async (bad, radix) => {
      const r = await decode(bad, radix);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("E_COERCE");
    },
  );
});

describe("util:hex-unescape", () => {
  const unescape = async (s: string, marker: string) =>
    u8(await value("util:hex-unescape", [str(s), str(marker), str("bad escape")]));
  const bytesOf = (s: string) => Array.from(s, (c) => c.charCodeAt(0) & 255);

  test("replaces each marker and two hex digits by a byte, of either case", async () => {
    expect(await unescape("a%41b", "%")).toEqual(bytesOf("aAb"));
    expect(await unescape("%e9%E9%00", "%")).toEqual([0xe9, 0xe9, 0]);
    expect(await unescape("=3D=3d", "=")).toEqual(bytesOf("=="));
  });

  test("text without the marker is its Latin-1 bytes; a following hex digit stays", async () => {
    expect(await unescape("plain", "%")).toEqual(bytesOf("plain"));
    expect(await unescape("", "%")).toEqual([]);
    expect(await unescape("%414", "%")).toEqual(bytesOf("A4"));
    expect(await unescape("é%41", "%")).toEqual([0xe9, 0x41]);
  });

  test.each([
    ["%"],
    ["%4"],
    ["a%"],
    ["%zz"],
    ["%4g"],
    ["%-1"],
    ["%-0"],
    ["%+1"],
    ["% 1"],
    ["%41%"],
  ])("%j is E_COERCE with the given message", async (bad) => {
    const e = await failure("util:hex-unescape", [str(bad), str("%"), str("bad escape")]);
    expect(e.code).toBe("E_COERCE");
    expect(e.message).toContain("bad escape");
  });
});

describe("util:byte-at, util:bit-field and util:nibbles>byte", () => {
  test("byte-at gives 0 past the end, for bytes and for lists", async () => {
    expect(await value("util:byte-at", [bytesV(7, 8, 9), int(0)])).toBe(7);
    expect(await value("util:byte-at", [bytesV(7, 8, 9), int(2)])).toBe(9);
    expect(await value("util:byte-at", [bytesV(7, 8, 9), int(3)])).toBe(0);
    expect(await value("util:byte-at", [bytesV(), int(0)])).toBe(0);
    expect(await value("util:byte-at", [listV(300, 400), int(1)])).toBe(400);
    expect(await value("util:byte-at", [listV(300, 400), int(2)])).toBe(0);
  });

  test("bit-field reads n bits from bit p, most significant first", async () => {
    const field = async (d: number[], p: number, n: number) =>
      await value("util:bit-field", [bytesV(...d), int(p), int(n)]);
    expect(await field([0xab, 0xcd, 0xef], 0, 8)).toBe(0xab);
    expect(await field([0xab, 0xcd, 0xef], 4, 8)).toBe(0xbc);
    expect(await field([0xab, 0xcd, 0xef], 0, 5)).toBe(0xab >> 3);
    expect(await field([0xab, 0xcd, 0xef], 11, 13)).toBe((0xcdef >> 0) & 0x1fff);
    expect(await field([0xff], 4, 8)).toBe(0xf0);
    expect(await field([], 0, 13)).toBe(0);
    expect(await field([0xff], 100, 5)).toBe(0);
  });

  test("bit-field agrees with a bit-string reading for every position and width", async () => {
    const data = [0x5a, 0xc3, 0x0f, 0xe1];
    const bits = data.map((b) => b.toString(2).padStart(8, "0")).join("") + "0".repeat(24);
    for (let p = 0; p < 40; p += 3) {
      for (const n of [1, 5, 6, 8, 13]) {
        const expected = Number.parseInt(bits.slice(p, p + n), 2);
        expect(await value("util:bit-field", [bytesV(...data), int(p), int(n)])).toBe(expected);
      }
    }
  });

  test("nibbles>byte joins two nibbles, high first, from bytes or a list", async () => {
    expect(await value("util:nibbles>byte", [bytesV(1, 2, 3, 4), int(0)])).toBe(0x12);
    expect(await value("util:nibbles>byte", [bytesV(1, 2, 3, 4), int(1)])).toBe(0x34);
    expect(await value("util:nibbles>byte", [listV(15, 0, 10, 11), int(0)])).toBe(0xf0);
    expect(await value("util:nibbles>byte", [listV(15, 0, 10, 11), int(1)])).toBe(0xab);
  });
});

describe("util:int>bytes", () => {
  test.each([
    [0, []],
    [1, [1]],
    [255, [255]],
    [256, [1, 0]],
    [0x010203, [1, 2, 3]],
    [0xffff, [255, 255]],
    [0x1000000, [1, 0, 0, 0]],
  ])("%i", async (n, expected) => {
    expect(u8(await value("util:int>bytes", [int(n)]))).toEqual(expected);
  });

  test("a 64-bit value and a power of two beyond", async () => {
    expect(u8(await value("util:int>bytes", [int(0xffffffffffffffffn)]))).toEqual(
      Array(8).fill(255),
    );
    expect(u8(await value("util:int>bytes", [int(2n ** 64n)]))).toEqual([1, ...Array(8).fill(0)]);
  });
});

describe("util:int>symbols, util:bytes>symbols and util:symbols>bytes", () => {
  // The alphabets and outputs here are ASCII, so a char-code copy is the UTF-8 bytes.
  const sym = (s: string) => valueHelpers.bytes(Uint8Array.from(s, (c) => c.charCodeAt(0)));
  const text = (v: unknown) => String.fromCharCode(...(v as Uint8Array));
  const table = async (alpha: string) =>
    valueHelpers.bytes(
      (await value("util:decode-table", [str(alpha), int(254), int(255)])) as Uint8Array,
    );

  test("int>symbols writes the digits with the symbols, radix = alphabet length", async () => {
    expect(text(await value("util:int>symbols", [int(0), sym("01")]))).toBe("");
    expect(text(await value("util:int>symbols", [int(5), sym("01")]))).toBe("101");
    expect(text(await value("util:int>symbols", [int(10), sym("abc")]))).toBe("bab");
    expect(text(await value("util:int>symbols", [int(57), sym("0123456789abcdef")]))).toBe("39");
    expect(text(await value("util:int>symbols", [int(1), sym("xyz")]))).toBe("y");
  });

  test("bytes>symbols maps each leading zero byte to the first symbol", async () => {
    const enc = async (d: number[], alpha: string) =>
      text(await value("util:bytes>symbols", [bytesV(...d), sym(alpha)]));
    expect(await enc([], "01")).toBe("");
    expect(await enc([0], "01")).toBe("0");
    expect(await enc([0, 0], "01")).toBe("00");
    expect(await enc([0, 0, 5], "01")).toBe("00101");
    expect(await enc([5], "01")).toBe("101");
    expect(await enc([1, 0], "abcdefghijklmnopqrstuvwxyz")).toBe("jw");
  });

  test("symbols>bytes is the inverse, skips white space and rejects unknown symbols", async () => {
    const tables: Record<string, Value> = {
      "01": await table("01"),
      abc: await table("abc"),
    };
    const dec = (s: string, alpha: string, radix: number) =>
      runtime.call("util:symbols>bytes", [sym(s), tables[alpha] as Value, int(radix)]);
    const ok = async (s: string, alpha: string, radix: number) => {
      const r = await dec(s, alpha, radix);
      expect(r.ok).toBe(true);
      return u8((top(r) as { v: unknown }).v);
    };
    expect(await ok("", "01", 2)).toEqual([]);
    expect(await ok("00101", "01", 2)).toEqual([0, 0, 5]);
    expect(await ok(" 0 0\n1 0 1 ", "01", 2)).toEqual([0, 0, 5]);
    expect(await ok("0", "01", 2)).toEqual([0]);
    expect(await ok("bab", "abc", 3)).toEqual([10]);
    const bad = await dec("012", "01", 2);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("E_COERCE");
  });

  test("round trip for leading zeros and random data in radix 58", async () => {
    const alpha = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    const t = await table(alpha);
    for (const d of [
      [],
      [0],
      [0, 0, 0],
      [0, 1],
      [255],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      [0, 0, 255, 255, 0],
    ]) {
      const enc = (await value("util:bytes>symbols", [bytesV(...d), sym(alpha)])) as Uint8Array;
      const r = await runtime.call("util:symbols>bytes", [valueHelpers.bytes(enc), t, int(58)]);
      expect(r.ok).toBe(true);
      expect(u8((top(r) as { v: unknown }).v)).toEqual(d);
    }
  });
});

describe("util letter and permutation words", () => {
  const b = (...v: number[]) => valueHelpers.bytes(Uint8Array.from(v));
  const bytesOf = async (q: string, args: Value[]) => [...((await value(q, args)) as Uint8Array)];
  const ALPHA = Array.from({ length: 26 }, (_, i) => i);

  test("letter?, letters?, digits?", async () => {
    for (const c of [64, 65, 90, 91, 96, 97, 122, 123, 48]) {
      expect(await value("util:letter?", [int(c)])).toBe(
        (c >= 65 && c <= 90) || (c >= 97 && c <= 122),
      );
    }
    expect(await value("util:letters?", [str("AbZ")])).toBe(true);
    expect(await value("util:letters?", [str("")])).toBe(false);
    expect(await value("util:letters?", [str("A1")])).toBe(false);
    expect(await value("util:digits?", [str("0123")])).toBe(true);
    expect(await value("util:digits?", [str("")])).toBe(false);
    expect(await value("util:digits?", [str("1a")])).toBe(false);
  });

  test("letter-indices, digit-values and letter-table", async () => {
    expect(await bytesOf("util:letter-indices", [str("AbZz")])).toEqual([0, 1, 25, 25]);
    expect(await bytesOf("util:digit-values", [str("0719")])).toEqual([0, 7, 1, 9]);
    const t = (await value("util:letter-table", [])) as Uint8Array;
    expect(t).toHaveLength(256);
    for (let c = 0; c < 256; c++) {
      const letter = (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
      expect(t[c]).toBe(letter ? (c | 32) - 97 : 255);
    }
  });

  test("count-of, index-of, perm-invert, perm?", async () => {
    expect(await value("util:count-of", [b(1, 2, 1, 1), int(1)])).toBe(3);
    expect(await value("util:count-of", [b(), int(1)])).toBe(0);
    expect(await value("util:index-of", [b(5, 6, 7), int(7)])).toBe(2);
    expect((await runtime.call("util:index-of", [b(5, 6, 7), int(9)])).ok).toBe(false);
    expect(await bytesOf("util:perm-invert", [b(2, 0, 1)])).toEqual([1, 2, 0]);
    expect(await value("util:perm?", [b(2, 0, 1), int(3)])).toBe(true);
    expect(await value("util:perm?", [b(2, 0, 2), int(3)])).toBe(false);
    expect(await value("util:perm?", [b(0, 1), int(3)])).toBe(false);
    expect(await value("util:perm?", [valueHelpers.list([int(1), int(0)]), int(2)])).toBe(true);
  });

  test("rotor-shifted, rotor-shift-table and table-compose3", async () => {
    const w = [
      4, 10, 12, 5, 11, 6, 3, 16, 21, 25, 13, 19, 14, 22, 24, 7, 23, 20, 18, 15, 0, 8, 1, 17, 2, 9,
    ];
    for (const s of [0, 1, 7, 25]) {
      const expected = ALPHA.map((x) => ((((w[(x + s) % 26] as number) - s) % 26) + 26) % 26);
      expect(await bytesOf("util:rotor-shifted", [b(...w), int(s)])).toEqual(expected);
    }
    const table = await bytesOf("util:rotor-shift-table", [b(...w)]);
    expect(table).toHaveLength(676);
    for (const s of [0, 3, 25]) {
      expect(table.slice(s * 26, s * 26 + 26)).toEqual(
        await bytesOf("util:rotor-shifted", [b(...w), int(s)]),
      );
    }
    const p = ALPHA.map((x) => (x + 1) % 26);
    const q = ALPHA.map((x) => ((x * 3) % 26 === x ? x : (x + 2) % 26));
    const r = ALPHA.map((x) => (x + 5) % 26);
    expect(await bytesOf("util:table-compose3", [b(...p), b(...q), b(...r)])).toEqual(
      ALPHA.map((x) => r[q[p[x] as number] as number]),
    );
  });

  test("rotor-notch-flags marks the rows whose window position is a notch", async () => {
    const flags = await bytesOf("util:rotor-notch-flags", [b(16, 25), int(3)]);
    expect(flags).toHaveLength(676);
    for (let i = 0; i < 676; i++) {
      const expected = i % 26 === 0 && [16, 25].includes((i / 26 + 3) % 26) ? 1 : 0;
      expect(flags[i]).toBe(expected);
    }
    expect((await bytesOf("util:rotor-notch-flags", [b(), int(0)])).every((v) => v === 0)).toBe(
      true,
    );
  });

  test("rotor-reflect-table composes rotor, fixed permutation and rotor back", async () => {
    const w = ALPHA.map((x) => (x * 5 + 3) % 26);
    const winv = await bytesOf("util:perm-invert", [b(...w)]);
    const r = ALPHA.map((x) => x ^ 1).map((x) => (x > 25 ? 25 : x));
    const fl = await bytesOf("util:rotor-shift-table", [b(...w)]);
    const il = await bytesOf("util:rotor-shift-table", [b(...winv)]);
    const t = await bytesOf("util:rotor-reflect-table", [b(...r), b(...fl), b(...il)]);
    for (const [s, x] of [
      [0, 0],
      [4, 9],
      [25, 25],
    ] as const) {
      const row = s * 26;
      const mid = r[fl[row + x] as number] as number;
      expect(t[row + x]).toBe(il[row + mid]);
    }
  });

  test("letter-settings: letters, spaced letters, numbers, errors", async () => {
    const call = (s: string, n: number) =>
      runtime.call("util:letter-settings", [str(s), int(n), str("rings")]);
    expect(await bytesOf("util:letter-settings", [str("BUL"), int(3), str("rings")])).toEqual([
      1, 20, 11,
    ]);
    expect(await bytesOf("util:letter-settings", [str("b u,l"), int(3), str("rings")])).toEqual([
      1, 20, 11,
    ]);
    expect(await bytesOf("util:letter-settings", [str("2 21 12"), int(3), str("rings")])).toEqual([
      1, 20, 11,
    ]);
    expect(await bytesOf("util:letter-settings", [str("26,1"), int(2), str("rings")])).toEqual([
      25, 0,
    ]);
    for (const [s, n] of [
      ["", 3],
      ["AB", 3],
      ["0 1 2", 3],
      ["1 27 3", 3],
      ["A1B", 3],
      ["-1 2 3", 3],
    ] as const) {
      const r = await call(s, n);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("E_RANGE");
    }
  });

  test("plugboard-table swaps pairs and rejects bad pairs", async () => {
    const t = await bytesOf("util:plugboard-table", [str("ab, CD")]);
    expect(t.slice(0, 5)).toEqual([1, 0, 3, 2, 4]);
    expect(t.slice(5)).toEqual(ALPHA.slice(5));
    expect(await bytesOf("util:plugboard-table", [str("")])).toEqual(ALPHA);
    for (const bad of ["AB BC", "AA", "A", "ABC", "A1"]) {
      const r = await runtime.call("util:plugboard-table", [str(bad)]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("E_RANGE");
    }
  });
});

describe("util:cycle-bytes", () => {
  const cyc = (pat: number[], start: number, n: number) =>
    value("util:cycle-bytes", [valueHelpers.bytes(Uint8Array.from(pat)), int(start), int(n)]);

  test("repeats the pattern from the start cell", async () => {
    expect(await cyc([1, 2, 3], 0, 7)).toEqual(Uint8Array.of(1, 2, 3, 1, 2, 3, 1));
    expect(await cyc([1, 2, 3], 2, 5)).toEqual(Uint8Array.of(3, 1, 2, 3, 1));
    expect(await cyc([9], 0, 4)).toEqual(Uint8Array.of(9, 9, 9, 9));
    expect(await cyc([1, 2, 3], 1, 0)).toEqual(new Uint8Array(0));
  });

  test("a long run is linear and exact", async () => {
    const out = (await cyc([0, 1, 1, 0, 1], 3, 65536)) as Uint8Array;
    expect(out.length).toBe(65536);
    const pat = [0, 1, 1, 0, 1];
    for (const i of [0, 1, 4, 5, 999, 65535]) expect(out[i]).toBe(pat[(3 + i) % 5]);
  });
});

describe("the ITA2 words", () => {
  const alphabet = "/E4A9SIU3DRJNFCKTZLWHYPQOBG5MXV8";
  const from = (s: string) => runtime.call("util:from-bp", [str(s)]);

  test("ita2-alphabet has 32 different characters, code order", async () => {
    expect(await value("util:ita2-alphabet", [])).toBe(alphabet);
    expect(new Set(alphabet).size).toBe(32);
  });

  test("ita2-table maps every character of the alphabet to its code, either case", async () => {
    const table = (await value("util:ita2-table", [])) as Uint8Array;
    expect(table.length).toBe(256);
    for (let c = 0; c < 32; c++) {
      const ch = alphabet.charCodeAt(c);
      expect(table[ch]).toBe(c);
      expect(table[String.fromCharCode(ch).toLowerCase().charCodeAt(0)]).toBe(c);
    }
    expect(table[43]).toBe(27);
    expect(table[45]).toBe(31);
    for (const w of [9, 10, 11, 12, 13, 32]) expect(table[w]).toBe(254);
    expect(table[49]).toBe(255);
    expect(table[200]).toBe(255);
  });

  test("ita2-code and ita2-entry agree with the table", async () => {
    const base = (await value("util:decode-table", [
      str(alphabet),
      int(254),
      int(255),
    ])) as Uint8Array;
    const b = valueHelpers.bytes(base);
    expect(await value("util:ita2-code", [int(43), b])).toBe(27);
    expect(await value("util:ita2-code", [int(69), b])).toBe(1);
    expect(await value("util:ita2-entry", [int(101), b])).toBe(1);
    expect(await value("util:ita2-entry", [int(45), b])).toBe(31);
    const t2 = (await value("util:ita2-table2", [b])) as Uint8Array;
    expect(t2).toEqual(await value("util:ita2-table", []));
  });

  test("from-bp reads either case, ignores white space and refuses other characters", async () => {
    expect(await value("util:from-bp", [str("e a\n+ 9 -/")])).toEqual(
      Uint8Array.of(1, 3, 27, 4, 31, 0),
    );
    expect(await value("util:from-bp", [str("")])).toEqual(new Uint8Array(0));
    for (const bad of ["1", "A=", "é"]) {
      const r = await from(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("E_COERCE");
    }
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

// The keyed squares and the upper-case merge promoted from the classical-cipher vocabularies.
function asciiBytes(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

function asText(v: unknown): string {
  return Array.from(v as Uint8Array, (c) => String.fromCharCode(c)).join("");
}

describe("util:keyed-alphabet", () => {
  test("the ZEBRAS square: keyword letters without repeats, then the rest of the alphabet", async () => {
    const v = await value("util:keyed-alphabet", [
      valueHelpers.bytes(asciiBytes("ZEBRAS")),
      valueHelpers.bytes(asciiBytes("ABCDEFGHIKLMNOPQRSTUVWXYZ")),
    ]);
    expect(asText(v)).toBe("ZEBRASCDFGHIKLMNOPQTUVWXY");
  });

  test("bytes of the key that are not in the alphabet, and repeats, are dropped", async () => {
    const v = await value("util:keyed-alphabet", [
      valueHelpers.bytes(asciiBytes("AAB?")),
      valueHelpers.bytes(asciiBytes("ABC")),
    ]);
    expect(asText(v)).toBe("ABC");
  });

  test("an empty key gives the alphabet itself", async () => {
    const v = await value("util:keyed-alphabet", [
      valueHelpers.bytes(new Uint8Array(0)),
      valueHelpers.bytes(asciiBytes("XYZ")),
    ]);
    expect(asText(v)).toBe("XYZ");
  });
});

describe("util:square-positions", () => {
  test("the position of each grid byte, 255 for the others", async () => {
    const table = (await value("util:square-positions", [
      valueHelpers.bytes(asciiBytes("ZEBRASCDFGHIKLMNOPQTUVWXY")),
    ])) as Uint8Array;
    expect(table.length).toBe(256);
    expect(table[90]).toBe(0); // Z
    expect(table[83]).toBe(5); // S
    expect(table[88]).toBe(23); // X
    expect(table[74]).toBe(255); // J is not in this square
    expect(table[48]).toBe(255); // a digit
  });
});

describe("util:upper-merge-i", () => {
  test("a lower-case letter becomes upper case, and J becomes I", async () => {
    for (let c = 97; c <= 122; c++) {
      const up = c - 32;
      const expected = up === 74 ? 73 : up;
      expect(await value("util:upper-merge-i", [int(c)])).toBe(expected);
    }
    expect(await value("util:upper-merge-i", [int(74)])).toBe(73);
    expect(await value("util:upper-merge-i", [int(73)])).toBe(73);
  });
});
