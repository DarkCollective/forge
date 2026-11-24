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
 * The step to line to instruction map (RECIPES.md sections 5.5 to 5.7) and the hard-kill rule (section 4.1).
 * The map is pure: it needs only `StepLine[]` from the compiler and `CompiledWord.positions` of the loaded word.
 */
import type { SourcePos } from "@forge/lang";
import { childLists } from "./children.js";
import { opIndex } from "./opindex.js";
import type { CatalogueView, IpEvent, Recipe, Step, StepIp, StepIpMap, StepLine } from "./types.js";

/**
 * Maps the enabled steps of `lines` to instruction ranges by line membership (RECIPES-1.1.md section 3.5): `startIp`
 * is the smallest instruction whose line lies in the step's lines, `endIp` the largest such instruction plus one.
 * It does not assume that lines never decrease along the code, which a lowered `if` breaks; for a text whose
 * lines do not decrease the result is the same as "the first instruction on or after the first line, up to the
 * first instruction after the last line". A step with no instruction of its own gets the empty range at the first
 * instruction after its last line.
 */
export function resolveStepIps(
  word: string,
  lines: readonly StepLine[],
  positions: readonly SourcePos[],
): StepIpMap {
  const steps: StepIp[] = [];
  for (const line of lines) {
    if (line.disabled || line.kind === "comment") continue;
    let lo = -1;
    let hi = -1;
    let after = positions.length;
    for (let ip = 0; ip < positions.length; ip++) {
      const l = (positions[ip] as SourcePos).line;
      if (l >= line.startLine && l <= line.endLine) {
        if (lo < 0) lo = ip;
        hi = ip + 1;
      } else if (l > line.endLine && after === positions.length) after = ip;
    }
    steps.push({
      path: line.path,
      kind: line.kind,
      startIp: lo < 0 ? after : lo,
      endIp: lo < 0 ? after : hi,
      breakpoint: line.breakpoint,
    });
  }
  const byIp = new Map<number, { ends: string[]; starts: string[] }>();
  const at = (ip: number): { ends: string[]; starts: string[] } => {
    let e = byIp.get(ip);
    if (e === undefined) {
      e = { ends: [], starts: [] };
      byIp.set(ip, e);
    }
    return e;
  };
  // Document order lists a parent before its children: starts outermost first, ends innermost first.
  for (const s of steps) at(s.startIp).starts.push(s.path);
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i] as StepIp;
    at(s.endIp).ends.push(s.path);
  }
  const events: IpEvent[] = [...byIp.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ip, e]) => ({ ip, ends: e.ends, starts: e.starts }));
  const breakpoints = steps.filter((s) => s.breakpoint).map((s) => ({ word, ip: s.startIp }));
  return { steps, events, breakpoints };
}

/**
 * The path of the deepest enabled step that contains the instruction the first frame of `word` was executing,
 * or null when no frame is in `word` or no step contains the instruction.
 */
export function attributeError(
  word: string,
  frames: readonly { readonly word: string; readonly ip: number }[],
  map: StepIpMap,
): string | null {
  const frame = frames.find((f) => f.word === word);
  if (frame === undefined) return null;
  let found: string | null = null;
  for (const s of map.steps) {
    if (frame.ip >= s.startIp && frame.ip < s.endIp) found = s.path;
  }
  return found;
}

/**
 * True iff an enabled step needs a hard-kill baker: a `subsection`, an `if` with a regex test, or an op (or op
 * test) whose catalogue entry has `needsHardKill`. Disabled steps, and everything inside them, are ignored.
 */
export function recipeNeedsHardKill(recipe: Recipe, catalogue: CatalogueView): boolean {
  const index = opIndex(catalogue);
  const needs = (name: string): boolean => index.find(name)?.op.needsHardKill === true;
  const stack: Step[] = [...recipe.steps];
  while (stack.length > 0) {
    const step = stack.pop() as Step;
    if (step.kind === "comment" || step.disabled === true) continue;
    switch (step.kind) {
      case "op":
        if (needs(step.op)) return true;
        break;
      case "subsection":
        return true;
      case "if":
        if (step.test.kind === "regex" || needs(step.test.op)) return true;
        break;
      default:
        break;
    }
    // Lanes of a slot step, `then` and `else`, and the children of containers (RECIPES-1.2.md section 6.8).
    for (const child of childLists(step)) stack.push(...child.steps);
  }
  return false;
}
