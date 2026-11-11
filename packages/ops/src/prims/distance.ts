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

/*
 * distance primitives. Only `_levenshtein` is a primitive: the edit distance is a dynamic programme of
 * length(a) * length(b) cells, each depending on its left, upper and diagonal neighbours. FL has no fast
 * mutable array and no per-element state in `map` (the same gap as `sigaba:_run`), so a row has to be rebuilt
 * as a list for every character of one sample, and every cell costs dozens of interpreter steps. At the default
 * limit of 10 million steps that is a few hundred characters per sample; the primitive does 64 KiB against a
 * few thousand characters in milliseconds. Everything else in the `distance` vocabulary is FL.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { limitFailure } from "../prim-util.js";

/** Most cells (length a times length b) one call may compute: about a second of work. */
export const MAX_CELLS = 100_000_000;

/** The weighted edit distance that turns `a` into `b`, over code points (two rows of the dynamic programme). */
export function levenshtein(a: string, b: string, ins: number, del: number, sub: number): number {
  const x = Array.from(a);
  const y = Array.from(b);
  if (x.length * y.length > MAX_CELLS) {
    throw limitFailure("levenshteinCells", MAX_CELLS, x.length * y.length, "Levenshtein cells");
  }
  let prev = new Float64Array(y.length + 1);
  let cur = new Float64Array(y.length + 1);
  for (let j = 1; j <= y.length; j++) prev[j] = (prev[j - 1] as number) + ins;
  for (let i = 1; i <= x.length; i++) {
    cur[0] = (prev[0] as number) + del;
    const xi = x[i - 1];
    for (let j = 1; j <= y.length; j++) {
      const diag = (prev[j - 1] as number) + (xi === y[j - 1] ? 0 : sub);
      const up = (prev[j] as number) + del;
      const left = (cur[j - 1] as number) + ins;
      cur[j] = diag < up ? (diag < left ? diag : left) : up < left ? up : left;
    }
    [prev, cur] = [cur, prev];
  }
  return prev[y.length] as number;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "distance",
    "_levenshtein",
    "( a:str b:str insertion:int deletion:int substitution:int -- int )",
    levenshtein,
    {
      doc: "Weighted edit distance from a to b over code points (private helper of distance:levenshtein).",
      category: "Analysis",
    },
  ),
];
