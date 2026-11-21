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
 * Registers and references (RECIPES-1.1.md sections 2.3, 2.4, 3.2 and 4.9).
 *
 * `scanScopes` is the one iterative walk behind the validator's scope pass, `registerInfo`, and
 * `registersInScope`. It reads only own data properties and never recurses, so it is safe on untrusted
 * input. Nesting is bounded by `maxDepth` and the number of steps by `maxSteps`, as in the validator.
 *
 * Scope is lexical: a register is visible to the later steps of its own list and to everything nested in
 * them. A disabled step compiles to comments, so an enabled step sees only enabled definitions, and a
 * disabled step (or a step inside a disabled container) sees every definition.
 */
import { dataProp } from "./limits.js";
import { opIndex } from "./opindex.js";
import { childPointer } from "./pointer.js";
import { RECIPE_LIMITS, STEP_KINDS } from "./types.js";
import type { CatalogueView, Recipe, RegisterRef, Step } from "./types.js";

/** The shape of a register name (RECIPES-1.1.md section 2.2). */
export const REGISTER_NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** True for exactly `{ ref: string }`. The name is not matched against `REGISTER_NAME_RE`; the validator does that. */
export function isRegisterRef(v: unknown): v is RegisterRef {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  return keys.length === 1 && keys[0] === "ref" && typeof dataProp(v, "ref") === "string";
}

/** What `registerInfo` and `registersInScope` say about one register. */
export interface RegisterInfo {
  readonly name: string;
  /** JSON pointer of the defining `register` step. */
  readonly path: string;
  /**
   * True iff at least one reference to it, in its scope, is the value of a parameter whose catalogue type is
   * `key` (RECIPES-1.1.md section 4.9). Always false when no catalogue is given.
   */
  readonly secret: boolean;
}

// ---------------------------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------------------------

/** One list on the way from the root to a step: the list's id and the index of the step (or ancestor) in it. */
export interface ScopeFrame {
  readonly id: number;
  readonly index: number;
}

/** A `register` step with a valid name. */
export interface RegisterDef {
  readonly name: string;
  /** Path of the `register` step. */
  readonly path: string;
  readonly frames: readonly ScopeFrame[];
  /** False when the step is disabled or inside a disabled step. */
  readonly enabled: boolean;
}

export type ScopeEvent =
  | { readonly t: "def"; readonly def: RegisterDef; readonly skipped: boolean }
  | {
      readonly t: "ref";
      readonly name: string;
      /** Path of the `ref` member. */
      readonly path: string;
      readonly frames: readonly ScopeFrame[];
      /** True when the step that holds the reference is disabled or inside a disabled step. */
      readonly disabled: boolean;
      readonly op: string | undefined;
      readonly param: string;
    }
  | {
      readonly t: "bad-position";
      readonly path: string;
      readonly container: string;
      readonly containerKind: string;
    }
  | { readonly t: "unreachable"; readonly path: string; readonly after: string };

export interface ScopeScan {
  /** Every `register` step with a valid name, in document order. */
  readonly defs: readonly RegisterDef[];
  /** In document order. */
  readonly events: readonly ScopeEvent[];
  /** The position asked for with the `at` option, when it was found. */
  readonly at: { readonly frames: readonly ScopeFrame[]; readonly disabled: boolean } | undefined;
  readonly byName: ReadonlyMap<string, readonly RegisterDef[]>;
}

export interface ScanOptions {
  /** Paths of steps that already have an error: they get no `ref`, `bad-position` or `unreachable` events. */
  readonly skip?: ReadonlySet<string>;
  /** A step path, or a list path (the position after its last step): fills `ScopeScan.at`. */
  readonly at?: string;
}

interface ListRec {
  readonly items: readonly unknown[];
  readonly path: string;
  readonly id: number;
  readonly depth: number;
  readonly base: readonly ScopeFrame[];
  readonly disabled: boolean;
  /** The nearest enclosing step that is not an `if`, or null at the root and under `if`s only. */
  readonly nonIf: { readonly path: string; readonly kind: string } | null;
  next: number;
  returnPath: string | null;
  warned: boolean;
}

