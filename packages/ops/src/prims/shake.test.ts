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
import { hash, primitives } from "./shake.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const abc = new TextEncoder().encode("abc");

describe("shake._hash", () => {
  test("is exported as a private primitive", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_hash"]);
  });

  test("the output is the requested length in bytes", () => {
    expect(hash(abc, "128", 1)).toHaveLength(1);
    expect(hash(abc, "256", 100)).toHaveLength(100);
  });

  test("a shorter output is a prefix of a longer one", () => {
    expect(hex(hash(abc, "128", 16))).toBe(hex(hash(abc, "128", 32)).slice(0, 32));
  });

  test("SHAKE128 of abc, 16 bytes (FIPS 202, hashlib)", () => {
    expect(hex(hash(abc, "128", 16))).toBe("5881092dd818bf5cf8a3ddb793fbcba7");
  });

  test("a bad variant or length is E_RANGE", () => {
    expect(() => hash(abc, "224", 16)).toThrow(/unknown SHAKE variant/);
    expect(() => hash(abc, "128", 0)).toThrow(/is not 1 to 65536 bytes/);
    expect(() => hash(abc, "128", 65537)).toThrow(/is not 1 to 65536 bytes/);
    expect(() => hash(abc, "128", 1.5)).toThrow(/is not 1 to 65536 bytes/);
  });
});
