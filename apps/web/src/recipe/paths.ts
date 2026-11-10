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
// Pure path helpers of the recipe pane: display numbers and where a step lands after a move.
import { joinPath, parsePath, splitStepPath } from "../state/recipe-ops.js";
import type { ListPath, StepPath } from "../state/recipe-ops.js";

const NUMERIC = /^[0-9]+$/;

/** "/steps/1/then/0" becomes "2.1": the 1-based index at every level, children included. */
export function stepNumber(path: StepPath): string {
  return parsePath(path)
    .filter((t) => NUMERIC.test(t))
    .map((t) => String(Number(t) + 1))
    .join(".");
}

/** The step that owns a list: "/steps/1/then" gives "/steps/1"; the root list "/steps" gives null. */
export function ownerOfList(listPath: ListPath): StepPath | null {
  const tokens = parsePath(listPath);
  if (tokens.length < 2) return null;
  return joinPath(tokens.slice(0, -1));
}

/**
 * Where a step ends up after `moveStep(from, toList, gap)` (all in pre-move coordinates, as that
 * action takes them). Mirrors the index fix-ups of `recipe-ops.moveStep`.
 */
export function pathAfterMove(from: StepPath, toList: ListPath, gap: number): StepPath {
  const src = splitStepPath(from);
  const targetTokens = parsePath(toList);
  const srcTokens = parsePath(src.listPath);
  let at = gap;
  if (src.listPath === toList) {
    if (src.index < at) at -= 1;
  } else if (
    targetTokens.length > srcTokens.length &&
    srcTokens.every((t, i) => targetTokens[i] === t)
  ) {
    const t = targetTokens[srcTokens.length] as string;
    if (NUMERIC.test(t) && Number(t) > src.index) {
      targetTokens[srcTokens.length] = String(Number(t) - 1);
    }
  }
  return `${joinPath(targetTokens)}/${at}`;
}
