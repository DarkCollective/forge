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
import { Rng, genRecipe } from "../test/gen.js";
import {
  combined,
  extras,
  fixtureFiles,
  fixtureText,
  golden,
  recipeOf,
  seed,
} from "../test/helpers.js";
import { compileRecipe } from "./compile.js";
import { canonicalRecipe } from "./normalise.js";
import { parseRecipeText } from "./text.js";
import type { CatalogueView, Recipe, RecipeIssue } from "./types.js";
import { validateRecipe } from "./validate.js";

function compileText(recipe: unknown, catalogue: CatalogueView = seed): string {
  const out = compileRecipe(recipe, catalogue, { pins: "ignore" });
  if (!out.ok) throw new Error(JSON.stringify(out.issues));
  return out.text;
}

/** The round-trip identity of RECIPES.md section 6.5. */
function expectRoundTrip(recipe: unknown, catalogue: CatalogueView): void {
  const checked = validateRecipe(recipe, catalogue, { pins: "ignore" });
  if (!checked.ok) throw new Error(`not valid: ${JSON.stringify(checked.issues)}`);
  const canonical = canonicalRecipe(checked.recipe, catalogue);
  const text = compileText(recipe, catalogue);
  const parsed = parseRecipeText(text, catalogue);
  if (!parsed.ok) throw new Error(`${JSON.stringify(parsed.issues)}\n${text}`);
  expect(JSON.stringify(parsed.recipe)).toBe(JSON.stringify(canonical));
  expect(compileText(canonical, catalogue)).toBe(text);
  // parsing again from the text of the canonical form is a fixed point
  const again = parseRecipeText(compileText(parsed.recipe, catalogue), catalogue);
  expect(again.ok && JSON.stringify(again.recipe)).toBe(JSON.stringify(canonical));
}

describe("parseRecipeText: goldens (RECIPES.md section 12.3)", () => {
  test("the text of 12.2 parses to the canonical JSON of 12.3, byte for byte", () => {
    const parsed = parseRecipeText(golden("demo.fl.txt"), seed);
    expect(parsed.ok).toBe(true);
    expect(JSON.stringify(parsed.ok && parsed.recipe)).toBe(golden("demo.canonical.json").trim());
    expect(parsed.issues).toEqual([]);
  });

  test("compileRecipe of that JSON returns the text of 12.2 again", () => {
    const canonical = JSON.parse(golden("demo.canonical.json")) as unknown;
    expect(compileText(canonical)).toBe(golden("demo.fl.txt"));
  });

  test("the Gate text parses to the Gate recipe with every parameter explicit", () => {
    const parsed = parseRecipeText(golden("gate.fl.txt"), seed);
    expect(JSON.stringify(parsed.ok && parsed.recipe)).toBe(
      '{"forge":1,"steps":[{"kind":"op","op":"base64:decode","params":{"alphabet":"standard"}},' +
        '{"kind":"op","op":"classical:rot","params":{"amount":13}},' +
        '{"kind":"op","op":"hex:encode","params":{"delimiter":"none","case":"lower"}}]}',
    );
  });

  test("literal and annotation examples (12.3 table)", () => {
    const hash = "0".repeat(64);
    const text = compileText(
      recipeOf([
        {
          kind: "op",
          op: "classical:rot",
          params: { amount: 13 },
          hash,
          breakpoint: true,
          note: 'a "b"',
        },
      ]),
    );
    expect(text).toContain(`13 classical:rot  \\ @pin=${hash} @break @note="a \\"b\\""`);
    const parsed = parseRecipeText(text, seed);
    expect(parsed.ok && parsed.recipe.steps[0]).toEqual({
      kind: "op",
      op: "classical:rot",
      params: { amount: 13 },
      hash,
      breakpoint: true,
      note: 'a "b"',
    });
    // the encoded literal rows
    const toggle = (value: string, enc: string) => ({
      kind: "op",
      op: "x:toggle",
      params: { mode: { value, enc } },
    });
    for (const [step, line] of [
      [toggle("héllo", "latin1"), '"héllo" recipe:latin1 x:toggle'],
      [toggle("3q2+7w", "base64"), '"3q2+7w==" recipe:base64 x:toggle'],
      [toggle("DE AD", "hex"), "#[ de ad ] x:toggle"],
      [toggle("tab\there", "utf8"), '"tab\\there" x:toggle'],
    ] as const) {
      expect(compileText(recipeOf([step]), extras)).toContain(`  ${line}\n`);
    }
  });
});

