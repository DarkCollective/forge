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
// Valid default container steps for the "Add block" menu (RECIPES section 3).
import type { Recipe, Step } from "@forge/recipe";
import { uniqueRegisterName } from "../state/recipe-ops.js";

export type BlockKind = "fork" | "subsection" | "if" | "repeat" | "register" | "return" | "comment";

export const BLOCK_KINDS: readonly BlockKind[] = [
  "fork",
  "subsection",
  "if",
  "repeat",
  "register",
  "return",
  "comment",
];

export const BLOCK_LABELS: Readonly<Record<BlockKind, string>> = {
  fork: "Fork (split, run, join)",
  subsection: "Subsection (regex matches)",
  if: "If (then / else)",
  repeat: "Repeat",
  register: "Register (remember a value)",
  return: "Return (stop and output)",
  comment: "Comment",
};

/**
 * The step "Add block" creates. A register gets the next free name ("value", "value-2", ...), which needs
 * the recipe it is added to (RECIPES-1.1.md section 4.12); without one it is "value".
 */
export function defaultBlock(kind: BlockKind, recipe?: Recipe): Step {
  switch (kind) {
    case "fork":
      return {
        kind: "fork",
        split: { value: "\n", enc: "utf8" },
        join: { value: "\n", enc: "utf8" },
        steps: [],
      };
    case "subsection":
      return { kind: "subsection", pattern: ".", steps: [] };
    case "if":
      return { kind: "if", test: { kind: "regex", pattern: "." }, then: [] };
    case "repeat":
      return { kind: "repeat", times: 2, steps: [] };
    case "register":
      return {
        kind: "register",
        name: recipe === undefined ? "value" : uniqueRegisterName(recipe),
        steps: [],
      };
    case "return":
      return { kind: "return" };
    case "comment":
      return { kind: "comment", text: "Comment" };
  }
}
