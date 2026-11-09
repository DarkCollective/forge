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
import { definePrimitive } from "@forge/lang";
import { describe, expect, test } from "vitest";
import {
  REGEX_LIMITS,
  codePointsBetween,
  execAll,
  execAllNamed,
  isRegexPrimitive,
  markRegexPrimitive,
  nextCodePoint,
  testAny,
} from "./regex-engine.js";

function thrown(fn: () => unknown): { code?: string; detail?: Record<string, unknown> } {
  try {
    fn();
  } catch (e) {
    return e as { code?: string; detail?: Record<string, unknown> };
  }
  throw new Error("expected a throw");
}

describe("execAll", () => {
  test("finds the non-overlapping matches left to right", () => {
    const ms = execAll("\\d+", "", "a1b22");
    expect(ms.map((m) => [m.index, m.end, m.text])).toEqual([
      [1, 2, "1"],
      [3, 5, "22"],
    ]);
  });

  test("reports capture groups, undefined when a group did not take part", () => {
    const [m] = execAll("(a)|(b)", "", "b");
    expect(m?.groups).toEqual([undefined, "b"]);
  });

  test("an empty match advances the search by one code point", () => {
    const ms = execAll("x*", "", "😀a");
    expect(ms.map((m) => [m.index, m.end])).toEqual([
      [0, 0],
      [2, 2],
      [3, 3],
    ]);
  });

  test("a match after a non-empty match may be empty", () => {
    const ms = execAll("a*", "", "baac");
    expect(ms.map((m) => [m.index, m.end])).toEqual([
      [0, 0],
      [1, 3],
      [3, 3],
      [4, 4],
    ]);
  });

  test("a lone high surrogate at the end advances by one unit", () => {
    const ms = execAll("x*", "", "a\ud83d");
    expect(ms.map((m) => m.index)).toEqual([0, 1, 2]);
  });

  test("never splits a surrogate pair (u flag)", () => {
    const ms = execAll(".", "", "😀");
    expect(ms.map((m) => m.text)).toEqual(["😀"]);
  });

  test("applies the i, m and s flags, ignoring repeats", () => {
    expect(execAll("^b", "m", "a\nb")).toHaveLength(1);
    expect(execAll("A", "ii", "a")).toHaveLength(1);
    expect(execAll("a.b", "s", "a\nb")).toHaveLength(1);
    expect(execAll("a.b", "", "a\nb")).toHaveLength(0);
  });

  test("named groups are available through execAllNamed", () => {
    const [m] = execAllNamed("(?<x>-)", "", "a-b");
    expect(m?.named?.get("x")).toBe("-");
    expect(execAllNamed("-", "", "-")[0]?.named).toBeUndefined();
  });

  test("a bad flag is E_RANGE", () => {
    expect(thrown(() => execAll("a", "g", "a")).code).toBe("E_RANGE");
    expect(thrown(() => execAll("a", "y", "a")).code).toBe("E_RANGE");
  });

  test("a pattern that does not compile is E_RANGE", () => {
    expect(thrown(() => execAll("(", "", "a")).code).toBe("E_RANGE");
    expect(thrown(() => testAny("\\p{Nope}", "", "a")).code).toBe("E_RANGE");
  });

  test("input over the limit is E_LIMIT_VALUE regexInput", () => {
    const e = thrown(() => execAll("a", "", "a".repeat(REGEX_LIMITS.maxInputChars + 1)));
    expect(e.code).toBe("E_LIMIT_VALUE");
    expect(e.detail?.limit).toBe("regexInput");
    expect(thrown(() => testAny("a", "", "a".repeat(REGEX_LIMITS.maxInputChars + 1))).code).toBe(
      "E_LIMIT_VALUE",
    );
  });

  test("input exactly at the limit is accepted", () => {
    expect(testAny("b", "", "a".repeat(REGEX_LIMITS.maxInputChars))).toBe(false);
  });

  test("more than the maximum number of matches is E_LIMIT_VALUE regexMatches", () => {
    expect(execAll("a", "", "a".repeat(REGEX_LIMITS.maxMatches))).toHaveLength(
      REGEX_LIMITS.maxMatches,
    );
    const e = thrown(() => execAll("a", "", "a".repeat(REGEX_LIMITS.maxMatches + 1)));
    expect(e.code).toBe("E_LIMIT_VALUE");
    expect(e.detail?.limit).toBe("regexMatches");
  });

  test("empty matches count towards the match limit", () => {
    const e = thrown(() => execAll("x*", "", "a".repeat(REGEX_LIMITS.maxMatches)));
    expect(e.detail?.limit).toBe("regexMatches");
  });

  test("REGEX_LIMITS has the documented values and is frozen", () => {
    expect(REGEX_LIMITS).toEqual({ maxInputChars: 4_194_304, maxMatches: 100_000 });
    expect(Object.isFrozen(REGEX_LIMITS)).toBe(true);
  });
});

describe("testAny", () => {
  test("is an unanchored search", () => {
    expect(testAny("b", "", "abc")).toBe(true);
    expect(testAny("^b", "", "abc")).toBe(false);
    expect(testAny("^A", "i", "abc")).toBe(true);
  });

  test("a text with more matches than the limit is still a plain yes", () => {
    expect(testAny("a", "", "a".repeat(REGEX_LIMITS.maxMatches + 10))).toBe(true);
  });
});

describe("code point helpers", () => {
  test("nextCodePoint skips a whole pair and one unit otherwise", () => {
    expect(nextCodePoint("😀a", 0)).toBe(2);
    expect(nextCodePoint("😀a", 2)).toBe(3);
    expect(nextCodePoint("\ud83d", 0)).toBe(1);
    expect(nextCodePoint("\ud83dx", 0)).toBe(1);
  });

  test("codePointsBetween counts code points, not units", () => {
    expect(codePointsBetween("😀a😀", 0, 5)).toBe(3);
    expect(codePointsBetween("😀a😀", 2, 3)).toBe(1);
    expect(codePointsBetween("abc", 2, 2)).toBe(0);
  });
});

describe("markRegexPrimitive", () => {
  test("records the qualified name and returns the definition", () => {
    const def = definePrimitive("zz", "probe", "( str -- bool )", () => true);
    expect(isRegexPrimitive("zz:probe")).toBe(false);
    expect(markRegexPrimitive(def)).toBe(def);
    expect(isRegexPrimitive("zz:probe")).toBe(true);
    expect(isRegexPrimitive("zz:other")).toBe(false);
  });
});
