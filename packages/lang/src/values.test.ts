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
import { describe, expect, test } from "vitest";
import { ForgeError, REDACTED } from "./errors.js";
import type { Constraint, ErrorCode, Limits, ParamType, StackSlot, Value } from "./types.js";
import { DEFAULT_LIMITS } from "./types.js";
import {
  bool,
  bytes,
  codePoints,
  coerce,
  coerceTracked,
  constraintText,
  cpAt,
  cpCompare,
  cpLength,
  cpOffset,
  cpSlice,
  display,
  equals,
  hasLoneSurrogate,
  int,
  intBitLength,
  isSecret,
  list,
  markSecret,
  normaliseInt,
  num,
  optionsText,
  quoteString,
  record,
  repr,
  reprShort,
  runtimeTypeOf,
  sizeOf,
  str,
  validate,
  valueHelpers,
} from "./values.js";

const B = (...b: number[]): Value => bytes(new Uint8Array(b));
const quotValue = (): Value => ({
  tag: "quot",
  v: { code: {} as never, start: 0, env: [] },
});
const fileValue = (name = "a.txt", type = "text/plain", ...b: number[]): Value => ({
  tag: "file",
  v: { name, type, bytes: new Uint8Array(b) },
});

function catchErr(fn: () => unknown): ForgeError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ForgeError);
    return e as ForgeError;
  }
  throw new Error("expected a ForgeError, nothing was thrown");
}

function expectCode(fn: () => unknown, code: ErrorCode, detail?: Record<string, unknown>): void {
  const e = catchErr(fn);
  expect(e.code).toBe(code);
  if (detail) expect(e.detail).toMatchObject(detail);
}

const SURR = "\ud83d"; // lone high surrogate
const GRIN = "\u{1F600}";

describe("code-point helpers", () => {
  test("cpLength counts code points", () => {
    expect(cpLength("")).toBe(0);
    expect(cpLength("abc")).toBe(3);
    expect(cpLength(GRIN)).toBe(1);
    expect(cpLength(`a${GRIN}b`)).toBe(3);
    expect(cpLength(SURR)).toBe(1);
    expect(cpLength("\ude00")).toBe(1);
    expect(cpLength(`${SURR}a`)).toBe(2);
    expect(cpLength(SURR + GRIN)).toBe(2);
  });

  test("codePoints", () => {
    expect(codePoints(`a${GRIN}é`)).toEqual([0x61, 0x1f600, 0xe9]);
    expect(codePoints("")).toEqual([]);
    expect(codePoints(SURR)).toEqual([0xd83d]);
  });

  test("cpCompare orders by code point, not by UTF-16 unit", () => {
    expect(cpCompare("a", "b")).toBe(-1);
    expect(cpCompare("b", "a")).toBe(1);
    expect(cpCompare("abc", "abc")).toBe(0);
    expect(cpCompare("ab", "abc")).toBe(-1);
    expect(cpCompare("abc", "ab")).toBe(1);
    expect(cpCompare("", "")).toBe(0);
    expect(cpCompare("", "a")).toBe(-1);
    // U+FF5E (BMP) < U+1F600 (astral), though the astral high surrogate 0xD83D < 0xFF5E
    expect(cpCompare("～", GRIN)).toBe(-1);
    expect(cpCompare(GRIN, "～")).toBe(1);
    expect("～" < GRIN).toBe(false); // JS order differs, which is the point
    expect(cpCompare(GRIN, "\u{1F601}")).toBe(-1);
    expect(cpCompare(`${GRIN}a`, GRIN)).toBe(1);
    expect(cpCompare(SURR, "")).toBe(-1);
  });

  test("cpOffset, cpAt and cpSlice index by code point", () => {
    const s = `a${GRIN}b`;
    expect(cpOffset(s, 0)).toBe(0);
    expect(cpOffset(s, 1)).toBe(1);
    expect(cpOffset(s, 2)).toBe(3);
    expect(cpOffset(s, 3)).toBe(4);
    expect(cpOffset(s, 4)).toBe(-1);
    expect(cpOffset(s, -1)).toBe(-1);
    expect(cpOffset(s, 1.5)).toBe(-1);
    expect(cpAt(s, 1)).toBe(0x1f600);
    expect(cpAt(s, 2)).toBe(0x62);
    expect(cpAt(s, 3)).toBeUndefined();
    expect(cpAt(s, -1)).toBeUndefined();
    expect(cpSlice(s, 1, 2)).toBe(GRIN);
    expect(cpSlice(s, 1)).toBe(`${GRIN}b`);
    expect(cpSlice(s, 0, 99)).toBe(s);
    expect(cpSlice(s, 99)).toBe("");
    expect(cpSlice(s, -5, 1)).toBe("a");
    expect(cpSlice(s, 2, 1)).toBe("");
  });

  test("hasLoneSurrogate", () => {
    expect(hasLoneSurrogate("")).toBe(false);
    expect(hasLoneSurrogate(`a${GRIN}`)).toBe(false);
    expect(hasLoneSurrogate(SURR)).toBe(true);
    expect(hasLoneSurrogate(`${SURR}a`)).toBe(true);
    expect(hasLoneSurrogate("\ude00")).toBe(true);
    expect(hasLoneSurrogate("\ude00" + GRIN)).toBe(true);
    expect(hasLoneSurrogate(GRIN + SURR)).toBe(true);
  });
});

