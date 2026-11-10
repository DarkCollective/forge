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
import { primitives } from "./analysis.js";

const log2 = primitives.find((p) => p.name === "_log2")!.fn as (x: number) => number;

describe("analysis._log2 (the only analysis primitive)", () => {
  test("exact on powers of two, which the entropy vectors rely on", () => {
    expect(log2(1)).toBe(0);
    expect(log2(0.5)).toBe(-1);
    expect(log2(1 / 256)).toBe(-8);
  });
  test("log2 of 3 is within rounding of the known value", () => {
    expect(Math.abs(log2(3) - 1.584962500721156)).toBeLessThan(1e-12);
  });
});
