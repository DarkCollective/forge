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
import { crcs, primitives } from "./generate-all.js";

const enc = (s: string) => new TextEncoder().encode(s);

// Check values of 123456789 from the reveng CRC catalogue (Greg Cook), one line per preset:
// name width poly init refin refout xorout.
const CHECK: [string, string, string][] = [
  ["CRC-3/GSM 3 3 0 F F 7", "4", "CRC-3/GSM"],
  ["CRC-3/ROHC 3 3 7 T T 0", "6", "CRC-3/ROHC"],
  ["CRC-5/USB 5 05 1F T T 1F", "19", "CRC-5/USB"],
  ["CRC-8 8 07 00 F F 00", "f4", "CRC-8"],
  ["CRC-12/3GPP 12 80F 000 F T 000", "daf", "CRC-12/3GPP (refin and refout differ)"],
  ["CRC-16/XMODEM 16 1021 0000 F F 0000", "31c3", "CRC-16/XMODEM"],
  ["CRC-16/ARC 16 8005 0000 T T 0000", "bb3d", "CRC-16/ARC"],
  ["CRC-24/OPENPGP 24 864CFB B704CE F F 000000", "21cf02", "CRC-24/OPENPGP"],
  ["CRC-32 32 04C11DB7 FFFFFFFF T T FFFFFFFF", "cbf43926", "CRC-32"],
  ["CRC-32/MPEG-2 32 04C11DB7 FFFFFFFF F F 00000000", "0376e6e7", "CRC-32/MPEG-2"],
  ["CRC-40/GSM 40 0004820009 0000000000 F F FFFFFFFFFF", "d4164fc646", "CRC-40/GSM"],
  [
    "CRC-64/XZ 64 42F0E1EBA9EA3693 FFFFFFFFFFFFFFFF T T FFFFFFFFFFFFFFFF",
    "995dc9bbdf1939fa",
    "CRC-64/XZ",
  ],
  [
    "CRC-64/ECMA-182 64 42F0E1EBA9EA3693 0000000000000000 F F 0000000000000000",
    "6c40df5f0b497347",
    "CRC-64/ECMA-182",
  ],
  [
    "CRC-82/DARC 82 0308C0111011401440411 000000000000000000000 T T 000000000000000000000",
    "09ea83f625023801fd612",
    "CRC-82/DARC",
  ],
];

describe("generate-all._crcs", () => {
  test("is exported as a private primitive", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_crcs"]);
  });

  for (const [line, check, name] of CHECK) {
    test(`${name} gives the catalogue check value of 123456789`, () => {
      expect(crcs(enc("123456789"), line)).toBe(
        check.padStart(Math.ceil(Number(line.split(" ")[1]) / 4), "0"),
      );
    });
  }

  test("one value per line, in order, and empty lines are skipped", () => {
    const lines = `${CHECK[3]![0]}\n\n${CHECK[8]![0]}\n`;
    expect(crcs(enc("123456789"), lines)).toBe("f4\ncbf43926");
  });

  test("presets with the same parameters give the same value", () => {
    expect(
      crcs(
        enc("abc"),
        "A 32 04C11DB7 FFFFFFFF T T FFFFFFFF\nB 32 04C11DB7 FFFFFFFF T T FFFFFFFF",
      ).split("\n"),
    ).toHaveLength(2);
    const v = crcs(enc("abc"), "A 16 1021 0000 F F 0000\nB 16 1021 0000 F F 0000").split("\n");
    expect(v[0]).toBe(v[1]);
  });

  test("an empty input gives the init value xored with xorout", () => {
    expect(crcs(new Uint8Array(), "CRC-32 32 04C11DB7 FFFFFFFF T T FFFFFFFF")).toBe("00000000");
    expect(crcs(new Uint8Array(), "CRC-16/XMODEM 16 1021 0000 F F 0000")).toBe("0000");
  });

  test("a line with the wrong number of fields or a width out of range is E_COERCE", () => {
    expect(() => crcs(enc("a"), "CRC-32 32 04C11DB7")).toThrowError(/bad preset line/);
    expect(() => crcs(enc("a"), "X 0 1 0 F F 0")).toThrowError(/bad width/);
    expect(() => crcs(enc("a"), "X 83 1 0 F F 0")).toThrowError(/bad width/);
  });
});
