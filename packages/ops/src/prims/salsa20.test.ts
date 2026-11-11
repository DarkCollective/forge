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
 * Tests for the salsa20 primitive (src/prims/salsa20.ts): the exported private helper and its argument checks. The
 * vectors and the word are tested in src/salsa20.test.ts and vocab/salsa20.test.json.
 */
import { describe, expect, test } from "vitest";
import { crypt, primitives } from "./salsa20.js";

describe("salsa20 primitive", () => {
  test("is exported as the private helper _crypt", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_crypt"]);
  });

  test("checks the key, nonce and counter with E_RANGE", () => {
    expect(() => crypt(new Uint8Array(1), new Uint8Array(20), new Uint8Array(8), 0)).toThrow(
      /16 or 32 bytes/,
    );
    expect(() => crypt(new Uint8Array(1), new Uint8Array(32), new Uint8Array(12), 0)).toThrow(
      /8 bytes/,
    );
    expect(() => crypt(new Uint8Array(1), new Uint8Array(32), new Uint8Array(8), 1.5)).toThrow(
      /whole number/,
    );
  });
});
