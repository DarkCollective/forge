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
import { expect, test } from "vitest";
import * as recipe from "./index.js";

test("the recipe contract constants exist", () => {
  expect(recipe.RECIPE_FORMAT_VERSION).toBe(1);
  expect(recipe.STEP_KINDS).toHaveLength(6);
  expect(recipe.SHARE_LIMITS.maxRecipeBytes).toBe(recipe.RECIPE_LIMITS.maxJsonBytes);
});

test("the package exports exactly what RECIPES.md section 11.5 lists", () => {
  const consts = [
    "RECIPE_FORMAT_VERSION",
    "SHARE_FORMAT_VERSION",
    "STEP_KINDS",
    "RECIPE_LIMITS",
    "SHARE_LIMITS",
    "RECIPE_VOCAB",
    "DEFAULT_RECIPE_WORD",
    "DEFAULT_RECIPE_VOCAB",
    "RECIPE_ISSUE_CODES",
    "SHARE_ERROR_CODES",
  ];
  const functions = [
    "validateRecipe",
    "normaliseRecipe",
    "resolveRecipe",
    "canonicalRecipe",
    "pinRecipe",
    "recipeNeedsHardKill",
    "compileRecipe",
    "resolveStepIps",
    "attributeError",
    "parseRecipeText",
    "encodeShare",
    "decodeShare",
    "escapePointer",
    "unescapePointer",
    "decodeEncoded",
    "encodeBytes",
  ];
  expect(Object.keys(recipe).sort()).toEqual([...consts, ...functions].sort());
  for (const name of functions)
    expect(typeof (recipe as Record<string, unknown>)[name], name).toBe("function");
});

test("the package stays runtime-free", () => {
  expect(Object.keys(recipe)).not.toContain("createRuntime");
});
