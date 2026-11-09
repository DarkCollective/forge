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
 * Recipe to FL compilation (RECIPES.md section 5). The output is the canonical text form (section 6): it is
 * the unit the baker loads and the text a person reads and pastes. Pure and deterministic.
 */
import { isReservedWord, isVocabName, isWordName } from "@forge/lang";
import { encodedLiteral, jsonStringLiteral, paramLiteral, stringLiteral } from "./literals.js";
import { canonicalRecipe } from "./normalise.js";
import { opIndex } from "./opindex.js";
import type { OpIndex } from "./opindex.js";
import { validateRecipe } from "./validate.js";
import { DEFAULT_RECIPE_VOCAB, DEFAULT_RECIPE_WORD } from "./types.js";
import type {
  CatalogueView,
  CompileOptions,
  CompileOutcome,
  OpStep,
  OpTest,
  ParamValue,
  Recipe,
  RecipeIssue,
  Step,
  StepLine,
} from "./types.js";

/** The first line of every compiled text and of every text the parser accepts. */
export const HEADER_LINE = "\\ forge-recipe 1";

/** The prefix of a disabled line, repeated once per disabled level. */
export const DISABLED_PREFIX = "\\ ~ ";

interface Emitter {
  readonly index: OpIndex;
  readonly out: string[];
  readonly lines: StepLine[];
}

function annotations(
  hash: string | undefined,
  breakpoint: boolean | undefined,
  note: string | undefined,
): string {
  const parts: string[] = [];
  if (hash !== undefined) parts.push(`@pin=${hash}`);
  if (breakpoint === true) parts.push("@break");
  if (note !== undefined && note !== "") parts.push(`@note=${jsonStringLiteral(note)}`);
  return parts.length === 0 ? "" : `  \\ ${parts.join(" ")}`;
}

/** `lits qname`: the literal groups in `ParamSpec` order, then the name. */
function opText(em: Emitter, op: OpStep | OpTest): string {
  const entry = em.index.find(op.op);
  const groups: string[] = [];
  if (entry !== undefined) {
    for (const spec of entry.op.params) {
      const value = (op.params as Record<string, ParamValue> | undefined)?.[spec.name];
      if (value !== undefined) groups.push(paramLiteral(spec, value));
    }
  }
  groups.push(op.op);
  return groups.join(" ");
}

function emitSteps(
  em: Emitter,
  steps: readonly Step[],
  basePath: string,
  nesting: number,
  parentLevel: number,
): void {
  steps.forEach((step, i) => {
    const path = `${basePath}/${i}`;
    const level = parentLevel + (step.kind !== "comment" && step.disabled === true ? 1 : 0);
    const prefix = "  ".repeat(nesting + 1) + DISABLED_PREFIX.repeat(level);
    const startLine = em.out.length + 1;
    const slot = em.lines.length;
    em.lines.push({
      path,
      kind: step.kind,
      startLine,
      endLine: startLine,
      disabled: level > 0,
      breakpoint: step.kind !== "comment" && step.breakpoint === true,
    });
    const child = (list: readonly Step[], key: string): void => {
      emitSteps(em, list, `${path}/${key}`, nesting + 1, level);
    };
    switch (step.kind) {
      case "op":
        em.out.push(prefix + opText(em, step) + annotations(step.hash, step.breakpoint, step.note));
        break;
      case "comment":
        em.out.push(`${prefix}\\ # ${jsonStringLiteral(step.text)}`);
        break;
      case "fork":
        em.out.push(
          `${prefix}recipe:as-bytes ${encodedLiteral(step.split)} ${encodedLiteral(step.join)} [` +
            annotations(undefined, step.breakpoint, step.note),
        );
        child(step.steps, "steps");
        em.out.push(`${prefix}] fork`);
        break;
      case "subsection":
        em.out.push(
          `${prefix}recipe:as-bytes ${stringLiteral(step.pattern)} ${stringLiteral(step.flags ?? "")} ` +
            `${stringLiteral(step.encoding ?? "utf8")} [` +
            annotations(undefined, step.breakpoint, step.note),
        );
        child(step.steps, "steps");
        em.out.push(`${prefix}] recipe:section`);
        break;
      case "if": {
        const test = step.test;
        const [testText, pin] =
          test.kind === "regex"
            ? [
                `${stringLiteral(test.pattern)} ${stringLiteral(test.flags ?? "")} ` +
                  `${stringLiteral(test.encoding ?? "utf8")} recipe:matches`,
                undefined,
              ]
            : [opText(em, test), test.hash];
        em.out.push(
          `${prefix}recipe:as-bytes [ ${testText} ] [` +
            annotations(pin, step.breakpoint, step.note),
        );
        child(step.then, "then");
        em.out.push(`${prefix}] [`);
        child(step.else ?? [], "else");
        em.out.push(`${prefix}] recipe:branch`);
        break;
      }
      case "repeat": {
        const settle = step.until !== undefined;
        const count = settle ? (step.max ?? 100) : (step.times ?? 1);
        em.out.push(
          `${prefix}recipe:as-bytes ${count} [` +
            annotations(undefined, step.breakpoint, step.note),
        );
        child(step.steps, "steps");
        em.out.push(`${prefix}] ${settle ? "recipe:settle" : "recipe:repeat"}`);
        break;
      }
    }
    em.lines[slot] = { ...(em.lines[slot] as StepLine), endLine: em.out.length };
  });
}

