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
import { lmHash, primitives } from "./lmhash.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

describe("lmhash primitive", () => {
  test("is exported as a private primitive", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_hash"]);
  });

  test("the empty password and PASSWORD (published values)", () => {
    expect(hex(lmHash(new Uint8Array(0)))).toBe("aad3b435b51404eeaad3b435b51404ee");
    expect(hex(lmHash(ascii("PASSWORD")))).toBe("e52cac67419a9a224a3b108f3fa6cb6d");
  });

  test("a password is cut at 14 bytes and the rest is ignored", () => {
    expect(hex(lmHash(ascii("ABCDEFGHIJKLMNOPQRS")))).toBe(hex(lmHash(ascii("ABCDEFGHIJKLMN"))));
  });
});
