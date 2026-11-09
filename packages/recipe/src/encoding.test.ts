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
import { Rng } from "../test/gen.js";
import {
  base64Decode,
  base64Encode,
  base64UrlDecode,
  base64UrlEncode,
  decodeEncoded,
  encodeBytes,
  hexDecode,
  hexEncode,
  latin1Decode,
  latin1Encode,
  normaliseEncodedValue,
  tryDecodeEncoded,
  utf8DecodeStrict,
  utf8Encode,
} from "./encoding.js";

const bytes = (...b: number[]) => Uint8Array.from(b);
const list = (b: Uint8Array | null) => (b === null ? null : Array.from(b));
const ascii = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

describe("hex", () => {
  test("encode is lowercase pairs", () => {
    expect(hexEncode(bytes(0, 1, 171, 255))).toBe("0001abff");
    expect(hexEncode(bytes())).toBe("");
  });

  test("decode accepts either case and ASCII whitespace", () => {
    expect(list(hexDecode("DE ad\tBE\nEF\r\v\f"))).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect(list(hexDecode(""))).toEqual([]);
    expect(list(hexDecode(" "))).toEqual([]);
    expect(list(hexDecode("d e"))).toEqual([0xde]);
  });

  test("decode rejects odd counts and other characters", () => {
    for (const bad of ["a", "abc", "zz", "0x00", "a-b", " ab", "٠٠"])
      expect(hexDecode(bad)).toBeNull();
  });
});

describe("base64 (RFC 4648 section 10 vectors)", () => {
  const vectors: [string, string][] = [
    ["", ""],
    ["f", "Zg=="],
    ["fo", "Zm8="],
    ["foo", "Zm9v"],
    ["foob", "Zm9vYg=="],
    ["fooba", "Zm9vYmE="],
    ["foobar", "Zm9vYmFy"],
  ];

  test.each(vectors)("%j", (plain, encoded) => {
    expect(base64Encode(ascii(plain))).toBe(encoded);
    expect(list(base64Decode(encoded))).toEqual(list(ascii(plain)));
    // padding is optional
    expect(list(base64Decode(encoded.replace(/=+$/, "")))).toEqual(list(ascii(plain)));
    expect(base64UrlEncode(ascii(plain))).toBe(encoded.replace(/=+$/, ""));
    expect(list(base64UrlDecode(encoded.replace(/=+$/, "")))).toEqual(list(ascii(plain)));
  });

  test("the alphabets differ in two characters", () => {
    expect(base64Encode(bytes(0xfb, 0xff))).toBe("+/8=");
    expect(base64UrlEncode(bytes(0xfb, 0xff))).toBe("-_8");
    expect(list(base64UrlDecode("-_8"))).toEqual([0xfb, 0xff]);
    expect(base64UrlDecode("+/8")).toBeNull();
    expect(base64Decode("-_8")).toBeNull();
  });

  test("decode ignores whitespace", () => {
    expect(list(base64Decode(" Zm9v\nYmFy\t"))).toEqual(list(ascii("foobar")));
  });

  test("decode rejects bad padding, bad length, bad characters and stray bits", () => {
    for (const bad of [
      "Zg=",
      "Zh==",
      "Z",
      "Zm9v!",
      "Zm9v=",
      "Zg===",
      "=Zg=",
      "Zg==Zg==",
      "Z=g=",
      "Zh",
      "Zm9",
      "éééé",
      "Zm 9v!",
    ]) {
      expect(base64Decode(bad)).toBeNull();
    }
  });

  test("base64url decode is canonical: no padding, no whitespace, no stray bits", () => {
    for (const bad of ["Zg==", "Zg=", " Zg", "Zh", "Zm9", "A", "AAAAA", "e31", "!"])
      expect(base64UrlDecode(bad)).toBeNull();
    expect(list(base64UrlDecode("e30"))).toEqual([0x7b, 0x7d]);
    expect(list(base64UrlDecode(""))).toEqual([]);
  });

  test("a round trip over random byte strings, one spelling each", () => {
    const rng = new Rng(3);
    for (let n = 0; n < 80; n++) {
      const data = Uint8Array.from({ length: n }, () => rng.int(256));
      expect(list(base64Decode(base64Encode(data)))).toEqual(list(data));
      const url = base64UrlEncode(data);
      expect(list(base64UrlDecode(url))).toEqual(list(data));
      expect(base64UrlEncode(base64UrlDecode(url) as Uint8Array)).toBe(url);
    }
  });
});

