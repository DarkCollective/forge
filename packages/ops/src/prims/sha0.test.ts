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
 * Tests for the sha0 primitive module: the pure function, with FIPS 180 (1993) values.
 */
import { describe, expect, test } from "vitest";
import { sha0 } from "./sha0.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const enc = (s: string) => new TextEncoder().encode(s);

describe("sha0", () => {
  test("FIPS 180 value for abc", () => {
    expect(hex(sha0(enc("abc")))).toBe("0164b8a914cd2a5e74c4f7ff082c4d97f1edf880");
  });

  test("differs from SHA-1 (no rotation in the schedule)", () => {
    // SHA-1("abc") is a9993e36..., which SHA-0 must not equal.
    expect(hex(sha0(enc("abc")))).not.toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  });

  test("works on a subarray view", () => {
    const whole = enc("xxabcxx");
    expect(hex(sha0(whole.subarray(2, 5)))).toBe("0164b8a914cd2a5e74c4f7ff082c4d97f1edf880");
  });
});
