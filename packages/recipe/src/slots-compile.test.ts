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
// RECIPES-1.2.md section 6 (RW3): compilation of slot steps, the step map, the canonical text and its parser, and the
// implicit conversions. Cases CR231 to CR238, CR260, CR261, CR264, CR266 and the recipe half of CR267. The "(run)" cases
// also run on a real runtime here (packages/ops/src/recipe.test.ts runs the same texts, written out by hand).
import { valueHelpers } from "@forge/lang";
import type { ForgeRuntime, RunResult, SourcePos, Value } from "@forge/lang";
import { assembleRuntime } from "@forge/ops";
import { loadBundleNode } from "@forge/ops/node";
import { describe, expect, test } from "vitest";
import { conversionCatalogue } from "../test/conversions-fixture.js";
import { fixtureFiles, fixtureText, golden, recipeOf, seed } from "../test/helpers.js";
import { compileRecipe } from "./compile.js";
import { planConversions } from "./conversions.js";
import { canonicalRecipe } from "./normalise.js";
import { recipeNeedsHardKill, resolveStepIps } from "./stepmap.js";
import { parseRecipeText } from "./text.js";
import type { CatalogueView, Recipe } from "./types.js";
import { validateRecipe } from "./validate.js";

const cat = conversionCatalogue;
const noConversions: CatalogueView = { version: cat.version, ops: cat.ops };

function compiled(recipe: unknown, catalogue: CatalogueView = cat) {
  const out = compileRecipe(recipe, catalogue, { pins: "ignore" });
  if (!out.ok) throw new Error(JSON.stringify(out.issues));
  return out;
}

const rows = (lines: readonly { path: string; startLine: number; endLine: number }[]) =>
  lines.map((l) => `${l.path} ${l.startLine}-${l.endLine}`);

const op = (name: string, extra: Record<string, unknown> = {}) => ({
  kind: "op",
  op: name,
  ...extra,
});
const lane = (...steps: unknown[]) => ({ steps });

// ---------------------------------------------------------------------------------------------
// The recipes of the (run) cases, with the fixture ops fx:cat and fx:then
// ---------------------------------------------------------------------------------------------

const R232 = recipeOf([
  op("text:upper"),
  op("fx:cat", { pipe: "left", right: lane(op("text:lower")) }),
]);
const R233 = recipeOf([
  op("text:upper"),
  op("fx:cat", { pipe: "right", left: lane(op("text:lower")) }),
]);
const R234 = recipeOf([
  op("text:upper"),
  op("fx:cat", { left: lane(op("text:lower")), right: lane(op("text:reverse")) }),
]);
const replaceAll = (replacement: unknown) =>
  op("regex:replace", { params: { pattern: "^.*$", replacement } });
const R235a = recipeOf([
  { kind: "register", name: "q", steps: [op("text:lower")] },
  op("text:upper"),
  op("fx:cat", { pipe: "left", right: lane(replaceAll({ ref: "q" })) }),
]);
const R235b = recipeOf([
  op("text:upper"),
  op("fx:cat", {
    pipe: "right",
    left: lane(
      { kind: "register", name: "r", steps: [op("text:reverse")] },
      replaceAll({ ref: "r" }),
    ),
  }),
]);
const R260a = recipeOf([
  op("text:upper"),
  op("fx:then", { pipe: "base", step: lane(op("text:lower")) }),
]);
const R260b = recipeOf([
  op("text:upper"),
  op("fx:then", { base: lane(op("text:lower")), step: lane(op("text:reverse")) }),
]);

const T232 = String.raw`\ forge-recipe 1
: main ( bytes -- any )
  text:upper
  [
    text:lower
  ] recipe:peek
  fx:cat
;
`;
const T233 = String.raw`\ forge-recipe 1
: main ( bytes -- any )
  text:upper
  [
    text:lower
  ] recipe:peek swap
  fx:cat
;
`;
const T234 = String.raw`\ forge-recipe 1
: main ( bytes -- any )
  text:upper
  [
    text:lower
  ] recipe:peek swap
  [
    text:reverse
  ] recipe:peek nip
  fx:cat
;
`;
const T235a = String.raw`\ forge-recipe 1
: main ( bytes -- any )
  [
    text:lower
  ] recipe:peek :> $q
  text:upper
  [
    "^.*$" $q "" regex:replace
  ] recipe:peek
  fx:cat
;
`;
const T235b = String.raw`\ forge-recipe 1
: main ( bytes -- any )
  text:upper
  [
    [
      text:reverse
    ] recipe:peek :> $r
    "^.*$" $r "" regex:replace
  ] recipe:peek swap
  fx:cat
;
`;
const T260a = T232.replace("fx:cat", "fx:then");
const T260b = T234.replace("fx:cat", "fx:then");

