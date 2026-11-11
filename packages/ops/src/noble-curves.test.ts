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
 * Smoke test for the @noble/curves dependency (WP 5.47): the package loads and computes a known public key.
 * No op uses it yet; WP 5.50 and 5.51 import it from their own primitives (see "Wave 7 conventions").
 */
import { describe, expect, test } from "vitest";
import { p256 } from "@noble/curves/nist.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";

const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

describe("@noble/curves", () => {
  test("secp256k1: the public key of the private key 1 is the generator", () => {
    const priv = new Uint8Array(32);
    priv[31] = 1;
    expect(hex(secp256k1.getPublicKey(priv, true))).toBe(
      "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    );
  });

  test("P-256: the public key of the private key 1 is the generator", () => {
    const priv = new Uint8Array(32);
    priv[31] = 1;
    expect(hex(p256.getPublicKey(priv, true))).toBe(
      "036b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296",
    );
  });
});
