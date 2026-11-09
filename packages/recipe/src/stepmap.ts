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
import { opIndex } from "./opindex.js";
import type { CatalogueView, IpEvent, Recipe, Step, StepIp, StepIpMap, StepLine } from "./types.js";

/** The smallest index in `[0, positions.length]` whose line satisfies `pred` (lines never decrease). */
function firstIp(positions: readonly SourcePos[], pred: (line: number) => boolean): number {
  let lo = 0;
  let hi = positions.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pred((positions[mid] as SourcePos).line)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * Maps the enabled steps of `lines` to instruction ranges. `startIp` is the first instruction on or after the
 * step's first line, `endIp` the first instruction after its last line.
 */
export function resolveStepIps(
  word: string,
  lines: readonly StepLine[],
  positions: readonly SourcePos[],
): StepIpMap {
  const steps: StepIp[] = [];
  for (const line of lines) {
    if (line.disabled || line.kind === "comment") continue;
    steps.push({
      path: line.path,
      kind: line.kind,
      startIp: firstIp(positions, (l) => l >= line.startLine),
      endIp: firstIp(positions, (l) => l > line.endLine),
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
        stack.push(...step.then, ...(step.else ?? []));
        break;
      case "fork":
      case "repeat":
        stack.push(...step.steps);
        break;
    }
  }
  return false;
}
