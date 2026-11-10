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
 * Tests for the md4 primitive module: the pure function, with RFC 1320 appendix A.5 values.
 */
import { describe, expect, test } from "vitest";
import { md4 } from "./md4.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const enc = (s: string) => new TextEncoder().encode(s);

describe("md4", () => {
  test("RFC 1320 values", () => {
    expect(hex(md4(new Uint8Array()))).toBe("31d6cfe0d16ae931b73c59d7e0c089c0");
    expect(hex(md4(enc("abc")))).toBe("a448017aaf21d8525fc10ae87aa6729d");
  });

  test("does not modify its input, and works on a subarray view", () => {
    const whole = enc("xxabcxx");
    const copy = whole.slice();
    expect(hex(md4(whole.subarray(2, 5)))).toBe("a448017aaf21d8525fc10ae87aa6729d");
    expect(whole).toEqual(copy);
  });
});
