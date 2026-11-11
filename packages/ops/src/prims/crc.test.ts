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
 * Tests of the crc and adler32 primitives themselves. The vocabularies' own tests (src/crc.test.ts,
 * src/adler32.test.ts) hold the presets against a bit-by-bit reference; these check the primitives'
 * values against a bit-by-bit reference and a Python zlib value for the 16 MiB input, the table the
 * bzip2 primitive shares, and the width check.
 */
import { describe, expect, test } from "vitest";
import { adler32 } from "./adler32.js";
import { crcRegister, msbTable, primitives } from "./crc.js";

const text = (s: string) => new TextEncoder().encode(s);

/** The same linear congruential bytes as the Python used for the expected 16 MiB values below. */
function lcgBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  let s = 12345;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    out[i] = (s >>> 16) & 15;
  }
  return out;
}

/** The textbook reflected CRC-32, one bit at a time: the independent reference. */
function bitwiseCrc32(d: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of d) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

const CRC32 = [32, 0x04c11db7n, 0xffffffffn, true, true, 0xffffffffn] as const;
const crc32Of = (d: Uint8Array) =>
  crcRegister(d, CRC32[0], CRC32[1], CRC32[2], CRC32[3], CRC32[4], CRC32[5]);

describe("crc primitive", () => {
  test("is exported as a private helper", () => {
    expect(primitives.map((p) => `${p.vocab}:${p.name}`)).toEqual(["crc:_crc"]);
  });

  test("CRC-32 matches the published check values", () => {
    expect(crc32Of(text("123456789"))).toBe(0xcbf43926n);
    expect(crc32Of(new Uint8Array(0))).toBe(0n);
    expect(crc32Of(text("a"))).toBe(0xe8b7be43n);
    expect(crc32Of(new Uint8Array(32))).toBe(0x190a55adn);
  });

  test("CRC-32 agrees with a bit-by-bit CRC-32 on random lengths", () => {
    for (let n = 0; n < 60; n++) {
      const d = lcgBytes(n * 41);
      expect(crc32Of(d)).toBe(BigInt(bitwiseCrc32(d)));
    }
  });

  test("16 MiB: CRC-32 equals the value Python's zlib gives (0x5abd3c44)", () => {
    expect(crc32Of(lcgBytes(16 * 1024 * 1024))).toBe(0x5abd3c44n);
  }, 60_000);

  test("a width outside 1 to 82 is E_RANGE", () => {
    for (const w of [0, 83, -1]) {
      expect(() => crcRegister(new Uint8Array(1), w, 1n, 0n, true, true, 0n)).toThrow(/CRC width/);
    }
  });

  test("the shared MSB-first table is bzip2's: the first entries of the 0x04c11db7 table", () => {
    const t = msbTable(32, 0x04c11db7);
    expect(Array.from(t.subarray(0, 4), (x) => x.toString(16))).toEqual([
      "0",
      "4c11db7",
      "9823b6e",
      "d4326d9",
    ]);
    expect(t[255]).toBe(0xb1f740b4);
  });
});

describe("adler32 primitive", () => {
  test("matches the published check values", () => {
    expect(adler32(text("123456789"))).toBe(0x091e01de);
    expect(adler32(new Uint8Array(0))).toBe(1);
    expect(adler32(text("Wikipedia"))).toBe(0x11e60398);
  });

  test("a long run of 0xff reduces correctly (zlib's NMAX blocks)", () => {
    // a = 1 + 255 n, b = n + 255 n (n + 1) / 2 reduced mod 65521, for n = 70000
    const n = 70000;
    const a = (1 + 255 * n) % 65521;
    const b = (n + (255 * n * (n + 1)) / 2) % 65521;
    expect(adler32(new Uint8Array(n).fill(255))).toBe(b * 65536 + a);
  });

  test("16 MiB equals the value Python's zlib gives (0x5d8b7081)", () => {
    expect(adler32(lcgBytes(16 * 1024 * 1024))).toBe(0x5d8b7081);
  }, 60_000);
});
