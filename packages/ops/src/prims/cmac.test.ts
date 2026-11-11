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
import { cmac, primitives } from "./cmac.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => Number.parseInt(x, 16));
const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return "none";
};

describe("cmac primitive", () => {
  test("is exported as a private primitive", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_mac"]);
  });

  // RFC 4493 section 4: the example with 40 bytes (a partial last block, padded and masked with K2).
  test("RFC 4493 example 3 (40 bytes, AES-128)", () => {
    const m = unhex(
      "6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411",
    );
    expect(hex(cmac(m, unhex("2b7e151628aed2a6abf7158809cf4f3c"), "AES"))).toBe(
      "dfa66747de9ae63030ca32611497c827",
    );
  });

  test("an unknown algorithm and bad key lengths are E_RANGE", () => {
    const m = new Uint8Array(1);
    expect(code(() => cmac(m, new Uint8Array(16), "DES"))).toBe("E_RANGE");
    expect(code(() => cmac(m, new Uint8Array(16), "toString"))).toBe("E_RANGE");
    expect(code(() => cmac(m, new Uint8Array(17), "AES"))).toBe("E_RANGE");
    expect(code(() => cmac(m, new Uint8Array(8), "TDES"))).toBe("E_RANGE");
  });
});