// ---------------------------------------------------------------------------------------------
// A runtime on the full bundle, with the two fixture words (their word is the core `cat`)
// ---------------------------------------------------------------------------------------------

const { bytes } = valueHelpers;

async function runtimeWith(text: string): Promise<ForgeRuntime> {
  const rt = assembleRuntime(await loadBundleNode("all"));
  rt.setCurrentVocab("fx");
  rt.load(
    ": cat ( str right:str -- str ) right core:cat ;\n: then ( str step:str -- str ) step core:cat ;\n",
    { unit: "fixture", scope: { current: "fx", using: [] } },
  );
  rt.setCurrentVocab("bake");
  rt.setCurrentVocab("user");
  rt.load(text, { unit: "recipe", scope: { current: "bake", using: [] } });
  return rt;
}

async function bake(text: string, input: string): Promise<RunResult> {
  const data = Uint8Array.from(input, (c) => c.charCodeAt(0));
  return (await runtimeWith(text)).call("bake:main", [bytes(data)]);
}

function top(r: RunResult): Value {
  if (!r.ok) throw r.error;
  return r.stack[r.stack.length - 1] as Value;
}

async function positionsOf(text: string): Promise<readonly SourcePos[]> {
  const entry = (await runtimeWith(text)).lookup("bake:main");
  if (entry.kind !== "fl" || entry.code === null) throw new Error("not a colon word");
  return entry.code.positions;
}

// ---------------------------------------------------------------------------------------------

describe("CR231 compatibility: a recipe with no slot step and no conversion compiles as it did", () => {
  test("the golden of RECIPES.md section 12.2 is unchanged, under a catalogue that has conversions too", () => {
    const demo = JSON.parse(golden("demo.recipe.json")) as unknown;
    expect(compiled(demo, seed).text).toBe(golden("demo.fl.txt"));
    // The conversions of a catalogue touch only a recipe whose kinds meet one of them.
    const withConversions = { ...seed, conversions: cat.conversions } as CatalogueView;
    expect(compiled(demo, withConversions).text).toBe(golden("demo.fl.txt"));
    expect(compiled(demo, withConversions).lines).toEqual(compiled(demo, seed).lines);
  });

  test("every valid v1 and v1.1 document compiles to the same text and lines whatever conversions are declared", () => {
    for (const dir of ["corpus/valid", "corpus/v11/valid"]) {
      for (const file of fixtureFiles(dir)) {
        const doc = JSON.parse(fixtureText(dir, file)) as unknown;
        const plain = compileRecipe(doc, seed, { pins: "ignore" });
        const declared = compileRecipe(
          doc,
          { ...seed, conversions: [{ from: "x", to: "y", op: "hex:decode", atEnd: true }] },
          { pins: "ignore" },
        );
        if (!plain.ok) continue;
        expect(declared.ok && declared.text, file).toBe(plain.text);
        expect(declared.ok && declared.lines, file).toEqual(plain.lines);
        for (const line of plain.lines) expect(line, file).not.toHaveProperty("implicit");
      }
    }
  });
});

