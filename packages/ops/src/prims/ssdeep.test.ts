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
import { pieces, primitives } from "./ssdeep.js";

const enc = (s: string) => new TextEncoder().encode(s);

describe("ssdeep._pieces", () => {
  test("is exported as a private primitive", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_pieces"]);
  });

  // python-ssdeep README: both strings have block size 3 (they are short), so one pass at 3.
  test("one pass at block size 3 of the python-ssdeep README text", () => {
    expect(
      pieces(enc("Also called fuzzy hashes, Ctph can match inputs that have homologies."), 3),
    ).toEqual(["AXGBicFlgVNhBGcL6wCrFQEv", "AXGHsNhxLsr2C", expect.any(Number)]);
  });

  test("no data gives two empty hashes", () => {
    expect(pieces(new Uint8Array(), 3)).toEqual(["", "", 0]);
  });

  test("all-zero data never triggers and ends with a zero rolling hash, so both hashes are empty", () => {
    expect(pieces(new Uint8Array(1000), 3)).toEqual(["", "", 0]);
  });

  test("the hashes are limited to 64 and 32 characters", () => {
    let x = 7;
    const data = Uint8Array.from(
      { length: 20000 },
      () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0), x >>> 16) & 0xff,
    );
    const [a, b, j] = pieces(data, 3);
    expect(a).toHaveLength(64);
    expect(b).toHaveLength(32);
    expect(j).toBe(63);
  });

  test("the hash alphabet is base 64", () => {
    let x = 99;
    const data = Uint8Array.from(
      { length: 5000 },
      () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0), x >>> 16) & 0xff,
    );
    const [a, b] = pieces(data, 12);
    expect(a + b).toMatch(/^[A-Za-z0-9+/]+$/);
  });
});
