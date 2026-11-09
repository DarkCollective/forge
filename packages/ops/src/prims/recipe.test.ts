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
import { coerce, valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "../bundle.js";
import { isRegexPrimitive, REGEX_LIMITS } from "../regex-engine.js";
import { loadBundleNode } from "../sources-node.js";
import { primitives } from "./recipe.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["recipe"]));
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const utf8 = (s: string) => coerce(str(s), "bytes").v as Uint8Array;

const inRecipe = { scope: { current: "recipe", using: [] as string[] } };

async function split(data: Uint8Array, pattern: string, flags = "", encoding = "utf8") {
  return runtime.call(
    "recipe:_split-matches",
    [bytes(data), str(pattern), str(flags), str(encoding)],
    inRecipe,
  );
}
function pieces(r: Awaited<ReturnType<typeof split>>): Uint8Array[] {
  if (!r.ok) throw r.error;
  const list = r.stack[r.stack.length - 1] as { tag: "list"; v: readonly Value[] };
  return list.v.map((x) => (x as { v: Uint8Array }).v);
}

describe("recipe:_split-matches", () => {
  test("returns gap match gap ... gap, 2k + 1 pieces", async () => {
    const out = pieces(await split(ascii("abc-def-cab"), "[a-c]+"));
    expect(out.map((p) => String.fromCharCode(...p))).toEqual(["", "abc", "-def-", "cab", ""]);
  });

  test("no match is a single gap", async () => {
    const out = pieces(await split(ascii("xyz"), "[a-c]+"));
    expect(out).toEqual([ascii("xyz")]);
  });

  test("empty data is a single empty gap", async () => {
    expect(pieces(await split(new Uint8Array(0), "a"))).toEqual([new Uint8Array(0)]);
  });

  test("empty matches are skipped", async () => {
    expect(pieces(await split(ascii("aaa"), "x*"))).toEqual([ascii("aaa")]);
    expect(pieces(await split(ascii("abc"), "b*")).map((p) => p.length)).toEqual([1, 1, 1]);
  });

  test("the concatenation is the input, for utf8 text including a BOM and astral characters", async () => {
    const data = utf8("﻿héllo 😀 wörld");
    const out = pieces(await split(data, "[éö]|😀"));
    expect(out).toHaveLength(7);
    const joined = new Uint8Array(out.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of out) {
      joined.set(p, at);
      at += p.length;
    }
    expect(joined).toEqual(data);
  });

  test("utf8 data that is not well-formed is E_COERCE", async () => {
    const r = await split(Uint8Array.of(0x61, 0xff), "a");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_COERCE");
  });

  test("latin1 reads every byte as one character and never fails", async () => {
    const out = pieces(await split(Uint8Array.of(0xff, 0x61, 0x62, 0xfe), "[ab]+", "", "latin1"));
    expect(out).toEqual([Uint8Array.of(0xff), ascii("ab"), Uint8Array.of(0xfe)]);
  });

  test("a large latin1 input is decoded in chunks", async () => {
    const data = new Uint8Array(50_000).fill(0x61);
    data[49_999] = 0xe9;
    const out = pieces(await split(data, "é", "", "latin1"));
    expect(out.map((p) => p.length)).toEqual([49_999, 1, 0]);
  });

  test("flags apply", async () => {
    expect(pieces(await split(ascii("aAa"), "a", "i")).map((p) => p.length)).toEqual([
      0, 1, 0, 1, 0, 1, 0,
    ]);
  });

  test("a flag outside ims is E_RANGE", async () => {
    const r = await split(ascii("a"), "a", "g");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_RANGE");
  });

  test("an invalid encoding is rejected by the declared choice", async () => {
    const r = await split(ascii("a"), "a", "", "ebcdic");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_PARAM_INVALID");
  });

  test("the pieces are fresh arrays", async () => {
    const data = ascii("abc");
    const out = pieces(await split(data, "b"));
    out[0]?.fill(0);
    expect(data).toEqual(ascii("abc"));
  });

  test("regex limits apply", async () => {
    const r = await split(new Uint8Array(REGEX_LIMITS.maxInputChars + 1).fill(0x61), "b");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.detail.limit).toBe("regexInput");
    const many = await split(new Uint8Array(REGEX_LIMITS.maxMatches + 1).fill(0x61), "a");
    expect(many.ok).toBe(false);
    if (!many.ok) expect(many.error.detail.limit).toBe("regexMatches");
  });

  test("a result over maxValueBytes is E_LIMIT_VALUE", async () => {
    const small = assembleRuntime(await loadBundleNode(["recipe"]), {
      limits: { maxValueBytes: 100 },
    });
    const r = await small.call(
      "recipe:_split-matches",
      [bytes(ascii("a".repeat(50))), str("a"), str(""), str("utf8")],
      inRecipe,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.detail.limit).toBe("maxValueBytes");
  });
});

describe("module", () => {
  test("one private primitive, marked as a regex-engine primitive", () => {
    expect(primitives.map((p) => `${p.vocab}:${p.name}`)).toEqual(["recipe:_split-matches"]);
    expect(isRegexPrimitive("recipe:_split-matches")).toBe(true);
    expect(primitives[0]?.doc).toBeTruthy();
    expect(primitives[0]?.category).toBeTruthy();
  });

  test("its name is private to the recipe vocabulary", () => {
    expect(() => runtime.lookup("recipe:_split-matches", { current: "user", using: [] })).toThrow();
    expect(runtime.lookup("recipe:_split-matches", { current: "recipe", using: [] }).qname).toBe(
      "recipe:_split-matches",
    );
  });
});
