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
import { describe, expect, it } from "vitest";
import {
  constraintHint,
  defaultEncoding,
  defaultText,
  encodingChoices,
  encodingOf,
  parseIntText,
  parseNumberText,
  stepNumberText,
  textToValue,
  valueToText,
  type FieldSpec,
} from "./convert.js";

const int = (c?: FieldSpec["constraint"], d?: number): FieldSpec => ({
  name: "n",
  type: "int",
  ...(c === undefined ? {} : { constraint: c }),
  ...(d === undefined ? {} : { default: d }),
});
const of = (type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({
  name: "p",
  type,
  ...extra,
});

describe("parseIntText", () => {
  it("normalises to a safe integer", () => {
    expect(parseIntText("13")).toBe(13);
    expect(parseIntText(" 007 ")).toBe(7);
    expect(parseIntText("+5")).toBe(5);
    expect(Object.is(parseIntText("-0"), 0)).toBe(true);
    expect(parseIntText("-12")).toBe(-12);
  });
  it("keeps the safe-integer boundary as numbers and beyond as canonical strings", () => {
    expect(parseIntText("9007199254740991")).toBe(9007199254740991);
    expect(parseIntText("9007199254740992")).toBe("9007199254740992");
    expect(parseIntText("-9007199254740991")).toBe(-9007199254740991);
    expect(parseIntText("-9007199254740992")).toBe("-9007199254740992");
    expect(parseIntText("000000000000000000000000000012345678901234567890")).toBe(
      "12345678901234567890",
    );
  });
  it("rejects everything else", () => {
    for (const t of ["", " ", "1e", "1e3", "1.5", "0x10", "--1", "1_000", "abc", "١٢"]) {
      expect(parseIntText(t)).toBeUndefined();
    }
  });
});

describe("parseNumberText", () => {
  it("accepts decimal and exponent literals", () => {
    expect(parseNumberText("1.5")).toBe(1.5);
    expect(parseNumberText(".5")).toBe(0.5);
    expect(parseNumberText("5.")).toBe(5);
    expect(parseNumberText("-1e3")).toBe(-1000);
    expect(parseNumberText("2E-2")).toBe(0.02);
    expect(Object.is(parseNumberText("-0"), 0)).toBe(true);
  });
  it("rejects non-literals and non-finite values", () => {
    for (const t of ["", ".", "e5", "1e", "Infinity", "NaN", "0x10", "1e999", "1,5"]) {
      expect(parseNumberText(t)).toBeUndefined();
    }
  });
});

describe("textToValue", () => {
  it("int / num / number: canonical value, raw text when unparsable, undefined when empty", () => {
    expect(textToValue(int(), "13")).toBe(13);
    expect(textToValue(int(), "1e")).toBe("1e");
    expect(textToValue(int(), "  ")).toBeUndefined();
    expect(textToValue(of("num"), "2.50")).toBe(2.5);
    expect(textToValue(of("number"), "3")).toBe(3);
    expect(textToValue(of("number"), "x")).toBe("x");
    expect(textToValue(of("num"), "")).toBeUndefined();
  });
  it("text-like types pass the text through, including empty", () => {
    for (const t of ["str", "regex", "charset", "bytes", "choice"] as const) {
      expect(textToValue(of(t), " a b ")).toBe(" a b ");
      expect(textToValue(of(t), "")).toBe("");
    }
  });
  it("bytes keep the user's hex text (the validator normalises)", () => {
    expect(textToValue(of("bytes"), "DE AD be ef")).toBe("DE AD be ef");
  });
  it("toggle / key build {value, enc}", () => {
    const key = of("key", { options: ["hex", "utf8"] });
    expect(textToValue(key, "abc", "utf8")).toEqual({ value: "abc", enc: "utf8" });
    expect(textToValue(key, "abc")).toEqual({ value: "abc", enc: "hex" });
    expect(textToValue(of("toggle"), "x")).toEqual({ value: "x", enc: "utf8" });
  });
  it("bool maps the strings true and false", () => {
    expect(textToValue(of("bool"), "true")).toBe(true);
    expect(textToValue(of("bool"), "false")).toBe(false);
  });
});

describe("valueToText and defaults", () => {
  it("shows numbers, big decimal strings, strings and encoded values", () => {
    expect(valueToText(13)).toBe("13");
    expect(valueToText("12345678901234567890")).toBe("12345678901234567890");
    expect(valueToText("1e")).toBe("1e");
    expect(valueToText({ value: "ab", enc: "hex" })).toBe("ab");
    expect(valueToText(true)).toBe("true");
    expect(valueToText(undefined)).toBe("");
    expect(valueToText(null)).toBe("");
    expect(valueToText([1])).toBe("[1]");
  });
  it("round-trips canonical values through text", () => {
    for (const v of [0, -5, 9007199254740991, "9007199254740992", "-9007199254740993"]) {
      expect(textToValue(int(), valueToText(v))).toBe(v);
    }
    expect(textToValue(of("num"), valueToText(0.1))).toBe(0.1);
  });
  it("defaultText", () => {
    expect(defaultText(int(undefined, 13))).toBe("13");
    expect(defaultText(of("str", { default: "" }))).toBe("");
    expect(defaultText(of("key", { default: { value: "k", enc: "utf8" } }))).toBe("k");
    expect(defaultText(of("regex"))).toBe("");
  });
});

describe("encodings", () => {
  it("are limited to ParamSpec.options, all four when bare", () => {
    expect(encodingChoices(of("key", { options: ["hex", "base64"] }))).toEqual(["hex", "base64"]);
    expect(encodingChoices(of("toggle"))).toEqual(["utf8", "hex", "latin1", "base64"]);
    expect(encodingChoices(of("key", { options: [] }))).toHaveLength(4);
  });
  it("default encoding is the default's, else the first option", () => {
    const k = of("key", { options: ["hex", "utf8"], default: { value: "", enc: "utf8" } });
    expect(defaultEncoding(k)).toBe("utf8");
    expect(defaultEncoding(of("key", { options: ["hex", "utf8"] }))).toBe("hex");
    expect(encodingOf(k, { value: "a", enc: "hex" })).toBe("hex");
    expect(encodingOf(k, undefined)).toBe("utf8");
    expect(encodingOf(k, "garbage")).toBe("utf8");
  });
});

describe("stepNumberText", () => {
  it("steps and clamps integers", () => {
    const s = int({ min: 0, max: 25 }, 13);
    expect(stepNumberText(s, "13", 1)).toBe("14");
    expect(stepNumberText(s, "25", 1)).toBe("25");
    expect(stepNumberText(s, "0", -1)).toBe("0");
    expect(stepNumberText(s, "", 1)).toBe("14");
    expect(stepNumberText(s, "1e", 1)).toBeUndefined();
  });
  it("steps big integers exactly", () => {
    expect(stepNumberText(int(), "9007199254740992", 1)).toBe("9007199254740993");
  });
  it("starts from min or 0 without a default", () => {
    expect(stepNumberText(int({ min: 5 }), "", -1)).toBe("5");
    expect(stepNumberText(int(), "", 1)).toBe("1");
  });
  it("steps floats without drift", () => {
    expect(stepNumberText(of("num"), "0.1", 1)).toBe("1.1");
    expect(stepNumberText(of("num", { constraint: { max: 1 } }), "0.5", 1)).toBe("1");
  });
});

describe("constraintHint", () => {
  it("describes ranges, lists and lengths", () => {
    expect(constraintHint(int({ min: 0, max: 25 }))).toBe("Allowed: 0 to 25");
    expect(constraintHint(int({ min: 1 }))).toBe("Allowed: at least 1");
    expect(constraintHint(int({ max: 9 }))).toBe("Allowed: at most 9");
    expect(constraintHint(int({ oneOf: [1, 2] }))).toBe("Allowed: one of 1, 2");
    expect(constraintHint(of("key", { constraint: { lengthOneOf: [16, 24, 32] } }))).toBe(
      "Allowed: length 16, 24, 32 bytes",
    );
    expect(constraintHint(of("str", { constraint: { minLength: 0, maxLength: 3 } }))).toBe(
      "Allowed: 0 to 3 characters",
    );
  });
  it("is empty without constraint", () => {
    expect(constraintHint(int())).toBe("");
    expect(constraintHint(of("str", { constraint: { pattern: "[ims]*" } }))).toBe("");
  });
});
