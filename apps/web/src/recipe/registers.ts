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
// Pure helpers of the recipe pane for registers and returns (RECIPES-1.1.md sections 2.2 to 2.4, 3.2):
// where a new block goes, and what renaming a register does to the references to it.
import { REGISTER_NAME_RE, isRegisterRef, registersInScope } from "@forge/recipe";
import type { Recipe, Step } from "@forge/recipe";
import {
  canPlace,
  childLists,
  childPath,
  getStep,
  patchStep,
  setParam,
  splitStepPath,
} from "../state/recipe-ops.js";
import type { ListPath, StepPath } from "../state/recipe-ops.js";
import { ownerOfList } from "./paths.js";

export interface Placement {
  readonly listPath: ListPath;
  readonly index: number;
}

/**
 * Where "Add block" puts `step`: right after the selected step, in its list; at the end of the root list
 * when nothing is selected. When that list does not allow the step (a `return` inside a fork, say), it
 * climbs to the nearest enclosing list that does, and goes right after the block that holds the selection.
 */
export function blockPlacement(recipe: Recipe, selected: StepPath | null, step: Step): Placement {
  if (selected === null || getStep(recipe, selected) === undefined) {
    return { listPath: "/steps", index: recipe.steps.length };
  }
  let at = splitStepPath(selected);
  for (;;) {
    if (canPlace(step, at.listPath)) return { listPath: at.listPath, index: at.index + 1 };
    const owner = ownerOfList(at.listPath);
    if (owner === null) return { listPath: "/steps", index: recipe.steps.length };
    at = splitStepPath(owner);
  }
}

/** True when `name` is a valid register name. */
export function validRegisterName(name: string): boolean {
  return REGISTER_NAME_RE.test(name);
}

/** The message under the name field for a name that does not fit the pattern; "" when it does. */
export function registerNameProblem(name: string): string {
  if (name === "") return "A register needs a name.";
  if (name.length > 32) return "Use at most 32 characters.";
  if (!validRegisterName(name)) {
    return "Start with a lower-case letter, then use lower-case letters, digits and hyphens.";
  }
  return "";
}

/** Paths of every op-like node (an op step, or the op test of an if) with the parameters that are references. */
function refNodes(recipe: Recipe): { nodePath: string; params: string[]; name: string }[] {
  const found: { nodePath: string; params: string[]; name: string }[] = [];
  const todo: { steps: readonly Step[]; path: ListPath }[] = [
    { steps: recipe.steps, path: "/steps" },
  ];
  while (todo.length > 0) {
    const { steps, path } = todo.pop() as (typeof todo)[number];
    steps.forEach((step, i) => {
      const sp = childPath(path, i);
      const collect = (nodePath: string, params: Readonly<Record<string, unknown>> | undefined) => {
        if (params === undefined) return;
        for (const [param, value] of Object.entries(params)) {
          if (isRegisterRef(value)) found.push({ nodePath, params: [param], name: value.ref });
        }
      };
      if (step.kind === "op") collect(sp, step.params);
      if (step.kind === "if" && step.test.kind === "op") collect(`${sp}/test`, step.test.params);
      for (const l of childLists(step, sp)) todo.push({ steps: l.steps, path: l.path });
    });
  }
  return found;
}

export interface RenameResult {
  readonly recipe: Recipe;
  /** References that now carry the new name. */
  readonly updated: number;
  /** True when the references were left alone because the new name is already visible at the register. */
  readonly clash: boolean;
}

/**
 * Rename the register at `path` and, in the same edit, every reference that resolves to it (one undo
 * step). A reference resolves to it when it is in the register's scope and no nearer register has that
 * name (`registersInScope`). When the new name is already visible at the register, the references are left
 * alone, so that the clash shows up as the validator's `duplicate-register` and not as silently
 * re-bound values. The caller checks the pattern first (`registerNameProblem`).
 */
export function renameRegister(recipe: Recipe, path: StepPath, name: string): RenameResult {
  const step = getStep(recipe, path);
  if (step === undefined || step.kind !== "register" || step.name === name) {
    return { recipe, updated: 0, clash: false };
  }
  const old = step.name;
  const clash = registersInScope(recipe, path).some((r) => r.name === name);
  let next = patchStep(recipe, path, { name });
  let updated = 0;
  if (!clash) {
    for (const node of refNodes(recipe)) {
      if (node.name !== old) continue;
      const here = registersInScope(recipe, node.nodePath).find((r) => r.name === old);
      if (here?.path !== path) continue;
      for (const param of node.params) {
        next = setParam(next, node.nodePath, param, { ref: name });
        updated += 1;
      }
    }
  }
  return { recipe: next, updated, clash };
}

/** How many references resolve to the register at `path` (for the card's "used by N" note). */
export function referenceCount(recipe: Recipe, path: StepPath): number {
  const step = getStep(recipe, path);
  if (step === undefined || step.kind !== "register") return 0;
  let n = 0;
  for (const node of refNodes(recipe)) {
    if (node.name !== step.name) continue;
    if (registersInScope(recipe, node.nodePath).find((r) => r.name === step.name)?.path === path) {
      n += 1;
    }
  }
  return n;
}
