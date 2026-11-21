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
// Pure, immutable edits of a recipe tree addressed by RFC 6901 JSON pointers (UI.md section 3.3).
// Step paths look like "/steps/1", "/steps/1/steps/0", "/steps/2/then/0"; list paths like "/steps",
// "/steps/1/steps", "/steps/2/else". Every function returns a new recipe and shares unchanged
// subtrees with the old one. Invalid paths throw a RangeError (a programming error, never user data).
import type { Recipe, Step } from "@forge/recipe";

export type StepPath = string;
export type ListPath = string;

/** The keys that hold a list of child steps. */
export const CHILD_LIST_KEYS = ["steps", "then", "else"] as const;
export type ChildListKey = (typeof CHILD_LIST_KEYS)[number];

type Json = unknown;
type Obj = Record<string, unknown>;

function isObj(v: Json): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const INDEX = /^(0|[1-9][0-9]*)$/;

export function parsePath(path: string): string[] {
  if (path === "") return [];
  if (!path.startsWith("/")) throw new RangeError(`bad path: ${path}`);
  return path.slice(1).split("/");
}

export function joinPath(tokens: readonly string[]): string {
  return tokens.map((t) => "/" + t).join("");
}

function toIndex(token: string, length: number): number {
  if (!INDEX.test(token)) throw new RangeError(`bad index: ${token}`);
  const i = Number(token);
  if (i >= length) throw new RangeError(`index out of range: ${token}`);
  return i;
}

/** The node at `path`, or undefined when absent (an omitted `else`, for example). */
export function getAt(root: Json, path: string): Json {
  let node = root;
  for (const token of parsePath(path)) {
    if (Array.isArray(node)) {
      if (!INDEX.test(token) || Number(token) >= node.length) return undefined;
      node = node[Number(token)];
    } else if (isObj(node)) {
      node = Object.hasOwn(node, token) ? node[token] : undefined;
    } else {
      return undefined;
    }
  }
  return node;
}

function updateAt(node: Json, tokens: readonly string[], i: number, fn: (n: Json) => Json): Json {
  if (i === tokens.length) return fn(node);
  const token = tokens[i] as string;
  if (Array.isArray(node)) {
    const idx = toIndex(token, node.length);
    const copy = node.slice();
    copy[idx] = updateAt(node[idx], tokens, i + 1, fn);
    return copy;
  }
  if (isObj(node)) {
    const own = Object.hasOwn(node, token);
    const lastToken = i === tokens.length - 1;
    if (!own && !(lastToken && (CHILD_LIST_KEYS as readonly string[]).includes(token))) {
      throw new RangeError(`no such key: ${token}`);
    }
    return { ...node, [token]: updateAt(own ? node[token] : undefined, tokens, i + 1, fn) };
  }
  throw new RangeError("path leaves the tree");
}

function replaceAt(recipe: Recipe, path: string, fn: (n: Json) => Json): Recipe {
  return updateAt(recipe, parsePath(path), 0, fn) as Recipe;
}

export function getStep(recipe: Recipe, path: StepPath): Step | undefined {
  const node = getAt(recipe, path);
  return isObj(node) ? (node as unknown as Step) : undefined;
}

export function getList(recipe: Recipe, listPath: ListPath): readonly Step[] {
  const node = getAt(recipe, listPath);
  return Array.isArray(node) ? (node as Step[]) : [];
}

/** Split "/steps/1/then/2" into the list "/steps/1/then" and the index 2. */
export function splitStepPath(path: StepPath): { listPath: ListPath; index: number } {
  const tokens = parsePath(path);
  const last = tokens.pop();
  if (last === undefined || !INDEX.test(last)) throw new RangeError(`not a step path: ${path}`);
  return { listPath: joinPath(tokens), index: Number(last) };
}

export function childPath(listPath: ListPath, index: number): StepPath {
  return `${listPath}/${index}`;
}

/** The child lists of a step with their paths, in display order. */
export function childLists(
  step: Step,
  stepPath: StepPath,
): { key: ChildListKey; path: ListPath; steps: readonly Step[] }[] {
  switch (step.kind) {
    case "fork":
    case "subsection":
    case "repeat":
    case "register":
      return [{ key: "steps", path: `${stepPath}/steps`, steps: step.steps }];
    case "if":
      return [
        { key: "then", path: `${stepPath}/then`, steps: step.then },
        { key: "else", path: `${stepPath}/else`, steps: step.else ?? [] },
      ];
    default:
      return [];
  }
}

/** True when `path` is `ancestor` or lies below it. */
export function isWithin(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(ancestor + "/");
}

/**
 * True when a `return` step may sit directly in this list: the root list, or a `then` / `else` branch of
 * an `if` that is itself in such a list (RECIPES-1.1.md section 3.2). Any other container (fork,
 * subsection, repeat, register) closes it.
 */
export function listAllowsReturn(listPath: ListPath): boolean {
  const tokens = parsePath(listPath);
  if (tokens[0] !== "steps") return false;
  // After "steps": index, then|else, index, then|else, ...
  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i] as string;
    if (i % 2 === 1 ? !INDEX.test(token) : token !== "then" && token !== "else") return false;
  }
  return tokens.length % 2 === 1;
}

/** True when `step` is a `return` or has one anywhere below it. */
export function containsReturn(step: Step): boolean {
  const todo: Step[] = [step];
  while (todo.length > 0) {
    const s = todo.pop() as Step;
    if (s.kind === "return") return true;
    for (const child of childLists(s, "")) todo.push(...child.steps);
  }
  return false;
}

/** The text announced and shown when a drop or an add is refused because of a `return`. */
export const BAD_POSITION_TEXT =
  "A Return can only go at the top of the recipe or inside the branches of an If.";

