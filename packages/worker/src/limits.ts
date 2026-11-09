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
 * The one place bake limits are merged (RECIPES.md section 8.6).
 */
import { DEFAULT_LIMITS } from "@forge/lang";
import type { Limits } from "@forge/lang";
import { UNTRUSTED_LIMITS } from "./types.js";
import type { EffectiveLimitsFn } from "./types.js";

const KEYS = Object.keys(DEFAULT_LIMITS) as (keyof Limits)[];

/** A usable limit: a number that is not NaN and not negative. */
function usable(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value) && value >= 0;
}

/**
 * `"trusted"`: `DEFAULT_LIMITS` overridden by the caller's limits, in either direction.
 * `"untrusted"`: for every field the smaller of `UNTRUSTED_LIMITS` (else the default) and the caller's
 * value, so a caller can only tighten. Unknown fields and unusable values (NaN, negative, not a number)
 * are ignored.
 */
export const effectiveLimits: EffectiveLimitsFn = (trust, limits = {}) => {
  const merged: Record<string, number> = {};
  for (const key of KEYS) {
    const trusted = trust === "trusted";
    const base = trusted ? DEFAULT_LIMITS[key] : (UNTRUSTED_LIMITS[key] ?? DEFAULT_LIMITS[key]);
    const given = Object.hasOwn(limits, key) ? limits[key] : undefined;
    if (!usable(given)) merged[key] = base;
    else merged[key] = trusted ? given : Math.min(base, given);
  }
  return merged as unknown as Limits;
};
