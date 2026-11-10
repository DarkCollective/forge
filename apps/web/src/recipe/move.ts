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
// Keyboard move targets of the recipe pane (UI.md WP 3.3). Pure: given the recipe and a step, say
// which list and gap a key press moves it to, in the pre-move coordinates `moveStep` takes.
import type { Recipe } from "@forge/recipe";
import { childLists, getList, getStep, parsePath, splitStepPath } from "../state/recipe-ops.js";
import type { ListPath, StepPath } from "../state/recipe-ops.js";
import { ownerOfList } from "./paths.js";

export type MoveKey = "up" | "down" | "in" | "out";

export interface MoveTarget {
  readonly listPath: ListPath;
  readonly gap: number;
}

/**
 * - up / down: among the siblings. Past the first step of an `else` lane it continues to the end of
 *   the `then` lane of the same `if`; past the last step of a `then` lane it enters the start of `else`.
 * - in: into the container directly above, as its last child (the `then` lane of an `if`).
 * - out: into the parent list, right after the container it leaves.
 * Returns null when the key has no effect.
 */
export function moveTarget(recipe: Recipe, path: StepPath, key: MoveKey): MoveTarget | null {
  const { listPath, index } = splitStepPath(path);
  const count = getList(recipe, listPath).length;
  if (index >= count) return null;
  const lane = parsePath(listPath).at(-1);
  const owner = ownerOfList(listPath);
  switch (key) {
    case "up":
      if (index > 0) return { listPath, gap: index - 1 };
      if (lane === "else" && owner !== null) {
        const thenPath = `${owner}/then`;
        return { listPath: thenPath, gap: getList(recipe, thenPath).length };
      }
      return null;
    case "down":
      if (index < count - 1) return { listPath, gap: index + 2 };
      if (lane === "then" && owner !== null) return { listPath: `${owner}/else`, gap: 0 };
      return null;
    case "in": {
      if (index === 0) return null;
      const above = `${listPath}/${index - 1}`;
      const step = getStep(recipe, above);
      const first = step === undefined ? undefined : childLists(step, above)[0];
      if (first === undefined) return null;
      return { listPath: first.path, gap: first.steps.length };
    }
    case "out": {
      if (owner === null) return null;
      const parent = splitStepPath(owner);
      return { listPath: parent.listPath, gap: parent.index + 1 };
    }
  }
}