describe("integer normal form", () => {
  const MAX = Number.MAX_SAFE_INTEGER; // 2^53 - 1

  test("safe integers stay numbers", () => {
    expect(normaliseInt(0)).toBe(0);
    expect(normaliseInt(42)).toBe(42);
    expect(normaliseInt(MAX)).toBe(MAX);
    expect(normaliseInt(-MAX)).toBe(-MAX);
  });

  test("numbers beyond the safe range become bigint", () => {
    expect(normaliseInt(2 ** 53)).toBe(9007199254740992n);
    expect(normaliseInt(-(2 ** 53))).toBe(-9007199254740992n);
    expect(normaliseInt(1e300)).toBe(BigInt(1e300));
  });

  test("bigints inside the safe range become numbers", () => {
    expect(normaliseInt(0n)).toBe(0);
    expect(normaliseInt(BigInt(MAX))).toBe(MAX);
    expect(normaliseInt(-BigInt(MAX))).toBe(-MAX);
    expect(normaliseInt(BigInt(MAX) + 1n)).toBe(9007199254740992n);
    expect(normaliseInt(-BigInt(MAX) - 1n)).toBe(-9007199254740992n);
  });

  test("negative zero becomes zero", () => {
    expect(Object.is(normaliseInt(-0), 0)).toBe(true);
    expect(Object.is((int(-0) as { v: number }).v, 0)).toBe(true);
  });

  test("non-integers are an internal error", () => {
    expectCode(() => normaliseInt(1.5), "E_INTERNAL");
    expectCode(() => normaliseInt(Number.NaN), "E_INTERNAL");
    expectCode(() => normaliseInt(Number.POSITIVE_INFINITY), "E_INTERNAL");
  });

  test("intBitLength", () => {
    expect(intBitLength(0)).toBe(0);
    expect(intBitLength(1)).toBe(1);
    expect(intBitLength(255)).toBe(8);
    expect(intBitLength(256)).toBe(9);
    expect(intBitLength(-256)).toBe(9);
    expect(intBitLength(MAX)).toBe(53);
    expect(intBitLength(2n ** 64n)).toBe(65);
    expect(intBitLength(2n ** 64n - 1n)).toBe(64);
    expect(intBitLength(-(2n ** 65_535n))).toBe(65_536);
  });

  test("maxIntBits is enforced as E_LIMIT_VALUE", () => {
    expect(normaliseInt(2n ** 64n - 1n, 64)).toBe(2n ** 64n - 1n);
    expectCode(() => normaliseInt(2n ** 64n, 64), "E_LIMIT_VALUE", { limit: 64, value: 65 });
    expectCode(() => normaliseInt(-(2n ** 64n), 64), "E_LIMIT_VALUE", { limit: 64, value: 65 });
    expect(normaliseInt(3, 2)).toBe(3);
    expectCode(() => normaliseInt(4, 2), "E_LIMIT_VALUE", { limit: 2, value: 3 });
    expect(normaliseInt(0, 0)).toBe(0);
    expectCode(() => normaliseInt(1, 0), "E_LIMIT_VALUE");
    expect(normaliseInt(2n ** 65_535n, DEFAULT_LIMITS.maxIntBits)).toBe(2n ** 65_535n);
    expectCode(() => int(2n ** 65_536n, DEFAULT_LIMITS.maxIntBits), "E_LIMIT_VALUE");
  });

  test("the int constructor normalises", () => {
    expect(int(5)).toEqual({ tag: "int", v: 5 });
    expect(int(5n)).toEqual({ tag: "int", v: 5 });
    expect(int(2 ** 60)).toEqual({ tag: "int", v: 2n ** 60n });
  });
});

describe("constructors", () => {
  test("build tagged values", () => {
    expect(num(1.5)).toEqual({ tag: "num", v: 1.5 });
    expect(num(-0)).toEqual({ tag: "num", v: -0 });
    expect(str("x")).toEqual({ tag: "str", v: "x" });
    expect(str("")).toEqual({ tag: "str", v: "" });
    expect(bool(false)).toEqual({ tag: "bool", v: false });
    const b = new Uint8Array([1]);
    expect(bytes(b).v).toBe(b);
    expect(list([int(1)])).toEqual({ tag: "list", v: [{ tag: "int", v: 1 }] });
  });

  test("record keeps insertion order and later duplicates win", () => {
    const r = record([
      ["b", int(1)],
      ["a", int(2)],
      ["b", int(3)],
    ]);
    expect([...(r.v as ReadonlyMap<string, Value>).entries()]).toEqual([
      ["b", int(3)],
      ["a", int(2)],
    ]);
    expect(record([]).v).toBeInstanceOf(Map);
  });

  test("num rejects non-finite values with E_RANGE", () => {
    expectCode(() => num(Number.NaN), "E_RANGE");
    expectCode(() => num(Number.POSITIVE_INFINITY), "E_RANGE");
    expectCode(() => num(Number.NEGATIVE_INFINITY), "E_RANGE");
  });

  test("markSecret marks bytes only", () => {
    const m = markSecret(B(1));
    expect(isSecret(m)).toBe(true);
    expect(isSecret(B(1))).toBe(false);
    expect(markSecret(int(1))).toEqual(int(1));
    expect(isSecret(int(1))).toBe(false);
  });

  test("valueHelpers bundles the helpers", () => {
    expect(valueHelpers.int).toBe(int);
    expect(valueHelpers.coerce).toBe(coerce);
    expect(valueHelpers.validate).toBe(validate);
    expect(valueHelpers.sizeOf).toBe(sizeOf);
    expect(valueHelpers.equals).toBe(equals);
    expect(valueHelpers.repr).toBe(repr);
    expect(valueHelpers.display).toBe(display);
    expect(valueHelpers.normaliseInt).toBe(normaliseInt);
  });
});

