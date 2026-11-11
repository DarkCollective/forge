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
 * Tests for the RC2 primitives (src/prims/rc2.ts): the test vectors of RFC 2268 section 5.
 */
import { describe, expect, test } from "vitest";
import { rc2DecryptBlock, rc2EncryptBlock, primitives } from "./rc2.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));

// [key, effective bits, plaintext, ciphertext]: RFC 2268 section 5.
const RFC: [string, number, string, string][] = [
  ["0000000000000000", 63, "0000000000000000", "ebb773f993278eff"],
  ["ffffffffffffffff", 64, "ffffffffffffffff", "278b27e42e2f0d49"],
  ["3000000000000000", 64, "1000000000000001", "30649edf9be7d2c2"],
  ["88", 64, "0000000000000000", "61a8a244adacccf0"],
  ["88bca90e90875a", 64, "0000000000000000", "6ccf4308974c267f"],
  ["88bca90e90875a7f0f79c384627bafb2", 64, "0000000000000000", "1a807d272bbe5db1"],
  ["88bca90e90875a7f0f79c384627bafb2", 128, "0000000000000000", "2269552ab0f85ca6"],
  [
    "88bca90e90875a7f0f79c384627bafb216f80a6f85920584c42fceb0be255daf1e",
    129,
    "0000000000000000",
    "5b78d3a43dfff1f1",
  ],
];

describe("rc2 primitives", () => {
  test("are exported as private helpers", () => {
    expect(primitives.map((p) => p.name)).toEqual([
      "_check-key",
      "_encrypt-block",
      "_decrypt-block",
    ]);
  });

  test.each(RFC)("RFC 2268 section 5: key %s, %i bits", (key, bits, pt, ct) => {
    expect(hex(rc2EncryptBlock(unhex(pt), unhex(key), bits))).toBe(ct);
    expect(hex(rc2DecryptBlock(unhex(ct), unhex(key), bits))).toBe(pt);
  });

  test("the effective bits change the cipher, and bad ones are E_RANGE", () => {
    const pt = new Uint8Array(8);
    const key = unhex("88bca90e90875a7f0f79c384627bafb2");
    expect(hex(rc2EncryptBlock(pt, key, 40))).not.toBe(hex(rc2EncryptBlock(pt, key, 128)));
    expect(() => rc2EncryptBlock(pt, key, 0)).toThrow(/effective/);
    expect(() => rc2EncryptBlock(pt, key, 1025)).toThrow(/effective/);
    expect(() => rc2EncryptBlock(pt, new Uint8Array(0), 64)).toThrow(/1 to 128/);
    expect(() => rc2EncryptBlock(pt, new Uint8Array(129), 64)).toThrow(/1 to 128/);
  });
});