describe("CR232 to CR235 and CR260: the compiled forms (run)", () => {
  test("CR232 pipe left: the lane, then the op", async () => {
    const out = compiled(R232);
    expect(out.text).toBe(T232);
    expect(rows(out.lines)).toEqual(["/steps/0 3-3", "/steps/1 4-7", "/steps/1/right/steps/0 5-5"]);
    expect(top(await bake(out.text, "Ab"))).toEqual({ tag: "str", v: "ABab" });
  });

  test("CR233 pipe right: the lane under left, then swap", async () => {
    const out = compiled(R233);
    expect(out.text).toBe(T233);
    expect(rows(out.lines)).toEqual(["/steps/0 3-3", "/steps/1 4-7", "/steps/1/left/steps/0 5-5"]);
    expect(top(await bake(out.text, "Ab"))).toEqual({ tag: "str", v: "abAB" });
  });

  test("CR234 no pipe: swap, then nip; the data above is dropped", async () => {
    const out = compiled(R234);
    expect(out.text).toBe(T234);
    expect(out.issues.map((i) => i.code)).toEqual(["unused-pipe"]);
    expect(rows(out.lines)).toEqual([
      "/steps/0 3-3",
      "/steps/1 4-10",
      "/steps/1/left/steps/0 5-5",
      "/steps/1/right/steps/0 8-8",
    ]);
    expect(top(await bake(out.text, "Ab"))).toEqual({ tag: "str", v: "abBA" });
  });

  test("CR235 a register above the step is read in a lane, and a register inside a lane works", async () => {
    const a = compiled(R235a);
    expect(a.text).toBe(T235a);
    expect(top(await bake(a.text, "Ab"))).toEqual({ tag: "str", v: "ABab" });
    const b = compiled(R235b);
    expect(b.text).toBe(T235b);
    expect(top(await bake(b.text, "Ab"))).toEqual({ tag: "str", v: "BAAB" });
  });

  test("CR260 base-and-step: the same texts with fx:then, in the same stack order", async () => {
    const a = compiled(R260a);
    expect(a.text).toBe(T260a);
    expect(rows(a.lines)).toEqual(["/steps/0 3-3", "/steps/1 4-7", "/steps/1/step/steps/0 5-5"]);
    expect(top(await bake(a.text, "Ab"))).toEqual({ tag: "str", v: "ABab" });
    const b = compiled(R260b);
    expect(b.text).toBe(T260b);
    expect(rows(b.lines)).toContain("/steps/1/base/steps/0 5-5");
    expect(rows(b.lines)).toContain("/steps/1/step/steps/0 8-8");
    expect(top(await bake(b.text, "Ab"))).toEqual({ tag: "str", v: "abBA" });
  });

  test("a slot op compiles its other parameters after the lanes, in ParamSpec order, and annotations sit on the op line", () => {
    const out = compiled(
      recipeOf([
        op("input:tab", { params: { tab: "a.csv" } }),
        op("csv:parse"),
        op("relix:theta-join", {
          pipe: "left",
          note: "join",
          breakpoint: true,
          params: { on: "a = b" },
          right: lane(op("relix:input", { params: { tab: "b.csv" } })),
        }),
      ]),
    );
    expect(out.text).toBe(
      [
        "\\ forge-recipe 1",
        ": main ( bytes -- any )",
        '  "a.csv" input:tab',
        "  csv:parse",
        '  "" relix:from  \\ @implicit',
        "  [",
        '    "b.csv" "csv" true relix:input',
        "  ] recipe:peek",
        '  "a = b" relix:theta-join  \\ @break @note="join"',
        "  0 relix:run  \\ @implicit",
        ";",
        "",
      ].join("\n"),
    );
  });
});

describe("CR236 round trips", () => {
  const recipes: [string, Recipe][] = [
    ["pipe left", R232],
    ["pipe right", R233],
    ["no pipe", R234],
    ["a register above the step, read in a lane", R235a],
    ["a register inside a lane", R235b],
    ["base-and-step, pipe base", R260a],
    ["base-and-step, no pipe", R260b],
    [
      "a disabled slot step",
      recipeOf([
        op("text:upper"),
        op("fx:cat", { disabled: true, pipe: "left", right: lane(op("text:lower")) }),
        op("text:reverse"),
      ]),
    ],
    [
      "a slot step in a disabled register, a nested lane, and comments",
      recipeOf([
        { kind: "comment", text: "before" },
        {
          kind: "register",
          name: "x",
          disabled: true,
          steps: [
            op("fx:cat", {
              pipe: "left",
              right: lane(op("fx:cat", { pipe: "right", left: lane(op("text:lower")) })),
            }),
          ],
        },
        op("text:upper"),
        op("fx:then", {
          pipe: "base",
          hash: "ab".repeat(32),
          step: lane({ kind: "comment", text: "in a lane" }, op("text:lower")),
        }),
      ]),
    ],
    [
      "fork and if around slot steps",
      recipeOf([
        {
          kind: "fork",
          split: { value: "\n", enc: "utf8" },
          join: { value: "0a", enc: "hex" },
          steps: [op("fx:cat", { pipe: "left", right: lane(op("text:lower")) })],
        },
        {
          kind: "if",
          test: { kind: "regex", pattern: "a" },
          then: [op("fx:cat", { left: lane(op("text:upper")), right: lane(op("text:lower")) })],
          else: [op("fx:then", { pipe: "base", step: lane(op("text:upper")) })],
        },
      ]),
    ],
  ];

  test.each(recipes)("%s", (_name, recipe) => {
    const checked = validateRecipe(recipe, cat, { pins: "ignore" });
    expect(checked.ok, JSON.stringify(checked.issues)).toBe(true);
    const canonical = canonicalRecipe(recipe, cat);
    const text = compiled(recipe).text;
    const parsed = parseRecipeText(text, cat);
    if (!parsed.ok) throw new Error(`${JSON.stringify(parsed.issues)}\n${text}`);
    expect(JSON.stringify(parsed.recipe)).toBe(JSON.stringify(canonical));
    expect(compiled(parsed.recipe).text).toBe(text);
  });

  test("the orders recipe, the fix recipe and the join with no pipe round trip, with their conversions dropped", () => {
    for (const file of fixtureFiles("corpus/v12/valid")) {
      const doc = JSON.parse(fixtureText("corpus/v12/valid", file)) as unknown;
      const checked = validateRecipe(doc, cat, { pins: "ignore" });
      if (!checked.ok) continue;
      const text = compiled(doc).text;
      const parsed = parseRecipeText(text, cat);
      if (!parsed.ok) throw new Error(`${file}: ${JSON.stringify(parsed.issues)}\n${text}`);
      expect(JSON.stringify(parsed.recipe), file).toBe(
        JSON.stringify(canonicalRecipe(checked.recipe, cat)),
      );
      expect(compiled(parsed.recipe).text, file).toBe(text);
    }
  });

  test("the text is parsed with the catalogue's slot family: [peek] is left on a binary op and base on a base-and-step op", () => {
    const binary = parseRecipeText(T232, cat);
    const baseStep = parseRecipeText(T260a, cat);
    expect(binary.ok && binary.recipe.steps[1]).toMatchObject({
      pipe: "left",
      right: { steps: [{}] },
    });
    expect(baseStep.ok && baseStep.recipe.steps[1]).toMatchObject({
      pipe: "base",
      step: { steps: [{}] },
    });
    const none = parseRecipeText(T260b, cat);
    expect(none.ok && none.recipe.steps[1]).toMatchObject({
      base: { steps: [{}] },
      step: { steps: [{}] },
    });
    expect(none.ok && none.recipe.steps[1]).not.toHaveProperty("pipe");
  });

  test("an issue inside a lane carries the line of its step, and an issue of the slot step the line of its op", () => {
    const text = [
      "\\ forge-recipe 1",
      ": main ( bytes -- any )",
      "  text:upper",
      "  [",
      "    text:lower",
      '    "(" "x" "" regex:replace',
      "  ] recipe:peek",
      "  fx:cat",
      ";",
      "",
    ].join("\n");
    const res = parseRecipeText(text, cat);
    expect(res.ok).toBe(false);
    const bad = res.issues.find((i) => i.code === "bad-regex");
    expect(bad?.path).toBe("/steps/1/right/steps/1/params/pattern");
    expect(bad?.detail).toMatchObject({ line: 6 });
  });

  test("a lane at the second place keeps the lines of its steps (two lanes)", () => {
    const text = [
      "\\ forge-recipe 1",
      ": main ( bytes -- any )",
      "  [",
      "    text:lower",
      "  ] recipe:peek swap",
      "  [",
      "    text:upper",
      '    "(" "x" "" regex:replace',
      "  ] recipe:peek nip",
      "  fx:cat",
      ";",
      "",
    ].join("\n");
    const res = parseRecipeText(text, cat);
    const bad = res.issues.find((i) => i.code === "bad-regex");
    expect(bad?.path).toBe("/steps/0/right/steps/1/params/pattern");
    expect(bad?.detail).toMatchObject({ line: 8 });
  });
});