describe("equality", () => {
  test("int against int, including bigint", () => {
    expect(equals(int(1), int(1))).toBe(true);
    expect(equals(int(1), int(2))).toBe(false);
    expect(equals(int(2n ** 80n), int(2n ** 80n))).toBe(true);
    expect(equals(int(2n ** 80n), int(2n ** 80n + 1n))).toBe(false);
    expect(equals(int(2n ** 80n), int(5))).toBe(false);
  });

  test("int against num is numeric, in both directions", () => {
    expect(equals(int(1), num(1))).toBe(true);
    expect(equals(num(1), int(1))).toBe(true);
    expect(equals(int(1), num(1.5))).toBe(false);
    expect(equals(num(1.5), int(1))).toBe(false);
    expect(equals(int(0), num(-0))).toBe(true);
    expect(equals(num(-0), num(0))).toBe(true);
  });

  test("bigint against num compares exact values", () => {
    expect(equals(int(2n ** 60n), num(2 ** 60))).toBe(true);
    expect(equals(num(2 ** 60), int(2n ** 60n))).toBe(true);
    expect(equals(int(2n ** 60n + 1n), num(2 ** 60))).toBe(false);
    expect(equals(int(2n ** 60n), num(2 ** 60 + 2 ** 10))).toBe(false);
    expect(equals(int(2n ** 60n), num(0.5))).toBe(false);
    expect(equals(int(2n ** 53n), num(2 ** 53))).toBe(true);
    expect(equals(int(2n ** 1100n), num(1e300))).toBe(false);
  });

  test("scalars", () => {
    expect(equals(num(0.1 + 0.2), num(0.30000000000000004))).toBe(true);
    expect(equals(num(1.5), num(2.5))).toBe(false);
    expect(equals(bool(true), bool(true))).toBe(true);
    expect(equals(bool(true), bool(false))).toBe(false);
  });

  test("strings compare by code units and never coerce", () => {
    expect(equals(str("a"), str("a"))).toBe(true);
    expect(equals(str("a"), str("b"))).toBe(false);
    expect(equals(str(GRIN), str("😀"))).toBe(true);
    expect(equals(str("a"), B(0x61))).toBe(false);
    expect(equals(str("1"), int(1))).toBe(false);
    expect(equals(bool(true), int(1))).toBe(false);
    expect(equals(list([]), bytes(new Uint8Array(0)))).toBe(false);
  });

  test("bytes", () => {
    expect(equals(B(1, 2), B(1, 2))).toBe(true);
    expect(equals(B(1, 2), B(1, 3))).toBe(false);
    expect(equals(B(1, 2), B(1))).toBe(false);
    expect(equals(B(), B())).toBe(true);
  });

  test("the secret mark is not part of identity", () => {
    expect(equals(markSecret(B(1)), B(1))).toBe(true);
  });

  test("lists are elementwise, with int/num equality inside", () => {
    expect(equals(list([int(1), int(2)]), list([int(1), int(2)]))).toBe(true);
    expect(equals(list([int(1), int(2)]), list([int(1), num(2)]))).toBe(true);
    expect(equals(list([int(1), int(2)]), list([int(1)]))).toBe(false);
    expect(equals(list([int(1), int(2)]), list([int(2), int(1)]))).toBe(false);
    expect(equals(list([]), list([]))).toBe(true);
    expect(equals(list([list([str("a")])]), list([list([str("a")])]))).toBe(true);
    expect(equals(list([list([str("a")])]), list([list([str("b")])]))).toBe(false);
  });

  test("records ignore insertion order", () => {
    const a = record([
      ["a", int(1)],
      ["b", int(2)],
    ]);
    const b = record([
      ["b", int(2)],
      ["a", int(1)],
    ]);
    expect(equals(a, b)).toBe(true);
    expect(equals(a, record([["a", int(1)]]))).toBe(false);
    expect(
      equals(
        a,
        record([
          ["a", int(1)],
          ["b", int(3)],
        ]),
      ),
    ).toBe(false);
    expect(
      equals(
        a,
        record([
          ["a", int(1)],
          ["c", int(2)],
        ]),
      ),
    ).toBe(false);
    expect(equals(record([]), record([]))).toBe(true);
  });

  test("quotations compare by identity", () => {
    const q = quotValue();
    expect(equals(q, q)).toBe(true);
    expect(equals(q, { tag: "quot", v: (q as unknown as { v: never }).v })).toBe(true);
    expect(equals(q, quotValue())).toBe(false);
  });

  test("files compare name, type and bytes", () => {
    expect(equals(fileValue("a", "t", 1), fileValue("a", "t", 1))).toBe(true);
    expect(equals(fileValue("a", "t", 1), fileValue("b", "t", 1))).toBe(false);
    expect(equals(fileValue("a", "t", 1), fileValue("a", "u", 1))).toBe(false);
    expect(equals(fileValue("a", "t", 1), fileValue("a", "t", 2))).toBe(false);
  });

  test("very deep nesting does not overflow the stack", () => {
    const build = (): Value => {
      let v: Value = int(1);
      for (let i = 0; i < 200_000; i++) v = list([v]);
      return v;
    };
    expect(equals(build(), build())).toBe(true);
  });
});

