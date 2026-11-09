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
import { describe, expect, test } from "vitest";
import { extras, seed } from "../test/helpers.js";
import { RECIPE_ISSUE_CODES, RECIPE_LIMITS } from "./types.js";
import type { CatalogueView, PinPolicy, RecipeIssue } from "./types.js";
import { validateRecipe } from "./validate.js";

type Row = [code: string, severity: "error" | "warning", path: string];

function run(doc: unknown, catalogue?: CatalogueView, pins?: PinPolicy) {
  return validateRecipe(doc, catalogue, pins === undefined ? undefined : { pins });
}

function rows(issues: readonly RecipeIssue[]): Row[] {
  return issues.map((i) => [i.code, i.severity, i.path]);
}

/** Validates `{forge: 1, steps: [step]}` against `catalogue` and returns code, severity and path of each issue. */
function step(s: unknown, catalogue: CatalogueView | undefined = seed, pins?: PinPolicy): Row[] {
  return rows(run({ forge: 1, steps: [s] }, catalogue, pins).issues);
}

function detail(issues: readonly RecipeIssue[], code: string): Record<string, unknown> | undefined {
  return issues.find((i) => i.code === code)?.detail;
}

const opStep = (extra: Record<string, unknown> = {}) => ({
  kind: "op",
  op: "text:upper",
  ...extra,
});
const E = "error" as const;
const W = "warning" as const;

describe("validateRecipe: documents (RECIPES.md section 12.4)", () => {
  test("a valid recipe is ok and returns the input", () => {
    const doc = { forge: 1, steps: [opStep()] };
    const result = run(doc, seed);
    expect(result.ok).toBe(true);
    expect(result.ok && result.recipe).toBe(doc);
    expect(result.issues).toEqual([]);
  });

  test.each<[string, unknown, Row[]]>([
    ["wrong version", { forge: 2, steps: [] }, [["bad-version", E, "/forge"]]],
    ["version as string", { forge: "1", steps: [] }, [["bad-version", E, "/forge"]]],
    ["no steps", { forge: 1 }, [["required", E, "/steps"]]],
    [
      "empty object",
      {},
      [
        ["required", E, "/forge"],
        ["required", E, "/steps"],
      ],
    ],
    ["an array", [], [["type", E, ""]]],
    ["null", null, [["type", E, ""]]],
    ["a string", "x", [["type", E, ""]]],
    ["steps not an array", { forge: 1, steps: {} }, [["type", E, "/steps"]]],
    ["unknown field", { forge: 1, steps: [], extra: 1 }, [["unknown-field", E, "/extra"]]],
    [
      "unknown field with ~ and /",
      { forge: 1, steps: [], "a/b~c": 1 },
      [["unknown-field", E, "/a~1b~0c"]],
    ],
    ["name not a string", { forge: 1, name: 1, steps: [] }, [["type", E, "/name"]]],
    ["name too long", { forge: 1, name: "n".repeat(121), steps: [] }, [["bad-value", E, "/name"]]],
    ["name of 120 emoji is fine", { forge: 1, name: "😀".repeat(120), steps: [] }, []],
    [
      "description too long",
      { forge: 1, description: "d".repeat(2001), steps: [] },
      [["bad-value", E, "/description"]],
    ],
    [
      "lone surrogate in a name",
      { forge: 1, name: "a\ud800", steps: [] },
      [["bad-value", E, "/name"]],
    ],
    [
      "bad catalogue id",
      { forge: 1, catalogue: "XYZ", steps: [] },
      [["bad-value", E, "/catalogue"]],
    ],
    [
      "catalogue id not a string",
      { forge: 1, catalogue: 5, steps: [] },
      [["type", E, "/catalogue"]],
    ],
    [
      "step not an object",
      { forge: 1, steps: [1, null, []] },
      [
        ["type", E, "/steps/0"],
        ["type", E, "/steps/1"],
        ["type", E, "/steps/2"],
      ],
    ],
  ])("%s", (_name, doc, expected) => {
    expect(rows(run(doc, seed).issues)).toEqual(expected);
    expect(run(doc, seed).ok).toBe(expected.every((r) => r[1] !== E));
  });

  test("details of bad-version, required, unknown-field, type", () => {
    expect(detail(run({ forge: 2, steps: [] }).issues, "bad-version")).toEqual({ value: 2 });
    expect(detail(run({ forge: "x".repeat(200), steps: [] }).issues, "bad-version")).toEqual({
      value: "x".repeat(80),
    });
    expect(detail(run({ forge: { a: 1 }, steps: [] }).issues, "bad-version")).toEqual({
      value: "object",
    });
    expect(detail(run({ forge: [1], steps: [] }).issues, "bad-version")).toEqual({
      value: "array",
    });
    expect(detail(run({ forge: null, steps: [] }).issues, "bad-version")).toEqual({ value: null });
    expect(detail(run({ forge: true, steps: [] }).issues, "bad-version")).toEqual({ value: true });
    expect(detail(run({ forge: Infinity, steps: [] }).issues, "bad-version")).toEqual({
      value: "Infinity",
    });
    expect(detail(run({ forge: 1 }).issues, "required")).toEqual({ field: "steps" });
    expect(detail(run({ forge: 1, steps: [], zzz: 1 }).issues, "unknown-field")).toEqual({
      field: "zzz",
    });
    expect(detail(run([]).issues, "type")).toEqual({ expected: "an object" });
  });

  test("catalogue-mismatch is a warning with both ids; the recipe is still ok", () => {
    const result = run({ forge: 1, catalogue: "0000000000000000", steps: [] }, seed);
    expect(result.ok).toBe(true);
    expect(rows(result.issues)).toEqual([["catalogue-mismatch", W, "/catalogue"]]);
    expect(result.issues[0]?.detail).toEqual({ recipe: "0000000000000000", current: seed.version });
    expect(run({ forge: 1, catalogue: seed.version, steps: [] }, seed).issues).toEqual([]);
    // without a catalogue nothing is compared
    expect(run({ forge: 1, catalogue: "0000000000000000", steps: [] }).issues).toEqual([]);
  });
});

