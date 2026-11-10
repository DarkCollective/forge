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
import { hash, primitives } from "./sha3.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const abc = new TextEncoder().encode("abc");

describe("sha3._hash", () => {
  test("is exported as a private primitive", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_hash"]);
  });

  test("each size gives its digest length", () => {
    const len = { "224": 28, "256": 32, "384": 48, "512": 64 };
    for (const [size, n] of Object.entries(len)) expect(hash(abc, size)).toHaveLength(n);
  });

  test("SHA3-256 of abc (FIPS 202)", () => {
    expect(hex(hash(abc, "256"))).toBe(
      "3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532",
    );
  });

  test("an unknown size is E_RANGE", () => {
    expect(() => hash(abc, "128")).toThrow(/unknown SHA-3 size/);
    expect(() => hash(abc, "toString")).toThrow(/unknown SHA-3 size/);
  });
});