describe("printing: repr and display", () => {
  test("ints", () => {
    expect(repr(int(42))).toBe("42");
    expect(repr(int(-7))).toBe("-7");
    expect(repr(int(0))).toBe("0");
    expect(repr(int(2n ** 70n))).toBe("1180591620717411303424");
    expect(repr(int(-(2n ** 70n)))).toBe("-1180591620717411303424");
    expect(display(int(187))).toBe("187"); // C07
  });

  test("floats print with .0 when integral (C05)", () => {
    expect(display(num(1.5 * 2))).toBe("3.0");
    expect(display(num(1e3))).toBe("1000.0");
    expect(display(num(0.1 + 0.2))).toBe("0.30000000000000004");
    expect(repr(num(-3))).toBe("-3.0");
    expect(repr(num(0))).toBe("0.0");
    expect(repr(num(-0))).toBe("-0.0");
    expect(repr(num(1.5))).toBe("1.5");
    expect(repr(num(-2.25))).toBe("-2.25");
    expect(repr(num(1e21))).toBe("1e+21");
    expect(repr(num(1.5e-7))).toBe("1.5e-7");
    expect(repr(num(1e-7))).toBe("1e-7");
    expect(repr(num(123456789012345680000))).toBe("123456789012345680000.0");
  });

  test("bools", () => {
    expect(repr(bool(true))).toBe("true");
    expect(display(bool(false))).toBe("false");
  });

  test("display prints a str raw, repr quotes it (C06)", () => {
    expect(display(str('AB\\"'))).toBe('AB\\"');
    expect(repr(str("abc"))).toBe('"abc"');
    expect(display(str(""))).toBe("");
    expect(repr(str(""))).toBe('""');
  });

  test("str escapes", () => {
    expect(repr(str('a\\b"c'))).toBe('"a\\\\b\\"c"');
    expect(repr(str("\n\r\t\0"))).toBe('"\\n\\r\\t\\0"');
    expect(repr(str("\x01\x1f\x7f\x08"))).toBe('"\\x01\\x1f\\x7f\\x08"');
    expect(repr(str("héllo " + GRIN))).toBe(`"héllo ${GRIN}"`);
    expect(repr(str("\x80 "))).toBe('"\x80 "');
    expect(repr(str(SURR))).toBe(`"${SURR}"`);
    expect(quoteString("x\ny")).toBe('"x\\ny"');
  });

  test("bytes print lowercase hex (C08)", () => {
    expect(display(B(0xde, 0xad, 0x00))).toBe("#[ de ad 00 ]");
    expect(repr(B(0xde, 0xad, 0xbe, 0xef))).toBe("#[ de ad be ef ]");
    expect(display(B())).toBe("#[ ]");
    expect(repr(B(0xff, 0x41))).toBe("#[ ff 41 ]"); // C68
  });

  test("lists (C31)", () => {
    expect(display(list([int(3), int(10)]))).toBe("{ 3 10 }");
    expect(display(list([]))).toBe("{ }");
    expect(display(list([list([int(1)]), str("a")]))).toBe('{ { 1 } "a" }');
    expect(display(list([str("a"), str("b"), str("c")]))).toBe('{ "a" "b" "c" }'); // C42
    expect(repr(list([list([]), list([list([])])]))).toBe("{ { } { { } } }");
    expect(repr(list([num(1), bool(true), B(1)]))).toBe("{ 1.0 true #[ 01 ] }");
  });

  test("records", () => {
    const r = record([
      ["a", int(1)],
      ["b", int(2)],
    ]);
    expect(display(r)).toBe('record{ "a": 1 "b": 2 }');
    expect(repr(record([]))).toBe("record{ }");
    expect(repr(record([["k\n", list([str("x")])]]))).toBe('record{ "k\\n": { "x" } }');
    expect(repr(record([["r", record([])]]))).toBe('record{ "r": record{ } }');
    expect(repr(list([record([["a", int(1)]]), record([])]))).toBe(
      '{ record{ "a": 1 } record{ } }',
    );
  });

  test("quotations and files", () => {
    expect(repr(quotValue())).toBe("<quot>");
    expect(display(quotValue())).toBe("<quot>");
    expect(repr(fileValue("a.txt", "text/plain", 1, 2, 3))).toBe(
      '<file "a.txt" "text/plain" 3 bytes>',
    );
    expect(repr(fileValue('q"', "t"))).toBe('<file "q\\"" "t" 0 bytes>');
  });

  test("secret bytes print <redacted>, also nested", () => {
    expect(display(markSecret(B(1, 2)))).toBe("<redacted>");
    expect(repr(markSecret(B(1, 2)))).toBe(REDACTED);
    expect(repr(list([int(1), markSecret(B(1))]))).toBe("{ 1 <redacted> }");
    expect(repr(record([["k", markSecret(B(1))]]))).toBe('record{ "k": <redacted> }');
  });

  test("deeply nested values print without overflowing the stack", () => {
    let v: Value = int(1);
    for (let i = 0; i < 100_000; i++) v = list([v]);
    const s = repr(v);
    expect(s.length).toBe(100_000 * 4 + 1);
  });
});

