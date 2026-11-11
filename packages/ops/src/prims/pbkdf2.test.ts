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
import { MAX_KEY, MAX_WORK, derive, primitives } from "./pbkdf2.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const text = (s: string) => new TextEncoder().encode(s);

describe("pbkdf2._derive", () => {
  test("is exported as a private primitive", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_derive"]);
  });

  test("RFC 6070 test vector 1 (SHA-1)", () => {
    expect(hex(derive(text("password"), text("salt"), 20, 1, "sha1"))).toBe(
      "0c60c80f961f0e71f3a9b524af6012062fe037a6",
    );
  });

  test("a key longer than one block continues the block counter", () => {
    const long = derive(text("password"), text("salt"), 40, 2, "sha1");
    expect(hex(long.subarray(0, 20))).toBe("ea6c014dc72d6f8ccd1ed92ace1d41f0d8de8957");
    expect(long).toHaveLength(40);
  });

  test("each hash gives the key size asked for", () => {
    for (const h of ["sha1", "sha256", "sha384", "sha512", "md5"]) {
      expect(derive(text("p"), text("s"), 7, 3, h)).toHaveLength(7);
    }
  });

  test("the caps are E_RANGE", () => {
    expect(() => derive(text("p"), text("s"), 16, 1, "sha3")).toThrow(/unknown PBKDF2 hash/);
    expect(() => derive(text("p"), text("s"), 16, 1, "toString")).toThrow(/unknown PBKDF2 hash/);
    expect(() => derive(text("p"), text("s"), 0, 1, "sha1")).toThrow(/key size/);
    expect(() => derive(text("p"), text("s"), MAX_KEY + 1, 1, "sha1")).toThrow(/key size/);
    expect(() => derive(text("p"), text("s"), 16, 0, "sha1")).toThrow(/iteration/);
    expect(() => derive(text("p"), text("s"), 16, 1.5, "sha1")).toThrow(/iteration/);
    expect(() => derive(text("p"), text("s"), 16, MAX_WORK + 1, "sha1")).toThrow(/limit/);
    // 1024 bytes is 52 SHA-1 blocks; one more iteration than the cap allows for them.
    expect(() => derive(text("p"), text("s"), 1024, Math.floor(MAX_WORK / 52) + 1, "sha1")).toThrow(
      /limit/,
    );
  });
});