describe("validateRecipe: steps (RECIPES.md section 12.4)", () => {
  test.each<[string, unknown, Row[]]>([
    ["bad kind", { kind: "wat" }, [["bad-kind", E, "/steps/0/kind"]]],
    ["missing kind", { op: "text:upper" }, [["bad-kind", E, "/steps/0/kind"]]],
    ["kind not a string", { kind: 5 }, [["bad-kind", E, "/steps/0/kind"]]],
    ["unknown op", { kind: "op", op: "nope:x" }, [["unknown-op", E, "/steps/0/op"]]],
    ["op without a colon", { kind: "op", op: "nope" }, [["bad-value", E, "/steps/0/op"]]],
    [
      "op with a long name",
      { kind: "op", op: `a:${"b".repeat(200)}` },
      [["bad-value", E, "/steps/0/op"]],
    ],
    ["op not a string", { kind: "op", op: 1 }, [["type", E, "/steps/0/op"]]],
    ["op missing", { kind: "op" }, [["required", E, "/steps/0/op"]]],
    [
      "extra field",
      { kind: "op", op: "text:upper", extra: 1 },
      [["unknown-field", E, "/steps/0/extra"]],
    ],
    ["disabled not a boolean", opStep({ disabled: 1 }), [["type", E, "/steps/0/disabled"]]],
    ["breakpoint not a boolean", opStep({ breakpoint: "y" }), [["type", E, "/steps/0/breakpoint"]]],
    ["note too long", opStep({ note: "n".repeat(501) }), [["bad-value", E, "/steps/0/note"]]],
    ["note not a string", opStep({ note: 1 }), [["type", E, "/steps/0/note"]]],
    ["hash too short", opStep({ hash: "ab" }), [["bad-value", E, "/steps/0/hash"]]],
    ["hash not a string", opStep({ hash: 5 }), [["type", E, "/steps/0/hash"]]],
    ["params not an object", opStep({ params: [] }), [["type", E, "/steps/0/params"]]],
    ["a comment", { kind: "comment", text: "hi" }, []],
    ["comment without text", { kind: "comment" }, [["required", E, "/steps/0/text"]]],
    [
      "comment text too long",
      { kind: "comment", text: "t".repeat(2001) },
      [["bad-value", E, "/steps/0/text"]],
    ],
    [
      "comment with disabled",
      { kind: "comment", text: "x", disabled: true },
      [["unknown-field", E, "/steps/0/disabled"]],
    ],
    ["bad kind stops the step", { kind: "wat", extra: 1 }, [["bad-kind", E, "/steps/0/kind"]]],
  ])("%s", (_name, s, expected) => {
    expect(step(s)).toEqual(expected);
  });

  test("bad-kind details", () => {
    const issues = run({ forge: 1, steps: [{ kind: "wat" }] }).issues;
    expect(detail(issues, "bad-kind")).toEqual({ value: "wat" });
    expect(detail(run({ forge: 1, steps: [{}] }).issues, "bad-kind")).toEqual({});
  });

  test.each<[string, unknown, Row[]]>([
    [
      "fork with bad hex",
      {
        kind: "fork",
        split: { value: "zz", enc: "hex" },
        join: { value: "0a", enc: "hex" },
        steps: [],
      },
      [["bad-encoding", E, "/steps/0/split/value"]],
    ],
    [
      "fork with an empty split",
      {
        kind: "fork",
        split: { value: "", enc: "utf8" },
        join: { value: "", enc: "utf8" },
        steps: [],
      },
      [["bad-value", E, "/steps/0/split/value"]],
    ],
    [
      "fork with a split that decodes to nothing",
      {
        kind: "fork",
        split: { value: " ", enc: "hex" },
        join: { value: "", enc: "utf8" },
        steps: [],
      },
      [["bad-value", E, "/steps/0/split/value"]],
    ],
    [
      "fork with latin1 above U+00FF",
      {
        kind: "fork",
        split: { value: "a", enc: "utf8" },
        join: { value: "Ā", enc: "latin1" },
        steps: [],
      },
      [["bad-encoding", E, "/steps/0/join/value"]],
    ],
    [
      "fork with a lone surrogate",
      {
        kind: "fork",
        split: { value: "a", enc: "utf8" },
        join: { value: "\udc00", enc: "utf8" },
        steps: [],
      },
      [["bad-encoding", E, "/steps/0/join/value"]],
    ],
    [
      "fork with bad base64",
      {
        kind: "fork",
        split: { value: "a", enc: "utf8" },
        join: { value: "A", enc: "base64" },
        steps: [],
      },
      [["bad-encoding", E, "/steps/0/join/value"]],
    ],
    [
      "fork with an unknown enc and a non-string value",
      {
        kind: "fork",
        split: { value: 1, enc: "ebcdic" },
        join: { enc: "utf8", value: "" },
        steps: [],
      },
      [
        ["type", E, "/steps/0/split/value"],
        ["bad-value", E, "/steps/0/split/enc"],
      ],
    ],
    [
      "fork missing fields and with an extra",
      { kind: "fork", split: { enc: "utf8", x: 1 }, join: 5 },
      [
        ["required", E, "/steps/0/steps"],
        ["unknown-field", E, "/steps/0/split/x"],
        ["required", E, "/steps/0/split/value"],
        ["type", E, "/steps/0/join"],
      ],
    ],
    [
      "fork missing everything",
      { kind: "fork" },
      [
        ["required", E, "/steps/0/split"],
        ["required", E, "/steps/0/join"],
        ["required", E, "/steps/0/steps"],
      ],
    ],
    [
      "fork with enc not a string",
      { kind: "fork", split: { value: "a", enc: 1 }, join: { value: "", enc: "utf8" }, steps: [] },
      [["type", E, "/steps/0/split/enc"]],
    ],
    [
      "subsection with a bad pattern",
      { kind: "subsection", pattern: "(", steps: [] },
      [["bad-regex", E, "/steps/0/pattern"]],
    ],
    [
      "subsection with a long pattern",
      { kind: "subsection", pattern: "a".repeat(1025), steps: [] },
      [["bad-regex", E, "/steps/0/pattern"]],
    ],
    [
      "subsection with flag g",
      { kind: "subsection", pattern: "a", flags: "g", steps: [] },
      [["bad-value", E, "/steps/0/flags"]],
    ],
    [
      "subsection with four flags",
      { kind: "subsection", pattern: "a", flags: "iiii", steps: [] },
      [["bad-value", E, "/steps/0/flags"]],
    ],
    [
      "subsection with flags not a string",
      { kind: "subsection", pattern: "a", flags: 1, steps: [] },
      [["type", E, "/steps/0/flags"]],
    ],
    [
      "subsection with encoding hex",
      { kind: "subsection", pattern: "a", encoding: "hex", steps: [] },
      [["bad-value", E, "/steps/0/encoding"]],
    ],
    [
      "subsection with encoding not a string",
      { kind: "subsection", pattern: "a", encoding: 1, steps: [] },
      [["type", E, "/steps/0/encoding"]],
    ],
    [
      "subsection with pattern not a string",
      { kind: "subsection", pattern: 1, steps: [] },
      [["type", E, "/steps/0/pattern"]],
    ],
    [
      "subsection with a lone surrogate pattern",
      { kind: "subsection", pattern: "\ud800", steps: [] },
      [["bad-value", E, "/steps/0/pattern"]],
    ],
    [
      "subsection fine",
      { kind: "subsection", pattern: "[a-z]+", flags: "mi", encoding: "latin1", steps: [] },
      [],
    ],
    [
      "subsection missing fields",
      { kind: "subsection" },
      [
        ["required", E, "/steps/0/pattern"],
        ["required", E, "/steps/0/steps"],
      ],
    ],
    [
      "repeat without times or until",
      { kind: "repeat", steps: [] },
      [["exclusive", E, "/steps/0"]],
    ],
    [
      "repeat with both",
      { kind: "repeat", times: 2, until: "stable", steps: [] },
      [["exclusive", E, "/steps/0"]],
    ],
    [
      "repeat with times 0",
      { kind: "repeat", times: 0, steps: [] },
      [["bad-value", E, "/steps/0/times"]],
    ],
    [
      "repeat with times 1001",
      { kind: "repeat", times: 1001, steps: [] },
      [["bad-value", E, "/steps/0/times"]],
    ],
    [
      "repeat with times 1.5",
      { kind: "repeat", times: 1.5, steps: [] },
      [["type", E, "/steps/0/times"]],
    ],
    [
      "repeat with times a string",
      { kind: "repeat", times: "3", steps: [] },
      [["type", E, "/steps/0/times"]],
    ],
    [
      "repeat with max but no until",
      { kind: "repeat", times: 2, max: 5, steps: [] },
      [["exclusive", E, "/steps/0/max"]],
    ],
    [
      "repeat with until forever",
      { kind: "repeat", until: "forever", steps: [] },
      [["bad-value", E, "/steps/0/until"]],
    ],
    [
      "repeat with max 0",
      { kind: "repeat", until: "stable", max: 0, steps: [] },
      [["bad-value", E, "/steps/0/max"]],
    ],
    ["repeat until stable with max", { kind: "repeat", until: "stable", max: 1000, steps: [] }, []],
    ["repeat times 1000", { kind: "repeat", times: 1000, steps: [] }, []],
    [
      "if without test or then",
      { kind: "if" },
      [
        ["required", E, "/steps/0/test"],
        ["required", E, "/steps/0/then"],
      ],
    ],
    [
      "if with a test of the wrong kind",
      { kind: "if", test: { kind: "wat" }, then: [] },
      [["bad-kind", E, "/steps/0/test/kind"]],
    ],
    [
      "if with a test that is not an object",
      { kind: "if", test: 1, then: [] },
      [["type", E, "/steps/0/test"]],
    ],
    [
      "if with then not an array",
      { kind: "if", test: { kind: "regex", pattern: "a" }, then: {} },
      [["type", E, "/steps/0/then"]],
    ],
    [
      "if with a regex test and extras",
      { kind: "if", test: { kind: "regex", pattern: "a", note: "x" }, then: [] },
      [["unknown-field", E, "/steps/0/test/note"]],
    ],
    [
      "if with a bad regex test",
      { kind: "if", test: { kind: "regex", pattern: "(", flags: "x", encoding: "hex" }, then: [] },
      [
        ["bad-regex", E, "/steps/0/test/pattern"],
        ["bad-value", E, "/steps/0/test/flags"],
        ["bad-value", E, "/steps/0/test/encoding"],
      ],
    ],
    [
      "if with an else",
      { kind: "if", test: { kind: "regex", pattern: "^o" }, then: [], else: [opStep()] },
      [],
    ],
    [
      "if with a long note",
      { kind: "if", test: { kind: "regex", pattern: "a" }, then: [], note: 5 },
      [["type", E, "/steps/0/note"]],
    ],
    [
      "if op test that is not a predicate",
      { kind: "if", test: { kind: "op", op: "hex:encode" }, then: [] },
      [["not-predicate", E, "/steps/0/test/op"]],
    ],
    [
      "if op test fine",
      { kind: "if", test: { kind: "op", op: "regex:test", params: { pattern: "^o" } }, then: [] },
      [],
    ],
    [
      "if op test unknown",
      { kind: "if", test: { kind: "op", op: "no:pe" }, then: [] },
      [["unknown-op", E, "/steps/0/test/op"]],
    ],
    [
      "if op test missing a param",
      { kind: "if", test: { kind: "op", op: "regex:test" }, then: [] },
      [["missing-param", E, "/steps/0/test/params/pattern"]],
    ],
    [
      "if op test with extras",
      {
        kind: "if",
        test: { kind: "op", op: "regex:test", note: "x", params: { pattern: "a" } },
        then: [],
      },
      [["unknown-field", E, "/steps/0/test/note"]],
    ],
  ])("%s", (_name, s, expected) => {
    expect(step(s)).toEqual(expected);
  });

  test("details: not-predicate, bad-regex, bad-encoding, bad-value constraints", () => {
    const np = run(
      { forge: 1, steps: [{ kind: "if", test: { kind: "op", op: "hex:encode" }, then: [] }] },
      seed,
    );
    expect(detail(np.issues, "not-predicate")).toEqual({ op: "hex:encode", output: "str" });
    const rx = run({ forge: 1, steps: [{ kind: "subsection", pattern: "(", steps: [] }] }, seed);
    expect(typeof detail(rx.issues, "bad-regex")?.reason).toBe("string");
    const long = run(
      { forge: 1, steps: [{ kind: "subsection", pattern: "a".repeat(2000), steps: [] }] },
      seed,
    );
    expect(detail(long.issues, "bad-regex")).toEqual({ reason: "too long" });
    const enc = run(
      {
        forge: 1,
        steps: [
          {
            kind: "fork",
            split: { value: "zz", enc: "hex" },
            join: { value: "", enc: "utf8" },
            steps: [],
          },
        ],
      },
      seed,
    );
    expect(detail(enc.issues, "bad-encoding")).toEqual({ enc: "hex" });
    const split = (value: string, e: string) =>
      run(
        {
          forge: 1,
          steps: [
            { kind: "fork", split: { value, enc: e }, join: { value: "", enc: "utf8" }, steps: [] },
          ],
        },
        seed,
      );
    expect(detail(split("", "utf8").issues, "bad-value")).toEqual({ constraint: "minLength 1" });
    expect(detail(split(" ", "hex").issues, "bad-value")).toEqual({
      constraint: "non-empty separator",
    });
    expect(detail(run({ forge: 1, name: "n".repeat(121), steps: [] }).issues, "bad-value")).toEqual(
      { constraint: "maxLength 120" },
    );
  });

  test("an empty join is fine", () => {
    expect(
      step({
        kind: "fork",
        split: { value: "x", enc: "utf8" },
        join: { value: "", enc: "utf8" },
        steps: [],
      }),
    ).toEqual([]);
  });
});

