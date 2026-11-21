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

/** "/steps/1/then/0" becomes "2.1" (the display number of a step, as the recipe pane shows it). */
function stepNo(path: unknown): string {
  if (typeof path !== "string") return "?";
  const parts = path
    .split("/")
    .filter((t) => /^[0-9]+$/.test(t))
    .map((t) => String(Number(t) + 1));
  return parts.length === 0 ? "?" : parts.join(".");
}

const KIND_WORDS: Readonly<Record<string, string>> = {
  fork: "Fork",
  subsection: "Subsection",
  repeat: "Repeat",
  register: "Register",
  if: "If",
};

/**
 * The text to show for an issue. The register and return codes of RECIPES-1.1.md section 4.3 get plain
 * English that says what to do (the validator's own message is the fallback, and the only text for every
 * other code). The result is always rendered as text.
 */
export function describeIssue(issue: RecipeIssue): string {
  const d = issue.detail ?? {};
  const name = typeof d["register"] === "string" ? d["register"] : "";
  switch (issue.code) {
    case "unknown-register":
      switch (d["reason"]) {
        case "not-defined":
          return `There is no register named "${name}". Add a Register block above this step, or switch this parameter back to a value.`;
        case "not-yet-defined":
          return `The register "${name}" is defined later in the recipe, or is the one being computed here, so it has no value yet. Move its Register block above this step.`;
        case "out-of-scope":
          return `The register "${name}" is defined inside a block that this step is not part of. A register can be used only by the steps after it in its own list, and by the blocks inside those steps.`;
        case "disabled":
          return `The register "${name}" is defined only by a disabled step. Enable that Register block, or choose another register.`;
        default:
          return `This step uses a register "${name}" that is not available here.`;
      }
    case "duplicate-register":
      return `A register named "${name}" already exists here (step ${stepNo(d["first"])}). Give this one another name.`;
    case "bad-position": {
      const kind =
        typeof d["containerKind"] === "string"
          ? (KIND_WORDS[d["containerKind"]] ?? d["containerKind"])
          : "block";
      return `A Return can only go at the top of the recipe or inside the branches of an If. This one is inside ${kind === "block" ? "a block" : `the ${kind} step ${stepNo(d["container"])}`}, so move it out.`;
    }
    case "unreachable-step":
      return `This step never runs: the Return at step ${stepNo(d["after"])} ends the recipe first. Move it above the Return, or remove it.`;
    default:
      return issue.message;
  }
}
