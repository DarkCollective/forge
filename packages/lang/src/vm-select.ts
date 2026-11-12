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
 * Pure helpers of the selection combinators of LANGUAGE-0.2.md section 11: the up-front checks of
 * the lists of `cond` and `case`, and the stable ordering behind `sort-by`.
 */
import { ForgeError } from "./errors.js";
import type { Value } from "./types.js";
import { cpCompare } from "./values.js";

function typeError(
  expected: string,
  actual: string,
  extra: Record<string, unknown> = {},
): ForgeError {
  return new ForgeError({
    code: "E_TYPE",
    message: `expected ${expected}, got ${actual}`,
    detail: { expected, actual, ...extra },
  });
}

/** `cond`: the argument is a list that holds quotations only (checked before any test runs). */
export function checkCondList(v: Value): readonly Value[] {
  if (v.tag !== "list") throw typeError("list", v.tag);
  const items = v.v;
  for (let i = 0; i < items.length; i++) {
    const it = items[i] as Value;
    if (it.tag !== "quot") throw typeError("quot", it.tag, { index: i, word: "cond" });
  }
  return items;
}

/**
 * `case`: the argument is a list of (value, action quotation) pairs with an optional final
 * default quotation. A value that is a quotation can never match; an action that is not a
 * quotation is an error. Both are checked before any comparison.
 */
export function checkCaseList(v: Value): readonly Value[] {
  if (v.tag !== "list") throw typeError("list", v.tag);
  const items = v.v;
  const pairs = items.length >> 1;
  for (let i = 0; i < pairs; i++) {
    const key = items[2 * i] as Value;
    if (key.tag === "quot")
      throw typeError("a non-quot value", "quot", { index: 2 * i, word: "case" });
    const act = items[2 * i + 1] as Value;
    if (act.tag !== "quot") throw typeError("quot", act.tag, { index: 2 * i + 1, word: "case" });
  }
  if (items.length % 2 === 1) {
    const d = items[items.length - 1] as Value;
    if (d.tag !== "quot") throw typeError("quot", d.tag, { index: items.length - 1, word: "case" });
  }
  return items;
}

type KeyClass = "number" | "str" | "bytes";

function keyClass(v: Value): KeyClass {
  switch (v.tag) {
    case "int":
    case "num":
      return "number";
    case "str":
    case "bytes":
      return v.tag;
    default:
      throw typeError("number, str or bytes", v.tag, { word: "sort-by" });
  }
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    if (x !== y) return x < y ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

/**
 * The items ordered stably by their keys: all numbers (`int` and `num` mixed, exact), all `str`
 * (code point order) or all `bytes` (lexicographic). Any other mixture or tag is `E_TYPE`.
 */
export function sortByKeys(items: readonly Value[], keys: readonly Value[]): Value[] {
  if (keys.length < 2) {
    if (keys.length === 1) keyClass(keys[0] as Value);
    return items.slice();
  }
  const first = keyClass(keys[0] as Value);
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i] as Value;
    if (keyClass(k) !== first) throw typeError(first, k.tag, { index: i, word: "sort-by" });
  }
  const idx = keys.map((_, i) => i);
  let cmp: (a: number, b: number) => number;
  if (first === "number") {
    cmp = (a, b) => {
      const x = (keys[a] as Value & { tag: "int" | "num" }).v;
      const y = (keys[b] as Value & { tag: "int" | "num" }).v;
      return x < y ? -1 : x > y ? 1 : 0;
    };
  } else if (first === "str") {
    cmp = (a, b) =>
      cpCompare((keys[a] as Value & { tag: "str" }).v, (keys[b] as Value & { tag: "str" }).v);
  } else {
    cmp = (a, b) =>
      compareBytes(
        (keys[a] as Value & { tag: "bytes" }).v,
        (keys[b] as Value & { tag: "bytes" }).v,
      );
  }
  idx.sort(cmp);
  return idx.map((i) => items[i] as Value);
}
