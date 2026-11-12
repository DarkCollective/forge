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
 * `MEMO:` at compile time (LANGUAGE-0.2.md section 9): the header shape, the `stateful` flag of a
 * compiled word, and the purity check. Nothing here executes FL.
 *
 * A memo word is pure when its body, and every word it calls transitively, has no effect label
 * (`+async`, `+random`, `+time`), reads or writes no `VARIABLE`, calls no session word and prints
 * nothing. The effect labels already propagate through `WordMeta.effects`; `stateful` propagates
 * the rest through `CompiledWord.deps` in the same way.
 */
import type { Item } from "./compiler.js";
import type {
  EffectLabel,
  MemoBudget,
  MemoSlot,
  SourcePos,
  StackEffect,
  WordEntry,
} from "./types.js";

/** Words of `core` whose result depends on the session or the dictionary, not on their inputs. */
const SESSION_WORDS: ReadonlySet<string> = new Set([
  "core:help",
  "core:see",
  "core:words",
  "core:vocabs",
  "core:current-vocab",
]);

/** Intrinsics that write to the run's output. */
const OUTPUT_WORDS: ReadonlySet<string> = new Set([".", ".s"]);

/** Default cap on the cached bytes of one runtime: 256 MiB. */
export const DEFAULT_MEMO_CACHE_BYTES = 268_435_456;

/** Default limits of `warm()`, merged over the runtime limits. */
export const DEFAULT_MEMO_LIMITS = Object.freeze({ maxSteps: 2_000_000, maxMillis: 5_000 });

/** Why a word is not pure: an effect label, or `"state"` (variable, session word) or `"output"`. */
export type Impurity = EffectLabel | "state" | "output";

/** Does `entry` itself (not its callees) make a caller stateful? */
function ownImpurity(entry: WordEntry): Impurity | null {
  switch (entry.kind) {
    case "variable":
      return "state";
    case "primitive":
      return SESSION_WORDS.has(entry.qname) ? "state" : null;
    case "intrinsic":
      return OUTPUT_WORDS.has(entry.intrinsic) ? "output" : null;
    case "fl":
      if (entry.code?.stateful === true) return "state";
      return null;
    default:
      return null;
  }
}

/** The effect label of `entry` (directly or through its callees), if any. */
function labelOf(entry: WordEntry): EffectLabel | null {
  const first = entry.meta.effects[0];
  if (first !== undefined) return first;
  if (entry.kind === "primitive") return entry.def.effects?.[0] ?? null;
  return null;
}

/** The first dependency that makes a body impure, with the reason; null for a pure body. */
export function firstImpurity(
  deps: Iterable<WordEntry>,
): { readonly entry: WordEntry; readonly why: Impurity } | null {
  for (const d of deps) {
    const label = labelOf(d);
    if (label !== null) return { entry: d, why: label };
    const own = ownImpurity(d);
    if (own !== null) return { entry: d, why: own };
  }
  return null;
}

/** Is a body with these dependencies `stateful` (reads a variable, a session word, or prints)? */
export function isStateful(deps: Iterable<WordEntry>): boolean {
  for (const d of deps) if (ownImpurity(d) !== null) return true;
  return false;
}

/** Position of the first use of `target` in a parsed body (depth first), or null. */
export function firstUse(items: readonly Item[], target: WordEntry): SourcePos | null {
  for (const it of items) {
    if (it.k === "word") {
      if (it.entry === target) return it.pos;
    } else if (it.k === "quot" || it.k === "list") {
      const p = firstUse(it.items, target);
      if (p !== null) return p;
    }
  }
  return null;
}

/** Why the header `effect` is not the shape `( -- T )` of a memo word; null when it is. */
export function memoHeaderProblem(effect: StackEffect): string | null {
  if (effect.inputs.length !== 0 || effect.variadicInput) {
    return "a MEMO: word takes no input";
  }
  if (effect.unchecked || effect.outputs.length !== 1) {
    return "a MEMO: word has exactly one output";
  }
  const type = (effect.outputs[0] as { readonly type: string }).type;
  if (type === "quot") return "a MEMO: word cannot return a quotation";
  if (type === "any") return "a MEMO: word needs a concrete output type, not 'any'";
  return null;
}

/** A fresh cache slot; `seq` orders the slots of one process by creation. */
let nextSeq = 0;
export function newMemoSlot(budget: MemoBudget): MemoSlot {
  return { bytes: 0, seq: nextSeq++, budget };
}

/** A budget of `cap` bytes with nothing cached. */
export function newMemoBudget(cap: number = DEFAULT_MEMO_CACHE_BYTES): MemoBudget {
  return { cap, used: 0 };
}
