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
import { extras, golden, recipeOf, seed } from "../test/helpers.js";
import { compileRecipe } from "./compile.js";
import type { CompileOutcome, Recipe } from "./types.js";

const GATE = {
  forge: 1,
  steps: [
    { kind: "op", op: "base64:decode", params: { alphabet: "standard" } },
    { kind: "op", op: "classical:rot", params: { amount: 13 } },
    { kind: "op", op: "hex:encode", params: { case: "lower", delimiter: "none" } },
  ],
};

function compiled(
  recipe: unknown,
  catalogue = seed,
  options?: Parameters<typeof compileRecipe>[2],
) {
  const out = compileRecipe(recipe, catalogue, options);
  if (!out.ok) throw new Error(JSON.stringify(out.issues));
  return out;
}

describe("compileRecipe goldens (RECIPES.md section 12)", () => {
  test("the Gate recipe compiles to the text of 12.1", () => {
    const out = compiled(GATE);
    expect(out.text).toBe(golden("gate.fl.txt"));
    expect(out.word).toBe("bake:main");
    expect(out.issues).toEqual([]);
    expect(out.lines.map((l) => [l.path, l.kind, l.startLine, l.endLine])).toEqual([
      ["/steps/0", "op", 3, 3],
      ["/steps/1", "op", 4, 4],
      ["/steps/2", "op", 5, 5],
    ]);
  });

  test("the recipe that uses every step kind compiles to the text of 12.2", () => {
    const demo = JSON.parse(golden("demo.recipe.json")) as unknown;
    const out = compiled(demo);
    expect(out.text).toBe(golden("demo.fl.txt"));
    expect(
      out.lines.map((l) => [l.path, l.kind, `${l.startLine}-${l.endLine}`, l.disabled]),
    ).toEqual([
      ["/steps/0", "op", "4-4", false],
      ["/steps/1", "comment", "5-5", false],
      ["/steps/2", "fork", "6-9", false],
      ["/steps/2/steps/0", "op", "7-7", false],
      ["/steps/2/steps/1", "op", "8-8", true],
      ["/steps/3", "subsection", "10-12", false],
      ["/steps/3/steps/0", "op", "11-11", false],
      ["/steps/4", "if", "13-16", false],
      ["/steps/4/then/0", "op", "14-14", false],
      ["/steps/5", "repeat", "17-19", false],
      ["/steps/5/steps/0", "op", "18-18", false],
      ["/steps/6", "op", "20-20", false],
    ]);
    expect(out.lines[3]?.breakpoint).toBe(true);
  });

  test("the text is deterministic and the same for the canonical form", () => {
    const demo = JSON.parse(golden("demo.recipe.json")) as unknown;
    const canonical = JSON.parse(golden("demo.canonical.json")) as unknown;
    expect(compiled(canonical).text).toBe(compiled(demo).text);
    expect(compiled(demo).text).toBe(compiled(demo).text);
  });

  test("an empty recipe compiles to an empty word", () => {
    expect(compiled({ forge: 1, steps: [] }).text).toBe(
      "\\ forge-recipe 1\n: main ( bytes -- any )\n;\n",
    );
  });

  test("name, description and catalogue are meta lines", () => {
    const out = compiled({
      forge: 1,
      name: 'A "name"',
      description: "two\nlines",
      catalogue: seed.version,
      steps: [],
    });
    expect(out.text.split("\n").slice(0, 5)).toEqual([
      "\\ forge-recipe 1",
      '\\ name "A \\"name\\""',
      '\\ description "two\\nlines"',
      `\\ catalogue "${seed.version}"`,
      ": main ( bytes -- any )",
    ]);
  });
});

