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
import { hash, primitives } from "./gost.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const text = (s: string) => new TextEncoder().encode(s);
// RFC 5831 prints a hash as a number, most significant byte first; the digest bytes are the
// reverse (little-endian).
const rev = (h: string) => (h.match(/../g) ?? []).reverse().join("");

describe("gost._hash", () => {
  test("is exported as a private primitive", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_hash"]);
  });

  // RFC 5831 section 7.3.1 and 7.3.2 (test S-box set).
  test("the two RFC 5831 examples", () => {
    expect(hex(hash(text("This is message, length=32 bytes"), "test"))).toBe(
      rev("faff37a615a816691cff3ef8b68ca247e09525f39f8119832eb81975d366c4b1"),
    );
    expect(hex(hash(text("Suppose the original message has length = 50 bytes"), "test"))).toBe(
      rev("0852f5623b89dd57aeb4781fe54df14eeafbc1350613763a0d770aa657ba1a47"),
    );
  });

  // The CryptoPro S-box has no RFC 5831 example; these are the published digests for it
  // (Wikipedia, "GOST (hash function)", CryptoPro parameter examples).
  test("CryptoPro S-box published digests", () => {
    expect(hex(hash(text(""), "cryptopro"))).toBe(
      "981e5f3ca30c841487830f84fb433e13ac1101569b9c13584ac483234cd656c0",
    );
    expect(hex(hash(text("abc"), "cryptopro"))).toBe(
      "b285056dbf18d7392d7677369524dd14747459ed8143997e163b2986f92fd42c",
    );
  });

  test("test S-box published digest of the empty message", () => {
    expect(hex(hash(text(""), "test"))).toBe(
      "ce85b99cc46752fffee35cab9a7b0278abb4c2d2055cff685af4912c49490f8d",
    );
  });

  test("one million 'a' (published digests for both S-boxes)", () => {
    const data = new Uint8Array(1_000_000).fill(0x61);
    expect(hex(hash(data, "test"))).toBe(
      "5c00ccc2734cdd3332d3d4749576e3c1a7dbaf0e7ea74e9fa602413c90a129fa",
    );
    expect(hex(hash(data, "cryptopro"))).toBe(
      "8693287aa62f9478f7cb312ec0866b6c4e4a0f11160441e8f4ffcd2715dd554f",
    );
  });

  test("an unknown S-box is rejected", () => {
    expect(() => hash(new Uint8Array(), "toString")).toThrow();
  });

  test("the two S-boxes differ", () => {
    expect(hex(hash(text("abc"), "test"))).not.toBe(hex(hash(text("abc"), "cryptopro")));
  });

  test("lengths around the block size are 32 bytes each", () => {
    for (const n of [0, 1, 31, 32, 33, 64, 65])
      expect(hash(new Uint8Array(n), "test")).toHaveLength(32);
  });

  test("64 KiB (regression value)", () => {
    const data = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);
    expect(hex(hash(data, "test"))).toBe(
      "2195a25eb416cd2002f5002b5bb1adadf7e08021924f672a00beac094ac09fdc",
    );
  });
});