/** The text of an already canonical recipe, and the lines of its steps. */
export function emitRecipe(
  recipe: Recipe,
  catalogue: CatalogueView,
  word: string,
): { text: string; lines: StepLine[] } {
  const em: Emitter = { index: opIndex(catalogue), out: [HEADER_LINE], lines: [] };
  if (recipe.name !== undefined) em.out.push(`\\ name ${jsonStringLiteral(recipe.name)}`);
  if (recipe.description !== undefined) {
    em.out.push(`\\ description ${jsonStringLiteral(recipe.description)}`);
  }
  if (recipe.catalogue !== undefined) {
    em.out.push(`\\ catalogue ${jsonStringLiteral(recipe.catalogue)}`);
  }
  em.out.push(`: ${word} ( bytes -- any )`);
  emitSteps(em, recipe.steps, "/steps", 0, 0);
  em.out.push(";");
  return { text: `${em.out.join("\n")}\n`, lines: em.lines };
}

function optionIssue(message: string, constraint: string): CompileOutcome {
  const issue: RecipeIssue = {
    code: "bad-value",
    severity: "error",
    path: "",
    message,
    detail: { constraint },
  };
  return { ok: false, issues: [issue] };
}

/**
 * Validates (pins per `options.pins`, default `"warn"`), then emits the canonical text of the canonical
 * recipe. Never throws.
 */
export function compileRecipe(
  recipe: unknown,
  catalogue: CatalogueView,
  options?: CompileOptions,
): CompileOutcome {
  try {
    const word = options?.word ?? DEFAULT_RECIPE_WORD;
    const vocab = options?.vocab ?? DEFAULT_RECIPE_VOCAB;
    if (!isWordName(word) || isReservedWord(word)) {
      return optionIssue("the word option is not a usable word name", "word name");
    }
    if (!isVocabName(vocab))
      return optionIssue("the vocab option is not a vocabulary name", "vocab name");
    const checked = validateRecipe(recipe, catalogue, { pins: options?.pins ?? "warn" });
    if (!checked.ok) return { ok: false, issues: checked.issues };
    const { text, lines } = emitRecipe(canonicalRecipe(checked.recipe, catalogue), catalogue, word);
    return { ok: true, text, word: `${vocab}:${word}`, lines, issues: checked.issues };
  } catch {
    // Only a broken catalogue can get here: the recipe itself is validated first.
    return optionIssue("the recipe could not be compiled", "compiler");
  }
}
