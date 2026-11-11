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
 * Tests of the sm2 primitives (src/prims/sm2.ts): the curve parameters (against `openssl ecparam -name SM2
 * -param_enc explicit`), the public key of the GB/T 32918.5 annex example, and the bounds of the arguments.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { SM2_PARAMS, mul, mulBase, order, primitives, validPoint } from "./sm2.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("sm2 primitives", () => {
  test("they are the private helpers of the sm2 words", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_order", "_mul-base", "_mul", "_valid-point"]);
  });

  test("the parameters are those of GB/T 32918.5-2017 (as OpenSSL prints them)", () => {
    expect(SM2_PARAMS.p.toString(16)).toBe(
      "fffffffeffffffffffffffffffffffffffffffff00000000ffffffffffffffff",
    );
    expect(SM2_PARAMS.a).toBe(SM2_PARAMS.p - 3n);
    expect(SM2_PARAMS.b.toString(16)).toBe(
      "28e9fa9e9d9f5e344d5a9e4bcf6509a7f39789f515ab8f92ddbcbd414d940e93",
    );
    expect(SM2_PARAMS.n.toString(16)).toBe(
      "fffffffeffffffffffffffffffffffff7203df6b21c6052b53bbf40939d54123",
    );
    expect(order()).toBe(SM2_PARAMS.n);
    expect(hex(mulBase(unhex("00".repeat(31) + "01")))).toBe(
      "04" +
        "32c4ae2c1f1981195f9904466a39c9948fe30bbff2660be1715a4589334c74c7" +
        "bc3736a2f4f6779c59bdcee36b692153d0a9877cc62a474002df32e52139f0a0",
    );
  });

  test("the annex example: the public key of d, and d times the public key of k is k times that of d", () => {
    const d = unhex("3945208f7b2144b13f36e38ac6d39f95889393692860b51a42fb81ef4df7c5b8");
    const pub = mulBase(d);
    expect(hex(pub)).toBe(
      "0409f9df311e5421a150dd7d161e4bc5c672179fad1833fc076bb08ff356f35020" +
        "ccea490ce26775a52dc6ea718cc1aa600aed05fbf35e084a6632f6072da9ad13",
    );
    const k = unhex("59276e27d506861a16680f3ad9c02dccef3cc1fa3cdbe4ce6d54b80deac1bc21");
    expect(hex(mul(pub, k))).toBe(hex(mul(mulBase(k), d)));
  });

  test("the order minus one is the largest scalar; zero, the order and wrong sizes are E_RANGE", () => {
    const n = SM2_PARAMS.n;
    const b = (v: bigint) => unhex(v.toString(16).padStart(64, "0"));
    expect(mulBase(b(n - 1n))).toHaveLength(65);
    expect(() => mulBase(b(0n))).toThrow(/scalar/);
    expect(() => mulBase(b(n))).toThrow(/scalar/);
    expect(() => mulBase(new Uint8Array(31))).toThrow(/32 bytes/);
    expect(() => mulBase(new Uint8Array(33))).toThrow(/32 bytes/);
  });

  test("points: only 04 || x || y on the curve", () => {
    const pub = mulBase(unhex("00".repeat(31) + "02"));
    expect(validPoint(pub)).toBe(true);
    const off = Uint8Array.from(pub);
    off[64] = (off[64] ?? 0) ^ 1;
    expect(validPoint(off)).toBe(false);
    expect(validPoint(pub.subarray(1))).toBe(false);
    expect(validPoint(new Uint8Array(65))).toBe(false);
    const wrongTag = Uint8Array.from(pub);
    wrongTag[0] = 2;
    expect(validPoint(wrongTag)).toBe(false);
    expect(() => mul(off, unhex("00".repeat(31) + "01"))).toThrow(/not a point/);
  });

  test("it never reads the host's random generator", () => {
    let reads = 0;
    vi.stubGlobal("crypto", {
      getRandomValues: (a: Uint8Array) => {
        reads++;
        return a;
      },
    });
    const pub = mulBase(unhex("00".repeat(31) + "05"));
    mul(pub, unhex("00".repeat(31) + "07"));
    expect(reads).toBe(0);
  });
});
