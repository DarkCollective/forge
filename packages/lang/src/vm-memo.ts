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
 * `MEMO:` at run time (LANGUAGE-0.2.md section 9): storing the value a memo word built into the
 * cache of its entry. The calling code (the `memo` instruction and the store at `ret`) is in
 * vm.ts; the decision whether a value may be cached lives here.
 */
import type { FlWordEntry, MemoSlot, Value } from "./types.js";
import { sizeOf } from "./values.js";

/** A memo build in progress, held by the frame of the memo word. */
export interface MemoBuild {
  readonly entry: FlWordEntry;
  /** The collector frame that was innermost when the build started; restored when it ends. */
  readonly savedCollector: unknown;
}

/** Does the value hold a quotation anywhere? Such a value pins code and an environment. */
function containsQuot(value: Value): boolean {
  const work: Value[] = [value];
  while (work.length > 0) {
    const x = work.pop() as Value;
    if (x.tag === "quot") return true;
    if (x.tag === "list") for (const item of x.v) work.push(item);
    else if (x.tag === "record") for (const v of x.v.values()) work.push(v);
  }
  return false;
}

/**
 * Caches `value` in `slot` if it fits the runtime's budget. Returns whether it was cached. A value
 * that would exceed the cap, or that holds a quotation, is not cached (the caller still has it).
 */
export function retainMemo(slot: MemoSlot, value: Value): boolean {
  if (slot.value !== undefined) return true;
  const bytes = sizeOf(value);
  const budget = slot.budget;
  if (bytes > budget.cap - budget.used) return false;
  if (containsQuot(value)) return false;
  slot.value = value;
  slot.bytes = bytes;
  budget.used += bytes;
  return true;
}
