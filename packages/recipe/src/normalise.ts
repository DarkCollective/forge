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
 * Normal forms (RECIPES.md section 3.6): `normaliseRecipe` (catalogue-free), `resolveRecipe`,
 * `canonicalRecipe` and `pinRecipe`. All are pure and idempotent, and build fresh objects from a whitelist of
 * keys. They expect a recipe that passed `validateRecipe`, whose nesting is therefore bounded by `maxDepth`.
 */
import type { ParamSpec } from "@forge/lang";
import { hexDecode, hexEncode, normaliseEncodedValue } from "./encoding.js";
import { opIndex } from "./opindex.js";
import type { OpIndex } from "./opindex.js";
import { RECIPE_LIMITS } from "./types.js";
import type {
  CatalogueView,
  Encoded,
  IfTest,
  OpStep,
  OpTest,
  ParamValue,
  ParamValues,
  Recipe,
  Step,
} from "./types.js";

type Obj = Record<string, unknown>;

/** True for a `{ value: string, enc: string }` object (recognised by shape). */
export function isEncodedShape(v: unknown): v is Encoded {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Obj).value === "string" &&
    typeof (v as Obj).enc === "string"
  );
}

function normaliseEncoded(e: Encoded): Encoded {
  return { value: normaliseEncodedValue(e.value, e.enc), enc: e.enc };
}

/** `flags` rewritten as the unique characters of `ims`, in that order. */
function normaliseFlags(flags: string): string {
  return ["i", "m", "s"].filter((c) => flags.includes(c)).join("");
}

function nonEmpty(s: string | undefined): s is string {
  return s !== undefined && s !== "";
}

function copyCommon(out: Obj, step: Step): void {
  if (step.kind === "comment") return;
  if (step.disabled === true) out.disabled = true;
  if (step.breakpoint === true) out.breakpoint = true;
  if (nonEmpty(step.note)) out.note = step.note;
}

function normaliseParams(params: ParamValues | undefined): ParamValues | undefined {
  if (params === undefined) return undefined;
  const keys = Object.keys(params).sort();
  if (keys.length === 0) return undefined;
  return Object.fromEntries(
    keys.map((k) => {
      const v = (params as Obj)[k] as ParamValue;
      return [k, isEncodedShape(v) ? normaliseEncoded(v) : v];
    }),
  );
}

function normaliseTest(test: IfTest): IfTest {
  if (test.kind === "op") {
    const out: Obj = { kind: "op", op: test.op };
    const params = normaliseParams(test.params);
    if (params !== undefined) out.params = params;
    if (test.hash !== undefined) out.hash = test.hash;
    return out as unknown as OpTest;
  }
  const out: Obj = { kind: "regex", pattern: test.pattern };
  const flags = normaliseFlags(test.flags ?? "");
  if (flags !== "") out.flags = flags;
  if (test.encoding !== undefined && test.encoding !== "utf8") out.encoding = test.encoding;
  return out as unknown as IfTest;
}

function normaliseStep(step: Step): Step {
  const out: Obj = { kind: step.kind };
  switch (step.kind) {
    case "op": {
      out.op = step.op;
      const params = normaliseParams(step.params);
      if (params !== undefined) out.params = params;
      if (step.hash !== undefined) out.hash = step.hash;
      break;
    }
    case "fork":
      out.split = normaliseEncoded(step.split);
      out.join = normaliseEncoded(step.join);
      out.steps = step.steps.map(normaliseStep);
      break;
    case "subsection": {
      out.pattern = step.pattern;
      const flags = normaliseFlags(step.flags ?? "");
      if (flags !== "") out.flags = flags;
      if (step.encoding !== undefined && step.encoding !== "utf8") out.encoding = step.encoding;
      out.steps = step.steps.map(normaliseStep);
      break;
    }
    case "if":
      out.test = normaliseTest(step.test);
      out.then = step.then.map(normaliseStep);
      if (step.else !== undefined && step.else.length > 0) out.else = step.else.map(normaliseStep);
      break;
    case "repeat":
      if (step.times !== undefined) out.times = step.times;
      if (step.until !== undefined) {
        out.until = step.until;
        if (step.max !== undefined && step.max !== RECIPE_LIMITS.defaultRepeatCap) {
          out.max = step.max;
        }
      }
      out.steps = step.steps.map(normaliseStep);
      break;
    case "comment":
      out.text = step.text;
      break;
  }
  copyCommon(out, step);
  return out as unknown as Step;
}

