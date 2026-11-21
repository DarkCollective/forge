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
// Pure helpers of the parameter form's Value / Register switch (RECIPES-1.1.md sections 2.4 and 4.12).
// No DOM, no store. A parameter is in Register mode when its stored value is `{ "ref": name }`.
import { isRegisterRef, registersInScope } from "@forge/recipe";
import type { CatalogueView, Recipe, RegisterInfo, RegisterRef } from "@forge/recipe";

/** Which half of the switch a stored parameter value is in. */
export type ParamMode = "value" | "register";

export function modeOf(value: unknown): ParamMode {
  return isRegisterRef(value) ? "register" : "value";
}

/** The register named by a stored value, or undefined when it is an ordinary value. */
export function refName(value: unknown): string | undefined {
  return isRegisterRef(value) ? value.ref : undefined;
}

/** The registers the picker offers at an op-like node ("/steps/0" or "/steps/2/test"): `registersInScope`. */
export function registerChoices(
  recipe: Recipe,
  nodePath: string,
  catalogue?: CatalogueView,
): readonly RegisterInfo[] {
  return registersInScope(recipe, nodePath, catalogue);
}

/** What the picker lists: the choices, plus the stored name when it is not among them (so it stays visible). */
export function pickerOptions(
  choices: readonly RegisterInfo[],
  current: string | undefined,
): readonly { readonly name: string; readonly secret: boolean; readonly inScope: boolean }[] {
  const out = choices.map((c) => ({ name: c.name, secret: c.secret, inScope: true }));
  if (current !== undefined && !choices.some((c) => c.name === current)) {
    out.unshift({ name: current, secret: false, inScope: false });
  }
  return out;
}

/** The value written when the user switches to Register: the nearest register in scope, or undefined when there is none. */
export function firstRef(choices: readonly RegisterInfo[]): RegisterRef | undefined {
  const last = choices[choices.length - 1];
  return last === undefined ? undefined : { ref: last.name };
}

/**
 * The value written when the user switches back to Value: the last value they had typed (kept by the
 * form), else `undefined`, which removes the parameter so that the catalogue default applies.
 */
export function valueAfterSwitchBack(last: unknown): unknown {
  return last === undefined || isRegisterRef(last) ? undefined : last;
}
