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
import { hash, MAX_COST, parse, primitives, verify } from "./bcrypt.js";

const text = (s: string) => new TextEncoder().encode(s);
const ascii = (u: Uint8Array) => String.fromCharCode(...u);

// Known hashes: the published tests of the OpenBSD-derived implementations (crypt_blowfish's
// wrapper.c, jBCrypt and bcryptjs), written from memory; every one is reproduced by this code, which a
// wrong recollection of a 31-character hash could not be. The password, then the full string.
const KNOWN: [string, string][] = [
  ["U*U", "$2a$05$CCCCCCCCCCCCCCCCCCCCC.E5YPO9kmyuRGyh0XouQYb4YMJKvyOeW"],
  ["U*U*", "$2a$05$CCCCCCCCCCCCCCCCCCCCC.VGOzA784oUp/Z0DY336zx7pLYAy0lwK"],
  ["U*U*U", "$2a$05$XXXXXXXXXXXXXXXXXXXXXOAcXxm9kjPGEMsLznoKqmqw7tc8WCx4a"],
  ["", "$2a$05$CCCCCCCCCCCCCCCCCCCCC.7uG0VCzI2bS7j6ymqJi9CdcdxiRTWNy"],
  ["", "$2a$06$DCq7YPn5Rq63x1Lad4cll.TV4S6ytwfsfvkgY8jIucDrjc8deX1s."],
  ["a", "$2a$06$m0CrhHm10qJ3lXRY.5zDGO3rS2KdeeWLuGmsfGlMfOxih58VYVfxe"],
  ["abc", "$2a$06$If6bvum7DFjUnE9p2uDeDu0YHzrHM6tf.iqN8.yx.jNN1ILEf7h0i"],
];

describe("bcrypt primitives", () => {
  test("are exported as private primitives", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_hash", "_verify", "_parse"]);
  });

  test.each(KNOWN)("verify %j against a published hash", (pw, h) => {
    expect(verify(text(pw), h)).toBe(true);
    expect(verify(text(pw + "x"), h)).toBe(false);
  });

  test("hash writes the version prefix, and the three versions give one hash", () => {
    const salt = new Uint8Array(16).fill(7);
    const b = ascii(hash(text("U*U"), salt, 5, "2b"));
    expect(b.slice(0, 7)).toBe("$2b$05$");
    expect(b.length).toBe(60);
    expect(ascii(hash(text("U*U"), salt, 5, "2a"))).toBe(`$2a$${b.slice(4)}`);
    expect(ascii(hash(text("U*U"), salt, 5, "2y"))).toBe(`$2y$${b.slice(4)}`);
    expect(verify(text("U*U"), b)).toBe(true);
  });

  test("passwords are cut at 72 bytes (with the terminating zero in the key)", () => {
    const long =
      "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789chars after 72 are ignored";
    expect(verify(text(long), "$2a$05$abcdefghijklmnopqrstuu5s2v8.iXieOjg/.AySBTTZIIVFJeBui")).toBe(
      true,
    );
    // 71 bytes plus the zero is the whole key; 72 bytes and more all give the same hash.
    const s = new Uint8Array(16);
    expect(ascii(hash(text("a".repeat(72)), s, 4, "2b"))).toBe(
      ascii(hash(text("a".repeat(100)), s, 4, "2b")),
    );
    expect(ascii(hash(text("a".repeat(71)), s, 4, "2b"))).not.toBe(
      ascii(hash(text("a".repeat(72)), s, 4, "2b")),
    );
  });

  test("a hash made by Apache htpasswd (a $2y$ string with a random salt, OpenBSD bcrypt) verifies", () => {
    // htpasswd -nbB -C 6 u 'pässword' on macOS.
    expect(
      verify(text("pässword"), "$2y$06$Xw2YPGW9fJcNET0YmsaCneayA0tLJhC5lmt9WLIURGJ0SjmbUwhz6"),
    ).toBe(true);
  });

  test("parse reports the parts", () => {
    expect(parse(KNOWN[5]![1])).toBe(
      "Rounds: 6\nSalt: $2a$06$m0CrhHm10qJ3lXRY.5zDGO\nPassword hash: 3rS2KdeeWLuGmsfGlMfOxih58VYVfxe\nFull hash: $2a$06$m0CrhHm10qJ3lXRY.5zDGO3rS2KdeeWLuGmsfGlMfOxih58VYVfxe",
    );
  });

  test("malformed strings are E_COERCE, costs outside 4 to the cap are E_RANGE", () => {
    const code = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return (e as { code?: string }).code;
      }
      return "none";
    };
    expect(code(() => verify(text("a"), "nope"))).toBe("E_COERCE");
    expect(code(() => parse("$2x$05$CCCCCCCCCCCCCCCCCCCCC.7uG0VCzI2bS7j6ymqJi9CdcdxiRTWNy"))).toBe(
      "E_COERCE",
    );
    expect(code(() => parse("$2a$03$CCCCCCCCCCCCCCCCCCCCC.7uG0VCzI2bS7j6ymqJi9CdcdxiRTWNy"))).toBe(
      "E_COERCE",
    );
    expect(
      code(() =>
        verify(
          text("a"),
          `$2a$${MAX_COST + 1}$CCCCCCCCCCCCCCCCCCCCC.7uG0VCzI2bS7j6ymqJi9CdcdxiRTWNy`,
        ),
      ),
    ).toBe("E_RANGE");
    expect(code(() => hash(text("a"), new Uint8Array(16), 3, "2b"))).toBe("E_RANGE");
    expect(code(() => hash(text("a"), new Uint8Array(16), MAX_COST + 1, "2b"))).toBe("E_RANGE");
    expect(code(() => hash(text("a"), new Uint8Array(15), 4, "2b"))).toBe("E_RANGE");
    expect(code(() => hash(text("a"), new Uint8Array(16), 4, "2x"))).toBe("E_RANGE");
  });
});