describe("validateRecipe: parameters against the catalogue", () => {
  const p = (op: string, params: Record<string, unknown>, cat: CatalogueView = seed) =>
    step({ kind: "op", op, params }, cat);

  test.each<[string, string, Record<string, unknown>, Row[]]>([
    [
      "int above its maximum",
      "classical:rot",
      { amount: 26 },
      [["bad-param", E, "/steps/0/params/amount"]],
    ],
    [
      "int below its minimum",
      "classical:rot",
      { amount: -1 },
      [["bad-param", E, "/steps/0/params/amount"]],
    ],
    ["int as a decimal string that fits", "classical:rot", { amount: "13" }, []],
    [
      "int with a leading zero",
      "classical:rot",
      { amount: "007" },
      [["bad-param", E, "/steps/0/params/amount"]],
    ],
    [
      "int minus zero",
      "classical:rot",
      { amount: "-0" },
      [["bad-param", E, "/steps/0/params/amount"]],
    ],
    [
      "int that is not integral",
      "classical:rot",
      { amount: 1.5 },
      [["bad-param", E, "/steps/0/params/amount"]],
    ],
    [
      "int beyond the safe range as a number",
      "classical:rot",
      { amount: 2 ** 60 },
      [["bad-param", E, "/steps/0/params/amount"]],
    ],
    [
      "int as a boolean",
      "classical:rot",
      { amount: true },
      [["bad-param", E, "/steps/0/params/amount"]],
    ],
    [
      "unknown param",
      "classical:rot",
      { amount: 13, shift: 1 },
      [["unknown-param", E, "/steps/0/params/shift"]],
    ],
    [
      "a param name that breaks the pattern",
      "classical:rot",
      { Amount: 1 },
      [["unknown-param", E, "/steps/0/params/Amount"]],
    ],
    [
      "missing required",
      "regex:replace",
      { pattern: "a" },
      [["missing-param", E, "/steps/0/params/replacement"]],
    ],
    [
      "choice that is not an option",
      "base64:decode",
      { alphabet: "nope" },
      [["bad-param", E, "/steps/0/params/alphabet"]],
    ],
    [
      "choice that is not a string",
      "base64:decode",
      { alphabet: 1 },
      [["bad-param", E, "/steps/0/params/alphabet"]],
    ],
    ["bool", "base64:encode", { padding: false }, []],
    [
      "bool that is not a bool",
      "base64:encode",
      { padding: "yes" },
      [["bad-param", E, "/steps/0/params/padding"]],
    ],
    ["bad regex", "regex:test", { pattern: "(" }, [["bad-regex", E, "/steps/0/params/pattern"]]],
    [
      "regex that is not a string",
      "regex:test",
      { pattern: 1 },
      [["bad-param", E, "/steps/0/params/pattern"]],
    ],
    [
      "regex too long",
      "regex:test",
      { pattern: "a".repeat(1025) },
      [["bad-regex", E, "/steps/0/params/pattern"]],
    ],
    [
      "str with too many flags",
      "regex:test",
      { pattern: "a", flags: "iiii" },
      [["bad-param", E, "/steps/0/params/flags"]],
    ],
    [
      "str that is not a string",
      "regex:test",
      { pattern: "a", flags: 1 },
      [["bad-param", E, "/steps/0/params/flags"]],
    ],
    [
      "a lone surrogate in a param",
      "regex:replace",
      { pattern: "a", replacement: "\ud800" },
      [["bad-value", E, "/steps/0/params/replacement"]],
    ],
    [
      "a non-finite number",
      "classical:rot",
      { amount: Infinity },
      [["type", E, "/steps/0/params/amount"]],
    ],
    [
      "an encoded value for a str",
      "regex:replace",
      { pattern: "a", replacement: { value: "x", enc: "utf8" } },
      [["bad-param", E, "/steps/0/params/replacement"]],
    ],
    [
      "a bad encoded value is structural",
      "regex:replace",
      { pattern: "a", replacement: { value: "x", enc: "hex" } },
      [["bad-encoding", E, "/steps/0/params/replacement/value"]],
    ],
    ["null", "classical:rot", { amount: null }, [["type", E, "/steps/0/params/amount"]]],
    ["an array", "classical:rot", { amount: [1] }, [["type", E, "/steps/0/params/amount"]]],
  ])("%s", (_name, op, params, expected) => {
    expect(p(op, params)).toEqual(expected);
  });

  test("bad-param details", () => {
    const rot = run(
      { forge: 1, steps: [{ kind: "op", op: "classical:rot", params: { amount: 26 } }] },
      seed,
    );
    expect(rot.issues[0]?.detail).toEqual({
      param: "amount",
      reason: "violates the constraint",
      constraint: "[0..25]",
    });
    const alpha = run(
      { forge: 1, steps: [{ kind: "op", op: "base64:decode", params: { alphabet: "nope" } }] },
      seed,
    );
    expect(alpha.issues[0]?.detail).toEqual({ param: "alphabet", reason: "not an option" });
    const flags = run(
      {
        forge: 1,
        steps: [{ kind: "op", op: "regex:test", params: { pattern: "a", flags: "iiii" } }],
      },
      seed,
    );
    expect(flags.issues[0]?.detail).toMatchObject({ constraint: "[0..3,/[ims]*/]" });
    const missing = run({ forge: 1, steps: [{ kind: "op", op: "regex:test" }] }, seed);
    expect(missing.issues[0]?.detail).toEqual({ param: "pattern" });
    const unknown = run(
      { forge: 1, steps: [{ kind: "op", op: "classical:rot", params: { shift: 1 } }] },
      seed,
    );
    expect(unknown.issues[0]?.detail).toEqual({ param: "shift" });
  });

  test("every parameter type of the extra catalogue", () => {
    const x = (op: string, params: Record<string, unknown>): Row[] => p(op, params, extras);
    const at = (name: string): Row => ["bad-param", E, `/steps/0/params/${name}`];
    // key and toggle
    expect(x("x:key", { key: { value: "ab", enc: "utf8" } })).toEqual([]);
    expect(x("x:key", { key: { value: "abcdef", enc: "utf8" } })).toEqual([at("key")]); // too long
    expect(x("x:key", { key: { value: "a", enc: "utf8" } })).toEqual([at("key")]); // too short
    expect(x("x:key", { key: { value: "AAAA", enc: "base64" } })).toEqual([at("key")]); // enc not allowed
    expect(x("x:key", { key: { value: "0a0b", enc: "hex" } })).toEqual([]);
    expect(x("x:key", { key: "ab" })).toEqual([at("key")]);
    expect(x("x:key", {})).toEqual([["missing-param", E, "/steps/0/params/key"]]);
    expect(x("x:secret", { secret: { value: "s3cret", enc: "utf8" } })).toEqual([]);
    expect(x("x:toggle", { mode: { value: "YQ==", enc: "base64" } })).toEqual([]);
    expect(x("x:toggle", { mode: { value: "!!", enc: "base64" } })).toEqual([
      ["bad-encoding", E, "/steps/0/params/mode/value"],
    ]);
    // numbers
    expect(
      x("x:nums", {
        count: 100,
        big: "9007199254740993",
        pick: 5,
        ratio: 0.25,
        any: 1.5,
        on: true,
      }),
    ).toEqual([]);
    expect(x("x:nums", { count: 0 })).toEqual([at("count")]);
    expect(x("x:nums", { count: 101 })).toEqual([at("count")]);
    expect(x("x:nums", { big: "9007199254740993999" })).toEqual([]);
    expect(x("x:nums", { big: "1.5" })).toEqual([at("big")]);
    expect(x("x:nums", { big: "" })).toEqual([at("big")]);
    expect(x("x:nums", { pick: 2 })).toEqual([at("pick")]);
    expect(x("x:nums", { pick: "5" })).toEqual([]);
    expect(x("x:nums", { ratio: 1.5 })).toEqual([at("ratio")]);
    expect(x("x:nums", { ratio: "0.5" })).toEqual([at("ratio")]);
    expect(x("x:nums", { any: "2" })).toEqual([at("any")]);
    // text types
    expect(x("x:text", { set: "abcd", raw: "dead", word: "hello", rx: "a+b", pick: "b" })).toEqual(
      [],
    );
    expect(x("x:text", { set: "" })).toEqual([at("set")]);
    expect(x("x:text", { set: "aa" })).toEqual([at("set")]);
    expect(x("x:text", { set: "abcde" })).toEqual([at("set")]);
    expect(x("x:text", { set: "😀😁" })).toEqual([]);
    expect(x("x:text", { set: 1 })).toEqual([at("set")]);
    expect(x("x:text", { raw: "dead" })).toEqual([]);
    expect(x("x:text", { raw: "de ad be" })).toEqual([]);
    expect(x("x:text", { raw: "de" })).toEqual([at("raw")]);
    expect(x("x:text", { raw: "zz" })).toEqual([at("raw")]);
    expect(x("x:text", { raw: 1 })).toEqual([at("raw")]);
    expect(x("x:text", { word: "" })).toEqual([at("word")]);
    expect(x("x:text", { word: "toolong" })).toEqual([at("word")]);
    expect(x("x:text", { rx: "a".repeat(9) })).toEqual([at("rx")]);
    expect(x("x:text", { pick: "c" })).toEqual([at("pick")]);
    // numeric constraints in all forms
    expect(x("x:tuple", { one: 0, low: 1, high: 9, pat: "zzz" })).toEqual([]);
    expect(x("x:tuple", { one: 1 })).toEqual([at("one")]);
    expect(x("x:tuple", { low: 0 })).toEqual([at("low")]);
    expect(x("x:tuple", { high: 10 })).toEqual([at("high")]);
    expect(x("x:tuple", { low: "99999999999999999999", high: "99999999999999999999" })).toEqual([
      at("high"),
    ]);
    expect(x("x:tuple", { low: "-99999999999999999999" })).toEqual([at("low")]);
    // an unsupported parameter type
    expect(x("x:ghost", { items: 1 })).toEqual([at("items")]);
    expect(x("x:ghost", {})).toEqual([["missing-param", E, "/steps/0/params/items"]]);
  });

  test("a recipe is checked without a catalogue by shape only", () => {
    const bare = (s: unknown): Row[] => rows(run({ forge: 1, steps: [s] }).issues);
    expect(bare({ kind: "op", op: "any:thing", params: { a: 1 } })).toEqual([]);
    expect(bare({ kind: "op", op: "any:thing", params: { Bad: 1 } })).toEqual([
      ["bad-value", E, "/steps/0/params/Bad"],
    ]);
    expect(bare({ kind: "op", op: "any:thing", params: { a: null } })).toEqual([
      ["type", E, "/steps/0/params/a"],
    ]);
  });

  test("an own __proto__ key is rejected and Object.prototype is untouched", () => {
    const doc = JSON.parse(
      '{"forge":1,"steps":[{"kind":"op","op":"text:upper","params":{"__proto__":{"polluted":true}}}]}',
    ) as unknown;
    const withCatalogue = run(doc, seed);
    expect(rows(withCatalogue.issues)).toEqual([["unknown-param", E, "/steps/0/params/__proto__"]]);
    const without = run(doc);
    expect(rows(without.issues)).toEqual([["bad-value", E, "/steps/0/params/__proto__"]]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  test("too many params is a limit issue", () => {
    const params: Record<string, number> = {};
    for (let i = 0; i < 33; i++) params[`p${i}`] = 1;
    const issues = run({ forge: 1, steps: [{ kind: "op", op: "any:thing", params }] }).issues;
    expect(issues[0]).toMatchObject({
      code: "limit",
      path: "/steps/0/params",
      detail: { limit: "maxParamsPerStep", max: 32 },
    });
  });
});

describe("validateRecipe: aliases and pins", () => {
  test("an alias is a warning and the recipe is ok", () => {
    const result = run({ forge: 1, steps: [{ kind: "op", op: "classical:rot13" }] }, seed);
    expect(result.ok).toBe(true);
    expect(rows(result.issues)).toEqual([["alias-used", W, "/steps/0/op"]]);
    expect(result.issues[0]?.detail).toEqual({ op: "classical:rot13", canonical: "classical:rot" });
  });

  test("an alias as an if test", () => {
    const result = run(
      {
        forge: 1,
        steps: [
          { kind: "if", test: { kind: "op", op: "x:has", params: { needle: "a" } }, then: [] },
        ],
      },
      extras,
    );
    expect(rows(result.issues)).toEqual([["alias-used", W, "/steps/0/test/op"]]);
  });

  test("a canonical name wins over an alias of another op", () => {
    const result = run(
      {
        forge: 1,
        steps: [
          { kind: "op", op: "y:clash" },
          { kind: "op", op: "y:rot13" },
        ],
      },
      extras,
    );
    expect(rows(result.issues)).toEqual([["alias-used", W, "/steps/1/op"]]);
  });

  const wrong = "f".repeat(64);
  test.each<[PinPolicy | undefined, Row[]]>([
    [undefined, [["hash-mismatch", W, "/steps/0/hash"]]],
    ["warn", [["hash-mismatch", W, "/steps/0/hash"]]],
    ["strict", [["hash-mismatch", E, "/steps/0/hash"]]],
    ["ignore", []],
  ])("pin policy %s", (pins, expected) => {
    const result = run(
      { forge: 1, steps: [{ kind: "op", op: "text:upper", hash: wrong }] },
      seed,
      pins,
    );
    expect(rows(result.issues)).toEqual(expected);
    expect(result.ok).toBe(pins !== "strict");
    if (expected.length > 0) {
      expect(result.issues[0]?.detail).toEqual({
        expected: seed.ops.find((o) => o.qname === "text:upper")?.hash,
        actual: wrong,
      });
    }
  });

  test("a matching pin and no pin are never a mismatch; an op test pin is checked", () => {
    const hash = seed.ops.find((o) => o.qname === "text:upper")?.hash;
    expect(step(opStep({ hash }))).toEqual([]);
    expect(step(opStep())).toEqual([]);
    const test = {
      kind: "if",
      test: { kind: "op", op: "regex:test", params: { pattern: "a" }, hash: wrong },
      then: [],
    };
    expect(step(test)).toEqual([["hash-mismatch", W, "/steps/0/test/hash"]]);
  });

  test("structural errors in a step hold back the catalogue checks of that step only", () => {
    const doc = {
      forge: 1,
      steps: [
        { kind: "op", op: "nope:x", note: 1 },
        { kind: "op", op: "nope:y" },
      ],
    };
    expect(rows(run(doc, seed).issues)).toEqual([
      ["type", E, "/steps/0/note"],
      ["unknown-op", E, "/steps/1/op"],
    ]);
  });
});

describe("validateRecipe: limits (RECIPES.md section 3.8)", () => {
  const fork = (steps: unknown[]) => ({
    kind: "fork",
    split: { value: "x", enc: "utf8" },
    join: { value: "", enc: "utf8" },
    steps,
  });

  test("nine nested forks: a limit at the path of the ninth", () => {
    let inner: unknown[] = [];
    for (let i = 0; i < 9; i++) inner = [fork(inner)];
    const result = run({ forge: 1, steps: inner });
    const path = Array.from({ length: 9 }, () => "steps/0").join("/");
    expect(rows(result.issues)).toEqual([["limit", E, `/${path}`]]);
    expect(result.issues[0]?.detail).toEqual({ limit: "maxDepth", max: 8 });
  });

  test("eight nested forks are fine", () => {
    let inner: unknown[] = [];
    for (let i = 0; i < 8; i++) inner = [fork(inner)];
    expect(run({ forge: 1, steps: inner }).ok).toBe(true);
  });

  test("501 comment steps: a limit", () => {
    const steps = Array.from({ length: 501 }, () => ({ kind: "comment", text: "c" }));
    const result = run({ forge: 1, steps });
    expect(rows(result.issues)).toEqual([["limit", E, "/steps/500"]]);
    expect(result.issues[0]?.detail).toEqual({ limit: "maxSteps", max: 500 });
    expect(run({ forge: 1, steps: steps.slice(0, 500) }).ok).toBe(true);
  });

  test("the step count is for the whole tree", () => {
    const comments = Array.from({ length: 300 }, () => ({ kind: "comment", text: "c" }));
    const result = run({ forge: 1, steps: [fork(comments), fork(comments)] });
    expect(result.issues.map((i) => i.detail?.limit)).toEqual(["maxSteps"]);
  });

  test("more than 100 issues: the 101st is a limit issue", () => {
    const steps = Array.from({ length: 150 }, () => ({ kind: "wat" }));
    const result = run({ forge: 1, steps });
    expect(result.issues).toHaveLength(101);
    expect(result.issues[100]).toMatchObject({
      code: "limit",
      detail: { limit: "maxIssues", max: 100 },
    });
    expect(result.ok).toBe(false);
  });

  test("exactly 100 issues are all reported", () => {
    const steps = Array.from({ length: 100 }, () => ({ kind: "wat" }));
    expect(run({ forge: 1, steps }).issues).toHaveLength(100);
  });

  test("JSON larger than maxJsonBytes: one limit issue and nothing else is checked", () => {
    const doc = {
      forge: 1,
      name: "n".repeat(RECIPE_LIMITS.maxJsonBytes),
      steps: [{ kind: "wat" }],
    };
    const result = run(doc);
    expect(rows(result.issues)).toEqual([["limit", E, ""]]);
    expect(result.issues[0]?.detail).toEqual({ limit: "maxJsonBytes", max: 262144 });
  });

  test("the size is that of JSON.stringify", () => {
    const sizeOf = (doc: unknown): number => new TextEncoder().encode(JSON.stringify(doc)).length;
    // strings with every kind of escape and every UTF-8 length, plus numbers, booleans and null
    const filler = '"\\\n\r\t\b\f\u0001\u0080߿ࠀ😀𐀀x';
    const make = (n: number) => ({
      forge: 1,
      name: "",
      note: filler.repeat(n),
      list: [1, -2.5, true, false, null, 1e21],
      steps: [],
    });
    // find the largest n that fits, by the real size, and check the validator agrees at the boundary
    // binary search: sizeOf(make(n)) is monotonic in n
    let lo = 1;
    let hi = 2;
    while (sizeOf(make(hi)) <= RECIPE_LIMITS.maxJsonBytes) hi *= 2;
    while (hi - lo > 1) {
      const mid = (lo + hi) >>> 1;
      if (sizeOf(make(mid)) <= RECIPE_LIMITS.maxJsonBytes) lo = mid;
      else hi = mid;
    }
    const n = lo;
    const fits = run(make(n)).issues.filter((i) => i.code === "limit");
    const over = run(make(n + 1)).issues.filter((i) => i.code === "limit");
    expect(fits).toEqual([]);
    expect(over).toHaveLength(1);
    // the count is exact: pad one document to the byte limit and one byte over
    const pad = (extra: number) => ({
      forge: 1,
      name: "",
      note: "x".repeat(
        RECIPE_LIMITS.maxJsonBytes - sizeOf({ forge: 1, name: "", note: "", steps: [] }) + extra,
      ),
      steps: [],
    });
    expect(sizeOf(pad(0))).toBe(RECIPE_LIMITS.maxJsonBytes);
    expect(run(pad(0)).issues.some((i) => i.code === "limit")).toBe(false);
    expect(run(pad(1)).issues.some((i) => i.code === "limit")).toBe(true);
    // a lone surrogate costs six bytes in JSON.stringify
    expect(sizeOf({ a: "\ud800" })).toBe(sizeOf({ a: "" }) + 6);
  });

  test("raw nesting deeper than 64 is a limit issue and never a stack overflow", () => {
    let deep: unknown = [];
    for (let i = 0; i < 100_000; i++) deep = [deep];
    const result = run({ forge: 1, steps: deep });
    expect(rows(result.issues)).toEqual([["limit", E, ""]]);
    expect(result.issues[0]?.detail).toEqual({ limit: "maxJsonDepth", max: 64 });
  });

  test("a balanced hostile nesting of objects {a:{a:...}}", () => {
    let deep: Record<string, unknown> = {};
    for (let i = 0; i < 100_000; i++) deep = { a: deep };
    const result = run(deep, seed);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toEqual(["limit"]);
  });

  test("nesting of exactly 64 is accepted by the pre-walk, 65 is not", () => {
    const nest = (levels: number): unknown => {
      let v: unknown = 1;
      for (let i = 1; i < levels; i++) v = [v];
      return v;
    };
    // depth 64 under an unknown field: the pre-walk passes, so the field is reported as unknown
    expect(run({ forge: 1, steps: [], x: nest(64) }).issues.map((i) => i.code)).toEqual([
      "unknown-field",
    ]);
    expect(run({ forge: 1, steps: [], x: nest(65) }).issues.map((i) => i.code)).toEqual(["limit"]);
  });

  test("a cycle is a limit issue", () => {
    const a: Record<string, unknown> = { forge: 1, steps: [] };
    a.self = a;
    expect(rows(run(a).issues)).toEqual([["limit", E, ""]]);
    expect(run(a).issues[0]?.detail).toEqual({ limit: "cycle" });
    const arr: unknown[] = [];
    arr.push(arr);
    expect(run({ forge: 1, steps: arr }).issues[0]?.code).toBe("limit");
  });

  test("a shared object that is not a cycle is fine (it counts every time it is seen)", () => {
    const shared = { kind: "comment", text: "c" };
    expect(run({ forge: 1, steps: [shared, shared] }).ok).toBe(true);
  });

  test("an exponentially shared structure is stopped by the byte budget", () => {
    let node: unknown = { kind: "comment", text: "x".repeat(100) };
    for (let i = 0; i < 40; i++) node = [node, node];
    const result = run({ forge: 1, steps: node });
    expect(result.issues.map((i) => i.code)).toEqual(["limit"]);
    expect(result.issues[0]?.detail?.limit).toBe("maxJsonBytes");
  });

  test("a huge sparse array is stopped without iterating to its end", () => {
    const sparse = new Array<unknown>(4_000_000_000);
    expect(run({ forge: 1, steps: sparse }).issues[0]?.detail?.limit).toBe("maxJsonBytes");
  });

  test("a very long string is stopped at once", () => {
    expect(run({ forge: 1, name: "x".repeat(5_000_000), steps: [] }).issues[0]?.detail?.limit).toBe(
      "maxJsonBytes",
    );
  });
});

describe("validateRecipe: hostile objects", () => {
  test("accessor properties are reported and never invoked", () => {
    let calls = 0;
    const doc: Record<string, unknown> = { forge: 1 };
    Object.defineProperty(doc, "steps", {
      enumerable: true,
      get() {
        calls++;
        return [];
      },
    });
    const result = run(doc);
    expect(calls).toBe(0);
    expect(rows(result.issues)).toEqual([
      ["type", E, "/steps"],
      ["required", E, "/steps"],
    ]);
    const inArray = [1];
    Object.defineProperty(inArray, 0, {
      enumerable: true,
      get() {
        calls++;
        return {};
      },
    });
    expect(rows(run({ forge: 1, steps: inArray }).issues)).toEqual([["type", E, "/steps/0"]]);
    expect(calls).toBe(0);
  });

  test("holes in an array are not data", () => {
    const holes = new Array<unknown>(2);
    expect(rows(run({ forge: 1, steps: holes }).issues)).toEqual([
      ["type", E, "/steps/0"],
      ["type", E, "/steps/1"],
    ]);
  });

  test("only plain objects are accepted", () => {
    class Step {
      kind = "comment";
      text = "x";
    }
    expect(rows(run({ forge: 1, steps: [new Step()] }).issues)).toEqual([["type", E, "/steps/0"]]);
    expect(rows(run({ forge: 1, steps: [new Map()] }).issues)).toEqual([["type", E, "/steps/0"]]);
    expect(rows(run({ forge: 1, steps: [new Date()] }).issues)).toEqual([["type", E, "/steps/0"]]);
    expect(
      run({ forge: 1, steps: [Object.assign(Object.create(null), { kind: "comment", text: "x" })] })
        .ok,
    ).toBe(true);
  });

  test("non-JSON values are type errors, not throws", () => {
    for (const bad of [undefined, () => 1, Symbol("s"), 10n, NaN]) {
      const result = run({ forge: 1, steps: [{ kind: "op", op: "a:b", params: { x: bad } }] });
      expect(result.ok).toBe(false);
    }
    expect(run(undefined).ok).toBe(false);
    expect(run(() => 1).ok).toBe(false);
  });

  test("a Proxy that throws does not escape", () => {
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("boom");
        },
      },
    );
    const result = run(proxy);
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe("type");
  });

  test("messages never echo more than 80 characters of user text", () => {
    const long = "L".repeat(500);
    const docs = [
      { forge: 1, steps: [{ kind: long }] },
      { forge: 1, steps: [{ kind: "op", op: `a:${long}` }] },
      { forge: 1, steps: [{ kind: "op", op: "a:b", [long]: 1 }] },
      { forge: 1, steps: [{ kind: "op", op: "classical:rot", params: { [long]: 1 } }] },
      { forge: 1, [long]: 1, steps: [] },
    ];
    for (const doc of docs) {
      for (const issue of run(doc, seed).issues) {
        expect(issue.message.length).toBeLessThan(200);
        expect(issue.message).not.toContain("L".repeat(81));
        expect(JSON.stringify(issue.detail ?? {})).not.toContain("L".repeat(81));
      }
    }
  });
});