/**
 * Whether `step` may be placed in the list: always, unless it is or contains a `return` and the list
 * does not allow one. (A moved block keeps the structure it already has inside.)
 */
export function canPlace(step: Step, listPath: ListPath): boolean {
  return listAllowsReturn(listPath) || !containsReturn(step);
}

function registerNamesOf(steps: readonly Step[], into: Set<string>): void {
  for (const step of steps) {
    if (step.kind === "register") into.add(step.name);
    for (const child of childLists(step, "")) registerNamesOf(child.steps, into);
  }
}

/** Every register name used anywhere in the recipe, enabled or not. */
export function registerNames(recipe: Recipe): ReadonlySet<string> {
  const names = new Set<string>();
  registerNamesOf(recipe.steps, names);
  return names;
}

/** `base`, or the first of `base-2`, `base-3`, ... that no register of the recipe uses (at most 32 characters). */
export function uniqueRegisterName(recipe: Recipe, base = "value"): string {
  const used = registerNames(recipe);
  if (!used.has(base) && base.length <= 32) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, 32 - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Insert `step` into the list at `index` (clamped to 0..length). Creates an omitted `else` list. */
export function insertStep(recipe: Recipe, listPath: ListPath, index: number, step: Step): Recipe {
  const last = parsePath(listPath).pop();
  if (last === undefined || !(CHILD_LIST_KEYS as readonly string[]).includes(last)) {
    throw new RangeError(`not a list path: ${listPath}`);
  }
  return replaceAt(recipe, listPath, (list) => {
    const items = Array.isArray(list) ? list : [];
    const at = Math.max(0, Math.min(index, items.length));
    return [...items.slice(0, at), step, ...items.slice(at)];
  });
}

export function removeStep(recipe: Recipe, path: StepPath): Recipe {
  const { listPath, index } = splitStepPath(path);
  return replaceAt(recipe, listPath, (list) => {
    const items = list as Json[];
    toIndex(String(index), items.length);
    return [...items.slice(0, index), ...items.slice(index + 1)];
  });
}

/**
 * Move a step. `toIndexGap` is the gap index in the *target list as it is before the move* (0 = before
 * the first item, length = after the last), which is what a drop indicator shows. `toList` is likewise
 * a path in the recipe before the move. Moving a step into itself or its own descendants returns the
 * recipe unchanged, and so does moving a `return` (or a block that holds one) where it is not allowed
 * (`canPlace`).
 */
export function moveStep(
  recipe: Recipe,
  from: StepPath,
  toList: ListPath,
  toIndexGap: number,
): Recipe {
  if (isWithin(toList, from)) return recipe;
  const step = getStep(recipe, from);
  if (step === undefined) throw new RangeError(`no step at ${from}`);
  if (!canPlace(step, toList)) return recipe;
  const src = splitStepPath(from);
  let targetTokens = parsePath(toList);
  const srcTokens = parsePath(src.listPath);
  let gap = toIndexGap;
  if (src.listPath === toList) {
    if (src.index < gap) gap -= 1;
  } else if (
    targetTokens.length > srcTokens.length &&
    srcTokens.every((t, i) => targetTokens[i] === t)
  ) {
    // The target list lives below a later sibling of the removed step: that sibling's index shifts down.
    const t = targetTokens[srcTokens.length] as string;
    if (INDEX.test(t) && Number(t) > src.index) {
      targetTokens = [...targetTokens];
      targetTokens[srcTokens.length] = String(Number(t) - 1);
    }
  }
  return insertStep(removeStep(recipe, from), joinPath(targetTokens), gap, step);
}

/** Deep-copy a step and insert the copy straight after it. */
export function duplicateStep(recipe: Recipe, path: StepPath): Recipe {
  const step = getStep(recipe, path);
  if (step === undefined) throw new RangeError(`no step at ${path}`);
  const { listPath, index } = splitStepPath(path);
  const copy = structuredClone(step);
  // A copy of a register next to the original would hide the same name (RECIPES-1.1.md section 2.3).
  const next: Step =
    copy.kind === "register" ? { ...copy, name: uniqueRegisterName(recipe, copy.name) } : copy;
  return insertStep(recipe, listPath, index + 1, next);
}

/** Shallow-merge `patch` into the step. A key whose value is `undefined` is deleted. */
export function patchStep(recipe: Recipe, path: StepPath, patch: Obj): Recipe {
  return replaceAt(recipe, path, (node) => {
    if (!isObj(node)) throw new RangeError(`no step at ${path}`);
    const merged: Obj = { ...node, ...patch };
    for (const key of Object.keys(patch)) if (patch[key] === undefined) delete merged[key];
    return merged;
  });
}

/**
 * Set or clear one parameter of an op-like node: an `op` step ("/steps/0") or the op test of an `if`
 * ("/steps/2/test"). `undefined` removes it (the catalogue default applies). An empty `params` is dropped.
 */
export function setParam(recipe: Recipe, nodePath: string, name: string, value: unknown): Recipe {
  return replaceAt(recipe, nodePath, (node) => {
    if (!isObj(node)) throw new RangeError(`no op at ${nodePath}`);
    const params: Obj = isObj(node.params) ? { ...node.params } : {};
    if (value === undefined) delete params[name];
    else params[name] = value;
    const next: Obj = { ...node, params };
    if (Object.keys(params).length === 0) delete next.params;
    return next;
  });
}

/** Number of steps in the whole tree (comments included). */
export function countSteps(steps: readonly Step[]): number {
  let n = 0;
  const todo: (readonly Step[])[] = [steps];
  while (todo.length > 0) {
    const list = todo.pop() as readonly Step[];
    for (const step of list) {
      n += 1;
      for (const child of childLists(step, "")) todo.push(child.steps);
    }
  }
  return n;
}