/** The catalogue-free normal form: key order, omitted defaults, `flags` and encoded values normalised. */
export function normaliseRecipe(recipe: Recipe): Recipe {
  const out: Obj = { forge: recipe.forge };
  if (nonEmpty(recipe.name)) out.name = recipe.name;
  if (nonEmpty(recipe.description)) out.description = recipe.description;
  if (recipe.catalogue !== undefined) out.catalogue = recipe.catalogue;
  out.steps = recipe.steps.map(normaliseStep);
  return out as unknown as Recipe;
}

// ---------------------------------------------------------------------------------------------
// resolve and pin: rebuild op steps and op tests
// ---------------------------------------------------------------------------------------------

type OpLike = OpStep | OpTest;

/** Rebuilds an op step or test in canonical key order: `kind op params hash`, then the remaining keys. */
function rebuildOp<T extends OpLike>(
  o: T,
  op: string,
  params: ParamValues | undefined,
  hash: string | undefined,
): T {
  const out: Obj = { kind: "op", op };
  if (params !== undefined) out.params = params;
  if (hash !== undefined) out.hash = hash;
  for (const key of Object.keys(o)) {
    if (key !== "kind" && key !== "op" && key !== "params" && key !== "hash") {
      out[key] = (o as unknown as Obj)[key];
    }
  }
  return out as unknown as T;
}

function mapSteps(steps: readonly Step[], fn: <T extends OpLike>(o: T) => T): Step[] {
  return steps.map((s): Step => {
    switch (s.kind) {
      case "op":
        return fn(s);
      case "comment":
        return s;
      case "fork":
      case "subsection":
      case "repeat":
        return { ...s, steps: mapSteps(s.steps, fn) };
      case "if": {
        const test = s.test.kind === "op" ? fn(s.test) : s.test;
        const out: Obj = { ...s, test, then: mapSteps(s.then, fn) };
        if (s.else !== undefined) out.else = mapSteps(s.else, fn);
        return out as unknown as Step;
      }
    }
  });
}

/** Normal spelling of a parameter value according to the parameter's declared type. */
function normaliseByType(spec: ParamSpec, v: ParamValue): ParamValue {
  switch (spec.type) {
    case "int": {
      if (typeof v !== "string") return v;
      const n = Number(v);
      return Number.isSafeInteger(n) && String(n) === v ? n : v;
    }
    case "bytes": {
      if (typeof v !== "string") return v;
      const bytes = hexDecode(v);
      return bytes === null ? v : hexEncode(bytes);
    }
    case "toggle":
    case "key":
      return isEncodedShape(v) ? normaliseEncoded(v) : v;
    default:
      return v;
  }
}

function resolveOp<T extends OpLike>(index: OpIndex, o: T): T {
  const entry = index.find(o.op);
  if (entry === undefined) return o;
  const specs = entry.op.params;
  let params: ParamValues | undefined;
  if (specs.length > 0) {
    const entries: [string, ParamValue][] = [];
    for (const spec of specs) {
      const given =
        o.params !== undefined && Object.hasOwn(o.params, spec.name)
          ? (o.params as Obj)[spec.name]
          : spec.default;
      if (given !== undefined) {
        entries.push([spec.name, normaliseByType(spec, given as ParamValue)]);
      }
    }
    params = Object.fromEntries(entries);
  }
  return rebuildOp(o, entry.op.qname, params, o.hash);
}

/** Aliases replaced by canonical names; every parameter made explicit, in `ParamSpec` order; values normalised by type. */
export function resolveRecipe(recipe: Recipe, catalogue: CatalogueView): Recipe {
  const index = opIndex(catalogue);
  return { ...recipe, steps: mapSteps(recipe.steps, (o) => resolveOp(index, o)) };
}

/** `resolveRecipe(normaliseRecipe(recipe), catalogue)`. */
export function canonicalRecipe(recipe: Recipe, catalogue: CatalogueView): Recipe {
  return resolveRecipe(normaliseRecipe(recipe), catalogue);
}

/**
 * Sets `hash` on every op step and op test from the catalogue. With `onlyMissing`, a pin that is already
 * there is kept (the share encoder uses this). An op the catalogue does not know is left alone.
 */
export function pinOps(recipe: Recipe, catalogue: CatalogueView, onlyMissing: boolean): Recipe {
  const index = opIndex(catalogue);
  const fn = <T extends OpLike>(o: T): T => {
    const entry = index.find(o.op);
    if (entry === undefined || (onlyMissing && o.hash !== undefined)) return o;
    return rebuildOp(o, o.op, o.params, entry.op.hash);
  };
  return { ...recipe, steps: mapSteps(recipe.steps, fn) };
}

/** Sets `hash` on every op step and op test from the catalogue (overwriting). */
export function pinRecipe(recipe: Recipe, catalogue: CatalogueView): Recipe {
  return pinOps(recipe, catalogue, false);
}