describe("parseRecipeText: the round trip (RECIPES.md section 6.5)", () => {
  test("the demo and gate recipes", () => {
    expectRoundTrip(JSON.parse(golden("demo.recipe.json")), seed);
    expectRoundTrip(JSON.parse(golden("demo.canonical.json")), seed);
  });

  test("every valid corpus document that the seed catalogue accepts", () => {
    let n = 0;
    for (const file of fixtureFiles("corpus/valid")) {
      const doc = JSON.parse(fixtureText("corpus/valid", file)) as unknown;
      if (!validateRecipe(doc, seed, { pins: "ignore" }).ok) continue;
      expectRoundTrip(doc, seed);
      n++;
    }
    expect(n).toBeGreaterThanOrEqual(10);
  });

  test("a hand-written set of awkward recipes", () => {
    const hard = '\u0000\u0001\u007f\u0085\u009f \\"\r\n\t é😀';
    const recipes: unknown[] = [
      recipeOf([], { name: hard, description: hard, catalogue: seed.version }),
      recipeOf([
        { kind: "comment", text: hard },
        { kind: "op", op: "text:upper", note: hard },
      ]),
      recipeOf([
        {
          kind: "op",
          op: "regex:replace",
          params: { pattern: hard.replace(/[\\()]/g, ""), replacement: hard },
        },
      ]),
      recipeOf([
        { kind: "op", op: "classical:rot13" },
        { kind: "op", op: "classical:rot", params: { amount: "5" } },
      ]),
      recipeOf([
        {
          kind: "fork",
          split: { value: "\n", enc: "utf8" },
          join: { value: "0A 0b", enc: "hex" },
          disabled: true,
          breakpoint: true,
          note: "n",
          steps: [
            { kind: "comment", text: "inside" },
            { kind: "op", op: "text:upper", disabled: true },
            {
              kind: "subsection",
              pattern: "a",
              flags: "mi",
              encoding: "latin1",
              disabled: true,
              steps: [{ kind: "op", op: "text:lower", disabled: true }],
            },
          ],
        },
      ]),
      recipeOf([
        {
          kind: "if",
          test: {
            kind: "op",
            op: "regex:test",
            params: { pattern: "a", flags: "i" },
            hash: "c".repeat(64),
          },
          then: [{ kind: "op", op: "text:upper" }],
          else: [
            {
              kind: "if",
              test: { kind: "regex", pattern: "b", flags: "s", encoding: "latin1" },
              then: [],
              else: [{ kind: "comment", text: "c" }],
            },
          ],
          disabled: true,
        },
      ]),
      recipeOf([
        { kind: "repeat", times: 1000, steps: [] },
        { kind: "repeat", until: "stable", max: 1, steps: [] },
      ]),
    ];
    for (const r of recipes) expectRoundTrip(r, seed);
  });

  test("nesting to the depth limit of 8", () => {
    let inner: unknown[] = [{ kind: "op", op: "text:upper" }];
    for (let i = 0; i < 8; i++) {
      inner = [
        {
          kind: "fork",
          split: { value: "\n", enc: "utf8" },
          join: { value: "", enc: "utf8" },
          steps: inner,
        },
      ];
    }
    // 8 forks around an op put the op at depth 9: too deep, so wrap 7
    expect(validateRecipe(recipeOf(inner), seed).ok).toBe(false);
    inner = (inner[0] as { steps: unknown[] }).steps;
    expectRoundTrip(recipeOf(inner), seed);
  });

  test("a property over generated recipes (seed and extra ops, every parameter type)", () => {
    for (let i = 1; i <= 400; i++) {
      const recipe = genRecipe(new Rng(i * 7919), combined);
      try {
        expectRoundTrip(recipe, combined);
      } catch (e) {
        throw new Error(
          `generated recipe ${i}: ${(e as Error).message}\n${JSON.stringify(recipe)}`,
          { cause: e },
        );
      }
    }
  });

  test("CRLF line ends, blank lines and other indentation are accepted", () => {
    const text = golden("demo.fl.txt");
    const messy = text
      .replace(/\n(?= {2}\\ ~)/g, "\n\n")
      .replace(/^ +/gm, "")
      .replace(/\n/g, "\r\n");
    const a = parseRecipeText(text, seed);
    const b = parseRecipeText(messy, seed);
    expect(b.ok && JSON.stringify(b.recipe)).toBe(a.ok && JSON.stringify(a.recipe));
  });

  test("an alias in the text is accepted with a warning and rewritten", () => {
    const text = "\\ forge-recipe 1\n: main ( bytes -- any )\n  13 classical:rot13\n;\n";
    const parsed = parseRecipeText(text, seed);
    expect(parsed.ok && parsed.recipe.steps[0]).toEqual({
      kind: "op",
      op: "classical:rot",
      params: { amount: 13 },
    });
    expect(parsed.issues.map((i) => [i.code, i.detail?.line, i.detail?.col])).toEqual([
      ["alias-used", 3, 3],
    ]);
  });
});