describe("limits: lanes count for depth and for steps, in the validator and in the parser alike", () => {
  const nest = (depth: number): unknown =>
    depth === 1 ? op("text:lower") : op("fx:cat", { pipe: "left", right: lane(nest(depth - 1)) });

  test("eight nested levels round trip, nine are a limit", () => {
    const ok = recipeOf([nest(8)]);
    const text = compiled(ok).text;
    const parsed = parseRecipeText(text, cat);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && JSON.stringify(parsed.recipe)).toBe(
      JSON.stringify(canonicalRecipe(ok, cat)),
    );
    const tooDeep = compileRecipe(recipeOf([nest(9)]), cat, { pins: "ignore" });
    expect(tooDeep.ok).toBe(false);
    expect(tooDeep.issues[0]?.code).toBe("limit");
    // the same text, written by hand one level deeper, is refused by the parser too
    const deeper = ["\\ forge-recipe 1", ": main ( bytes -- any )"];
    for (let d = 0; d < 9; d++) deeper.push(`${"  ".repeat(d + 1)}[`);
    deeper.push(`${"  ".repeat(10)}text:lower`);
    for (let d = 8; d >= 0; d--)
      deeper.push(`${"  ".repeat(d + 1)}] recipe:peek`, `${"  ".repeat(d + 1)}fx:cat`);
    deeper.push(";", "");
    const res = parseRecipeText(deeper.join("\n"), cat);
    expect(res.ok).toBe(false);
    expect(res.issues[0]?.code).toBe("limit");
  });

  test("500 steps, lane steps and slot steps counted once each, are valid and 501 are not", () => {
    const pair = op("fx:cat", { pipe: "left", right: lane(op("text:lower")) });
    const at = (n: number) => recipeOf(Array.from({ length: n }, () => pair));
    const text = compiled(at(250)).text;
    expect(parseRecipeText(text, cat).ok).toBe(true);
    const over = text.replace("\n;\n", `\n  [\n    text:lower\n  ] recipe:peek\n  fx:cat\n;\n`);
    expect(compileRecipe(at(251), cat, { pins: "ignore" }).ok).toBe(false);
    const res = parseRecipeText(over, cat);
    expect(res.ok).toBe(false);
    expect(res.issues[0]?.code).toBe("limit");
  });
});

