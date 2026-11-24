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
/**
 * The child lists of a step, in document order (RECIPES-1.2.md section 5.3): `steps` of a `fork`, `subsection`,
 * `repeat` and `register`, `then` and `else` of an `if`, and the lanes of a slot step (`left/steps`, `right/steps`,
 * `base/steps`, `step/steps`). The walkers that only need to visit every nested step share it.
 */
import { SLOT_NAMES } from "./types.js";
import type { OpStep, Step } from "./types.js";

/** One child list: the pointer segment(s) below the step that reach it, and its steps. */
export interface ChildList {
  /** `"steps"`, `"then"`, `"else"`, or `"<slot>/steps"`. */
  readonly key: string;
  readonly steps: readonly Step[];
  /** The slot name for a lane, else undefined. */
  readonly slot?: (typeof SLOT_NAMES)[number];
}

/** The slot lanes of an op step, in document order (`left`, `right`, `base`, `step`). */
export function slotLanes(step: OpStep): ChildList[] {
  const out: ChildList[] = [];
  for (const slot of SLOT_NAMES) {
    const lane = step[slot];
    if (lane !== undefined && Array.isArray(lane.steps)) {
      out.push({ key: `${slot}/steps`, steps: lane.steps, slot });
    }
  }
  return out;
}

/** The child lists of `step`, in document order. Comments, returns and ops without slots have none. */
export function childLists(step: Step): ChildList[] {
  switch (step.kind) {
    case "op":
      return slotLanes(step);
    case "fork":
    case "subsection":
    case "repeat":
    case "register":
      return [{ key: "steps", steps: step.steps }];
    case "if":
      return step.else === undefined
        ? [{ key: "then", steps: step.then }]
        : [
            { key: "then", steps: step.then },
            { key: "else", steps: step.else },
          ];
    default:
      return [];
  }
}
