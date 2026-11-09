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
import { DEFAULT_LIMITS } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { effectiveLimits } from "./limits.js";
import { UNTRUSTED_LIMITS } from "./types.js";

describe("effectiveLimits", () => {
  test("untrusted defaults are the defaults tightened by UNTRUSTED_LIMITS", () => {
    const l = effectiveLimits("untrusted");
    expect(l.maxSteps).toBe(UNTRUSTED_LIMITS.maxSteps);
    expect(l.maxMillis).toBe(10_000);
    expect(l.maxOutputBytes).toBe(DEFAULT_LIMITS.maxOutputBytes);
    expect(Object.keys(l).sort()).toEqual(Object.keys(DEFAULT_LIMITS).sort());
  });

  test("untrusted callers can only lower", () => {
    const l = effectiveLimits("untrusted", { maxMillis: 50, maxSteps: 1e12, maxDataDepth: 0 });
    expect(l.maxMillis).toBe(50);
    expect(l.maxSteps).toBe(UNTRUSTED_LIMITS.maxSteps);
    expect(l.maxDataDepth).toBe(0);
  });

  test("trusted callers may move either way", () => {
    const l = effectiveLimits("trusted", { maxMillis: 1e9, maxSteps: 5 });
    expect(l.maxMillis).toBe(1e9);
    expect(l.maxSteps).toBe(5);
    expect(l.maxIntBits).toBe(DEFAULT_LIMITS.maxIntBits);
  });

  test("unusable values and unknown fields are ignored", () => {
    const hostile = {
      maxMillis: Number.NaN,
      maxSteps: -1,
      maxDataDepth: "5",
      bogus: 1,
    } as unknown as Record<string, number>;
    for (const trust of ["trusted", "untrusted"] as const) {
      const l = effectiveLimits(trust, hostile);
      expect(l.maxMillis).toBe(trust === "trusted" ? DEFAULT_LIMITS.maxMillis : 10_000);
      expect(l.maxSteps).toBe(trust === "trusted" ? DEFAULT_LIMITS.maxSteps : 5_000_000);
      expect(Object.hasOwn(l, "bogus")).toBe(false);
    }
  });

  test("inherited properties of the caller's object are ignored", () => {
    const l = effectiveLimits("trusted", Object.create({ maxSteps: 3 }) as object);
    expect(l.maxSteps).toBe(DEFAULT_LIMITS.maxSteps);
  });
});
