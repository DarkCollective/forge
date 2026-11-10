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
// Internal vocabularies (INTERNAL_VOCABS) are never catalogue ops, so a recipe cannot name their words.
import { validateRecipe } from "@forge/recipe";
import { describe, expect, test } from "vitest";
import { catalogue } from "./helpers.js";

describe("internal vocabularies", () => {
  test("a recipe that names util:space? is rejected as an unknown operation", () => {
    const result = validateRecipe(
      { forge: 1, steps: [{ kind: "op", op: "util:space?" }] },
      catalogue,
    );
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain("unknown-op");
  });
});
