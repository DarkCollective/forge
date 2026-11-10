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
import { hash, primitives } from "./ripemd160.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const abc = new TextEncoder().encode("abc");

describe("ripemd160._hash", () => {
  test("is exported as a private primitive", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_hash"]);
  });

  test("the digest is 20 bytes", () => {
    expect(hash(abc, "160")).toHaveLength(20);
  });

  test("RIPEMD-160 of abc (paper test vector)", () => {
    expect(hex(hash(abc, "160"))).toBe("8eb208f7e05d987a9b044a8e98c6b087f15a0bfc");
  });

  test("only size 160 exists: other sizes are E_RANGE", () => {
    expect(() => hash(abc, "128")).toThrow(/unknown RIPEMD size/);
    expect(() => hash(abc, "256")).toThrow(/unknown RIPEMD size/);
    expect(() => hash(abc, "toString")).toThrow(/unknown RIPEMD size/);
  });
});