const BODY = (...lines: string[]) =>
  ["\\ forge-recipe 1", ": main ( bytes -- any )", ...lines, ";", ""].join("\n");

interface ErrorRow {
  name: string;
  text: string;
  code: string;
  path?: string;
  line: number;
  col?: number;
  constraint?: string;
  catalogue?: CatalogueView;
}

function firstIssue(text: string, catalogue: CatalogueView = seed): RecipeIssue {
  const result = parseRecipeText(text, catalogue);
  expect(result.ok).toBe(false);
  return result.issues[0] as RecipeIssue;
}

describe("parseRecipeText: errors carry the line and column (RECIPES.md section 6.4)", () => {
  const rows: ErrorRow[] = [
    { name: "empty text", text: "", code: "required", path: "", line: 1 },
    { name: "wrong first line", text: "hello\n", code: "required", path: "", line: 1 },
    {
      name: "wrong format version",
      text: "\\ forge-recipe 2\n",
      code: "bad-version",
      path: "",
      line: 1,
    },
    { name: "no word line", text: "\\ forge-recipe 1\n;\n", code: "required", path: "", line: 2 },
    {
      name: "bad word line",
      text: "\\ forge-recipe 1\n: main ( bytes -- bytes )\n;\n",
      code: "required",
      path: "",
      line: 2,
    },
    {
      name: "no semicolon",
      text: "\\ forge-recipe 1\n: main ( bytes -- any )\n  text:upper\n",
      code: "required",
      path: "",
      line: 4,
    },
    {
      name: "text after the semicolon",
      text: BODY() + "extra\n",
      code: "unknown-field",
      path: "",
      line: 4,
    },
    {
      name: "meta that is not a string",
      text: "\\ forge-recipe 1\n\\ name 5\n: main ( bytes -- any )\n;\n",
      code: "bad-value",
      path: "",
      line: 2,
    },
    {
      name: "duplicate meta",
      text: '\\ forge-recipe 1\n\\ name "a"\n\\ name "b"\n: main ( bytes -- any )\n;\n',
      code: "bad-value",
      path: "",
      line: 3,
    },
    {
      name: "a bare CR",
      text: BODY("  text:upper\rtext:lower"),
      code: "bad-value",
      path: "",
      line: 3,
      col: 13,
    },
    {
      name: "close without open",
      text: BODY("  ] fork"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
      constraint: "block structure",
    },
    {
      name: "else without open",
      text: BODY("  ] ["),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
      constraint: "block structure",
    },
    {
      name: "never closed",
      text: BODY('  recipe:as-bytes "x" "" [', "    text:upper"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
      col: 3,
      constraint: "block structure",
    },
    {
      name: "mismatched close",
      text: BODY('  recipe:as-bytes "x" "" "utf8" [', "  ] fork"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "close word of an if on a fork",
      text: BODY('  recipe:as-bytes "a" "" [', "  ] recipe:branch"),
      code: "bad-value",
      path: "/steps/0",
      line: 4,
      constraint: "block structure",
    },
    {
      name: "wrong level on the close line",
      text: BODY('  recipe:as-bytes "a" "" [', "  \\ ~ ] fork"),
      code: "bad-value",
      path: "/steps/0",
      line: 4,
      constraint: "block structure",
    },
    {
      name: "a level jump",
      text: BODY("  \\ ~ \\ ~ text:upper"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
      constraint: "block structure",
    },
    {
      name: "a level jump on an open line",
      text: BODY("  \\ ~ \\ ~ recipe:as-bytes 2 [", "  \\ ~ \\ ~ ] recipe:repeat"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
      constraint: "block structure",
    },
    {
      name: "a comment at the wrong level",
      text: BODY('  \\ ~ \\ # "x"'),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
      constraint: "block structure",
    },
    {
      name: "else in a fork",
      text: BODY('  recipe:as-bytes "a" "b" [', "  ] [", "  ] fork"),
      code: "bad-value",
      path: "/steps/0",
      line: 4,
      constraint: "block structure",
    },
    {
      name: "else at the wrong level",
      text: BODY(
        '  recipe:as-bytes [ "a" "" "utf8" recipe:matches ] [',
        "  \\ ~ ] [",
        "  ] recipe:branch",
      ),
      code: "bad-value",
      path: "/steps/0",
      line: 4,
      constraint: "block structure",
    },
    {
      name: "two else lines",
      text: BODY(
        '  recipe:as-bytes [ "a" "" "utf8" recipe:matches ] [',
        "  ] [",
        "  ] [",
        "  ] recipe:branch",
      ),
      code: "bad-value",
      path: "/steps/0",
      line: 5,
      constraint: "block structure",
    },
    {
      name: "if without else",
      text: BODY('  recipe:as-bytes [ "a" "" "utf8" recipe:matches ] [', "  ] recipe:branch"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "unknown op",
      text: BODY("  nope:x"),
      code: "unknown-op",
      path: "/steps/0",
      line: 3,
      col: 3,
    },
    {
      name: "an op line that ends in a plain word",
      text: BODY("  13 upper"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "a non-literal before the op",
      text: BODY("  upper text:upper"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "a bracket before the op",
      text: BODY("  [ text:upper"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "a leftover group",
      text: BODY("  1 text:upper"),
      code: "bad-param",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "a missing group",
      text: BODY("  classical:rot"),
      code: "bad-param",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "a group of the wrong kind",
      text: BODY('  "13" classical:rot'),
      code: "bad-param",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "a float for an int",
      text: BODY("  13.0 classical:rot"),
      code: "bad-param",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "an int for a num",
      text: BODY("  5 9007199254740993 3 1 2 false x:nums"),
      code: "bad-param",
      path: "/steps/0",
      line: 3,
      catalogue: extras,
    },
    {
      name: "a helper on a plain string",
      text: BODY('  "13" recipe:latin1 classical:rot'),
      code: "bad-param",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "an unterminated string",
      text: BODY('  "abc classical:rot'),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
      col: 3,
    },
    {
      name: "a bad byte literal",
      text: BODY("  #[ zz ] hex:decode"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "an empty line after the prefix",
      text: BODY("  \\ ~ "),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "a plain comment line",
      text: BODY("  \\ hello"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "a comment step that is not a string",
      text: BODY("  \\ # 5"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "a comment step with trailing text",
      text: BODY('  \\ # "a" x'),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "an annotation that is not an annotation",
      text: BODY("  text:upper  \\ hello"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "an annotation with one space",
      text: BODY("  text:upper \\ @break"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "annotations in the wrong order",
      text: BODY("  text:upper  \\ @break @pin=" + "a".repeat(64)),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "a bad pin",
      text: BODY("  text:upper  \\ @pin=abc"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "a pin without a separator",
      text: BODY("  text:upper  \\ @pin=" + "a".repeat(64) + "@break"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "a break without a separator",
      text: BODY('  text:upper  \\ @break@note="x"'),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "an unterminated note",
      text: BODY('  text:upper  \\ @note="abc'),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "a note that is not JSON",
      text: BODY('  text:upper  \\ @note="a\\q"'),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "a note that is not a string",
      text: BODY("  text:upper  \\ @note=5"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "annotations on a close line",
      text: BODY("  recipe:as-bytes 2 [", "  ] recipe:repeat  \\ @break"),
      code: "bad-value",
      path: "/steps/0/steps/0",
      line: 4,
    },
    {
      name: "a close line with extra tokens",
      text: BODY("  recipe:as-bytes 2 [", "  ] recipe:repeat 5"),
      code: "bad-value",
      path: "/steps/0/steps/0",
      line: 4,
    },
    {
      name: "a close line with a word that is no closer",
      text: BODY("  recipe:as-bytes 2 [", "  ] text:upper"),
      code: "bad-value",
      path: "/steps/0/steps/0",
      line: 4,
    },
    { name: "a lone bracket", text: BODY("  ]"), code: "bad-value", path: "/steps/0", line: 3 },
    {
      name: "a pin on a fork",
      text: BODY('  recipe:as-bytes "a" "b" [  \\ @pin=' + "a".repeat(64), "  ] fork"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "a pin on a regex if",
      text: BODY(
        '  recipe:as-bytes [ "a" "" "utf8" recipe:matches ] [  \\ @pin=' + "a".repeat(64),
        "  ] [",
        "  ] recipe:branch",
      ),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "fork with one atom",
      text: BODY('  recipe:as-bytes "a" [', "  ] fork"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "fork with a number",
      text: BODY('  recipe:as-bytes "a" 5 [', "  ] fork"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "fork with a non-literal",
      text: BODY('  recipe:as-bytes "a" x [', "  ] fork"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "section with two atoms",
      text: BODY('  recipe:as-bytes "a" "" [', "  ] recipe:section"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "section with a helper",
      text: BODY('  recipe:as-bytes "a" "" "x" recipe:latin1 [', "  ] recipe:section"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "section with an unknown encoding",
      text: BODY('  recipe:as-bytes "a" "" "hex" [', "  ] recipe:section"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "if with a test that is not one quotation",
      text: BODY(
        '  recipe:as-bytes [ [ "a" "" "utf8" recipe:matches ] ] [',
        "  ] [",
        "  ] recipe:branch",
      ),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "if without brackets around the test",
      text: BODY(
        '  recipe:as-bytes [ "a" "" "utf8" recipe:matches [',
        "  ] [",
        "  ] recipe:branch",
      ),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "if with a regex test of the wrong shape",
      text: BODY(
        '  recipe:as-bytes [ "a" 1 "utf8" recipe:matches ] [',
        "  ] [",
        "  ] recipe:branch",
      ),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "if with a regex test and a bad encoding",
      text: BODY(
        '  recipe:as-bytes [ "a" "" "hex" recipe:matches ] [',
        "  ] [",
        "  ] recipe:branch",
      ),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "if with an unknown op test",
      text: BODY("  recipe:as-bytes [ nope:x ] [", "  ] [", "  ] recipe:branch"),
      code: "unknown-op",
      path: "/steps/0/test",
      line: 3,
    },
    {
      name: "repeat with a float",
      text: BODY("  recipe:as-bytes 1.5 [", "  ] recipe:repeat"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "repeat with a huge integer",
      text: BODY("  recipe:as-bytes 99999999999999999999 [", "  ] recipe:repeat"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "repeat with two atoms",
      text: BODY("  recipe:as-bytes 1 2 [", "  ] recipe:repeat"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
    {
      name: "repeat with no atom",
      text: BODY("  recipe:as-bytes [", "  ] recipe:settle"),
      code: "bad-value",
      path: "/steps/0",
      line: 3,
    },
  ];

  test.each(rows)("$name", (row) => {
    const issue = firstIssue(row.text, row.catalogue);
    expect(issue.code).toBe(row.code);
    expect(issue.severity).toBe("error");
    if (row.path !== undefined) expect(issue.path).toBe(row.path);
    expect(issue.detail?.line).toBe(row.line);
    expect(typeof issue.detail?.col).toBe("number");
    if (row.col !== undefined) expect(issue.detail?.col).toBe(row.col);
    if (row.constraint !== undefined) expect(issue.detail?.constraint).toBe(row.constraint);
  });

  test("validation issues are mapped to the line of their step", () => {
    const hash = "f".repeat(64);
    const text = BODY(
      "  26 classical:rot",
      '  "(" "" regex:test',
      '  recipe:as-bytes "(" "" "utf8" [',
      "    text:upper  \\ @pin=" + hash,
      "  ] recipe:section",
    );
    const result = parseRecipeText(text, seed);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => [i.code, i.path, i.detail?.line, i.detail?.col])).toEqual([
      ["bad-param", "/steps/0/params/amount", 3, 3],
      ["bad-regex", "/steps/1/params/pattern", 4, 3],
      ["bad-regex", "/steps/2/pattern", 5, 3],
      ["hash-mismatch", "/steps/2/steps/0/hash", 6, 5],
    ]);
  });

  test("issues of the document itself point at line 1", () => {
    const text = '\\ forge-recipe 1\n\\ catalogue "0000000000000000"\n: main ( bytes -- any )\n;\n';
    const result = parseRecipeText(text, seed);
    expect(result.ok).toBe(true);
    expect(result.issues.map((i) => [i.code, i.detail?.line])).toEqual([["catalogue-mismatch", 1]]);
    const long = `\\ forge-recipe 1\n\\ name "${"n".repeat(200)}"\n: main ( bytes -- any )\n;\n`;
    const bad = parseRecipeText(long, seed);
    expect(bad.issues.map((i) => [i.code, i.path, i.detail?.line])).toEqual([
      ["bad-value", "/name", 1],
    ]);
  });

  test("a lexical error is a bad-value at the column inside the line", () => {
    const issue = firstIssue(BODY('    1 "abc'));
    expect(issue).toMatchObject({ code: "bad-value", path: "/steps/0" });
    expect(issue.detail).toMatchObject({ line: 3, col: 7 });
  });

  test("limits: text size, nesting depth and the number of steps", () => {
    const big = BODY('  \\ # "' + "x".repeat(300_000) + '"');
    expect(firstIssue(big)).toMatchObject({ code: "limit", detail: { limit: "maxJsonBytes" } });
    const wide = "é".repeat(150_000);
    expect(firstIssue(wide)).toMatchObject({ code: "limit" });

    const open = (n: number) =>
      Array.from({ length: n }, (_, i) => `${"  ".repeat(i + 1)}recipe:as-bytes 2 [`);
    const close = (n: number) =>
      Array.from({ length: n }, (_, i) => `${"  ".repeat(n - i)}] recipe:repeat`);
    const nested = (n: number) => BODY(...open(n), ...close(n));
    expect(parseRecipeText(nested(8), seed).ok).toBe(true);
    const deep = firstIssue(nested(9));
    expect(deep).toMatchObject({ code: "limit", detail: { limit: "maxDepth", line: 11 } });
    expect(deep.path).toBe(
      Array.from({ length: 9 }, () => "steps/0")
        .join("/")
        .replace(/^/, "/"),
    );

    const many = BODY(...Array.from({ length: 501 }, () => "  text:upper"));
    expect(firstIssue(many)).toMatchObject({
      code: "limit",
      path: "/steps/500",
      detail: { limit: "maxSteps" },
    });
    expect(
      parseRecipeText(BODY(...Array.from({ length: 500 }, () => "  text:upper")), seed).ok,
    ).toBe(true);
  });

  test("text from a user is never run: definitions and loaders are plain errors", () => {
    for (const evil of [
      ": evil ( -- ) 1 2 + ;",
      "IN: core",
      "USING: core",
      "PRIMITIVE: x",
      "recipe:section",
      "VOCAB: hack",
      "1 2 + .",
      "VARIABLE x",
    ]) {
      const issue = firstIssue(BODY(`  ${evil}`));
      expect(["bad-value", "unknown-op", "bad-param"]).toContain(issue.code);
    }
    // a second definition after the semicolon is not read
    expect(firstIssue(BODY() + ": evil ( -- ) ;\n").code).toBe("unknown-field");
  });

  test("it never throws", () => {
    for (const text of [
      "\u0000",
      "\\ forge-recipe 1\n: main ( bytes -- any )\n  \\ ~ \\ ~ \\ ~",
      null,
      undefined,
      5,
    ]) {
      expect(parseRecipeText(text as string, seed).ok).toBe(false);
    }
    // a broken catalogue is reported, not thrown
    const broken = parseRecipeText(golden("gate.fl.txt"), null as unknown as CatalogueView);
    expect(broken.ok).toBe(false);
    expect(broken.issues[0]?.code).toBe("bad-value");
  });

  test("the Recipe type is what comes back", () => {
    const result = parseRecipeText(golden("gate.fl.txt"), seed);
    const recipe: Recipe | undefined = result.ok ? result.recipe : undefined;
    expect(recipe?.steps).toHaveLength(3);
  });
});
