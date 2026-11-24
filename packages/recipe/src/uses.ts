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
 * Pure, catalogue-light questions about a valid recipe that the v1.2 features raise (RECIPES-1.2.md sections 7.4,
 * 7.5 and 14.3): does it use slots or anything else of v1.2, which tabs does it read, and which step's output
 * enters a given step. They walk with explicit stacks, so nesting costs no recursion beyond `maxDepth`.
 */
import { childLists } from "./children.js";
import { opIndex } from "./opindex.js";
import { unescapePointer } from "./pointer.js";
import { NAMED_INPUT_OPS, NAMED_INPUT_PARAM, SLOT_NAMES } from "./types.js";
import type { CatalogueView, Recipe, Step } from "./types.js";

const SLOT_KEYS: readonly string[] = ["pipe", ...SLOT_NAMES];

/** Every step of the tree (lanes included), parents before children, in document order. */
function* walk(steps: readonly Step[]): Generator<{ step: Step; path: string; disabled: boolean }> {
  const stack: { step: Step; path: string; disabled: boolean }[] = [];
  const push = (list: readonly Step[], base: string, disabled: boolean): void => {
    for (let i = list.length - 1; i >= 0; i--) {
      const step = list[i] as Step;
      stack.push({
        step,
        path: `${base}/${i}`,
        disabled: disabled || (step.kind !== "comment" && step.disabled === true),
      });
    }
  };
  push(steps, "/steps", false);
  while (stack.length > 0) {
    const item = stack.pop() as { step: Step; path: string; disabled: boolean };
    yield item;
    const children = childLists(item.step);
    for (let c = children.length - 1; c >= 0; c--) {
      const child = children[c] as ReturnType<typeof childLists>[number];
      push(child.steps, `${item.path}/${child.key}`, item.disabled);
    }
  }
}

/** True iff some op step (enabled or not, at any depth, lanes included) has `pipe`, `left`, `right`, `base` or `step`. */
export function recipeUsesSlots(recipe: Recipe): boolean {
  for (const { step } of walk(recipe.steps)) {
    if (step.kind === "op" && SLOT_KEYS.some((k) => Object.hasOwn(step, k))) return true;
  }
  return false;
}

/** A tab that an enabled step reads by name. */
export interface InputName {
  readonly name: string;
  /** JSON pointer of the step. */
  readonly path: string;
}

/**
 * The literal tab names of the enabled `input:tab` and `relix:input` steps (the ops of `NAMED_INPUT_OPS`), in
 * document order, with the path of each step. A `{ "ref": … }` tab is not listed (RECIPES-1.2.md section 7.4).
 */
export function inputNames(recipe: Recipe): InputName[] {
  const out: InputName[] = [];
  for (const { step, path, disabled } of walk(recipe.steps)) {
    if (disabled || step.kind !== "op" || !NAMED_INPUT_OPS.includes(step.op)) continue;
    const tab = step.params === undefined ? undefined : step.params[NAMED_INPUT_PARAM];
    if (typeof tab === "string") out.push({ name: tab, path });
  }
  return out;
}

export interface UsesV12Options {
  /** With a catalogue, an op step that gives a value to an `ext` parameter counts. */
  readonly catalogue?: CatalogueView;
  /** With the vocabulary map of a `PackIndex` (RECIPES-1.2.md section 8.2), an op in a pack vocabulary counts. */
  readonly packs?: { readonly vocabs: ReadonlyMap<string, string> };
}

/**
 * True iff the recipe needs a v1.2 reader (RECIPES-1.2.md section 14.3): it uses slots, or `inputNames` is not
 * empty; with `catalogue`, some op step gives a value to an `ext` parameter; with `packs`, some op is in a pack vocabulary.
 * With no options only the first two tests run.
 */
export function recipeUsesV12(recipe: Recipe, options: UsesV12Options = {}): boolean {
  if (recipeUsesSlots(recipe) || inputNames(recipe).length > 0) return true;
  const index = options.catalogue === undefined ? undefined : opIndex(options.catalogue);
  const packs = options.packs;
  if (index === undefined && packs === undefined) return false;
  const ops = (step: Step): string[] =>
    step.kind === "op"
      ? [step.op]
      : step.kind === "if" && step.test.kind === "op"
        ? [step.test.op]
        : [];
  for (const { step } of walk(recipe.steps)) {
    for (const name of ops(step)) {
      if (packs?.vocabs.has(name.slice(0, name.indexOf(":"))) === true) return true;
    }
    if (index !== undefined && step.kind === "op" && step.params !== undefined) {
      const entry = index.find(step.op);
      if (
        entry?.op.params.some((p) => p.type === "ext" && Object.hasOwn(step.params ?? {}, p.name))
      ) {
        return true;
      }
    }
  }
  return false;
}

interface Located {
  readonly list: readonly Step[];
  /** Path of `list`. */
  readonly listPath: string;
  readonly index: number;
  /** Path of the step that owns the list, or null for the root list. */
  readonly owner: string | null;
}

/** Finds the step a path names (a path inside the step counts as the step). Null when the path names no step. */
function locate(recipe: Recipe, path: string): Located | null {
  const tokens = path.split("/").slice(1).map(unescapePointer);
  if (path === "" || tokens[0] !== "steps") return null;
  let list: readonly Step[] = recipe.steps;
  let owner: string | null = null;
  let listPath = "/steps";
  let t = 1;
  for (;;) {
    const raw = tokens[t];
    if (raw === undefined || !/^(0|[1-9][0-9]*)$/.test(raw)) return null;
    const index = Number(raw);
    const step = list[index];
    if (step === undefined) return null;
    const stepPath = `${listPath}/${index}`;
    t++;
    const key = tokens[t];
    const next =
      key === undefined
        ? undefined
        : childLists(step).find((c) => c.key === key || c.key === `${key}/${tokens[t + 1] ?? ""}`);
    if (next === undefined) return { list, listPath, index, owner };
    t += next.key.split("/").length;
    owner = stepPath;
    listPath = `${stepPath}/${next.key}`;
    list = next.steps;
  }
}

/**
 * The path of the step whose output enters the step at `path`, or null when that is the bake's input
 * (RECIPES-1.2.md section 7.5): the nearest earlier enabled step of the same list that is not a comment or a
 * register, else the data that entered the list's container (the slot step of a lane, the `if` of a branch, the
 * container of a `fork`, `subsection`, `repeat` or `register` child). A path inside a step counts as the step.
 * Null too for a path that names no step.
 */
export function dataSourcePath(recipe: Recipe, path: string): string | null {
  let at = locate(recipe, path);
  while (at !== null) {
    for (let i = at.index - 1; i >= 0; i--) {
      const s = at.list[i] as Step;
      if (s.kind === "comment" || s.kind === "register" || s.disabled === true) continue;
      return `${at.listPath}/${i}`;
    }
    at = at.owner === null ? null : locate(recipe, at.owner);
  }
  return null;
}