describe("CR237 structure errors", () => {
  const wrap = (...body: string[]) =>
    ["\\ forge-recipe 1", ": main ( bytes -- any )", ...body, ";", ""].join("\n");
  const lane1 = ["  [", "    text:lower"];
  const cases: [string, string, number][] = [
    ["a lane and then the end of the word", wrap(...lane1, "  ] recipe:peek"), 5],
    ["a lane and then a comment", wrap(...lane1, "  ] recipe:peek", '  \\ # "x"', "  fx:cat"), 6],
    ["nip as the first lane", wrap(...lane1, "  ] recipe:peek nip", "  fx:cat"), 5],
    [
      "a second swap",
      wrap(
        ...lane1,
        "  ] recipe:peek swap",
        "  [",
        "    text:lower",
        "  ] recipe:peek swap",
        "  fx:cat",
      ),
      8,
    ],
    [
      "a second peek",
      wrap(...lane1, "  ] recipe:peek", "  [", "    text:lower", "  ] recipe:peek", "  fx:cat"),
      8,
    ],
    [
      "three lanes",
      wrap(
        ...lane1,
        "  ] recipe:peek swap",
        "  [",
        "    text:lower",
        "  ] recipe:peek nip",
        "  [",
        "    text:lower",
        "  ] recipe:peek nip",
        "  fx:cat",
      ),
      11,
    ],
    [
      "a lane at level 0 and its op line at level 1",
      wrap(...lane1, "  ] recipe:peek", "  \\ ~ fx:cat"),
      6,
    ],
    [
      "a lane followed by a close line",
      wrap(
        "  recipe:as-bytes 2 [",
        ...lane1.map((l) => `  ${l}`),
        "    ] recipe:peek",
        "  ] recipe:repeat",
      ),
      7,
    ],
    [
      "a lane followed by a register open line's close",
      wrap(...lane1, "  ] recipe:peek", "  ] recipe:peek :> $x"),
      6,
    ],
    [
      "a lane followed by another block",
      wrap(...lane1, "  ] recipe:peek", "  recipe:as-bytes 2 [", "  ] recipe:repeat"),
      6,
    ],
    ["a lane followed by a return", wrap(...lane1, "  ] recipe:peek", "  core:exit"), 6],
  ];
  test.each(cases)("%s", (_name, text, line) => {
    const res = parseRecipeText(text, cat);
    expect(res.ok).toBe(false);
    expect(res.issues[0]?.code).toBe("bad-value");
    expect(res.issues[0]?.detail).toMatchObject({ constraint: "block structure", line });
  });

  test("a lane whose open line carries an annotation is bad-value", () => {
    const text = [
      "\\ forge-recipe 1",
      ": main ( bytes -- any )",
      "  [  \\ @break",
      "    text:lower",
      "  ] recipe:peek",
      "  fx:cat",
      ";",
      "",
    ].join("\n");
    const res = parseRecipeText(text, cat);
    expect(res.issues[0]?.code).toBe("bad-value");
    expect(res.issues[0]?.detail).toMatchObject({ line: 3 });
  });

  test("an op line that is not a slot op after a lane is bad-slot (not-slot-op), and so is the wrong family", () => {
    const body = ["  [", "    text:lower", "  ] recipe:peek"];
    const plain = parseRecipeText(
      ["\\ forge-recipe 1", ": main ( bytes -- any )", ...body, "  text:upper", ";", ""].join("\n"),
      cat,
    );
    expect(plain.ok).toBe(false);
    expect(plain.issues[0]).toMatchObject({ code: "bad-slot", detail: { reason: "not-slot-op" } });
  });
});

describe("CR238 a disabled slot step, and a breakpoint on one", () => {
  test("every line of a disabled slot step is prefixed, and the step has no instruction", async () => {
    const out = compiled(
      recipeOf([
        op("text:upper"),
        op("fx:cat", { disabled: true, pipe: "left", right: lane(op("text:lower")) }),
        op("text:reverse"),
      ]),
    );
    expect(out.text).toBe(
      [
        "\\ forge-recipe 1",
        ": main ( bytes -- any )",
        "  text:upper",
        "  \\ ~ [",
        "    \\ ~ text:lower",
        "  \\ ~ ] recipe:peek",
        "  \\ ~ fx:cat",
        "  text:reverse",
        ";",
        "",
      ].join("\n"),
    );
    expect(out.lines.map((l) => [l.path, l.disabled])).toEqual([
      ["/steps/0", false],
      ["/steps/1", true],
      ["/steps/1/right/steps/0", true],
      ["/steps/2", false],
    ]);
    const map = resolveStepIps(out.word, out.lines, await positionsOf(out.text));
    expect(map.steps.map((s) => s.path)).toEqual(["/steps/0", "/steps/2"]);
  });

  test("@break on the op line is a breakpoint at the first instruction of the first lane, and the lane steps have ranges inside", async () => {
    const out = compiled(
      recipeOf([
        op("text:upper"),
        op("fx:cat", { breakpoint: true, pipe: "left", right: lane(op("text:lower")) }),
      ]),
    );
    expect(out.text).toContain("  fx:cat  \\ @break\n");
    const map = resolveStepIps(out.word, out.lines, await positionsOf(out.text));
    const slot = map.steps.find((s) => s.path === "/steps/1");
    const inner = map.steps.find((s) => s.path === "/steps/1/right/steps/0");
    if (slot === undefined || inner === undefined) throw new Error("missing step");
    expect(map.breakpoints).toEqual([{ word: out.word, ip: slot.startIp }]);
    expect(slot.startIp).toBeLessThan(inner.startIp);
    expect(inner.startIp).toBeGreaterThanOrEqual(slot.startIp);
    expect(inner.endIp).toBeLessThanOrEqual(slot.endIp);
    // the step above ends where the slot step starts: nothing in between
    const above = map.steps.find((s) => s.path === "/steps/0");
    expect(above?.endIp).toBe(slot.startIp);
  });
});

