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
import { hash, primitives } from "./sm3.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const text = (s: string) => new TextEncoder().encode(s);

describe("sm3._hash", () => {
  test("is exported as a private primitive", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_hash"]);
  });

  // draft-sca-cfrg-sm3 Appendix A.1 and A.2 (GB/T 32905-2016 examples 1 and 2).
  test("the two standard examples", () => {
    expect(hex(hash(text("abc")))).toBe(
      "66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0",
    );
    expect(hex(hash(text("abcd".repeat(16))))).toBe(
      "debe9ff92275b8a138604889c18e5a4d6fdb70e5387e5765293dcba39c0c5732",
    );
  });

  // Block-boundary lengths: padding spills into a second block at 56 bytes and up.
  test("padding boundaries are 32 bytes each", () => {
    for (const n of [0, 55, 56, 63, 64, 65, 119, 120])
      expect(hash(new Uint8Array(n))).toHaveLength(32);
  });

  // 64 KiB of (i * 31 + 7) mod 256; the digest was computed with OpenSSL (node's crypto "sm3") and
  // is fixed here.
  test("64 KiB", () => {
    const data = Uint8Array.from({ length: 65536 }, (_, i) => (i * 31 + 7) & 0xff);
    expect(hex(hash(data))).toBe(
      "0e4a2be9b211e58f0dc0320fad99a8d61ebc57410878feea4853afd94b20c80b",
    );
  });
});
