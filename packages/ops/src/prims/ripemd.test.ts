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
 * Tests for the ripemd primitive module: the pure function, with Bosselaers test values.
 */
import { describe, expect, test } from "vitest";
import { hash } from "./ripemd.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const enc = (s: string) => new TextEncoder().encode(s);

describe("ripemd hash", () => {
  test("abc for each size", () => {
    expect(hex(hash(enc("abc"), "128"))).toBe("c14a12199c66e4ba84636b0f69144c77");
    expect(hex(hash(enc("abc"), "256"))).toBe(
      "afbd6e228b9d8cbbcef5ca2d03e6dba10ac0bc7dcbe4680e1e42d2e975459b65",
    );
    expect(hex(hash(enc("abc"), "320"))).toBe(
      "de4c01b3054f8930a79d09ae738e92301e5a17085beffdc1b8d116713e74f82fa942d64cdbc4682d",
    );
  });

  test("an unknown size raises", () => {
    // 160 is handled by the word, through ripemd160:digest, not by this primitive.
    expect(() => hash(enc("abc"), "160")).toThrow();
    expect(() => hash(enc("abc"), "constructor")).toThrow();
  });
});
