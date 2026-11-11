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

/*
 * diff primitive: the edit script between two sequences, which FL cannot compute at 64 KiB (it has no mutable
 * arrays, and Myers' algorithm updates a vector of furthest-reaching points at every step).
 *
 *  - `_edits ( a:list b:list -- list )`: a and b are lists of strings (the comparison keys of the tokens of
 *    the two samples: lines, words or characters). The result is a list of runs, each a list of four ints
 *    { kind a-start b-start length }: kind 0 is a run of equal tokens, 1 a run of tokens deleted from a, 2 a run
 *    inserted from b. a-start and b-start are the offsets (0-based) in a and in b where the run starts, also for a
 *    deletion (b-start is where in b it happens) and for an insertion. In a block of changes between two equal runs
 *    the deletion comes first, then the insertion. Equal runs are never adjacent.
 *
 * The algorithm is Myers' O(ND) difference in linear space (the middle snake, found by searching forward and
 * backward at once), after the common prefix and suffix are cut off. It gives a shortest edit script, except that
 * the work is capped: when a sub-problem costs more than WORK_LIMIT steps of the search, the part that is left is
 * reported as one deletion and one insertion (still a correct script, not a shortest one).
 */
import { definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveDef, Value } from "@forge/lang";
import { coerceFailure } from "../prim-util.js";

const { int, list } = valueHelpers;

/** Total search steps (one per diagonal examined) allowed in one call before the rest is replaced wholesale. */
const WORK_LIMIT = 60_000_000;

const EQ = 0;
const DEL = 1;
const INS = 2;

interface Search {
  readonly a: Int32Array;
  readonly b: Int32Array;
  /** Edit codes in order, one per token: EQ, DEL or INS. */
  readonly ops: number[];
  work: number;
}

/** The point (x, y) in a[aLo..aHi) x b[bLo..bHi) where a shortest path is split, or null (no common token, or over budget). */
function bisect(
  s: Search,
  aLo: number,
  aHi: number,
  bLo: number,
  bHi: number,
): [number, number] | null {
  const { a, b } = s;
  const n = aHi - aLo;
  const m = bHi - bLo;
  const maxD = Math.ceil((n + m) / 2);
  const off = maxD;
  const len = 2 * maxD + 2;
  const v1 = new Int32Array(len).fill(-1);
  const v2 = new Int32Array(len).fill(-1);
  v1[off + 1] = 0;
  v2[off + 1] = 0;
  const delta = n - m;
  const front = delta % 2 !== 0;
  let k1start = 0;
  let k1end = 0;
  let k2start = 0;
  let k2end = 0;
  for (let d = 0; d < maxD; d++) {
    for (let k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
      if (++s.work > WORK_LIMIT) return null;
      const o1 = off + k1;
      let x1 =
        k1 === -d || (k1 !== d && (v1[o1 - 1] as number) < (v1[o1 + 1] as number))
          ? (v1[o1 + 1] as number)
          : (v1[o1 - 1] as number) + 1;
      let y1 = x1 - k1;
      while (x1 < n && y1 < m && a[aLo + x1] === b[bLo + y1]) {
        x1++;
        y1++;
      }
      v1[o1] = x1;
      if (x1 > n) k1end += 2;
      else if (y1 > m) k1start += 2;
      else if (front) {
        const o2 = off + delta - k1;
        if (o2 >= 0 && o2 < len && (v2[o2] as number) !== -1) {
          if (x1 >= n - (v2[o2] as number)) return [x1, y1];
        }
      }
    }
    for (let k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
      if (++s.work > WORK_LIMIT) return null;
      const o2 = off + k2;
      let x2 =
        k2 === -d || (k2 !== d && (v2[o2 - 1] as number) < (v2[o2 + 1] as number))
          ? (v2[o2 + 1] as number)
          : (v2[o2 - 1] as number) + 1;
      let y2 = x2 - k2;
      while (x2 < n && y2 < m && a[aHi - x2 - 1] === b[bHi - y2 - 1]) {
        x2++;
        y2++;
      }
      v2[o2] = x2;
      if (x2 > n) k2end += 2;
      else if (y2 > m) k2start += 2;
      else if (!front) {
        const o1 = off + delta - k2;
        if (o1 >= 0 && o1 < len && (v1[o1] as number) !== -1) {
          const x1 = v1[o1] as number;
          const y1 = off + x1 - o1;
          if (x1 >= n - x2) return [x1, y1];
        }
      }
    }
  }
  return null;
}

