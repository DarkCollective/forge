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
import * as ops from "./index.js";

describe("the main entry (RECIPES 11.5)", () => {
  test("exports exactly the documented values", () => {
    expect(Object.keys(ops).sort()).toEqual([
      "CATALOGUE_FORMAT",
      "CHECKS_FORMAT",
      "CHECKS_MAX_BYTES",
      "HELP_FORMAT",
      "HELP_MAX_BYTES",
      "INTERNAL_VOCABS",
      "REGEX_LIMITS",
      "UI_PARAM_TYPES",
      "assembleRuntime",
      "buildCatalogue",
      "buildChecks",
      "buildHelp",
      "createBundleLoader",
      "execAll",
      "isCatalogueOp",
      "isRegexPrimitive",
      "markRegexPrimitive",
      "scanVocab",
    ]);
  });

  test("has no loader: those are in @forge/ops/node and @forge/ops/vite (R24)", () => {
    expect("loadBundleNode" in ops).toBe(false);
    expect("loadBundleVite" in ops).toBe(false);
    expect("createNodeProvider" in ops).toBe(false);
  });

  test("the functions work from the entry", () => {
    expect(ops.scanVocab([], [])).toEqual({ units: [], vocabs: [] });
    expect(ops.execAll("a", "", "bab")).toHaveLength(1);
    expect(ops.isRegexPrimitive("regex:test")).toBe(false);
    expect(ops.REGEX_LIMITS.maxMatches).toBe(100_000);
  });
});
