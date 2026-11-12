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
 * Compiler support for mid-body locals (`:> name`) and `exit` (LANGUAGE-0.2.md sections 8 and
 * 11.5): the scope stack of bound names, the lowering plan (the single place that decides which
 * literal quotations are lowered to jumps), and the generation context that carries the
 * "is `exit` allowed here" state and the `own` marker of quotations.
 *
 * Only types are imported from `compiler.ts`, so there is no runtime import cycle.
 */
import { ForgeError } from "./errors.js";
import type { Item } from "./compiler.js";
import type { Instruction, SourcePos } from "./types.js";

// ---------------------------------------------------------------------------------------------
// Scopes of bound names
// ---------------------------------------------------------------------------------------------

/**
 * The visible locals of the body being parsed and the scopes that bound some of them. Header
 * locals live in `locals` from the start and are never removed; a name bound by `:>` is removed
 * when the innermost `[ ... ]` that contains the `:>` closes. Slots are never reused.
 */
export class LocalScopes {
  /** Names bound by `:>` in slot order, starting at slot `firstFree`. */
  readonly bound: string[] = [];
  private readonly frames: string[][] = [[]];
  private lists = 0;
  private readonly listFlags: boolean[] = [];

  constructor(
    /** Visible local names to slots; shared with the parser. */
    readonly locals: Map<string, number>,
    private readonly firstFree: number,
  ) {}

  /** True while inside a `{ }` list literal, however deeply nested. */
  get inList(): boolean {
    return this.lists > 0;
  }

  /** Opens the scope of a `[ ]` quotation or a `{ }` list literal. */
  enter(isQuotation: boolean): void {
    this.frames.push([]);
    this.listFlags.push(!isQuotation);
    if (!isQuotation) this.lists++;
  }

  /** Closes the innermost scope: the names bound in it stop being visible. */
  leave(): void {
    const names = this.frames.pop() as string[];
    for (const n of names) this.locals.delete(n);
    if (this.listFlags.pop() === true) this.lists--;
  }

  /** Binds `name` to the next free slot and returns the slot. */
  declare(name: string): number {
    const slot = this.firstFree + this.bound.length;
    this.bound.push(name);
    this.locals.set(name, slot);
    (this.frames[this.frames.length - 1] as string[]).push(name);
    return slot;
  }
}

// ---------------------------------------------------------------------------------------------
// The lowering plan
// ---------------------------------------------------------------------------------------------

export type LowerShape = "if" | "while" | "when" | "unless" | "loop";

/** A literal-quotation combinator that is lowered inline, and how many items it consumes. */
export interface LowerPlan {
  readonly shape: LowerShape;
  readonly used: number;
}

function intrinsicNameOf(item: Item | undefined): string | undefined {
  return item !== undefined && item.k === "word" && item.entry.kind === "intrinsic"
    ? item.entry.intrinsic
    : undefined;
}

const bindsCache = new WeakMap<readonly Item[], boolean>();

/**
 * Does running these items bind a local in the frame that runs them? True for a `bind` item and
 * for one inside a quotation that is lowered inline into this frame. A quotation that is not
 * lowered is a frame of its own (marked `own`), and a list literal holds no binding.
 */
export function bindsInFrame(items: readonly Item[]): boolean {
  const known = bindsCache.get(items);
  if (known !== undefined) return known;
  let found = false;
  for (let i = 0; i < items.length && !found;) {
    const it = items[i] as Item;
    if (it.k === "bind") {
      found = true;
      break;
    }
    const plan = lowerPlan(items, i);
    if (plan === null) {
      i++;
      continue;
    }
    const a = items[i] as Item;
    const b = items[i + 1] as Item;
    if (a.k === "quot" && bindsInFrame(a.items)) found = true;
    else if ((plan.shape === "if" || plan.shape === "while") && b.k === "quot") {
      found = bindsInFrame(b.items);
    }
    i += plan.used;
  }
  bindsCache.set(items, found);
  return found;
}

/**
 * Which inline lowering applies at `items[i]` (spec 8, "Lowering"), or null. `while` and `loop`
 * are not lowered when a quotation they run binds a local (LANGUAGE-0.2.md section 8): the body
 * would re-run in one frame and overwrite a slot that a closure of an earlier iteration holds.
 */
export function lowerPlan(items: readonly Item[], i: number): LowerPlan | null {
  const a = items[i];
  if (a === undefined || a.k !== "quot") return null;
  const b = items[i + 1];
  const c = items[i + 2];
  if (b !== undefined && b.k === "quot" && c !== undefined) {
    const third = intrinsicNameOf(c);
    if (third === "if") return { shape: "if", used: 3 };
    if (third === "while") {
      return bindsInFrame(a.items) || bindsInFrame(b.items) ? null : { shape: "while", used: 3 };
    }
  }
  const second = intrinsicNameOf(b);
  if (second === "when") return { shape: "when", used: 2 };
  if (second === "unless") return { shape: "unless", used: 2 };
  if (second === "loop") return bindsInFrame(a.items) ? null : { shape: "loop", used: 2 };
  return null;
}

// ---------------------------------------------------------------------------------------------
// Generation context
// ---------------------------------------------------------------------------------------------

/** What code generation needs to know about the frame it is generating for. */
export interface GenCtx {
  /** Qualified name of the word, for errors. */
  readonly word: string;
  readonly vocab: string;
  /** May `exit` be compiled here (word body, or a quotation lowered inline into it)? */
  readonly exitOk: boolean;
  /** `dmark` frames open at this point of the frame. */
  readonly marks: number;
  /** Set when a `bind` is generated for this frame; shared by the inline-lowered parts. */
  readonly frame: { binds: boolean };
}

export function rootGenCtx(word: string, vocab: string, exitOk: boolean): GenCtx {
  return { word, vocab, exitOk, marks: 0, frame: { binds: false } };
}

/** The context of a quotation that is a frame of its own (not lowered). */
export function quotGenCtx(gx: GenCtx): GenCtx {
  return { word: gx.word, vocab: gx.vocab, exitOk: false, marks: 0, frame: { binds: false } };
}

/** The context of a list literal: `exit` is not allowed inside it. */
export function listGenCtx(gx: GenCtx): GenCtx {
  return { ...gx, exitOk: false };
}

/** The context of the quotations of a lowered `while` or `loop`: one more open `dmark`. */
export function loopGenCtx(gx: GenCtx): GenCtx {
  return { ...gx, marks: gx.marks + 1 };
}

/** The `quot` instruction for a body whose generation used `qx`. */
export function quotInstruction(end: number, qx: GenCtx): Instruction {
  return qx.frame.binds ? { op: "quot", end, own: true } : { op: "quot", end };
}

/** The `exit` instruction, or E_SYNTAX where it cannot be a jump. */
export function exitInstruction(gx: GenCtx, pos: SourcePos): Instruction {
  if (!gx.exitOk) {
    throw new ForgeError({
      code: "E_SYNTAX",
      message: "'exit' is only allowed where it compiles to a jump",
      word: gx.word,
      vocab: gx.vocab,
      pos,
      detail: { expected: "a word body or a quotation lowered by if, when, unless, while or loop" },
    });
  }
  return { op: "exit", marks: gx.marks };
}