/** Append the edits of a[aLo..aHi) against b[bLo..bHi) to s.ops. */
function diffRange(s: Search, aLo0: number, aHi0: number, bLo0: number, bHi0: number): void {
  let aLo = aLo0;
  let aHi = aHi0;
  let bLo = bLo0;
  let bHi = bHi0;
  const { a, b, ops } = s;
  let prefix = 0;
  while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) {
    aLo++;
    bLo++;
    prefix++;
  }
  let suffix = 0;
  while (aLo < aHi && bLo < bHi && a[aHi - 1] === b[bHi - 1]) {
    aHi--;
    bHi--;
    suffix++;
  }
  for (let i = 0; i < prefix; i++) ops.push(EQ);
  const n = aHi - aLo;
  const m = bHi - bLo;
  if (n === 0 || m === 0) {
    for (let i = 0; i < n; i++) ops.push(DEL);
    for (let i = 0; i < m; i++) ops.push(INS);
  } else {
    const split = bisect(s, aLo, aHi, bLo, bHi);
    if (
      split === null ||
      (split[0] === 0 && split[1] === 0) ||
      (split[0] === n && split[1] === m)
    ) {
      for (let i = 0; i < n; i++) ops.push(DEL);
      for (let i = 0; i < m; i++) ops.push(INS);
    } else {
      diffRange(s, aLo, aLo + split[0], bLo, bLo + split[1]);
      diffRange(s, aLo + split[0], aHi, bLo + split[1], bHi);
    }
  }
  for (let i = 0; i < suffix; i++) ops.push(EQ);
}

/** The keys as small integers, equal strings getting equal numbers. */
function intern(a: readonly Value[], b: readonly Value[]): [Int32Array, Int32Array] {
  const ids = new Map<string, number>();
  const conv = (items: readonly Value[]): Int32Array => {
    const out = new Int32Array(items.length);
    items.forEach((item, i) => {
      if (item.tag !== "str") {
        throw coerceFailure(item.tag, "str", "the diff keys must be strings");
      }
      const key = item.v as string;
      let id = ids.get(key);
      if (id === undefined) {
        id = ids.size;
        ids.set(key, id);
      }
      out[i] = id;
    });
    return out;
  };
  return [conv(a), conv(b)];
}

function edits(aKeys: readonly Value[], bKeys: readonly Value[]): Value[] {
  const [a, b] = intern(aKeys, bKeys);
  const s: Search = { a, b, ops: [], work: 0 };
  diffRange(s, 0, a.length, 0, b.length);
  // Group the codes into runs. A block of changes between two equal runs becomes one deletion and one insertion.
  const runs: Value[] = [];
  let ai = 0;
  let bi = 0;
  let i = 0;
  const ops = s.ops;
  while (i < ops.length) {
    if (ops[i] === EQ) {
      let j = i;
      while (j < ops.length && ops[j] === EQ) j++;
      runs.push(list([int(EQ), int(ai), int(bi), int(j - i)]));
      ai += j - i;
      bi += j - i;
      i = j;
    } else {
      let j = i;
      let dels = 0;
      let inss = 0;
      while (j < ops.length && ops[j] !== EQ) {
        if (ops[j] === DEL) dels++;
        else inss++;
        j++;
      }
      if (dels > 0) runs.push(list([int(DEL), int(ai), int(bi), int(dels)]));
      if (inss > 0) runs.push(list([int(INS), int(ai + dels), int(bi), int(inss)]));
      ai += dels;
      bi += inss;
      i = j;
    }
  }
  return runs;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("diff", "_edits", "( a:list b:list -- list )", edits, {
    doc: "The edit script between two lists of strings as runs { kind a-start b-start length } (0 equal, 1 deleted from a, 2 inserted from b); Myers' difference in linear space, capped in work (private helper of diff:compare).",
    category: "Utils",
  }),
];
