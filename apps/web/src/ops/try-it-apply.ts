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
// Applying a Try it plan to the workbench (WP 6.18). Separate from the dialog so it can be tested with
// a fake store: the dialog passes the real `actions` and a snapshot of the inputs.
import type { Recipe } from "@forge/recipe";
import type { EncodingName, EolName } from "../io/codec.js";
import { planInput } from "./help-view.js";
import type { InputPlan } from "./help-view.js";

/** The part of the app actions Try it uses. */
export interface TryItActions {
  setInputBytes(id: string, bytes: Uint8Array): void;
  selectInput(id: string): void;
  addInput(name: string, bytes: Uint8Array): string;
  setInputEncoding(id: string, encoding: EncodingName): void;
  setInputEol(id: string, eol: EolName): void;
  setRecipe(recipe: Recipe): void;
}

export interface TryItTarget {
  readonly recipe: Recipe;
  readonly bytes: Uint8Array;
  readonly encoding: EncodingName;
  readonly eol: EolName;
}

/**
 * Put the plan's input in a tab (see `planInput`) and set the tab's encoding and line ending, then set
 * the recipe. The line ending is set on every path, including a tab that is selected again: the bytes
 * there are the same, so it is the setting the plan reports. Mixed line endings: the plan reports the
 * most common one (a tie goes to LF), exactly as loading a file does; the bytes stay exact, only the
 * editor's view of them is normalised to that ending.
 */
export function applyTryIt(
  a: TryItActions,
  inputs: Parameters<typeof planInput>[0],
  activeId: string,
  name: string,
  target: TryItTarget,
): { readonly plan: InputPlan; readonly tab: string } {
  const plan = planInput(inputs, activeId, name, target.bytes);
  let tab: string;
  if (plan.kind === "fill") {
    tab = plan.id;
    a.setInputBytes(tab, target.bytes);
  } else if (plan.kind === "select") {
    tab = plan.id;
    a.selectInput(tab);
  } else {
    tab = a.addInput(plan.name, target.bytes);
  }
  a.setInputEncoding(tab, target.encoding);
  a.setInputEol(tab, target.eol);
  a.setRecipe(target.recipe);
  return { plan, tab };
}
