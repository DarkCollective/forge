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
 * list primitives: the sort and the shuffle that FL lacks (the core has no sort word, and a Fisher-Yates in FL
 * would grow a list one swap at a time, which is quadratic). The words are shared: other vocabularies call
 * them qualified (`list:sort`, `list:sort-by`, `list:shuffle`), and none of them is a catalogue op.
 *
 *  - `sort ( items:list -- list )`: stable ascending sort of a list of numbers (int and num, compared as
 *    numbers, big integers included) or of strings (by code point, not by UTF-16 code unit). A list that mixes
 *    numbers with strings, or holds anything else, is E_COERCE; an empty list is returned as it is.
 *  - `sort-by ( items:list keys:list -- list )`: the items reordered by a stable ascending sort of their keys
 *    (keys follow the same rules as in `sort`); the two lists must be the same length (E_RANGE).
 *  - `shuffle ( items:list -- list )`: a uniform random permutation (Fisher-Yates over `random:below`'s
 *    CSPRNG draw), +random.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef, Value } from "@forge/lang";
import { coerceFailure, rangeFailure } from "../prim-util.js";
import { randomBelow } from "./random.js";

type Compare = (a: number, b: number) => number;

/** Order of two strings by code point: UTF-16 order, except that surrogates (astral characters) sort above U+E000 to U+FFFF. */
function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    let x = a.charCodeAt(i);
    let y = b.charCodeAt(i);
    if (x === y) continue;
    if (x >= 0xd800 && y >= 0xd800) {
      if (x >= 0xe000) x -= 0x800;
      else x += 0x2000;
      if (y >= 0xe000) y -= 0x800;
      else y += 0x2000;
    }
    return x - y;
  }
  return a.length - b.length;
}

/** A comparison over the payloads of the keys, or E_COERCE when they are not all numbers or all strings. */
function keyOrder(keys: readonly Value[]): (a: number, b: number) => number {
  let kind: "num" | "str" | null = null;
  for (const k of keys) {
    const group = k.tag === "int" || k.tag === "num" ? "num" : k.tag === "str" ? "str" : null;
    if (group === null || (kind !== null && kind !== group)) {
      throw coerceFailure("list", "sort keys", "the elements must be all numbers or all strings");
    }
    kind = group;
  }
  const v = (i: number) => keys[i]?.v as number | bigint | string;
  if (kind === "str") return (a, b) => compareCodePoints(v(a) as string, v(b) as string);
  return (a, b) => {
    const x = v(a) as number | bigint;
    const y = v(b) as number | bigint;
    return x < y ? -1 : x > y ? 1 : 0;
  };
}

/** The indexes 0..n-1 in stable ascending order of the keys. */
function order(keys: readonly Value[], compare: Compare = keyOrder(keys)): number[] {
  const idx = Array.from({ length: keys.length }, (_, i) => i);
  // Array.prototype.sort is stable (ES2019); the index tie-break keeps the guarantee explicit.
  idx.sort((a, b) => compare(a, b) || a - b);
  return idx;
}

function sort(items: readonly Value[]): Value[] {
  return order(items).map((i) => items[i] as Value);
}

function sortBy(items: readonly Value[], keys: readonly Value[]): Value[] {
  if (items.length !== keys.length) {
    throw rangeFailure("the items and the keys must be the same length", {
      items: items.length,
      keys: keys.length,
    });
  }
  return order(keys).map((i) => items[i] as Value);
}

function shuffle(items: readonly Value[]): Value[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1);
    const t = out[i] as Value;
    out[i] = out[j] as Value;
    out[j] = t;
  }
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("list", "sort", "( items:list -- list )", sort, {
    doc: "A stable ascending sort of a list of numbers (int and num together, compared as numbers, big integers included) or of strings (by code point). A list that mixes numbers and strings, or holds anything else, is E_COERCE. Shared word: call it qualified from any vocabulary.",
  }),
  definePrimitive("list", "sort-by", "( items:list keys:list -- list )", sortBy, {
    doc: "The items in the order of a stable ascending sort of their keys (all numbers or all strings, by the rules of list:sort; E_COERCE otherwise). The lists must be the same length (E_RANGE). Compute the keys with map. Shared word: call it qualified from any vocabulary.",
  }),
  definePrimitive("list", "shuffle", "( items:list -- list )", shuffle, {
    effects: ["+random"],
    doc: "A uniform random permutation of the list (Fisher-Yates on the host CSPRNG). Shared word: call it qualified from any vocabulary.",
  }),
];
