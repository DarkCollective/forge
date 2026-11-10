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
// Issue selection for step cards. WP 3.4 exports the same idea as params/issues.ts; this copy keeps
// the recipe pane independent until both have landed.
import type { RecipeIssue } from "@forge/recipe";
import { CHILD_LIST_KEYS } from "../state/recipe-ops.js";
import type { StepPath } from "../state/recipe-ops.js";

/** Issues at `prefix` or below it. */
export function issuesForPath(issues: readonly RecipeIssue[], prefix: string): RecipeIssue[] {
  return issues.filter((i) => i.path === prefix || i.path.startsWith(prefix + "/"));
}

/** First token after the step path, or "" when the issue is at the step itself. */
function fieldOf(issue: RecipeIssue, stepPath: StepPath): string {
  if (issue.path === stepPath) return "";
  return issue.path.slice(stepPath.length + 1).split("/")[0] as string;
}

/** Issues of this step that are not inside one of its child lists (those belong to the children). */
export function ownIssues(issues: readonly RecipeIssue[], stepPath: StepPath): RecipeIssue[] {
  return issuesForPath(issues, stepPath).filter(
    (i) => !(CHILD_LIST_KEYS as readonly string[]).includes(fieldOf(i, stepPath)),
  );
}

/** Own issues of one field ("split", "pattern", ...); the parameters of an `if` op test are left to the parameter form. */
export function fieldIssues(
  issues: readonly RecipeIssue[],
  stepPath: StepPath,
  field: string,
): RecipeIssue[] {
  return ownIssues(issues, stepPath).filter(
    (i) => fieldOf(i, stepPath) === field && !i.path.startsWith(`${stepPath}/${field}/params`),
  );
}

const FIELDS = new Set([
  "split",
  "join",
  "pattern",
  "flags",
  "encoding",
  "times",
  "until",
  "max",
  "test",
  "note",
  "text",
  "params",
]);

/** Own issues not shown by a field or the parameter form: unknown-op, hash-mismatch, alias-used, ... */
export function stepLevelIssues(issues: readonly RecipeIssue[], stepPath: StepPath): RecipeIssue[] {
  return ownIssues(issues, stepPath).filter((i) => !FIELDS.has(fieldOf(i, stepPath)));
}

export interface IssueCounts {
  readonly errors: number;
  readonly warnings: number;
}

/** Counts for the badge: the step and everything below it. */
export function issueCounts(issues: readonly RecipeIssue[], stepPath: StepPath): IssueCounts {
  let errors = 0;
  let warnings = 0;
  for (const i of issuesForPath(issues, stepPath)) {
    if (i.severity === "error") errors += 1;
    else warnings += 1;
  }
  return { errors, warnings };
}
