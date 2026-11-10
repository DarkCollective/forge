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
import { primitives } from "./cobs.js";

const starts = primitives.find((p) => p.name === "_starts")!.fn as (
  d: Uint8Array,
) => { v: number }[];
const offsets = (d: number[]) => starts(Uint8Array.from(d)).map((x) => x.v);

describe("cobs._starts", () => {
  test("lists the offset of each block", () => {
    expect(offsets([])).toEqual([]);
    expect(offsets([1])).toEqual([0]);
    expect(offsets([3, 0x11, 0x22, 2, 0x33])).toEqual([0, 3]);
    expect(offsets([1, 1, 1, 1])).toEqual([0, 1, 2, 3]);
  });

  test("a zero code or a block that runs past the end is E_COERCE", () => {
    expect(() => starts(Uint8Array.from([1, 0]))).toThrow(/zero byte/);
    expect(() => starts(Uint8Array.from([3, 1]))).toThrow(/truncated/);
    expect(() => starts(Uint8Array.from([255, 1, 2]))).toThrow(/truncated/);
  });
});
