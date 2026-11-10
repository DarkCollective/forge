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
 * Tests for the md2 primitive module: the pure function, with the RFC 1319 appendix A.5 values.
 */
import { describe, expect, test } from "vitest";
import { md2 } from "./md2.js";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const enc = (s: string) => new TextEncoder().encode(s);

describe("md2", () => {
  test("RFC 1319 values", () => {
    expect(hex(md2(new Uint8Array()))).toBe("8350e5a3e24c153df2275c9f80692773");
    expect(hex(md2(enc("abc")))).toBe("da853b0d3f88d99b30283a69e6ded6bb");
  });

  test("does not modify its input", () => {
    const data = enc("message digest");
    const copy = data.slice();
    md2(data);
    expect(data).toEqual(copy);
  });
});