function isObj(v: unknown): v is object {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const KINDS: readonly string[] = STEP_KINDS;

/** Walks the steps of `root` (anything: untrusted input is fine) and records definitions, references and positions. */
export function scanScopes(root: unknown, options: ScanOptions = {}): ScopeScan {
  const defs: RegisterDef[] = [];
  const events: ScopeEvent[] = [];
  const byName = new Map<string, RegisterDef[]>();
  let at: { frames: readonly ScopeFrame[]; disabled: boolean } | undefined;
  const result = (): ScopeScan => ({ defs, events, at, byName });

  const rootSteps = isObj(root) ? dataProp(root, "steps") : undefined;
  if (!Array.isArray(rootSteps)) return result();

  const target = options.at;
  const matches = (path: string): boolean =>
    target !== undefined && (target === path || target.startsWith(`${path}/`));
  let nextId = 0;
  let nodes = 0;
  const stack: ListRec[] = [];
  const open = (
    items: readonly unknown[],
    path: string,
    depth: number,
    base: readonly ScopeFrame[],
    disabled: boolean,
    nonIf: ListRec["nonIf"],
  ): ListRec => {
    const rec: ListRec = {
      items,
      path,
      id: nextId++,
      depth,
      base,
      disabled,
      nonIf,
      next: 0,
      returnPath: null,
      warned: false,
    };
    if (target === path || (target === "" && path === "/steps")) {
      at = { frames: [...base, { id: rec.id, index: items.length }], disabled };
    }
    return rec;
  };
  stack.push(open(rootSteps, "/steps", 1, [], false, null));

  while (stack.length > 0) {
    const list = stack[stack.length - 1] as ListRec;
    if (list.next >= list.items.length) {
      stack.pop();
      continue;
    }
    const index = list.next++;
    if (++nodes > RECIPE_LIMITS.maxSteps) break;
    const step = dataProp(list.items, index);
    if (!isObj(step)) continue;
    const kind = dataProp(step, "kind");
    if (typeof kind !== "string" || !KINDS.includes(kind)) continue;

    const path = childPointer(list.path, index);
    const disabled = list.disabled || (kind !== "comment" && dataProp(step, "disabled") === true);
    const frames: ScopeFrame[] = [...list.base, { id: list.id, index }];
    const skipped = options.skip?.has(path) === true;
    if (matches(path)) at = { frames, disabled };

    if (kind !== "comment" && !disabled && list.returnPath !== null && !list.warned && !skipped) {
      events.push({ t: "unreachable", path, after: list.returnPath });
      list.warned = true;
    }

    const refsOf = (owner: object, ownerPath: string): void => {
      const params = dataProp(owner, "params");
      if (!isObj(params)) return;
      const opName = dataProp(owner, "op");
      for (const key of Object.keys(params)) {
        const value = dataProp(params, key);
        if (!isObj(value)) continue;
        const ref = dataProp(value, "ref");
        if (typeof ref !== "string" || !REGISTER_NAME_RE.test(ref)) continue;
        events.push({
          t: "ref",
          name: ref,
          path: `${childPointer(`${ownerPath}/params`, key)}/ref`,
          frames,
          disabled,
          op: typeof opName === "string" ? opName : undefined,
          param: key,
        });
      }
    };
    /** Child lists, to be walked in the order given (the stack is last in, first out). */
    const children: [key: string, container: ListRec["nonIf"]][] = [];
    const nonIfHere = { path, kind };

    switch (kind) {
      case "op":
        if (!skipped) refsOf(step, path);
        break;
      case "if": {
        const test = dataProp(step, "test");
        if (!skipped && isObj(test) && dataProp(test, "kind") === "op") {
          refsOf(test, `${path}/test`);
        }
        children.push(["then", list.nonIf], ["else", list.nonIf]);
        break;
      }
      case "fork":
      case "subsection":
      case "repeat":
        children.push(["steps", nonIfHere]);
        break;
      case "register": {
        const name = dataProp(step, "name");
        if (typeof name === "string" && REGISTER_NAME_RE.test(name)) {
          const def: RegisterDef = { name, path, frames, enabled: !disabled };
          defs.push(def);
          const same = byName.get(name);
          if (same === undefined) byName.set(name, [def]);
          else same.push(def);
          events.push({ t: "def", def, skipped });
        }
        children.push(["steps", nonIfHere]);
        break;
      }
      case "return":
        if (!skipped) {
          if (list.nonIf !== null) {
            events.push({
              t: "bad-position",
              path,
              container: list.nonIf.path,
              containerKind: list.nonIf.kind,
            });
          }
        }
        if (!disabled && list.returnPath === null) list.returnPath = path;
        break;
      default:
        break;
    }

    if (list.depth + 1 <= RECIPE_LIMITS.maxDepth) {
      const opened: ListRec[] = [];
      for (const [key, nonIf] of children) {
        const items = dataProp(step, key);
        if (Array.isArray(items)) {
          opened.push(open(items, `${path}/${key}`, list.depth + 1, frames, disabled, nonIf));
        }
      }
      for (let i = opened.length - 1; i >= 0; i--) stack.push(opened[i] as ListRec);
    }
  }
  return result();
}

// ---------------------------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------------------------

/** Why a reference does not resolve (RECIPES-1.1.md section 4.3). */
export type UnknownRegisterReason = "not-defined" | "not-yet-defined" | "out-of-scope" | "disabled";

/** Where a definition sits relative to a position: on the path and earlier, on the path and not earlier, or off it. */
function relation(def: RegisterDef, frames: readonly ScopeFrame[]): "earlier" | "later" | "off" {
  const own = def.frames[def.frames.length - 1] as ScopeFrame;
  const there = frames.find((f) => f.id === own.id);
  if (there === undefined) return "off";
  return own.index < there.index ? "earlier" : "later";
}

/** The definitions visible at a position, in document order. `disabled` selects the view (section 2.3). */
export function visibleDefs(
  scan: ScopeScan,
  frames: readonly ScopeFrame[],
  disabled: boolean,
): RegisterDef[] {
  return scan.defs.filter((d) => (disabled || d.enabled) && relation(d, frames) === "earlier");
}

/** The definition a reference binds to (the nearest earlier one), or the reason there is none. */
export function lookupRegister(
  scan: ScopeScan,
  name: string,
  frames: readonly ScopeFrame[],
  disabled: boolean,
): { readonly def: RegisterDef } | { readonly reason: UnknownRegisterReason } {
  const candidates = scan.byName.get(name) ?? [];
  const seen = candidates.filter(
    (d) => (disabled || d.enabled) && relation(d, frames) === "earlier",
  );
  const last = seen[seen.length - 1];
  if (last !== undefined) return { def: last };
  const eligible = candidates.filter((d) => disabled || d.enabled);
  if (eligible.some((d) => relation(d, frames) === "later")) return { reason: "not-yet-defined" };
  if (eligible.length > 0) return { reason: "out-of-scope" };
  return { reason: candidates.length > 0 ? "disabled" : "not-defined" };
}

/** The first enabled definition of the same name that is visible at an enabled definition, or undefined. */
export function findDuplicate(scan: ScopeScan, def: RegisterDef): RegisterDef | undefined {
  if (!def.enabled) return undefined;
  return (scan.byName.get(def.name) ?? []).find(
    (d) => d.enabled && relation(d, def.frames) === "earlier",
  );
}

/** The definitions that feed a `key` parameter through at least one reference. */
function secretDefs(scan: ScopeScan, catalogue: CatalogueView): Set<RegisterDef> {
  const index = opIndex(catalogue);
  const secret = new Set<RegisterDef>();
  for (const e of scan.events) {
    if (e.t !== "ref" || e.op === undefined) continue;
    const spec = index.find(e.op)?.op.params.find((p) => p.name === e.param);
    if (spec?.type !== "key") continue;
    const found = lookupRegister(scan, e.name, e.frames, e.disabled);
    if ("def" in found) secret.add(found.def);
  }
  return secret;
}

// ---------------------------------------------------------------------------------------------
// The exports of the package
// ---------------------------------------------------------------------------------------------

/**
 * Every `register` step of a valid recipe (enabled or not, in document order), with whether it is secret
 * (RECIPES-1.1.md section 4.9).
 */
export function registerInfo(recipe: Recipe, catalogue: CatalogueView): RegisterInfo[] {
  const scan = scanScopes(recipe);
  const secret = secretDefs(scan, catalogue);
  return scan.defs.map((d) => ({ name: d.name, path: d.path, secret: secret.has(d) }));
}

/**
 * The registers visible at the step at `stepPath`, outermost first: those a reference in that step could
 * use. A path inside a step (`/steps/2/test`) counts as the step. A path that ends at a list
 * (`/steps/1/then`) means the position after the list's last step. An unknown path gives `[]`.
 * A disabled step sees every definition, an enabled one only the enabled ones. With a `catalogue`, `secret`
 * is computed over the whole recipe; without one it is false.
 */
export function registersInScope(
  recipe: Recipe,
  stepPath: string,
  catalogue?: CatalogueView,
): RegisterInfo[] {
  const scan = scanScopes(recipe, { at: stepPath });
  if (scan.at === undefined) return [];
  const secret = catalogue === undefined ? new Set<RegisterDef>() : secretDefs(scan, catalogue);
  // One entry per name: when a disabled step sees an enabled and a disabled definition, the nearest wins.
  const byName = new Map<string, RegisterDef>();
  for (const d of visibleDefs(scan, scan.at.frames, scan.at.disabled)) {
    byName.delete(d.name);
    byName.set(d.name, d);
  }
  return [...byName.values()].map((d) => ({ name: d.name, path: d.path, secret: secret.has(d) }));
}

/**
 * True iff the recipe has a `register` or `return` step (enabled or disabled) or a register reference:
 * the recipe needs Forge 1.1 or later (RECIPES-1.1.md section 1.3).
 */
export function recipeUsesV11(recipe: Recipe): boolean {
  const stack: Step[] = [...recipe.steps];
  const refIn = (params: Readonly<Record<string, unknown>> | undefined): boolean =>
    params !== undefined && Object.values(params).some(isRegisterRef);
  while (stack.length > 0) {
    const step = stack.pop() as Step;
    switch (step.kind) {
      case "register":
      case "return":
        return true;
      case "op":
        if (refIn(step.params)) return true;
        break;
      case "if":
        if (step.test.kind === "op" && refIn(step.test.params)) return true;
        stack.push(...step.then, ...(step.else ?? []));
        break;
      case "fork":
      case "subsection":
      case "repeat":
        stack.push(...step.steps);
        break;
      case "comment":
        break;
    }
  }
  return false;
}
