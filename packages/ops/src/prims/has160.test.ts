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
import { hash, primitives } from "./has160.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const text = (s: string) => new TextEncoder().encode(s);

describe("has160._hash", () => {
  test("is exported as a private primitive", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_hash"]);
  });

  test("the empty message and abc", () => {
    expect(hex(hash(text("")))).toBe("307964ef34151d37c8047adec7ab50f4ff89762d");
    expect(hex(hash(text("abc")))).toBe("975e810488cf2a3d49838478124afce4b1c78804");
  });

  test("padding boundaries are 20 bytes each", () => {
    for (const n of [0, 55, 56, 63, 64, 65, 119, 120])
      expect(hash(new Uint8Array(n))).toHaveLength(20);
  });

  // 64 KiB of (i * 31 + 7) mod 256. No independent implementation is available, so this digest
  // was computed by this primitive once the spec vectors passed, and is fixed as a regression value.
  test("64 KiB (regression value)", () => {
    const data = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);
    expect(hex(hash(data))).toBe("af2e9f228abb4e212b62ebff1e4c3242af1ad389");
  });
});
