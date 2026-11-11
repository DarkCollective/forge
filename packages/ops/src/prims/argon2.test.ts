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
import { derive, primitives, tag, verify } from "./argon2.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const text = (s: string) => new TextEncoder().encode(s);
const ascii = (u: Uint8Array) => String.fromCharCode(...u);

describe("argon2 primitives", () => {
  test("are exported as private primitives", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_derive", "_verify"]);
  });

  // RFC 9106 section 5: password 32 x 0x01, salt 16 x 0x02, secret 8 x 0x03, associated data 12 x 0x04,
  // t = 3, m = 32 KiB, p = 4, tag length 32. The word argon2:derive has no secret or associated data
  // (CyberChef has none), so these run on the tag function that the word is built on.
  describe("RFC 9106 section 5 test vectors", () => {
    const password = new Uint8Array(32).fill(1);
    const salt = new Uint8Array(16).fill(2);
    const secret = new Uint8Array(8).fill(3);
    const ad = new Uint8Array(12).fill(4);
    const q = { version: 0x13, t: 3, m: 32, p: 4, length: 32, secret, ad };
    test.each([
      ["argon2d", "512b391b6f1162975371d30919734294f868e3be3984f3c1a13a4db9fabe4acb"],
      ["argon2i", "c814d9d1dc7f37aa13f0d77f2494bda1c8de6b016dd388d29952a4c4672b6ce8"],
      ["argon2id", "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659"],
    ])("%s", (type, want) => {
      expect(hex(tag(password, salt, { ...q, type }))).toBe(want);
    });
  });

  test("the encoded string is the PHC form and verifies, for every type", () => {
    const salt = text("saltsalt");
    for (const type of ["argon2d", "argon2i", "argon2id"]) {
      const enc = ascii(derive(text("pw"), salt, 2, 64, 2, 24, type, true));
      expect(enc).toMatch(
        new RegExp(`^\\$${type}\\$v=19\\$m=64,t=2,p=2\\$c2FsdHNhbHQ\\$[A-Za-z0-9+/]{32}$`),
      );
      expect(verify(text("pw"), enc)).toBe(true);
      expect(verify(text("pW"), enc)).toBe(false);
    }
  });

  test("the raw output is the hash of the encoded form", () => {
    const salt = text("saltsalt");
    const raw = derive(text("pw"), salt, 1, 8, 1, 16, "argon2id", false);
    expect(raw).toHaveLength(16);
    expect(ascii(derive(text("pw"), salt, 1, 8, 1, 16, "argon2id", true))).toMatch(/^\$argon2id\$/);
  });

  test("the encoded hash of a salt and hash whose lengths are not multiples of 3", () => {
    const enc = ascii(derive(text("pw"), text("salt12345"), 1, 8, 1, 17, "argon2i", true));
    expect(verify(text("pw"), enc)).toBe(true);
  });

  test("caps raise E_RANGE", () => {
    const d = (t: number, m: number, p: number, len: number, salt = "saltsalt") =>
      derive(text("pw"), text(salt), t, m, p, len, "argon2i", false);
    expect(() => d(1, 262145, 1, 32)).toThrow(/memory/);
    expect(() => d(5, 262144, 1, 32)).toThrow(/memory \* iterations/);
    expect(() => d(65, 8, 1, 32)).toThrow(/iterations/);
    expect(() => d(0, 8, 1, 32)).toThrow(/iterations/);
    expect(() => d(1, 8, 65, 32)).toThrow(/parallelism/);
    expect(() => d(1, 16, 4, 32)).toThrow(/8 \* parallelism/);
    expect(() => d(1, 8, 1, 3)).toThrow(/hash length/);
    expect(() => d(1, 8, 1, 1025)).toThrow(/hash length/);
    expect(() => d(1, 8, 1, 32, "short")).toThrow(/salt/);
    expect(() => d(1.5, 8, 1, 32)).toThrow(/iterations/);
    expect(() => derive(text("pw"), text("saltsalt"), 1, 8, 1, 32, "toString", false)).toThrow(
      /unknown Argon2 type/,
    );
  });

  test("a malformed encoded string is E_COERCE, a cost over the cap E_RANGE", () => {
    const ok = "$argon2i$v=19$m=8,t=1,p=1$c2FsdHNhbHQ$AAAAAAAAAAAAAAAAAAAAAA";
    expect(() => verify(text("pw"), "")).toThrow(/cannot convert/);
    expect(() => verify(text("pw"), ok.replace("$v=19", "$v=18"))).toThrow(/version/);
    expect(() => verify(text("pw"), ok.replace("c2FsdHNhbHQ", "c2FsdA"))).toThrow(/salt/);
    expect(() => verify(text("pw"), ok.replace("m=8", "m=99999999999"))).toThrow(/cannot convert/);
    expect(() => verify(text("pw"), "$".repeat(5000))).toThrow(/cannot convert/);
    expect(() => verify(text("pw"), ok.replace("m=8", "m=999999999"))).toThrow(/memory/);
    expect(() => verify(text("pw"), ok.replace("c2FsdHNhbHQ", "c2FsdHNhbHQ="))).toThrow(
      /cannot convert/,
    );
  });
});