describe("compileRecipe: layout", () => {
  test("annotations sit in the order pin, break, note", () => {
    const hash = "0".repeat(64);
    const out = compiled(
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
    expect(out.text.split("\n")[2]).toBe(
      `  13 classical:rot  \\ @pin=${hash} @break @note="a \\"b\\""`,
    );
    // the hash differs from the catalogue: a warning, and the text is still produced
    expect(out.issues.map((i) => i.code)).toEqual(["hash-mismatch"]);
  });

  test("the else part is always written; an op test carries the pin on the open line", () => {
    const hash = "1".repeat(64);
    const out = compiled(
      recipeOf(
        [
          {
            kind: "if",
            test: { kind: "op", op: "regex:test", params: { pattern: "^o" }, hash },
            then: [{ kind: "op", op: "text:lower" }],
            else: [{ kind: "op", op: "text:upper" }],
            note: "n",
          },
        ],
        {},
      ),
      seed,
      { pins: "ignore" },
    );
    expect(out.text).toBe(
      [
        "\\ forge-recipe 1",
        ": main ( bytes -- any )",
        `  recipe:as-bytes [ "^o" "" regex:test ] [  \\ @pin=${hash} @note="n"`,
        "    text:lower",
        "  ] [",
        "    text:upper",
        "  ] recipe:branch",
        ";",
        "",
      ].join("\n"),
    );
    expect(out.lines.map((l) => l.path)).toEqual([
      "/steps/0",
      "/steps/0/then/0",
      "/steps/0/else/0",
    ]);
  });

  test("repeat with times, repeat until stable with the default and an explicit cap", () => {
    const out = compiled(
      recipeOf([
        { kind: "repeat", times: 3, steps: [] },
        { kind: "repeat", until: "stable", steps: [] },
        { kind: "repeat", until: "stable", max: 7, steps: [] },
      ]),
    );
    expect(out.text).toBe(
      [
        "\\ forge-recipe 1",
        ": main ( bytes -- any )",
        "  recipe:as-bytes 3 [",
        "  ] recipe:repeat",
        "  recipe:as-bytes 100 [",
        "  ] recipe:settle",
        "  recipe:as-bytes 7 [",
        "  ] recipe:settle",
        ";",
        "",
      ].join("\n"),
    );
  });

  test("disabled containers comment out the whole block, one prefix per disabled level", () => {
    const out = compiled(
      recipeOf([
        {
          kind: "fork",
          split: { value: "\n", enc: "utf8" },
          join: { value: "", enc: "utf8" },
          disabled: true,
          steps: [
            { kind: "comment", text: "inside" },
            { kind: "op", op: "text:upper", disabled: true },
            { kind: "op", op: "text:lower" },
          ],
        },
      ]),
    );
    expect(out.text).toBe(
      [
        "\\ forge-recipe 1",
        ": main ( bytes -- any )",
        '  \\ ~ recipe:as-bytes "\\n" "" [',
        '    \\ ~ \\ # "inside"',
        "    \\ ~ \\ ~ text:upper",
        "    \\ ~ text:lower",
        "  \\ ~ ] fork",
        ";",
        "",
      ].join("\n"),
    );
    expect(out.lines.map((l) => l.disabled)).toEqual([true, true, true, true]);
  });

  test("the word and vocab options", () => {
    const out = compiled({ forge: 1, steps: [] }, seed, { word: "go", vocab: "mine" });
    expect(out.word).toBe("mine:go");
    expect(out.text).toContain(": go ( bytes -- any )");
  });
});

describe("compileRecipe: failures", () => {
  test("an invalid recipe returns the validation issues", () => {
    const out = compileRecipe({ forge: 2, steps: [] }, seed);
    expect(out.ok).toBe(false);
    expect(out.issues[0]?.code).toBe("bad-version");
  });

  test("strict pins turn a mismatch into a failure; ignore drops it", () => {
    const step = { kind: "op", op: "text:upper", hash: "2".repeat(64) };
    const strict: CompileOutcome = compileRecipe(recipeOf([step]), seed, { pins: "strict" });
    expect(strict.ok).toBe(false);
    expect(compiled(recipeOf([step]), seed, { pins: "ignore" }).issues).toEqual([]);
    expect(compiled(recipeOf([step])).issues[0]?.severity).toBe("warning");
  });

  test("bad options fail without throwing", () => {
    for (const options of [
      { word: "recurse" },
      { word: "a b" },
      { word: "x:y" },
      { vocab: "1x" },
    ]) {
      const out = compileRecipe({ forge: 1, steps: [] }, seed, options);
      expect(out.ok).toBe(false);
      expect(out.issues[0]?.code).toBe("bad-value");
    }
  });

  test("it never throws on hostile input", () => {
    for (const input of [null, 1, "x", [], undefined]) {
      expect(compileRecipe(input, seed).ok).toBe(false);
    }
    expect(compileRecipe({ forge: 1, steps: [] }, extras).ok).toBe(true);
    // a broken catalogue is reported, not thrown
    const broken = compileRecipe({ forge: 1, steps: [] }, null as never);
    expect(broken.ok).toBe(false);
    expect(broken.issues[0]?.code).toBe("bad-value");
  });
});

describe("compileRecipe: every parameter type is spelled as section 5.2 says", () => {
  test("literals of the extra catalogue", () => {
    const recipe = recipeOf([
      { kind: "op", op: "x:key", params: { key: { value: "DE AD", enc: "hex" } } },
      { kind: "op", op: "x:secret", params: { secret: { value: "3q2+7w", enc: "base64" } } },
      { kind: "op", op: "x:toggle", params: { mode: { value: "héllo", enc: "latin1" } } },
      { kind: "op", op: "x:toggle" },
      {
        kind: "op",
        op: "x:nums",
        params: { count: "7", big: "9007199254740993", any: 0.5, ratio: 1, on: true },
      },
      { kind: "op", op: "x:nums", params: { any: 1e21, ratio: -0 } },
      {
        kind: "op",
        op: "x:text",
        params: { set: "ab", raw: "DE AD", word: 'a"b\\c', rx: "x", pick: "b" },
      },
      { kind: "op", op: "x:text" },
      { kind: "op", op: "y:rot" },
    ]) as Recipe;
    const lines = compiled(recipe, extras).text.split("\n").slice(2, -2);
    expect(lines).toEqual([
      "  #[ de ad ] x:key",
      '  "3q2+7w==" recipe:base64 x:secret',
      '  "héllo" recipe:latin1 x:toggle',
      '  "ab" recipe:latin1 x:toggle',
      "  7 9007199254740993 3 1.0 0.5 true x:nums",
      "  5 9007199254740993 3 -0.0 1000000000000000000000 false x:nums",
      '  "ab" #[ de ad ] "a\\"b\\\\c" "x" "b" x:text',
      '  "abc" #[ ab 01 ] "hey" "a+" "a" x:text',
      "  y:rot",
    ]);
  });
});
