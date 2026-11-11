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

/* Tests for the decompression bomb helpers of prim-util.ts (the wave 6 output limit). */
import { describe, expect, test } from "vitest";
import { BoundedOutput, bombFailure } from "./prim-util.js";

describe("BoundedOutput", () => {
  test("joins the chunks in order and counts them", () => {
    const o = new BoundedOutput(10);
    o.push(Uint8Array.of(1, 2));
    o.push(new Uint8Array(0));
    o.push(Uint8Array.of(3));
    expect(o.length).toBe(3);
    expect(Array.from(o.finish())).toEqual([1, 2, 3]);
  });

  test("exactly the cap is fine; the chunk that passes it is E_LIMIT_VALUE and is not kept", () => {
    const o = new BoundedOutput(4);
    o.push(new Uint8Array(4));
    expect(o.length).toBe(4);
    expect(() => o.push(Uint8Array.of(1))).toThrow(/decompressed data of 5 exceeds the limit of 4/);
    expect(o.length).toBe(4);
  });

  test("bombFailure names the limit", () => {
    const e = bombFailure(100, 120);
    expect(e.code).toBe("E_LIMIT_VALUE");
    expect(e.detail).toEqual({ limit: "maxValueBytes", max: 100, value: 120 });
  });
});