describe("latin1 and utf8", () => {
  test("latin1", () => {
    expect(latin1Encode(bytes(0x68, 0xe9, 0xff))).toBe("héÿ");
    expect(list(latin1Decode("héÿ"))).toEqual([0x68, 0xe9, 0xff]);
    expect(latin1Decode("Ā")).toBeNull();
    expect(latin1Decode("😀")).toBeNull();
  });

  test("utf8 is strict", () => {
    expect(list(utf8Encode("hé😀"))).toEqual([0x68, 0xc3, 0xa9, 0xf0, 0x9f, 0x98, 0x80]);
    expect(utf8DecodeStrict(utf8Encode("hé😀"))).toBe("hé😀");
    expect(utf8DecodeStrict(bytes(0xff))).toBeNull();
    expect(utf8DecodeStrict(bytes(0xc0, 0x80))).toBeNull();
    expect(utf8DecodeStrict(bytes(0xed, 0xa0, 0x80))).toBeNull(); // an encoded surrogate
    // a byte order mark is kept, not dropped
    expect(utf8DecodeStrict(bytes(0xef, 0xbb, 0xbf, 0x41))).toBe("﻿A");
  });
});

describe("encoded values", () => {
  test("tryDecodeEncoded by enc", () => {
    expect(list(tryDecodeEncoded("hé", "utf8"))).toEqual([0x68, 0xc3, 0xa9]);
    expect(tryDecodeEncoded("\ud800", "utf8")).toBeNull();
    expect(list(tryDecodeEncoded("DE AD", "hex"))).toEqual([0xde, 0xad]);
    expect(tryDecodeEncoded("zz", "hex")).toBeNull();
    expect(list(tryDecodeEncoded("hé", "latin1"))).toEqual([0x68, 0xe9]);
    expect(tryDecodeEncoded("ā", "latin1")).toBeNull();
    expect(list(tryDecodeEncoded("Zg", "base64"))).toEqual([0x66]);
    expect(tryDecodeEncoded("Z", "base64")).toBeNull();
  });

  test("normal forms (RECIPES.md section 3.4)", () => {
    expect(normaliseEncodedValue("DE AD", "hex")).toBe("dead");
    expect(normaliseEncodedValue("3q2+7w", "base64")).toBe("3q2+7w==");
    expect(normaliseEncodedValue(" 3q2+ 7w== ", "base64")).toBe("3q2+7w==");
    expect(normaliseEncodedValue("hé", "latin1")).toBe("hé");
    expect(normaliseEncodedValue("a b", "utf8")).toBe("a b");
    // a value that is not valid is returned as it is
    expect(normaliseEncodedValue("zz", "hex")).toBe("zz");
    expect(normaliseEncodedValue("!", "base64")).toBe("!");
  });

  test("decodeEncoded and encodeBytes", () => {
    expect(list(decodeEncoded({ value: "DE AD", enc: "hex" }))).toEqual([0xde, 0xad]);
    expect(() => decodeEncoded({ value: "zz", enc: "hex" })).toThrow(RangeError);
    expect(encodeBytes(bytes(0xde, 0xad), "hex")).toBe("dead");
    expect(encodeBytes(bytes(0xde, 0xad), "base64")).toBe("3q0=");
    expect(encodeBytes(bytes(0x68, 0xe9), "latin1")).toBe("hé");
    expect(encodeBytes(utf8Encode("hé"), "utf8")).toBe("hé");
    expect(() => encodeBytes(bytes(0xff), "utf8")).toThrow(RangeError);
  });

  test("every encoding round-trips random bytes", () => {
    const rng = new Rng(11);
    for (let n = 0; n < 30; n++) {
      const data = Uint8Array.from({ length: n }, () => rng.int(256));
      for (const enc of ["hex", "base64", "latin1"] as const) {
        expect(list(decodeEncoded({ value: encodeBytes(data, enc), enc }))).toEqual(list(data));
      }
    }
  });
});
