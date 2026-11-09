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
import { read } from "@forge/lang";
import type { ParamSpec } from "@forge/lang";
import { describe, expect, test } from "vitest";
import {
  bytesLiteral,
  encodedLiteral,
  floatLiteral,
  intLiteral,
  jsonStringLiteral,
  paramLiteral,
  stringLiteral,
} from "./literals.js";
import type { ParamValue } from "./types.js";

const spec = (type: string): ParamSpec =>
  ({ name: "p", type, index: 1, required: true }) as ParamSpec;
const lit = (type: string, value: ParamValue) => paramLiteral(spec(type), value);

describe("literals (RECIPES.md section 5.2)", () => {
  test("string literals", () => {
    expect(stringLiteral("")).toBe('""');
    expect(stringLiteral('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(stringLiteral("\u0000\n\r\t")).toBe('"\\0\\n\\r\\t"');
    expect(stringLiteral("\u0001\u001f\u007f\u0080\u009f")).toBe('"\\x01\\x1f\\x7f\\x80\\x9f"');
    // not a control character: written raw. U+2028 too: FL does not treat it as a line break.
    expect(stringLiteral(" é 😀​")).toBe('" é 😀​"');
    expect(stringLiteral("héllo")).toBe('"héllo"');
  });

  test("every string literal reads back as the same string and has no raw line break", () => {
    const all = Array.from({ length: 0x180 }, (_, i) => String.fromCharCode(i)).join("") + "  ﻿😀";
    const text = stringLiteral(all);
    expect(text).not.toMatch(/[\n\r]/);
    const tokens = read(text);
    expect(tokens[0]).toMatchObject({ kind: "str", value: all });
  });

  test("JSON string literals escape only quote, backslash and C0", () => {
    expect(jsonStringLiteral('a"b\\c\n\u0001\u007f\u0085 ')).toBe(
      '"a\\"b\\\\c\\n\\u0001\u007f\u0085 "',
    );
  });

  test("byte arrays", () => {
    expect(bytesLiteral(Uint8Array.of())).toBe("#[ ]");
    expect(bytesLiteral(Uint8Array.of(0xde, 0xad, 0, 15))).toBe("#[ de ad 00 0f ]");
    expect(read("#[ de ad ]")[0]).toMatchObject({
      kind: "bytes",
      value: Uint8Array.of(0xde, 0xad),
    });
  });

  test("floats", () => {
    expect(floatLiteral(2)).toBe("2.0");
    expect(floatLiteral(0.5)).toBe("0.5");
    expect(floatLiteral(-3)).toBe("-3.0");
    expect(floatLiteral(1e21)).toBe("1e+21");
    expect(floatLiteral(1.5e-7)).toBe("1.5e-7");
    expect(floatLiteral(-0)).toBe("-0.0");
    expect(floatLiteral(0)).toBe("0.0");
    for (const x of [2, 0.5, -3, 1e21, 1.5e-7, -0, 123456.789, 5e-324]) {
      const token = read(floatLiteral(x))[0];
      expect(token).toMatchObject({ kind: "float" });
      expect(Object.is((token as { value: number }).value, x)).toBe(true);
    }
  });

  test("ints", () => {
    expect(intLiteral(13)).toBe("13");
    expect(intLiteral(-5)).toBe("-5");
    expect(intLiteral(-0)).toBe("0");
    expect(intLiteral("9007199254740993")).toBe("9007199254740993");
    expect(intLiteral(1e21)).toBe("1000000000000000000000");
    expect(read("-5")[0]).toMatchObject({ kind: "int", value: -5 });
  });

  test("encoded groups", () => {
    expect(encodedLiteral({ value: "a\nb", enc: "utf8" })).toBe('"a\\nb"');
    expect(encodedLiteral({ value: "DE AD", enc: "hex" })).toBe("#[ de ad ]");
    expect(encodedLiteral({ value: "", enc: "hex" })).toBe("#[ ]");
    expect(encodedLiteral({ value: "hé", enc: "latin1" })).toBe('"hé" recipe:latin1');
    expect(encodedLiteral({ value: "3q2+7w", enc: "base64" })).toBe('"3q2+7w==" recipe:base64');
    // not valid: written as empty rather than throwing
    expect(encodedLiteral({ value: "zz", enc: "hex" })).toBe("#[ ]");
  });

  test("a literal group for every parameter type", () => {
    expect(lit("int", 7)).toBe("7");
    expect(lit("int", "9007199254740993")).toBe("9007199254740993");
    expect(lit("num", 2)).toBe("2.0");
    expect(lit("number", 2)).toBe("2");
    expect(lit("number", 2.5)).toBe("2.5");
    expect(lit("number", 1e21)).toBe("1000000000000000000000");
    expect(lit("bool", true)).toBe("true");
    expect(lit("bool", false)).toBe("false");
    expect(lit("str", "x")).toBe('"x"');
    expect(lit("choice", "standard")).toBe('"standard"');
    expect(lit("regex", "\\d+")).toBe('"\\\\d+"');
    expect(lit("charset", "abc")).toBe('"abc"');
    expect(lit("bytes", "DE AD")).toBe("#[ de ad ]");
    expect(lit("bytes", "zz")).toBe("#[ ]");
    expect(lit("toggle", { value: "ab", enc: "latin1" })).toBe('"ab" recipe:latin1');
    expect(lit("key", { value: "k", enc: "utf8" })).toBe('"k"');
  });
});
