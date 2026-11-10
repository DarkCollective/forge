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
import { hash, primitives } from "./blake2s.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const abc = new TextEncoder().encode("abc");
const none = new Uint8Array(0);

describe("blake2s._hash", () => {
  test("is exported as a private primitive", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_hash"]);
  });

  test("BLAKE2s-256 of abc (RFC 7693 appendix B)", () => {
    expect(hex(hash(abc, 32, none))).toBe(
      "508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982",
    );
  });

  test("an empty key is the unkeyed hash", () => {
    expect(hex(hash(abc, 16, none))).toBe(hex(hash(abc, 16, new Uint8Array(0))));
  });

  test("a size outside 1 to 32 is E_RANGE", () => {
    expect(() => hash(abc, 0, none)).toThrow(/BLAKE2s output size 0/);
    expect(() => hash(abc, 33, none)).toThrow(/BLAKE2s output size 33/);
  });

  test("a key over 32 bytes is E_RANGE", () => {
    expect(() => hash(abc, 32, new Uint8Array(33))).toThrow(/over 32/);
  });
});
