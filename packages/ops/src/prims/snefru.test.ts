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
import { hash, primitives } from "./snefru.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const text = (s: string) => new TextEncoder().encode(s);
const words = (s: string) => s.replace(/\s+/g, "");

// Xerox Snefru 2.5a distribution (testSnefru, correctSnefruOutput, correctSnefru256Output):
// inputs "\n", "1\n", "12\n", ... "123456789\n", 8 passes.
const INPUTS = [
  "",
  "1",
  "12",
  "123",
  "1234",
  "12345",
  "123456",
  "1234567",
  "12345678",
  "123456789",
].map((s) => s + "\n");
const OUT128 = [
  "d9fcb317 1c097fbb a8c8f12a a0906bad",
  "44ec420c e99c1f62 feb66c53 c24ae453",
  "7182051a a852ef6f ba4b6c9c 9b79b317",
  "bc3a50af 82bf56d6 a64732bc 7b050a93",
  "c5b8a049 85a8eadf b4331a89 88752b77",
  "d559a2b6 2f6f4411 1324f852 08723707",
  "6cfb5e8f 1da02bd1 67b01e48 16686c30",
  "29aa4832 5f275a8a 7a01ba15 43c54ba5",
  "be862a6b 68b7df88 7ebe0031 9cbc4a47",
  "6103721c cd8ad565 d68e90b0 f8906163",
];
const OUT256 = [
  "2e02687f 0d45d5b9 b50cb68c 3f33e684 3d618a1a ca2d0689 3d3eb4e3 026b5732",
  "bfea4a05 a2a2ef15 c736d114 598a20b9 d9bd4d66 b661e6b0 5ecf6a77 37bdc58c",
  "ac677d69 761ade3f 189c7aef 106d5fe7 392d324e 19cc76d5 db4a2c05 f2cc2cc5",
  "061c76aa 1db4a22c 0e42945e 26c48499 b5400162 e08c640b e05d3c00 7c44793d",
  "1e87fe1d 9c927e9e 24be85e3 cc733598 73541640 a6261793 ce5a9749 53113f5e",
  "1b59927d 85a9349a 87796620 fe2ff401 a06a7ba4 8794498e bab978ef c3a68912",
  "28e9d9bc 35032b68 faeda881 01ecb252 4317e9da 111b0e3e 70941072 12d9cf72",
  "f7fff4ee 74fd1b8d 6b3267f8 4e47e007 f029d13b 8af7e37e 34d13b46 9b8f248f",
  "ee7d64b0 102b2205 e9892661 3b200185 559d08be 6ad787da 717c9687 44e11af3",
  "4ca72639 e40e9ab9 c0c3f523 c4449b39 11632d37 4c124d77 02192ec2 e4e0b7a3",
];

describe("snefru._hash", () => {
  test("is exported as a private primitive", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_hash"]);
  });

  test("Xerox 2.5a vectors, 8 passes, 128 and 256 bits", () => {
    INPUTS.forEach((s, i) => {
      expect(hex(hash(text(s), "128", "8"))).toBe(words(OUT128[i]!));
      expect(hex(hash(text(s), "256", "8"))).toBe(words(OUT256[i]!));
    });
  });

  // Merkle's distribution, as revised by Rich Salz (comp.sources.unix v21i019, tests.sh): the
  // same algorithm with 2 passes at 128 bits and 4 passes at 256 bits.
  test("comp.sources.unix v21i019 vectors, 2 passes at 128 bits and 4 passes at 256 bits", () => {
    expect(hex(hash(text("\n"), "128", "2"))).toBe("13af7619ab98d4b5f5e0a9e6b26b5452");
    expect(hex(hash(text("1\n"), "128", "2"))).toBe("578c83f88fe1f6a8c119d2ba3a9256c2");
    expect(hex(hash(text("123456789\n"), "128", "2"))).toBe("e699784944ed68a1c762ea1e90c77967");
    expect(hex(hash(text("\n"), "256", "4"))).toBe(
      words("6c504351 ce7f4b7a 93adb29a f9781ff9 2150f157 fee18661 eef511a3 0fc83ddf"),
    );
    expect(hex(hash(text("123456789\n"), "256", "4"))).toBe(
      words("c2242249 1187baaa 94725400 08dffd5b 38f01557 9f3f2390 50969991 fdc1a810"),
    );
  });

  test("a multi-chunk message (the quantum electrodynamics text of testSnefru)", () => {
    const qed =
      "The theory of quantum electrodynamics has now lasted for\n" +
      "more than fifty years, and has been tested more and more\n" +
      "accurately over a wider and wider range of conditions.\n" +
      "At the present time I can proudly say that there is no\n" +
      "significant difference between experiment and theory!\n" +
      "\n" +
      "Just to give you an idea of how the theory has been put\n" +
      "through the wringer, I'll give you some recent numbers:\n" +
      "experiments have Dirac's number at 1.00115965221 (with\n" +
      "an uncertainty of about five times as much). To give you\n" +
      "a feeling for the accuracy of these numbers, it comes\n" +
      "out something like this:  If you were to measure the\n" +
      "distance from Los Angeles to New York to this accuracy,\n" +
      "it would be exact to the thickness of a human hair.\n" +
      "That's how delicately quantum electrodynamics has, in the\n" +
      "past fifty years, been checked -- both theoretically and\n" +
      "experimentally.\n";
    expect(hex(hash(text(qed), "128", "8"))).toBe(words("56ab6bb2 1a7a0789 2d62cb03 c41dde6d"));
    expect(hex(hash(text(qed), "256", "8"))).toBe(
      words("5e8a32ed 1998b611 f5f09696 0c65e820 da93a9a4 24d27151 30c1e454 83f1839c"),
    );
  });

  test("bad size or rounds are rejected", () => {
    expect(() => hash(new Uint8Array(), "64", "8")).toThrow();
    expect(() => hash(new Uint8Array(), "128", "9")).toThrow();
    expect(() => hash(new Uint8Array(), "128", "toString")).toThrow();
  });

  test("64 KiB (regression value)", () => {
    const data = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);
    expect(hex(hash(data, "256", "8"))).toBe(
      "3b28c5bd7d4b609dccb899cd05811bda5ccae35c7e88571e9953078fbe169b1e",
    );
  });
});
