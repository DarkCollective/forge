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
import { hash, primitives } from "./streebog.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
// RFC 6986 prints messages and hashes as numbers, most significant byte first; the bytes are
// the reverse.
const rev = (h: string) => (h.match(/../g) ?? []).reverse().join("");
const unhex = (h: string) => Uint8Array.from((h.match(/../g) ?? []).map((b) => parseInt(b, 16)));

// RFC 6986 section 10.1: M1 (63 bytes, "012345678901234567890123456789012345678901234567890123456789012").
const M1 = unhex(
  rev(
    "323130393837363534333231303938373635343332313039383736353433323130393837363534333231303938373635343332313039383736353433323130",
  ),
);
// RFC 6986 section 10.2: M2 (72 bytes).
const M2 = unhex(
  rev(
    "fbe2e5f0eee3c820fbeafaebef20fffbf0e1e0f0f520e0ed20e8ece0ebe5f0f2f120fff0eeec20f120faf2fee5e2202ce8f6f3ede220e8e6eee1e8f0f2d1202ce8f0f2e5e220e5d1",
  ),
);

describe("streebog._hash", () => {
  test("is exported as a private primitive", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_hash"]);
  });

  test("RFC 6986 example 1", () => {
    expect(String.fromCharCode(...M1)).toBe(
      "012345678901234567890123456789012345678901234567890123456789012",
    );
    expect(hex(hash(M1, "512"))).toBe(
      rev(
        "486f64c1917879417fef082b3381a4e211c324f074654c38823a7b76f830ad00fa1fbae42b1285c0352f227524bc9ab16254288dd6863dccd5b9f54a1ad0541b",
      ),
    );
    expect(hex(hash(M1, "256"))).toBe(
      rev("00557be5e584fd52a449b16b0251d05d27f94ab76cbaa6da890b59d8ef1e159d"),
    );
  });

  test("RFC 6986 example 2", () => {
    expect(M2).toHaveLength(72);
    expect(hex(hash(M2, "512"))).toBe(
      rev(
        "28fbc9bada033b1460642bdcddb90c3fb3e56c497ccd0f62b8a2ad4935e85f037613966de4ee00531ae60f3b5a47f8dae06915d5f2f194996fcabf2622e6881e",
      ),
    );
    expect(hex(hash(M2, "256"))).toBe(
      rev("508f7e553c06501d749a66fc28c6cac0b005746d97537fa85d9e40904efed29d"),
    );
  });

  test("an unknown size is rejected", () => {
    expect(() => hash(new Uint8Array(), "384")).toThrow();
  });

  test("lengths around the block size give the digest size", () => {
    for (const n of [0, 1, 63, 64, 65, 127, 128]) {
      expect(hash(new Uint8Array(n), "512")).toHaveLength(64);
      expect(hash(new Uint8Array(n), "256")).toHaveLength(32);
    }
  });

  test("64 KiB (regression value)", () => {
    const data = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);
    expect(hex(hash(data, "256"))).toBe(
      "37afac6100b835e412a9cb43a3ef039376d27d86e59b1718d6697cb902bf6008",
    );
    expect(hex(hash(data, "512"))).toBe(
      "67329da70370c1fe0000669464763201a934d3ad8eccf94a0e881b821a44eb1b8d9f02994f5fc100bff7763638f776ff51994f588f6ddf2958cc6b9b5734ddc1",
    );
  });
});