describe("reprShort (the .s cut)", () => {
  test("up to 80 code points is untouched", () => {
    const s80 = "x".repeat(78); // 78 + 2 quotes = 80
    expect(reprShort(str(s80))).toBe(`"${s80}"`);
    expect(cpLength(reprShort(str(s80)))).toBe(80);
  });

  test("81 code points are cut to 77 plus ...", () => {
    const out = reprShort(str("x".repeat(79))); // 81 with quotes
    expect(out).toBe(`"${"x".repeat(76)}...`);
    expect(cpLength(out)).toBe(80);
  });

  test("counts code points, not code units", () => {
    const out = reprShort(str(GRIN.repeat(100)));
    expect(cpLength(out)).toBe(80);
    expect(out.endsWith("...")).toBe(true);
    expect(out).toBe(`"${GRIN.repeat(76)}...`);
    expect(reprShort(str(GRIN.repeat(78)))).toBe(`"${GRIN.repeat(78)}"`);
  });

  test("a custom limit", () => {
    expect(reprShort(str("abcdefghij"), 8)).toBe('"abcd...');
    expect(reprShort(int(12345), 8)).toBe("12345");
  });

  test("huge values are summarised cheaply", () => {
    const big = list(Array.from({ length: 1_000_000 }, (_, i) => int(i)));
    const out = reprShort(big);
    expect(cpLength(out)).toBe(80);
    expect(out.startsWith("{ 0 1 2 3")).toBe(true);
    expect(out.endsWith("...")).toBe(true);
    expect(cpLength(reprShort(str("y".repeat(10_000_000))))).toBe(80);
    expect(reprShort(bytes(new Uint8Array(5_000_000)))).toMatch(/^#\[ 00 00 .*\.\.\.$/);
    const bigRecord = record(Array.from({ length: 1000 }, (_, i) => [`key${i}`, int(i)] as const));
    expect(reprShort(bigRecord).startsWith('record{ "key0": 0 "key1": 1')).toBe(true);
    expect(cpLength(reprShort(record([["k".repeat(1000), int(1)]])))).toBe(80);
  });

  test("redacts secrets", () => {
    expect(reprShort(markSecret(B(1)))).toBe("<redacted>");
  });
});

describe("coercion table (spec 4.2)", () => {
  const samples: Record<string, Value> = {
    bytes: B(0x68, 0x69),
    str: str("hi"),
    int: int(7),
    num: num(7.5),
    bool: bool(true),
    list: list([int(1)]),
    quot: quotValue(),
    record: record([["a", int(1)]]),
    file: fileValue(),
  };
  const declared: ParamType[] = [
    "bytes",
    "str",
    "int",
    "num",
    "bool",
    "list",
    "quot",
    "record",
    "file",
    "number",
    "any",
  ];
  // "ok": unchanged, "co": coerced (these samples succeed), "-": E_TYPE
  const table: Record<string, Record<string, "ok" | "co" | "-">> = {
    bytes: { bytes: "ok", str: "co", any: "ok" },
    str: { bytes: "co", str: "ok", any: "ok" },
    int: { int: "ok", num: "co", number: "ok", any: "ok" },
    num: { num: "ok", number: "ok", any: "ok" },
    bool: { bool: "ok", any: "ok" },
    list: { list: "ok", any: "ok" },
    quot: { quot: "ok", any: "ok" },
    record: { record: "ok", any: "ok" },
    file: { file: "ok", any: "ok" },
  };
  // num 7.5 is not integral, so num -> int is a COERCE failure: "xc"
  const cases: [string, ParamType, "ok" | "co" | "-" | "xc"][] = [];
  for (const [tag, row] of Object.entries(table)) {
    for (const d of declared) {
      let expected: "ok" | "co" | "-" | "xc" = row[d] ?? "-";
      if (tag === "num" && d === "int") expected = "xc";
      cases.push([tag, d, expected]);
    }
  }

  test.each(cases)("%s -> %s : %s", (tag, to, expected) => {
    const v = samples[tag] as Value;
    if (expected === "-") {
      expectCode(() => coerce(v, to), "E_TYPE", { expected: to, actual: tag });
    } else if (expected === "xc") {
      expectCode(() => coerce(v, to), "E_COERCE", { from: tag, to });
    } else if (expected === "ok") {
      const r = coerceTracked(v, to);
      expect(r.value).toBe(v);
      expect(r.coercion).toBeNull();
    } else {
      const r = coerceTracked(v, to);
      expect(r.value.tag).toBe(to);
      expect(r.coercion).toEqual({ from: tag, to });
    }
  });

  test("the table has all 99 cells", () => {
    expect(cases).toHaveLength(99);
  });

  test("refinement types coerce by their runtime type", () => {
    expect(runtimeTypeOf("choice")).toBe("str");
    expect(runtimeTypeOf("regex")).toBe("str");
    expect(runtimeTypeOf("charset")).toBe("str");
    expect(runtimeTypeOf("toggle")).toBe("bytes");
    expect(runtimeTypeOf("key")).toBe("bytes");
    expect(runtimeTypeOf("int")).toBe("int");
    expect(runtimeTypeOf("number")).toBe("number");
    expect(runtimeTypeOf("any")).toBe("any");
    expect(coerce(str("é"), "key")).toEqual(B(0xc3, 0xa9));
    expect(coerce(str("é"), "toggle")).toEqual(B(0xc3, 0xa9));
    expect(coerce(B(0x61), "choice")).toEqual(str("a"));
    expect(coerce(B(0x61), "regex")).toEqual(str("a"));
    expect(coerce(B(0x61), "charset")).toEqual(str("a"));
    expect(coerce(str("a"), "choice")).toEqual(str("a"));
    expectCode(() => coerce(int(1), "choice"), "E_TYPE", { expected: "choice", actual: "int" });
    expectCode(() => coerce(int(1), "key"), "E_TYPE");
  });

  describe("str -> bytes", () => {
    test("encodes UTF-8", () => {
      expect(coerce(str("héllo"), "bytes")).toEqual(B(0x68, 0xc3, 0xa9, 0x6c, 0x6c, 0x6f)); // C42
      expect(coerce(str(""), "bytes")).toEqual(B());
      expect(coerce(str(GRIN), "bytes")).toEqual(B(0xf0, 0x9f, 0x98, 0x80));
      expect(coerce(str("\u0000"), "bytes")).toEqual(B(0));
      expect(coerce(str("﻿"), "bytes")).toEqual(B(0xef, 0xbb, 0xbf));
    });
    test("a lone surrogate is E_COERCE, never U+FFFD", () => {
      expectCode(() => coerce(str(SURR), "bytes"), "E_COERCE", { from: "str", to: "bytes" });
      expectCode(() => coerce(str("a\ude00b"), "bytes"), "E_COERCE");
      expectCode(() => coerce(str(GRIN + SURR), "bytes"), "E_COERCE");
    });
  });

  describe("bytes -> str", () => {
    test("decodes UTF-8 and keeps the BOM", () => {
      expect(coerce(B(0x61, 0x62), "str")).toEqual(str("ab"));
      expect(coerce(B(0xc3, 0xa9), "str")).toEqual(str("é"));
      expect(coerce(B(), "str")).toEqual(str(""));
      expect(coerce(B(0xef, 0xbb, 0xbf, 0x61), "str")).toEqual(str("﻿a"));
      expect(coerce(B(0xf0, 0x9f, 0x98, 0x80), "str")).toEqual(str(GRIN));
    });
    test.each([
      ["a lone continuation byte", [0xff]], // C45
      ["0x80", [0x80]],
      ["truncated sequence", [0xc3]],
      ["truncated 4-byte sequence", [0xf0, 0x9f, 0x98]],
      ["overlong NUL", [0xc0, 0x80]],
      ["overlong slash", [0xe0, 0x80, 0xaf]],
      ["encoded surrogate", [0xed, 0xa0, 0x80]],
      ["above U+10FFFF", [0xf4, 0x90, 0x80, 0x80]],
      ["bad continuation", [0xc3, 0x28]],
    ])("rejects %s", (_name, b) => {
      expectCode(() => coerce(B(...b), "str"), "E_COERCE", { from: "bytes", to: "str" });
    });
  });

  describe("int -> num", () => {
    test("is exact for safe ints", () => {
      expect(coerce(int(3), "num")).toEqual(num(3));
      expect(coerce(int(-3), "num")).toEqual(num(-3));
      expect(coerce(int(Number.MAX_SAFE_INTEGER), "num")).toEqual(num(Number.MAX_SAFE_INTEGER));
      expect(coerce(int(0), "num")).toEqual(num(0));
    });
    test("a bigint int is E_COERCE", () => {
      expectCode(() => coerce(int(2n ** 53n), "num"), "E_COERCE", { from: "int", to: "num" });
      expectCode(() => coerce(int(-(2n ** 70n)), "num"), "E_COERCE");
    });
  });

  describe("num -> int", () => {
    test("is exact for integral numbers", () => {
      expect(coerce(num(3), "int")).toEqual(int(3));
      expect(coerce(num(-4), "int")).toEqual(int(-4));
      expect(coerce(num(1e3), "int")).toEqual(int(1000));
      const z = coerce(num(-0), "int") as { v: number };
      expect(Object.is(z.v, 0)).toBe(true);
    });
    test("beyond the safe range gives a bigint int", () => {
      expect(coerce(num(2 ** 53), "int")).toEqual({ tag: "int", v: 9007199254740992n });
      expect(coerce(num(1e20), "int")).toEqual({ tag: "int", v: 100000000000000000000n });
      expect(coerce(num(-(2 ** 60)), "int")).toEqual({ tag: "int", v: -(2n ** 60n) });
    });
    test("a fractional number is E_COERCE", () => {
      expectCode(() => coerce(num(1.5), "int"), "E_COERCE", { from: "num", to: "int" }); // C65
      expectCode(() => coerce(num(-0.5), "int"), "E_COERCE");
    });
  });

  test("not coercions: str<->int, int->str, bool<->anything, list<->bytes", () => {
    expectCode(() => coerce(str("1"), "int"), "E_TYPE");
    expectCode(() => coerce(int(1), "str"), "E_TYPE");
    expectCode(() => coerce(bool(true), "int"), "E_TYPE");
    expectCode(() => coerce(int(1), "bool"), "E_TYPE");
    expectCode(() => coerce(list([int(1)]), "bytes"), "E_TYPE");
    expectCode(() => coerce(B(1), "list"), "E_TYPE");
    expectCode(() => coerce(str("x"), "number"), "E_TYPE");
  });

  test("the param name or index is added to the error detail", () => {
    expectCode(() => coerce(int(1), "str", "amount"), "E_TYPE", { param: "amount" });
    expectCode(() => coerce(str(SURR), "bytes", 2), "E_COERCE", { param: 2 });
    expect(catchErr(() => coerce(int(1), "str")).detail).not.toHaveProperty("param");
    expect(catchErr(() => coerce(str(SURR), "bytes")).detail).not.toHaveProperty("param");
  });

  test("the result of a coercion has no secret mark", () => {
    const r = coerce(markSecret(B(0x61)), "str");
    expect(r).toEqual(str("a"));
    expect(coerce(markSecret(B(0x61)), "bytes")).toEqual(markSecret(B(0x61)));
  });
});

describe("validate (spec 4.3, 5.5, 5.6)", () => {
  const L: Readonly<Limits> = DEFAULT_LIMITS;
  const slot = (type: ParamType, extra: Partial<StackSlot> = {}): StackSlot => ({
    name: "p",
    type,
    ...extra,
  });
  const c = (k: Constraint): Constraint => k;
  const ok = (v: Value, s: StackSlot): void => {
    expect(() => validate(v, s, L)).not.toThrow();
  };
  const bad = (v: Value, s: StackSlot, constraint: string, value?: string): ForgeError => {
    const e = catchErr(() => validate(v, s, L));
    expect(e.code).toBe("E_PARAM_INVALID");
    expect(e.detail.param).toBe(s.name ?? 0);
    expect(e.detail.constraint).toBe(constraint);
    if (value !== undefined) expect(e.detail.value).toBe(value);
    return e;
  };

  describe("int", () => {
    const s = slot("int", { name: "amount", constraint: c({ min: 0, max: 25 }) });
    test("interval", () => {
      ok(int(0), s);
      ok(int(13), s);
      ok(int(25), s);
      bad(int(26), s, "[0..25]", "26"); // C63, section 15.1
      bad(int(-1), s, "[0..25]", "-1"); // C64
      bad(int(2n ** 80n), s, "[0..25]");
      bad(int(-(2n ** 80n)), s, "[0..25]");
    });
    test("open-ended intervals", () => {
      ok(int(1000), slot("int", { constraint: c({ min: 5 }) }));
      bad(int(4), slot("int", { constraint: c({ min: 5 }) }), "[5..]");
      ok(int(2n ** 80n), slot("int", { constraint: c({ min: 5 }) }));
      ok(int(-9), slot("int", { constraint: c({ max: 5 }) }));
      bad(int(6), slot("int", { constraint: c({ max: 5 }) }), "[..5]");
      ok(int(-(2n ** 80n)), slot("int", { constraint: c({ max: 5 }) }));
    });
    test("set", () => {
      const set = slot("int", { constraint: c({ oneOf: [16, 24, 32] }) });
      ok(int(24), set);
      bad(int(25), set, "[16|24|32]");
      bad(int(2n ** 80n), set, "[16|24|32]");
    });
    test("a single value", () => {
      const one = slot("int", { constraint: c({ min: 7, max: 7 }) });
      ok(int(7), one);
      bad(int(8), one, "[7]");
    });
    test("no constraint accepts anything", () => {
      ok(int(2n ** 80n), slot("int"));
    });
  });

  describe("num", () => {
    const s = slot("num", { constraint: c({ min: 0, max: 1 }) });
    test("interval", () => {
      ok(num(0), s);
      ok(num(0.5), s);
      ok(num(1), s);
      bad(num(1.5), s, "[0..1]", "1.5");
      bad(num(-0.1), s, "[0..1]");
      ok(num(100), slot("num", { constraint: c({ min: 0 }) }));
      bad(num(-1), slot("num", { constraint: c({ min: 0 }) }), "[0..]");
      bad(num(2), slot("num", { constraint: c({ max: 1.5 }) }), "[..1.5]");
    });
    test("a set is honoured when present", () => {
      const set = slot("num", { constraint: c({ oneOf: [1, 2.5] }) });
      ok(num(2.5), set);
      bad(num(3), set, "[1|2.5]");
    });
  });

  describe("str and its length / pattern constraints", () => {
    test("length is in code points", () => {
      const s = slot("str", { constraint: c({ minLength: 1, maxLength: 3 }) });
      ok(str("a"), s);
      ok(str("abc"), s);
      ok(str(GRIN.repeat(3)), s);
      bad(str(""), s, "[1..3]");
      bad(str("abcd"), s, "[1..3]");
      bad(str(GRIN.repeat(4)), s, "[1..3]");
    });
    test("length sets and open ends", () => {
      const set = slot("str", { constraint: c({ lengthOneOf: [2, 4] }) });
      ok(str("ab"), set);
      bad(str("abc"), set, "[2|4]");
      bad(str("a"), slot("str", { constraint: c({ minLength: 2 }) }), "[2..]");
      bad(str("abc"), slot("str", { constraint: c({ maxLength: 2 }) }), "[..2]");
      bad(str("abc"), slot("str", { constraint: c({ minLength: 2, maxLength: 2 }) }), "[2]");
    });
    test("the pattern must match the whole string", () => {
      const s = slot("str", { constraint: c({ pattern: "[a-z]+" }) });
      ok(str("abc"), s);
      bad(str("abc1"), s, "[/[a-z]+/]");
      bad(str("1abc"), s, "[/[a-z]+/]");
      bad(str(""), s, "[/[a-z]+/]");
      const alt = slot("str", { constraint: c({ pattern: "a|b" }) });
      ok(str("a"), alt);
      bad(str("ab"), alt, "[/a|b/]");
      bad(str("a\n"), slot("str", { constraint: c({ pattern: "a" }) }), "[/a/]");
      ok(str(GRIN), slot("str", { constraint: c({ pattern: "." }) })); // u flag: one astral char
    });
    test("length and pattern combine, length first in the text", () => {
      const s = slot("str", { constraint: c({ pattern: "[a-z]+", minLength: 1, maxLength: 5 }) });
      ok(str("abc"), s);
      bad(str("abcdef"), s, "[1..5,/[a-z]+/]");
      bad(str("AB"), s, "[1..5,/[a-z]+/]");
    });
    test("an uncompilable stored pattern is an internal error; the cache is bounded", () => {
      expectCode(
        () => validate(str("a"), slot("str", { constraint: c({ pattern: "(" }) }), L),
        "E_INTERNAL",
      );
      for (let i = 0; i < 300; i++) {
        ok(str("a"), slot("str", { constraint: c({ pattern: `a{1}|b${i}` }) }));
      }
      ok(str("a"), slot("str", { constraint: c({ pattern: "a" }) }));
    });
    test("an unconstrained str accepts anything", () => {
      ok(str(""), slot("str"));
      ok(str(SURR), slot("str"));
    });
  });

  describe("bytes, key, toggle: byte length", () => {
    for (const type of ["bytes", "key", "toggle"] as const) {
      test(type, () => {
        const s = slot(type, { constraint: c({ lengthOneOf: [16, 24, 32] }) });
        ok(bytes(new Uint8Array(16)), s);
        ok(bytes(new Uint8Array(32)), s);
        bad(
          bytes(new Uint8Array(15)),
          s,
          "[16|24|32]",
          "#[ 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 ]",
        );
        const iv = slot(type, { constraint: c({ minLength: 16, maxLength: 16 }) });
        ok(bytes(new Uint8Array(16)), iv);
        bad(bytes(new Uint8Array(17)), iv, "[16]");
        ok(bytes(new Uint8Array(1000)), slot(type));
      });
    }
    test("table:bytes[256]", () => {
      const s = slot("bytes", { name: "table", constraint: c({ minLength: 256, maxLength: 256 }) });
      ok(bytes(new Uint8Array(256)), s);
      const e = bad(B(1), s, "[256]", "#[ 01 ]"); // C148
      expect(e.detail.param).toBe("table");
    });
    test("a secret value is never shown in the detail", () => {
      const s = slot("key", { name: "k", constraint: c({ lengthOneOf: [16] }) });
      const e = bad(markSecret(B(1, 2, 3)), s, "[16]", "<redacted>");
      expect(JSON.stringify(e.toJSON())).not.toContain("01 02");
    });
  });

  describe("list: element count", () => {
    const s = slot("list", { constraint: c({ minLength: 1, maxLength: 2 }) });
    test("interval", () => {
      ok(list([int(1)]), s);
      ok(list([int(1), int(2)]), s);
      bad(list([]), s, "[1..2]", "{ }");
      bad(list([int(1), int(2), int(3)]), s, "[1..2]", "{ 1 2 3 }");
      ok(list([]), slot("list"));
    });
  });

  describe("choice", () => {
    const s = slot("choice", { name: "m", options: ["enc", "dec"], default: "enc" });
    test("exact, case-sensitive membership", () => {
      ok(str("enc"), s);
      ok(str("dec"), s);
      bad(str("zzz"), s, "{enc|dec}", '"zzz"'); // C59
      bad(str("ENC"), s, "{enc|dec}");
      bad(str(""), s, "{enc|dec}");
    });
    test("options with spaces render as string literals", () => {
      const q = slot("choice", { name: "m", options: ["Upper case", "Lower case"] });
      ok(str("Lower case"), q);
      bad(str("Other"), q, '{"Upper case"|"Lower case"}'); // C165
    });
    test("no options accepts nothing", () => {
      bad(str("a"), slot("choice"), "{}");
    });
  });

  describe("regex", () => {
    test("valid sources pass", () => {
      ok(str("[a-z]+"), slot("regex"));
      ok(str(""), slot("regex"));
      ok(str("\\p{L}"), slot("regex")); // needs the u flag
    });
    test("an invalid source is rejected", () => {
      bad(str("("), slot("regex"), "regex", '"("');
      bad(str("\\p{Nope}"), slot("regex"), "regex");
      bad(str("[z-a]"), slot("regex"), "regex");
    });
    test("length is limited in code points by maxRegexLength", () => {
      const lim: Readonly<Limits> = { ...L, maxRegexLength: 4 };
      expect(() => validate(str("a".repeat(4)), slot("regex"), lim)).not.toThrow();
      expect(() => validate(str(GRIN.repeat(4)), slot("regex"), lim)).not.toThrow();
      const e = catchErr(() => validate(str("a".repeat(5)), slot("regex"), lim));
      expect(e.code).toBe("E_PARAM_INVALID");
      expect(e.detail.constraint).toBe("regex");
      expect(e.detail.param).toBe("p");
    });
  });

  describe("charset", () => {
    test("non-empty, no repeated code point", () => {
      ok(str("abc"), slot("charset"));
      ok(str(`a${GRIN}b`), slot("charset"));
      bad(str(""), slot("charset"), "charset", '""');
      bad(str("aba"), slot("charset"), "charset", '"aba"');
      bad(str(GRIN + GRIN), slot("charset"), "charset");
    });
    test("the length constraint applies in code points", () => {
      const s = slot("charset", { constraint: c({ minLength: 2, maxLength: 3 }) });
      ok(str("ab"), s);
      ok(str(`a${GRIN}b`), s);
      bad(str("a"), s, "[2..3]");
      bad(str("abcd"), s, "[2..3]");
    });
  });

  describe("types without constraints", () => {
    test("any, number, bool, quot, record, file accept their values", () => {
      for (const v of [int(1), str("a"), B(1), list([]), quotValue(), record([]), fileValue()]) {
        ok(v, slot("any"));
      }
      ok(int(1), slot("number"));
      ok(num(1.5), slot("number"));
      ok(bool(true), slot("bool"));
      ok(quotValue(), slot("quot"));
      ok(record([]), slot("record"));
      ok(fileValue(), slot("file"));
    });
  });

  describe("param naming and tag safety", () => {
    test("an unnamed slot reports its index, else 0", () => {
      const s: StackSlot = { name: null, type: "int", constraint: c({ min: 1 }) };
      expect(catchErr(() => validate(int(0), s, L, 3)).detail.param).toBe(3);
      expect(catchErr(() => validate(int(0), s, L)).detail.param).toBe(0);
    });
    test("a value of the wrong tag is E_TYPE", () => {
      expectCode(() => validate(str("a"), slot("int"), L), "E_TYPE", {
        expected: "int",
        actual: "str",
        param: "p",
      });
      expectCode(() => validate(str("a"), slot("number"), L), "E_TYPE");
      expectCode(() => validate(int(1), slot("key"), L), "E_TYPE");
      expectCode(() => validate(int(1), { name: null, type: "str" }, L, 1), "E_TYPE", {
        param: 1,
      });
    });
    test("the error message names the parameter and value", () => {
      const e = catchErr(() =>
        validate(int(26), slot("int", { name: "amount", constraint: { max: 25 } }), L),
      );
      expect(e.message).toContain("amount");
      expect(e.message).toContain("26");
    });
    test("detail.value is cut to 80 code points", () => {
      const s = slot("str", { constraint: c({ maxLength: 1 }) });
      const e = catchErr(() => validate(str("z".repeat(500)), s, L));
      expect(cpLength(e.detail.value as string)).toBe(80);
      expect((e.detail.value as string).endsWith("...")).toBe(true);
    });
  });

  describe("canonical constraint text (spec 12.3)", () => {
    test("constraintText", () => {
      expect(constraintText(undefined)).toBe("");
      expect(constraintText({})).toBe("");
      expect(constraintText({ min: 1, max: 25 })).toBe("[1..25]");
      expect(constraintText({ min: 1 })).toBe("[1..]");
      expect(constraintText({ max: 25 })).toBe("[..25]");
      expect(constraintText({ min: 3, max: 3 })).toBe("[3]");
      expect(constraintText({ oneOf: [16, 24, 32] })).toBe("[16|24|32]");
      expect(constraintText({ min: 0.5, max: 2.5 })).toBe("[0.5..2.5]");
      expect(constraintText({ minLength: 2, maxLength: 4 })).toBe("[2..4]");
      expect(constraintText({ lengthOneOf: [16] })).toBe("[16]");
      expect(constraintText({ pattern: "a+" })).toBe("[/a+/]");
      expect(constraintText({ maxLength: 9, pattern: "a+" })).toBe("[..9,/a+/]");
    });
    test("optionsText", () => {
      expect(optionsText(["a", "b"])).toBe("{a|b}");
      expect(optionsText(["Upper case", "x"])).toBe('{"Upper case"|x}');
      expect(optionsText(["a|b", "{", "}", 'q"'])).toBe('{"a|b"|"{"|"}"|"q\\""}');
      expect(optionsText([""])).toBe('{""}');
      expect(optionsText([])).toBe("{}");
    });
  });
});

describe("sizeOf (spec 10.8)", () => {
  test("scalars", () => {
    expect(sizeOf(B(1, 2, 3))).toBe(3);
    expect(sizeOf(B())).toBe(0);
    expect(sizeOf(bytes(new Uint8Array(1000)))).toBe(1000);
    expect(sizeOf(str("abc"))).toBe(6);
    expect(sizeOf(str(""))).toBe(0);
    expect(sizeOf(str(GRIN))).toBe(4); // 2 x length in UTF-16 units
    expect(sizeOf(int(5))).toBe(8);
    expect(sizeOf(int(Number.MAX_SAFE_INTEGER))).toBe(8);
    expect(sizeOf(num(1.5))).toBe(8);
    expect(sizeOf(bool(true))).toBe(1);
    expect(sizeOf(quotValue())).toBe(16);
  });

  test("a bigint int is ceil(bits / 8)", () => {
    expect(sizeOf(int(2n ** 53n))).toBe(7); // 54 bits
    expect(sizeOf(int(2n ** 63n))).toBe(8); // 64 bits
    expect(sizeOf(int(2n ** 64n))).toBe(9); // 65 bits
    expect(sizeOf(int(-(2n ** 64n)))).toBe(9);
    expect(sizeOf(int(2n ** 65_535n))).toBe(8192);
  });

  test("lists: 8 per element plus the elements", () => {
    expect(sizeOf(list([]))).toBe(0);
    expect(sizeOf(list([int(1), int(2)]))).toBe(2 * 8 + 2 * 8);
    expect(sizeOf(list([str("ab"), list([bool(true)])]))).toBe(2 * 8 + 4 + (8 + 1));
  });

  test("records: 16 per entry plus keys and values", () => {
    expect(sizeOf(record([]))).toBe(0);
    expect(sizeOf(record([["ab", int(1)]]))).toBe(16 + 4 + 8);
    expect(
      sizeOf(
        record([
          ["k", list([B(1, 2)])],
          ["xyz", str("q")],
        ]),
      ),
    ).toBe(2 * 16 + 2 + (8 + 2) + 6 + 2);
  });

  test("files: name and type as strings plus the bytes", () => {
    expect(sizeOf(fileValue("ab", "t", 1, 2, 3))).toBe(4 + 2 + 3);
  });

  test("deeply nested values are metered without recursion", () => {
    let v: Value = int(1);
    for (let i = 0; i < 100_000; i++) v = list([v]);
    expect(sizeOf(v)).toBe(100_000 * 8 + 8);
  });
});
