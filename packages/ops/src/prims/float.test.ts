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
import { pack, parseNumber, unpack } from "./float.js";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const bytes = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));

describe("float._pack / float._unpack", () => {
  test("parseNumber accepts decimal text and the special names, and nothing else", () => {
    expect(parseNumber("1.5e3")).toBe(1500);
    expect(parseNumber(".5")).toBe(0.5);
    expect(parseNumber("5.")).toBe(5);
    expect(parseNumber("+7")).toBe(7);
    expect(Object.is(parseNumber("-0"), -0)).toBe(true);
    expect(parseNumber("-INF")).toBe(Number.NEGATIVE_INFINITY);
    expect(parseNumber("Infinity")).toBe(Number.POSITIVE_INFINITY);
    expect(parseNumber("nan")).toBeNaN();
    for (const bad of ["", "e5", "1e", "0x1", "1_0", "1 2", "--1", "1.2.3", "NaN1"]) {
      expect(() => parseNumber(bad), bad).toThrow();
    }
  });

  test("pack writes the bit patterns of IEEE 754", () => {
    expect(hex(pack("1", 64, false))).toBe("3ff0000000000000");
    expect(hex(pack("1", 64, true))).toBe("000000000000f03f");
    expect(hex(pack("-0", 32, false))).toBe("80000000");
    expect(hex(pack("Infinity", 32, false))).toBe("7f800000");
    expect(hex(pack("NaN", 64, false))).toBe("7ff8000000000000");
  });

  test("overflow of written digits is an error, but written Infinity is not", () => {
    expect(() => pack("1e400", 64, false)).toThrow();
    expect(() => pack("3.5e38", 32, false)).toThrow();
    expect(hex(pack("3.4028235e38", 32, false))).toBe("7f7fffff");
  });

  test("unpack gives the shortest round-trip text", () => {
    expect(unpack(bytes("3fb999999999999a"), false)).toBe("0.1");
    expect(unpack(bytes("3dcccccd"), false)).toBe("0.1");
    expect(unpack(bytes("7f7fffff"), false)).toBe("3.4028235e+38");
    expect(unpack(bytes("00000001"), false)).toBe("1e-45");
    expect(unpack(bytes("0000000000000001"), false)).toBe("5e-324");
    expect(unpack(bytes("8000000000000000"), false)).toBe("-0");
  });
});
