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
import { ForgeError } from "../errors.js";
import { ext, nullValue, registerExtKind } from "../ext.js";
import type { ErrorCode, PrimitiveContext, Value } from "../types.js";
import { DEFAULT_LIMITS } from "../types.js";
import { bool, bytes, equals, int, list, num, record, repr, str } from "../values.js";
import { JSON_MAX_DEPTH, jsonToValue, valueToJson } from "./json.js";

const ctx: PrimitiveContext = {
  signal: undefined,
  limits: { ...DEFAULT_LIMITS },
  scope: { current: "user", using: [] },
};

const read = (t: string): Value => jsonToValue(t, ctx);
const write = (v: Value, indent: number | bigint = 0): string => valueToJson(v, indent, ctx);

function codeOf(f: () => unknown): ErrorCode {
  try {
    f();
  } catch (e) {
    if (e instanceof ForgeError) return e.code;
    throw e;
  }
  throw new Error("did not fail");
}

/** value -> json -> value is the same value, for compact and indented text, and the text is stable. */
function roundTrips(v: Value): void {
  for (const indent of [0, 1, 2, 32]) {
    const t = write(v, indent);
    const back = read(t);
    expect(equals(back, v), `${t}`).toBe(true);
    expect(write(back, indent)).toBe(t);
  }
}

describe("round trips", () => {
  test("nested lists and records, with the order of the keys kept", () => {
    const v = record([
      ["z", list([int(1), list([int(2), list([])]), record([])])],
      [
        "a",
        record([
          ["m", list([str("x")])],
          ["b", bool(false)],
        ]),
      ],
      ["", int(0)],
      ["__proto__", int(1)],
    ]);
    roundTrips(v);
    const back = read(write(v)).v as ReadonlyMap<string, Value>;
    expect([...back.keys()]).toEqual(["z", "a", "", "__proto__"]);
  });

  test("ext{null}, alone and nested, stays apart from 0, false and the empty values", () => {
    roundTrips(nullValue());
    roundTrips(list([nullValue(), int(0), bool(false), str(""), list([]), record([])]));
    roundTrips(record([["a", list([nullValue(), record([["b", nullValue()]])])]]));
    expect(read("null")).toEqual(nullValue());
    expect(equals(read("[null]"), list([int(0)]))).toBe(false);
  });

  test("Unicode and escapes", () => {
    for (const s of [
      "",
      'quote " backslash \\ slash /',
      "tab\t lf\n cr\r bs\b ff\f",
      "\u0000\u0001\u001f\u007f",
      "é ß 日本語   ",
      "😀 \u{1d11e}",
      "퟿￿",
    ]) {
      roundTrips(str(s));
      roundTrips(record([[s, str(s)]]));
    }
    expect(write(str("\u0001"))).toBe('"\\u0001"');
    expect(write(str("é😀"))).toBe('"é😀"');
    expect(read('"\\ud83d\\ude00 \\u00e9 \\/ \\u0041"')).toEqual(str("😀 é / A"));
  });

  test("big integers are exact", () => {
    for (const n of [
      0n,
      9007199254740991n,
      9007199254740992n,
      -9007199254740993n,
      12345678901234567890n,
      -(2n ** 200n),
      10n ** 60n,
    ]) {
      roundTrips(int(n));
      expect(write(int(n))).toBe(n.toString());
      expect(read(n.toString())).toEqual(int(n));
    }
    expect(equals(read("-0"), int(0))).toBe(true);
    expect(write(read("-0"))).toBe("0");
  });

  test("number edge cases: int and num stay apart", () => {
    for (const x of [
      0.5, -0.5, 1.5e300, 5e-324, 1.7976931348623157e308, 0.1, 100, 1e21, -0, 123456789.125,
    ]) {
      roundTrips(num(x));
    }
    expect(write(num(100))).toBe("100.0");
    expect(write(num(-0))).toBe("-0.0");
    expect(write(num(1e21))).toBe("1e+21");
    expect(read("100.0").tag).toBe("num");
    expect(read("1e2").tag).toBe("num");
    expect(read("100").tag).toBe("int");
    expect(read("-0.0")).toEqual(num(-0));
    expect(repr(read("[1,1.0]"))).toBe("{ 1 1.0 }");
    expect(codeOf(() => read("1e999"))).toBe("E_COERCE");
    expect(codeOf(() => read("-1e999"))).toBe("E_COERCE");
  });
});

