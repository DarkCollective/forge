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
import { hash, primitives } from "./blake3.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const none = new Uint8Array(0);
const elvish = new TextEncoder().encode("whats the Elvish word for friend");

describe("blake3._hash", () => {
  test("is exported as a private primitive", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_hash"]);
  });

  test("the empty input (official BLAKE3 test vector)", () => {
    expect(hex(hash(new Uint8Array(0), 32, none))).toBe(
      "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262",
    );
  });

  test("the keyed empty input (official BLAKE3 test vector)", () => {
    expect(hex(hash(new Uint8Array(0), 32, elvish))).toBe(
      "92b2b75604ed3c761f9d6f62392c8a9227ad0ea3f09573e783f1498a4ed60d26",
    );
  });

  test("an empty key is the unkeyed hash", () => {
    expect(hex(hash(new Uint8Array(0), 32, none))).toBe(
      hex(hash(new Uint8Array(0), 32, new Uint8Array(0))),
    );
  });

  test("a shorter output is a prefix of a longer one", () => {
    const data = Uint8Array.of(0);
    expect(hex(hash(data, 16, none))).toBe(hex(hash(data, 64, none)).slice(0, 32));
  });

  test("a key that is not 32 bytes, or a length out of range, is E_RANGE", () => {
    expect(() => hash(new Uint8Array(0), 32, new Uint8Array(16))).toThrow(/is not 32/);
    expect(() => hash(new Uint8Array(0), 0, none)).toThrow(/is not 1 to 65536 bytes/);
    expect(() => hash(new Uint8Array(0), 65537, none)).toThrow(/is not 1 to 65536 bytes/);
  });
});
