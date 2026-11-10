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
import { hash, primitives } from "./keccak.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const abc = new TextEncoder().encode("abc");

describe("keccak._hash", () => {
  test("is exported as a private primitive", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_hash"]);
  });

  test("each size gives its digest length", () => {
    const len = { "224": 28, "256": 32, "384": 48, "512": 64 };
    for (const [size, n] of Object.entries(len)) expect(hash(abc, size)).toHaveLength(n);
  });

  test("Keccak-256 of the empty string (original Keccak padding, not SHA3-256)", () => {
    expect(hex(hash(new Uint8Array(), "256"))).toBe(
      "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    );
  });

  test("an unknown size is E_RANGE", () => {
    expect(() => hash(abc, "128")).toThrow(/unknown Keccak size/);
    expect(() => hash(abc, "constructor")).toThrow(/unknown Keccak size/);
  });
});
