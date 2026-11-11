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
 * Tests for the chacha primitive (src/prims/chacha.ts): the exported private helper and its argument checks. The
 * vectors and the word are tested in src/chacha.test.ts and vocab/chacha.test.json.
 */
import { describe, expect, test } from "vitest";
import { crypt, primitives } from "./chacha.js";

describe("chacha primitive", () => {
  test("is exported as the private helper _crypt", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_crypt"]);
  });

  test("checks the key, nonce, counter and rounds with E_RANGE", () => {
    const k = new Uint8Array(32);
    const n = new Uint8Array(12);
    expect(() => crypt(new Uint8Array(1), new Uint8Array(15), n, 0, "20")).toThrow(
      /16 or 32 bytes/,
    );
    expect(() => crypt(new Uint8Array(1), k, new Uint8Array(10), 0, "20")).toThrow(/8 or 12 bytes/);
    expect(() => crypt(new Uint8Array(1), k, n, -1, "20")).toThrow(/whole number/);
    expect(() => crypt(new Uint8Array(1), k, n, 0, "7")).toThrow(/20, 12 or 8/);
    expect(() => crypt(new Uint8Array(1), new Uint8Array(16), n, 0, "20")).toThrow(/32-byte key/);
  });
});