describe("validateRecipe: issue codes", () => {
  test("every code is emitted by some test above, or by the share codec", () => {
    // secret-in-url comes from encodeShare only; see share.test.ts
    const fromValidator = RECIPE_ISSUE_CODES.filter((c) => c !== "secret-in-url");
    const seen = new Set<string>();
    const docs: [unknown, CatalogueView | undefined][] = [
      [{ forge: 1, steps: [{ kind: 1 }] }, seed],
      [{ forge: 1 }, seed],
      [{ forge: 1, x: 1, steps: [] }, seed],
      [{ forge: 2, steps: [] }, seed],
      [{ forge: 1, steps: [{ kind: "wat" }] }, seed],
      [{ forge: 1, name: 1, steps: [] }, seed],
      [{ forge: 1, name: "n".repeat(500), steps: [] }, seed],
      [{ forge: 1, steps: [{ kind: "repeat", steps: [] }] }, seed],
      [
        { forge: 1, steps: Array.from({ length: 501 }, () => ({ kind: "comment", text: "c" })) },
        seed,
      ],
      [{ forge: 1, steps: [{ kind: "op", op: "nope:x" }] }, seed],
      [
        { forge: 1, steps: [{ kind: "if", test: { kind: "op", op: "hex:encode" }, then: [] }] },
        seed,
      ],
      [{ forge: 1, steps: [{ kind: "op", op: "text:upper", params: { a: 1 } }] }, seed],
      [{ forge: 1, steps: [{ kind: "op", op: "regex:test" }] }, seed],
      [{ forge: 1, steps: [{ kind: "op", op: "classical:rot", params: { amount: 99 } }] }, seed],
      [
        {
          forge: 1,
          steps: [
            {
              kind: "fork",
              split: { value: "z", enc: "hex" },
              join: { value: "", enc: "utf8" },
              steps: [],
            },
          ],
        },
        seed,
      ],
      [{ forge: 1, steps: [{ kind: "subsection", pattern: "(", steps: [] }] }, seed],
      [{ forge: 1, steps: [{ kind: "op", op: "text:upper", hash: "f".repeat(64) }] }, seed],
      [{ forge: 1, steps: [{ kind: "op", op: "classical:rot13" }] }, seed],
      [{ forge: 1, catalogue: "0".repeat(16), steps: [] }, seed],
    ];
    for (const [doc, cat] of docs) for (const i of run(doc, cat).issues) seen.add(i.code);
    expect([...seen].sort()).toEqual([...fromValidator].sort());
  });
});
