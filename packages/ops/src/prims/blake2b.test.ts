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
import { hash, primitives } from "./blake2b.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const abc = new TextEncoder().encode("abc");
const none = new Uint8Array(0);

describe("blake2b._hash", () => {
  test("is exported as a private primitive", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_hash"]);
  });

  test("BLAKE2b-512 of abc (RFC 7693 appendix A)", () => {
    expect(hex(hash(abc, 64, none))).toBe(
      "ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923",
    );
  });

  test("an empty key is the unkeyed hash", () => {
    expect(hex(hash(abc, 32, none))).toBe(hex(hash(abc, 32, new Uint8Array(0))));
    expect(hex(hash(abc, 32, none))).not.toBe(hex(hash(abc, 32, Uint8Array.of(1))));
  });

  test("a size outside 1 to 64 is E_RANGE", () => {
    expect(() => hash(abc, 0, none)).toThrow(/BLAKE2b output size 0/);
    expect(() => hash(abc, 65, none)).toThrow(/BLAKE2b output size 65/);
  });

  test("a key over 64 bytes is E_RANGE", () => {
    expect(() => hash(abc, 32, new Uint8Array(65))).toThrow(/over 64/);
  });
});
