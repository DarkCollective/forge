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
// Mapping of validator issues (`state.issues`, RECIPES.md section 3.7) to form fields. The paths are
// RFC 6901 pointers, the same ones the recipe pane uses for step cards.
import type { RecipeIssue } from "@forge/recipe";

/** `~` -> `~0`, `/` -> `~1` (RFC 6901). */
export function escapePointer(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Issues at `pathPrefix` itself or anywhere below it (`/steps/1` matches `/steps/1/params/x`, not `/steps/10`). */
export function issuesForPath(
  issues: readonly RecipeIssue[],
  pathPrefix: string,
): readonly RecipeIssue[] {
  return issues.filter((i) => i.path === pathPrefix || i.path.startsWith(`${pathPrefix}/`));
}

/**
 * Issues of one parameter of an op-like node: `<nodePath>/params/<name>` and below
 * (`.../value`, `.../enc` for encoded values), including `missing-param` at the same path.
 */
export function paramIssues(
  issues: readonly RecipeIssue[],
  nodePath: string,
  name: string,
): readonly RecipeIssue[] {
  return issuesForPath(issues, `${nodePath}/params/${escapePointer(name)}`);
}