describe("CR261 base-and-step text", () => {
  test("[swap] on a base-and-step op is assembled as a binary step: bad-slot wrong-slots", () => {
    const res = parseRecipeText(T233.replace("fx:cat", "fx:then"), cat);
    expect(res.ok).toBe(false);
    expect(res.issues[0]).toMatchObject({
      code: "bad-slot",
      detail: { reason: "wrong-slots", op: "fx:then" },
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Implicit conversions: CR264, CR266, CR267 (recipe half)
// ---------------------------------------------------------------------------------------------

const ORDERS = JSON.parse(`{
  "forge": 1,
  "name": "Paid orders by region",
  "steps": [
    { "kind": "op", "op": "input:tab", "params": { "tab": "orders.b64" } },
    { "kind": "op", "op": "base64:decode" },
    { "kind": "op", "op": "csv:parse" },
    { "kind": "op", "op": "relix:select", "params": { "cond": "status = 'paid'" } },
    { "kind": "op", "op": "relix:theta-join", "params": { "on": "customer_id = id" }, "pipe": "left",
      "right": { "steps": [
        { "kind": "op", "op": "relix:input", "params": { "tab": "customers.csv" } },
        { "kind": "op", "op": "relix:select", "params": { "cond": "country = 'NZ'" } } ] } },
    { "kind": "op", "op": "relix:group", "params": { "spec": "region; sum(total) as revenue" } },
    { "kind": "op", "op": "relix:sort", "params": { "keys": "revenue desc" } }
  ]
}`) as Recipe;

const ORDERS_TEXT = String.raw`\ forge-recipe 1
\ name "Paid orders by region"
: main ( bytes -- any )
  "orders.b64" input:tab
  "standard" base64:decode
  csv:parse
  "" relix:from  \ @implicit
  "status = 'paid'" relix:select
  [
    "customers.csv" "csv" true relix:input
    "country = 'NZ'" relix:select
  ] recipe:peek
  "customer_id = id" relix:theta-join
  "region; sum(total) as revenue" relix:group
  "revenue desc" relix:sort
  0 relix:run  \ @implicit
;
`;

describe("CR264 the lift and the run at the end are inserted, marked @implicit, and dropped on parse", () => {
  test("the orders recipe compiles to the text of section 6.1 with the step map of section 6.4", () => {
    const out = compiled(ORDERS);
    expect(out.text).toBe(ORDERS_TEXT);
    expect(rows(out.lines)).toEqual([
      "/steps/0 4-4",
      "/steps/1 5-5",
      "/steps/2 6-6",
      "/steps/3 7-8",
      "/steps/4 9-13",
      "/steps/4/right/steps/0 10-10",
      "/steps/4/right/steps/1 11-11",
      "/steps/5 14-14",
      "/steps/6 15-16",
    ]);
    expect(out.lines[3]?.implicit).toEqual([{ line: 7, op: "relix:from" }]);
    expect(out.lines[8]?.implicit).toEqual([{ line: 16, op: "relix:run" }]);
    expect(out.lines.filter((l) => l.implicit !== undefined)).toHaveLength(2);
  });

  test("the text parses to the canonical JSON, with neither implicit line", () => {
    const parsed = parseRecipeText(ORDERS_TEXT, cat);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(JSON.stringify(parsed.recipe)).toBe(JSON.stringify(canonicalRecipe(ORDERS, cat)));
    expect(parsed.recipe.steps).toHaveLength(7);
  });

  test("a catalogue with no conversions gives no implicit line", () => {
    const out = compiled(ORDERS, noConversions);
    expect(out.text).not.toContain("@implicit");
    expect(out.text).not.toContain("relix:from");
    expect(out.lines.every((l) => l.implicit === undefined)).toBe(true);
    expect(planConversions(ORDERS, noConversions)).toEqual([]);
  });

  test("@implicit is bad-value on core:exit, a comment, a register open line, a container line and a close line", () => {
    const wrap = (...body: string[]) =>
      ["\\ forge-recipe 1", ": main ( bytes -- any )", ...body, ";", ""].join("\n");
    const bad: string[] = [
      wrap("  core:exit  \\ @implicit"),
      wrap('  \\ # "x"  \\ @implicit'),
      wrap("  [  \\ @implicit", "    text:lower", "  ] recipe:peek :> $x"),
      wrap("  recipe:as-bytes 2 [  \\ @implicit", "    text:lower", "  ] recipe:repeat"),
      wrap("  recipe:as-bytes 2 [", "    text:lower", "  ] recipe:repeat  \\ @implicit"),
      wrap("  [", "    text:lower", "  ] recipe:peek  \\ @implicit", "  fx:cat"),
      wrap("  text:upper  \\ @pin=" + "ab".repeat(32) + " @implicit"),
    ];
    for (const text of bad) {
      const res = parseRecipeText(text, cat);
      expect(res.ok, text).toBe(false);
      expect(res.issues[0]?.code, text).toBe("bad-value");
    }
    // on an op line it is dropped, and nothing about the line is checked
    const dropped = parseRecipeText(
      wrap("  text:upper", '  "never read" no:such  \\ @implicit', "  text:lower"),
      cat,
    );
    expect(dropped.ok && dropped.recipe.steps).toHaveLength(2);
  });

  test("conversions are planned before a step, at the end of a lane and at the end of the recipe", () => {
    const recipe = recipeOf([
      op("input:tab", { params: { tab: "a" } }),
      op("csv:parse"),
      op("relix:theta-join", {
        pipe: "left",
        params: { on: "a = b" },
        right: lane(op("input:tab", { params: { tab: "b" } }), op("csv:parse")),
      }),
      op("csv:parse", { disabled: true }),
      op("relix:select", { params: { cond: "x" } }),
    ]);
    expect(planConversions(recipe, cat)).toEqual([
      { at: "before", path: "/steps/2", op: "relix:from", from: "table", to: "relation" },
      {
        at: "lane-end",
        path: "/steps/2",
        slot: "right",
        op: "relix:from",
        from: "table",
        to: "relation",
      },
      { at: "end", path: "/steps/4", op: "relix:run", from: "relation", to: "table" },
    ]);
    const out = compiled(recipe);
    expect(out.text).toBe(
      [
        "\\ forge-recipe 1",
        ": main ( bytes -- any )",
        '  "a" input:tab',
        "  csv:parse",
        '  "" relix:from  \\ @implicit',
        "  [",
        '    "b" input:tab',
        "    csv:parse",
        '    "" relix:from  \\ @implicit',
        "  ] recipe:peek",
        '  "a = b" relix:theta-join',
        "  \\ ~ csv:parse",
        '  "x" relix:select',
        "  0 relix:run  \\ @implicit",
        ";",
        "",
      ].join("\n"),
    );
    // the lane-end line is inside the slot step's range and in none of the steps of the lane
    const slot = out.lines.find((l) => l.path === "/steps/2");
    expect(slot).toMatchObject({ startLine: 5, endLine: 11 });
    expect(slot?.implicit).toEqual([
      { line: 5, op: "relix:from" },
      { line: 9, op: "relix:from" },
    ]);
    const inner = out.lines.filter((l) => l.path.startsWith("/steps/2/right"));
    expect(rows(inner)).toEqual(["/steps/2/right/steps/0 7-7", "/steps/2/right/steps/1 8-8"]);
    const back = parseRecipeText(out.text, cat);
    expect(back.ok && JSON.stringify(back.recipe)).toBe(
      JSON.stringify(canonicalRecipe(recipe, cat)),
    );
  });

  test("a pipe on the right converts the data above for the slot parameter; no pipe converts nothing", () => {
    const right = recipeOf([
      op("input:tab", { params: { tab: "a" } }),
      op("csv:parse"),
      op("relix:left-join", {
        pipe: "right",
        params: { on: "a = b" },
        left: lane(op("relix:input", { params: { tab: "b" } })),
      }),
    ]);
    expect(planConversions(right, cat).map((c) => `${c.at} ${c.path} ${c.op}`)).toEqual([
      "before /steps/2 relix:from",
      "end /steps/2 relix:run",
    ]);
    const none = recipeOf([
      op("input:tab", { params: { tab: "a" } }),
      op("csv:parse"),
      op("relix:left-join", {
        params: { on: "a = b" },
        left: lane(op("relix:input", { params: { tab: "b" } })),
        right: lane(op("relix:input", { params: { tab: "c" } })),
      }),
    ]);
    expect(planConversions(none, cat).map((c) => `${c.at} ${c.path} ${c.op}`)).toEqual([
      "end /steps/2 relix:run",
    ]);
  });

  test("the kind is unknown after a fork, a subsection, a repeat, an if and a return, and a register leaves it as it was", () => {
    const after = (step: unknown) =>
      planConversions(
        recipeOf([
          op("input:tab", { params: { tab: "a" } }),
          op("csv:parse"),
          step,
          op("relix:select", { params: { cond: "x" } }),
        ]),
        cat,
      ).map((c) => `${c.at} ${c.path}`);
    expect(after({ kind: "register", name: "r", steps: [op("text:lower")] })).toEqual([
      "before /steps/3",
      "end /steps/3",
    ]);
    // Nothing is inserted before the select, whose input would otherwise be lifted: only the select's own output is known.
    const unknown = ["end /steps/3"];
    expect(after({ kind: "repeat", times: 2, steps: [op("hex:decode")] })).toEqual(unknown);
    expect(after({ kind: "subsection", pattern: "a", steps: [op("hex:decode")] })).toEqual(unknown);
    expect(after({ kind: "return" })).toEqual(unknown);
    expect(
      after({
        kind: "if",
        test: { kind: "regex", pattern: "a" },
        then: [op("hex:decode")],
      }),
    ).toEqual(unknown);
  });

  test("a recipe whose enabled steps are all comments or disabled gets no conversion from bytes", () => {
    expect(planConversions(recipeOf([{ kind: "comment", text: "x" }]), cat)).toEqual([]);
    const odd: CatalogueView = {
      ...cat,
      conversions: [{ from: "bytes", to: "table", op: "csv:parse", atEnd: true }],
    };
    const out = compiled(recipeOf([{ kind: "comment", text: "x" }]), odd);
    expect(out.text).toContain("  csv:parse  \\ @implicit\n;");
  });
});

describe("CR266 compile half: a run is inserted before a table op in mid-recipe", () => {
  const recipe = recipeOf([
    op("relix:input", { params: { tab: "a.csv" } }),
    op("relix:select", { params: { cond: "x > 1" } }),
    op("table:to-json"),
  ]);

  test("the run sits between the last two lines, inside the range of the step that needs the table", () => {
    const out = compiled(recipe);
    expect(out.text).toBe(
      [
        "\\ forge-recipe 1",
        ": main ( bytes -- any )",
        '  "a.csv" "csv" true relix:input',
        '  "x > 1" relix:select',
        "  0 relix:run  \\ @implicit",
        "  table:to-json",
        ";",
        "",
      ].join("\n"),
    );
    expect(rows(out.lines)).toEqual(["/steps/0 3-3", "/steps/1 4-4", "/steps/2 5-6"]);
    expect(out.lines[2]?.implicit).toEqual([{ line: 5, op: "relix:run" }]);
  });

  test("the same recipe in a catalogue with no conversions compiles with no extra line", () => {
    const out = compiled(recipe, noConversions);
    expect(out.text).toBe(
      [
        "\\ forge-recipe 1",
        ": main ( bytes -- any )",
        '  "a.csv" "csv" true relix:input',
        '  "x > 1" relix:select',
        "  table:to-json",
        ";",
        "",
      ].join("\n"),
    );
  });
});

describe("CR267 recipe half: the words the compiler inserts count as steps", () => {
  const recipe = recipeOf([
    op("relix:input", { params: { tab: "a.csv" } }),
    op("relix:select", { params: { cond: "x" } }),
  ]);
  const hard = (flag: boolean): CatalogueView => ({
    ...cat,
    ops: cat.ops.map((o) => (o.qname === "relix:run" ? { ...o, needsHardKill: flag } : o)),
  });

  test("a recipe that ends in a relation needs a hard kill when relix:run does", () => {
    expect(recipeNeedsHardKill(recipe, hard(true))).toBe(true);
    expect(recipeNeedsHardKill(recipe, hard(false))).toBe(false);
    expect(recipeNeedsHardKill(recipe, { ...hard(true), conversions: undefined })).toBe(false);
  });

  test("a conversion inside a lane or before a slot step counts too, and a disabled step does not", () => {
    const inLane = recipeOf([
      op("input:tab", { params: { tab: "a" } }),
      op("csv:parse"),
      op("relix:union", { pipe: "left", right: lane(op("relix:input", { params: { tab: "b" } })) }),
    ]);
    expect(recipeNeedsHardKill(inLane, hard(true))).toBe(true);
    const disabled = recipeOf([
      op("relix:input", { params: { tab: "a.csv" }, disabled: true }),
      op("hex:decode"),
    ]);
    expect(recipeNeedsHardKill(disabled, hard(true))).toBe(false);
  });
});