describe("errors", () => {
  test("bad text is E_COERCE with offset, line, column and reason", () => {
    try {
      read('{"a":1,\n "b":}');
      throw new Error("did not fail");
    } catch (e) {
      expect(e).toBeInstanceOf(ForgeError);
      const d = (e as ForgeError).detail as Record<string, unknown>;
      expect((e as ForgeError).code).toBe("E_COERCE");
      expect(d["line"]).toBe(2);
      expect(d["column"]).toBe(6);
      expect(d["offset"]).toBe(13);
      expect(typeof d["reason"]).toBe("string");
    }
    for (const bad of [
      "",
      " ",
      "[1,]",
      "[1 2]",
      '{"a":1,"a":2}',
      "{'a':1}",
      "// c\n1",
      "[1] x",
      "NaN",
      "Infinity",
      "+1",
      ".5",
      "1.",
      "01",
      "-",
      "1e",
      '"\\x"',
      '"\\ud800"',
      '"\\udc00"',
      '"\ud800"',
      '"a\nb"',
      "﻿1",
      " 1",
      "tru",
    ]) {
      expect(
        codeOf(() => read(bad)),
        JSON.stringify(bad),
      ).toBe("E_COERCE");
    }
  });

  test("only space, tab, LF and CR are white space", () => {
    expect(read(" \t\r\n[ 1 ,\t2\n]\r\n")).toEqual(list([int(1), int(2)]));
  });

  test("nesting beyond 512 levels is E_LIMIT_VALUE in both words", () => {
    const ok = "[".repeat(JSON_MAX_DEPTH) + "]".repeat(JSON_MAX_DEPTH);
    const deep = "[".repeat(JSON_MAX_DEPTH + 1) + "]".repeat(JSON_MAX_DEPTH + 1);
    expect(JSON_MAX_DEPTH).toBe(512);
    roundTrips(read(ok));
    expect(codeOf(() => read(deep))).toBe("E_LIMIT_VALUE");
    let v: Value = list([]);
    for (let k = 0; k < JSON_MAX_DEPTH; k++) v = list([v]);
    expect(codeOf(() => write(v))).toBe("E_LIMIT_VALUE");
  });

  test("an int over maxIntBits is E_LIMIT_VALUE; the size of the value is held to maxValueBytes", () => {
    const small: PrimitiveContext = { ...ctx, limits: { ...DEFAULT_LIMITS, maxIntBits: 64 } };
    expect(codeOf(() => jsonToValue("1" + "0".repeat(30), small))).toBe("E_LIMIT_VALUE");
    const tiny: PrimitiveContext = { ...ctx, limits: { ...DEFAULT_LIMITS, maxValueBytes: 64 } };
    expect(codeOf(() => jsonToValue(`[${"1,".repeat(100)}1]`, tiny))).toBe("E_LIMIT_VALUE");
    expect(codeOf(() => valueToJson(str("x".repeat(100)), 0, tiny))).toBe("E_LIMIT_VALUE");
  });

  test("no JSON form: bytes and every ext value but null are E_TYPE, at any depth", () => {
    expect(codeOf(() => write(bytes(new Uint8Array([1]))))).toBe("E_TYPE");
    expect(codeOf(() => write(list([record([["a", bytes(new Uint8Array())]])])))).toBe("E_TYPE");
    registerExtKind({
      kind: "json-t-pt",
      equals: () => true,
      sizeOf: () => 16,
      toText: () => "pt",
    });
    expect(codeOf(() => write(ext("json-t-pt", {})))).toBe("E_TYPE");
    expect(codeOf(() => write(list([ext("json-t-pt", {})])))).toBe("E_TYPE");
  });

  test("a lone surrogate in a string is E_COERCE when written; indent is E_RANGE outside 0 to 32", () => {
    expect(codeOf(() => write(str("\ud800")))).toBe("E_COERCE");
    expect(codeOf(() => write(int(1), 33))).toBe("E_RANGE");
    expect(codeOf(() => write(int(1), -1))).toBe("E_RANGE");
  });
});
