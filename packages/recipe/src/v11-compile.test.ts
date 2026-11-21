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
// RECIPES-1.1.md (WP 6.37): compilation and the text form of `register` and `return`, cases CR119 to CR128,
// checked against the shipped catalogue and, for the "(run)" cases, the shipped bundle on a real runtime.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { valueHelpers } from "@forge/lang";
import type { ForgeRuntime, RunResult, SourcePos, Value } from "@forge/lang";
import { assembleRuntime } from "@forge/ops";
import { loadBundleNode } from "@forge/ops/node";
import { describe, expect, test } from "vitest";
import { extras, fixtureText, golden, recipeOf, seed } from "../test/helpers.js";
import { compileRecipe } from "./compile.js";
import { paramLiteral } from "./literals.js";
import { canonicalRecipe } from "./normalise.js";
import { attributeError, recipeNeedsHardKill, resolveStepIps } from "./stepmap.js";
import { parseRecipeText } from "./text.js";
import type { CatalogueView, Recipe, StepIpMap } from "./types.js";
import { validateRecipe } from "./validate.js";

const here = join(fileURLToPath(import.meta.url), "..");

/** The shipped catalogue (`dist/catalogue.json` of `@forge/ops`). */
const real = JSON.parse(
  readFileSync(join(here, "..", "..", "ops", "dist", "catalogue.json"), "utf8"),
) as CatalogueView;

const v11 = (file: string): unknown => JSON.parse(fixtureText("corpus/v11/valid", file)) as unknown;

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const hexBytes = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));

function compiled(recipe: unknown, catalogue: CatalogueView = real) {
  const out = compileRecipe(recipe, catalogue, { pins: "ignore" });
  if (!out.ok) throw new Error(JSON.stringify(out.issues));
  return out;
}

const lineRows = (
  lines: readonly { path: string; kind: string; startLine: number; endLine: number }[],
) => lines.map((l) => `${l.path} ${l.startLine}-${l.endLine} ${l.kind}`);

const rangeRows = (map: StepIpMap) => map.steps.map((s) => `${s.path} [${s.startIp}, ${s.endIp})`);

// ---------------------------------------------------------------------------------------------
// The texts of the proposal (the same as the ones packages/ops/src/recipe.test.ts loads and bakes)
// ---------------------------------------------------------------------------------------------

const CR119 = String.raw`\ forge-recipe 1
: main ( bytes -- any )
  [
    0 16 false bytes-slice:take
  ] recipe:peek :> $iv
  [
    16 32 false bytes-slice:take
  ] recipe:peek :> $key
  0 48 false bytes-slice:remove
  $key $iv "CBC" "pkcs7" #[ ] aes:decrypt
;
`;

const CR120 = String.raw`\ forge-recipe 1
: main ( bytes -- any )
  hex:decode
  recipe:as-bytes dup "^a" "" "utf8" recipe:matches [
    "none" "upper" hex:encode
    core:exit
  ] [
  ] if
  text:reverse
;
`;

const CR121 = String.raw`\ forge-recipe 1
: main ( bytes -- any )
  hex:decode
  recipe:as-bytes dup "^a" "" "utf8" recipe:matches [
    recipe:as-bytes dup "b$" "" "utf8" recipe:matches [
      "none" "upper" hex:encode
      core:exit
    ] [
    ] if
    text:upper
  ] [
  ] if
  recipe:as-bytes [ "z" "" "utf8" recipe:matches ] [
    text:lower
  ] [
  ] recipe:branch
  "none" "lower" hex:encode
;
`;

const CR122 = String.raw`\ forge-recipe 1
: main ( bytes -- any )
  hex:decode
  recipe:as-bytes [ "^a" "" "utf8" recipe:matches ] [
    "none" "upper" hex:encode
    \ ~ core:exit
  ] [
  ] recipe:branch
  text:reverse
;
`;

const CR123 = String.raw`\ forge-recipe 1
: main ( bytes -- any )
  recipe:as-bytes "\n" #[ 0a ] [
    [
      0 2 false bytes-slice:take
    ] recipe:peek :> $pat
    0 3 false bytes-slice:remove
    $pat "-" "" regex:replace
  ] fork
;
`;

const CR128 = String.raw`\ forge-recipe 1
: main ( bytes -- any )
  [
    "a" "string" false search:count
  ] recipe:peek :> $n
  $n classical:rot
;
`;

const CR136 = String.raw`\ forge-recipe 1
: main ( bytes -- any )
  hex:decode
  core:exit
  text:upper
;
`;

const hexEncodeUpper = {
  kind: "op",
  op: "hex:encode",
  params: { delimiter: "none", case: "upper" },
};

const R120 = {
  forge: 1,
  steps: [
    { kind: "op", op: "hex:decode" },
    {
      kind: "if",
      test: { kind: "regex", pattern: "^a" },
      then: [hexEncodeUpper, { kind: "return" }],
    },
    { kind: "op", op: "text:reverse" },
  ],
};

const R121 = {
  forge: 1,
  steps: [
    { kind: "op", op: "hex:decode" },
    {
      kind: "if",
      test: { kind: "regex", pattern: "^a" },
      then: [
        {
          kind: "if",
          test: { kind: "regex", pattern: "b$" },
          then: [hexEncodeUpper, { kind: "return" }],
        },
        { kind: "op", op: "text:upper" },
      ],
    },
    {
      kind: "if",
      test: { kind: "regex", pattern: "z" },
      then: [{ kind: "op", op: "text:lower" }],
    },
    { kind: "op", op: "hex:encode" },
  ],
};

const R123 = {
  forge: 1,
  steps: [
    {
      kind: "fork",
      split: { value: "\n", enc: "utf8" },
      join: { value: "0a", enc: "hex" },
      steps: [
        {
          kind: "register",
          name: "pat",
          steps: [{ kind: "op", op: "bytes-slice:take", params: { start: 0, length: 2 } }],
        },
        { kind: "op", op: "bytes-slice:remove", params: { start: 0, length: 3 } },
        {
          kind: "op",
          op: "regex:replace",
          params: { pattern: { ref: "pat" }, replacement: "-" },
        },
      ],
    },
  ],
};

const R128 = {
  forge: 1,
  steps: [
    {
      kind: "register",
      name: "n",
      steps: [{ kind: "op", op: "search:count", params: { pattern: "a" } }],
    },
    { kind: "op", op: "classical:rot", params: { amount: { ref: "n" } } },
  ],
};

const R136 = {
  forge: 1,
  steps: [{ kind: "op", op: "hex:decode" }, { kind: "return" }, { kind: "op", op: "text:upper" }],
};

// ---------------------------------------------------------------------------------------------
// A runtime on the full bundle
// ---------------------------------------------------------------------------------------------

const { bytes } = valueHelpers;

function loadUnit(rt: ForgeRuntime, text: string): void {
  rt.setCurrentVocab("bake");
  rt.setCurrentVocab("user");
  rt.load(text, { unit: "recipe", scope: { current: "bake", using: [] } });
}

async function runtimeWith(text: string): Promise<ForgeRuntime> {
  const rt = assembleRuntime(await loadBundleNode("all"));
  loadUnit(rt, text);
  return rt;
}

async function bake(text: string, input: Uint8Array): Promise<RunResult> {
  return (await runtimeWith(text)).call("bake:main", [bytes(input)]);
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
// JSON to FL: CR119 to CR124
// ---------------------------------------------------------------------------------------------

describe("compileRecipe: registers and return (RECIPES-1.1.md section 6.4)", () => {
  test("CR119 recipe M compiles to registers and locals, with the lines and ranges of the proposal", async () => {
    const out = compiled(v11("cr101-recipe-m.json"));
    expect(out.text).toBe(CR119);
    expect(out.issues).toEqual([]);
    expect(lineRows(out.lines)).toEqual([
      "/steps/0 3-5 register",
      "/steps/0/steps/0 4-4 op",
      "/steps/1 6-8 register",
      "/steps/1/steps/0 7-7 op",
      "/steps/2 9-9 op",
      "/steps/3 10-10 op",
    ]);
    const positions = await positionsOf(out.text);
    expect(positions).toHaveLength(27);
    expect(rangeRows(resolveStepIps(out.word, out.lines, positions))).toEqual([
      "/steps/0 [0, 8)",
      "/steps/0/steps/0 [1, 5)",
      "/steps/1 [8, 16)",
      "/steps/1/steps/0 [9, 13)",
      "/steps/2 [16, 20)",
      "/steps/3 [20, 26)",
    ]);
  });

  test("CR120 an if that contains a return is lowered, and the step map uses line membership", async () => {
    const out = compiled(R120);
    expect(out.text).toBe(CR120);
    expect(lineRows(out.lines)).toEqual([
      "/steps/0 3-3 op",
      "/steps/1 4-8 if",
      "/steps/1/then/0 5-5 op",
      "/steps/1/then/1 6-6 return",
      "/steps/2 9-9 op",
    ]);
    const positions = await positionsOf(out.text);
    expect(positions).toHaveLength(15);
    const map = resolveStepIps(out.word, out.lines, positions);
    expect(rangeRows(map)).toEqual([
      "/steps/0 [0, 1)",
      "/steps/1 [1, 13)",
      "/steps/1/then/0 [8, 11)",
      "/steps/1/then/1 [11, 12)",
      "/steps/2 [13, 14)",
    ]);
    expect(map.events.map((e) => [e.ip, e.ends, e.starts])).toEqual([
      [0, [], ["/steps/0"]],
      [1, ["/steps/0"], ["/steps/1"]],
      [8, [], ["/steps/1/then/0"]],
      [11, ["/steps/1/then/0"], ["/steps/1/then/1"]],
      [12, ["/steps/1/then/1"], []],
      [13, ["/steps/1"], ["/steps/2"]],
      [14, ["/steps/2"], []],
    ]);
    // the error attribution: an instruction inside the branch belongs to the branch step, the jumpf to the if
    expect(attributeError("bake:main", [{ word: "bake:main", ip: 9 }], map)).toBe(
      "/steps/1/then/0",
    );
    expect(attributeError("bake:main", [{ word: "bake:main", ip: 7 }], map)).toBe("/steps/1");
  });

  test("CR120 a breakpoint on the return pauses before the exit instruction", async () => {
    const withBreak = JSON.parse(JSON.stringify(R120)) as typeof R120;
    (withBreak.steps[1] as { then: Record<string, unknown>[] }).then[1] = {
      kind: "return",
      breakpoint: true,
    };
    const out = compiled(withBreak);
    expect(out.text).toContain("    core:exit  \\ @break\n");
    const map = resolveStepIps(out.word, out.lines, await positionsOf(out.text));
    expect(map.breakpoints).toEqual([{ word: "bake:main", ip: 11 }]);
  });

  test("CR121 nested ifs with a return are all lowered; an unrelated if keeps recipe:branch", () => {
    expect(compiled(R121).text).toBe(CR121);
  });

  test("CR122 a disabled return: the if is compiled as in v1, and the line numbers do not move", () => {
    const disabled = JSON.parse(JSON.stringify(R120)) as typeof R120;
    (disabled.steps[1] as { then: Record<string, unknown>[] }).then[1] = {
      kind: "return",
      disabled: true,
    };
    const out = compiled(disabled);
    expect(out.text).toBe(CR122);
    expect(lineRows(out.lines).filter((r) => r.startsWith("/steps/1"))).toEqual([
      "/steps/1 4-8 if",
      "/steps/1/then/0 5-5 op",
      "/steps/1/then/1 6-6 return",
    ]);
    expect(compiled(R120).lines.map((l) => [l.path, l.startLine, l.endLine])).toEqual(
      out.lines.map((l) => [l.path, l.startLine, l.endLine]),
    );
  });

  test("a return in the else branch lowers the if too; a disabled if keeps recipe:branch", () => {
    const inElse = recipeOf([
      { kind: "if", test: { kind: "regex", pattern: "x" }, then: [], else: [{ kind: "return" }] },
    ]);
    expect(compiled(inElse).text).toContain('recipe:as-bytes dup "x" "" "utf8" recipe:matches [\n');
    expect(compiled(inElse).text).toContain("  ] if\n");
    const disabledIf = recipeOf([
      {
        kind: "if",
        disabled: true,
        test: { kind: "regex", pattern: "x" },
        then: [{ kind: "return" }],
      },
    ]);
    const text = compiled(disabledIf).text;
    expect(text).toContain('\\ ~ recipe:as-bytes [ "x" "" "utf8" recipe:matches ] [\n');
    expect(text).toContain("  \\ ~ ] recipe:branch\n");
  });

  test("an op test of a lowered if: the pin stays on the open line", () => {
    const out = compileRecipe(
      recipeOf([
        {
          kind: "if",
          test: { kind: "op", op: "regex:test", params: { pattern: "a" } },
          then: [{ kind: "return" }],
        },
      ]),
      real,
      { pins: "ignore" },
    );
    if (!out.ok) throw new Error(JSON.stringify(out.issues));
    expect(out.text).toContain(
      '  recipe:as-bytes dup "a" "" regex:test [\n    core:exit\n  ] [\n  ] if\n',
    );
  });

  test("CR123 a register inside a fork child, and a reference to a regex parameter", () => {
    expect(compiled(R123).text).toBe(CR123);
  });

  test("CR124 compatibility: the golden of section 12.2 and every v1 text is unchanged", () => {
    const demo = compiled(JSON.parse(golden("demo.recipe.json")), seed);
    expect(demo.text).toBe(golden("demo.fl.txt"));
    expect(demo.text).not.toContain("recipe:peek");
    expect(demo.text).not.toContain("] if\n");
  });

  test("a register carries @break and @note on its open line, never a pin; a disabled register is commented", () => {
    const out = compiled(
      recipeOf([
        {
          kind: "register",
          name: "x",
          breakpoint: true,
          note: "n",
          steps: [{ kind: "op", op: "text:upper" }],
        },
        {
          kind: "register",
          name: "y",
          disabled: true,
          steps: [{ kind: "op", op: "text:lower" }],
        },
      ]),
    );
    expect(out.text).toBe(
      [
        "\\ forge-recipe 1",
        ": main ( bytes -- any )",
        '  [  \\ @break @note="n"',
        "    text:upper",
        "  ] recipe:peek :> $x",
        "  \\ ~ [",
        "    \\ ~ text:lower",
        "  \\ ~ ] recipe:peek :> $y",
        ";",
        "",
      ].join("\n"),
    );
  });

  test("a reference is $name for every parameter type", () => {
    const ref = { ref: "r" };
    for (const type of [
      "bytes",
      "str",
      "int",
      "num",
      "number",
      "bool",
      "choice",
      "toggle",
      "regex",
      "charset",
      "key",
    ]) {
      expect(paramLiteral({ name: "p", type, required: true, index: 1 } as never, ref)).toBe("$r");
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The compiled texts bake to the stated outputs (the texts that packages/ops/src/recipe.test.ts loads)
// ---------------------------------------------------------------------------------------------

describe("the compiled texts equal the ones 6.35 loads, and bake to the stated outputs", () => {
  const opsTest = readFileSync(join(here, "..", "..", "ops", "src", "recipe.test.ts"), "utf8");
  const cases: [string, string, unknown][] = [
    ["CR119", CR119, v11("cr101-recipe-m.json")],
    ["CR120", CR120, R120],
    ["CR121", CR121, R121],
    ["CR123", CR123, R123],
    ["CR136", CR136, R136],
  ];

  test.each(cases)(
    "%s: the text is the one in the ops test, and the compiler produces it",
    (name, text, recipe) => {
      expect(opsTest).toContain(`const ${name} = String.raw\`${text}\`;`);
      expect(compiled(recipe).text).toBe(text);
    },
  );

  test("CR128 (the ops test calls it CR128): the compiler produces the text", () => {
    expect(opsTest).toContain(`const CR128 = String.raw\`${CR128}\`;`);
    expect(compiled(R128).text).toBe(CR128);
  });

  test("CR131 recipe M decrypts the blob built with aes:encrypt", async () => {
    const input = hexBytes(
      "a0a1a2a3a4a5a6a7a8a9aaabacadaeaf" +
        "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f" +
        "6f498b8b870a0d8175f26312b99705c8",
    );
    const text = compiled(v11("cr101-recipe-m.json")).text;
    expect(top(await bake(text, input))).toEqual({ tag: "bytes", v: ascii("attack at dawn") });
  });

  test("CR132 a register supplies an int parameter (banana: three a, so rot 3)", async () => {
    const r = await bake(compiled(R128).text, ascii("banana"));
    expect(top(r)).toEqual({ tag: "bytes", v: hexBytes("656471647164") });
  });

  test("CR134 a register per fork piece, as a regex parameter", async () => {
    const r = await bake(compiled(R123).text, ascii("ab:xxabxx\ncd:yycdyy"));
    expect(top(r)).toEqual({ tag: "bytes", v: hexBytes("78782d78780a79792d7979") });
  });

  test("CR135 return taken and not taken, from the if and from a nested if", async () => {
    const t120 = compiled(R120).text;
    expect(top(await bake(t120, ascii("6162")))).toEqual({ tag: "str", v: "6162" });
    expect(top(await bake(t120, ascii("6362")))).toEqual({ tag: "str", v: "bc" });
    const t121 = compiled(R121).text;
    expect(top(await bake(t121, ascii("6162")))).toEqual({ tag: "str", v: "6162" });
    expect(top(await bake(t121, ascii("6161")))).toEqual({ tag: "str", v: "4141" });
    expect(top(await bake(t121, ascii("6263")))).toEqual({ tag: "str", v: "6263" });
  });

  test("CR136 return at the root skips what follows and keeps the tag of the data", async () => {
    const out = compileRecipe(R136, real, { pins: "ignore" });
    if (!out.ok) throw new Error(JSON.stringify(out.issues));
    expect(out.issues.map((i) => i.code)).toEqual(["unreachable-step"]);
    const r = await bake(out.text, ascii("6162"));
    expect(top(r)).toEqual({ tag: "bytes", v: ascii("ab") });
    expect(r.stack).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Text and JSON: CR125 to CR128
// ---------------------------------------------------------------------------------------------

const CR125_CANONICAL =
  '{"forge":1,"steps":[{"kind":"register","name":"iv","steps":[{"kind":"op","op":"bytes-slice:take","params":{"start":0,"length":16,"each-line":false}}]},{"kind":"register","name":"key","steps":[{"kind":"op","op":"bytes-slice:take","params":{"start":16,"length":32,"each-line":false}}]},{"kind":"op","op":"bytes-slice:remove","params":{"start":0,"length":48,"each-line":false}},{"kind":"op","op":"aes:decrypt","params":{"key":{"ref":"key"},"iv":{"ref":"iv"},"mode":"CBC","padding":"pkcs7","aad":{"value":"","enc":"hex"}}}]}';

const CR126_CANONICAL =
  '{"forge":1,"steps":[{"kind":"op","op":"hex:decode"},{"kind":"if","test":{"kind":"regex","pattern":"^a"},"then":[{"kind":"op","op":"hex:encode","params":{"delimiter":"none","case":"upper"}},{"kind":"return"}]},{"kind":"op","op":"text:reverse"}]}';

function parsed(text: string, catalogue: CatalogueView = real) {
  return parseRecipeText(text, catalogue);
}

function parseIssue(text: string) {
  const r = parsed(text);
  if (r.ok) throw new Error(`parsed: ${JSON.stringify(r.recipe)}`);
  return r.issues[0];
}

describe("parseRecipeText: registers and return (RECIPES-1.1.md section 6.5)", () => {
  test("CR125 the text of CR119 parses to the canonical JSON of recipe M, and back", () => {
    const r = parsed(CR119);
    expect(r.ok && JSON.stringify(r.recipe)).toBe(CR125_CANONICAL);
    expect(compiled(JSON.parse(CR125_CANONICAL)).text).toBe(CR119);
  });

  test("CR126 the text of CR120 parses to the canonical JSON of its recipe, and back", () => {
    const r = parsed(CR120);
    expect(r.ok && JSON.stringify(r.recipe)).toBe(CR126_CANONICAL);
    expect(compiled(JSON.parse(CR126_CANONICAL)).text).toBe(CR120);
  });

  test("CR127 structure errors of the new lines", () => {
    // the closer if without dup
    const a = parseIssue(
      '\\ forge-recipe 1\n: main ( bytes -- any )\n  recipe:as-bytes [ "^a" "" "utf8" recipe:matches ] [\n    text:upper\n  ] [\n  ] if\n;\n',
    );
    expect([a?.code, a?.path, a?.detail]).toEqual([
      "bad-value",
      "/steps/0",
      { constraint: "block structure", line: 6, col: 3 },
    ]);
    // a name outside the pattern
    const b = parseIssue(
      "\\ forge-recipe 1\n: main ( bytes -- any )\n  [\n    text:upper\n  ] recipe:peek :> $IV\n;\n",
    );
    expect([b?.code, b?.path, b?.detail?.constraint, b?.detail?.line]).toEqual([
      "bad-value",
      "/steps/0/name",
      "pattern ^[a-z][a-z0-9-]{0,31}$",
      5,
    ]);
    // an unterminated register
    const c = parseIssue("\\ forge-recipe 1\n: main ( bytes -- any )\n  [\n    text:upper\n;\n");
    expect([c?.code, c?.path, c?.detail?.constraint]).toEqual([
      "bad-value",
      "/steps/0",
      "block structure",
    ]);
    // an atom before core:exit
    const d = parseIssue("\\ forge-recipe 1\n: main ( bytes -- any )\n  1 core:exit\n;\n");
    expect([d?.code, d?.path, d?.detail?.line]).toEqual(["bad-value", "/steps/0", 3]);
  });

  test("CR128 a reference to an int parameter, and the lines of an op with several (round trip)", () => {
    expect(compiled(R128).text).toBe(CR128);
    const r = parsed(CR128);
    const checked = validateRecipe(R128, real, { pins: "ignore" });
    if (!checked.ok) throw new Error("invalid");
    expect(r.ok && JSON.stringify(r.recipe)).toBe(
      JSON.stringify(canonicalRecipe(checked.recipe, real)),
    );
    expect(r.ok && (r.recipe.steps[1] as { params: unknown }).params).toEqual({
      amount: { ref: "n" },
    });
  });

  test("more structure errors: dup with another closer, the wrong closer for a register, scope errors", () => {
    const head = "\\ forge-recipe 1\n: main ( bytes -- any )\n";
    // dup and recipe:branch
    expect(
      parseIssue(
        `${head}  recipe:as-bytes dup "a" "" "utf8" recipe:matches [\n  ] [\n  ] recipe:branch\n;\n`,
      )?.detail?.constraint,
    ).toBe("block structure");
    // dup and fork
    expect(
      parseIssue(`${head}  recipe:as-bytes dup "a" "" "utf8" recipe:matches [\n  ] fork\n;\n`)
        ?.detail?.constraint,
    ).toBe("block structure");
    // a register frame closed as a fork, and a fork frame closed as a register
    expect(parseIssue(`${head}  [\n    text:upper\n  ] fork\n;\n`)?.detail?.constraint).toBe(
      "block structure",
    );
    expect(
      parseIssue(`${head}  recipe:as-bytes "" #[ ] [\n    text:upper\n  ] recipe:peek :> $a\n;\n`)
        ?.detail?.constraint,
    ).toBe("block structure");
    // an else line in a register
    expect(parseIssue(`${head}  [\n  ] [\n  ] recipe:peek :> $a\n;\n`)?.detail?.constraint).toBe(
      "block structure",
    );
    // an unknown register is the validator's error, with a line
    const u = parseIssue(`${head}  $nope classical:rot\n;\n`);
    expect(u?.code).toBe("unknown-register");
    expect(u?.detail?.line).toBe(3);
    // a return inside a fork is bad-position
    const p = parseIssue(`${head}  recipe:as-bytes "," "," [\n    core:exit\n  ] fork\n;\n`);
    expect(p?.code).toBe("bad-position");
    // a reference in a fork separator is not an op parameter
    expect(parseIssue(`${head}  recipe:as-bytes $a #[ ] [\n  ] fork\n;\n`)?.code).toBe("bad-value");
  });

  test("core:exit carries annotations and levels like other step lines", () => {
    const text =
      '\\ forge-recipe 1\n: main ( bytes -- any )\n  core:exit  \\ @break @note="stop"\n  \\ ~ core:exit\n;\n';
    const r = parsed(text);
    expect(r.ok && r.recipe.steps).toEqual([
      { kind: "return", breakpoint: true, note: "stop" },
      { kind: "return", disabled: true },
    ]);
    expect(
      parseIssue(
        "\\ forge-recipe 1\n: main ( bytes -- any )\n  core:exit  \\ @pin=" +
          "0".repeat(64) +
          "\n;\n",
      )?.path,
    ).toBe("/steps/0");
  });

  test("text parsed and recompiled may change form: a closer if with no return recompiles to recipe:branch", () => {
    const text =
      '\\ forge-recipe 1\n: main ( bytes -- any )\n  recipe:as-bytes dup "a" "" "utf8" recipe:matches [\n    text:upper\n  ] [\n  ] if\n;\n';
    const r = parsed(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(compiled(r.recipe).text).toContain("] recipe:branch");
  });
});

describe("the round trip over the new constructs", () => {
  const roundTrip = (recipe: unknown, catalogue: CatalogueView = real): void => {
    const checked = validateRecipe(recipe, catalogue, { pins: "ignore" });
    if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
    const canonical = canonicalRecipe(checked.recipe, catalogue);
    const text = compiled(recipe, catalogue).text;
    const back = parseRecipeText(text, catalogue);
    if (!back.ok) throw new Error(`${JSON.stringify(back.issues)}\n${text}`);
    expect(JSON.stringify(back.recipe)).toBe(JSON.stringify(canonical));
    expect(compiled(canonical, catalogue).text).toBe(text);
  };

  test("registers in every container, disabled registers, annotations, returns in else", () => {
    roundTrip(
      recipeOf([
        {
          kind: "register",
          name: "a",
          breakpoint: true,
          note: "keep",
          steps: [
            {
              kind: "register",
              name: "b",
              steps: [{ kind: "op", op: "text:upper" }],
            },
            { kind: "comment", text: "c" },
          ],
        },
        {
          kind: "register",
          name: "off",
          disabled: true,
          steps: [{ kind: "op", op: "text:lower" }],
        },
        {
          kind: "if",
          test: { kind: "op", op: "regex:test", params: { pattern: "q" } },
          then: [{ kind: "return", note: "x", breakpoint: true }],
          else: [{ kind: "if", test: { kind: "regex", pattern: "z" }, then: [{ kind: "return" }] }],
        },
        {
          kind: "subsection",
          pattern: "a",
          steps: [{ kind: "register", name: "s", steps: [] }],
        },
        {
          kind: "repeat",
          times: 2,
          steps: [{ kind: "op", op: "classical:rot", params: { amount: { ref: "a" } } }],
        },
      ]),
    );
  });

  test("a reference in every parameter type of the extra catalogue", () => {
    const cat: CatalogueView = { version: extras.version, ops: extras.ops };
    roundTrip(
      recipeOf([
        { kind: "register", name: "r", steps: [{ kind: "op", op: "x:soft" }] },
        {
          kind: "op",
          op: "x:text",
          params: {
            set: { ref: "r" },
            raw: { ref: "r" },
            word: { ref: "r" },
            rx: { ref: "r" },
            pick: { ref: "r" },
          },
        },
        {
          kind: "op",
          op: "x:nums",
          params: { count: { ref: "r" }, ratio: { ref: "r" }, any: { ref: "r" }, on: { ref: "r" } },
        },
        { kind: "op", op: "x:key", params: { key: { ref: "r" } } },
        { kind: "op", op: "x:toggle", params: { mode: { ref: "r" } } },
        {
          kind: "if",
          test: { kind: "op", op: "x:pred", params: { needle: { ref: "r" } } },
          then: [{ kind: "return" }],
        },
      ]),
      cat,
    );
  });
});

describe("recipeNeedsHardKill recurses into register (RECIPES-1.1.md section 4.6)", () => {
  const needs = (steps: unknown[]): boolean =>
    recipeNeedsHardKill(recipeOf(steps) as Recipe, extras);

  test("a hard-kill op in a register's children is found", () => {
    expect(needs([{ kind: "register", name: "a", steps: [{ kind: "op", op: "x:hard" }] }])).toBe(
      true,
    );
    expect(
      needs([
        {
          kind: "register",
          name: "a",
          steps: [{ kind: "register", name: "b", steps: [{ kind: "op", op: "x:hard" }] }],
        },
      ]),
    ).toBe(true);
    expect(
      needs([
        { kind: "register", name: "a", steps: [{ kind: "subsection", pattern: "a", steps: [] }] },
      ]),
    ).toBe(true);
  });

  test("a soft register, a disabled register and a return need nothing", () => {
    expect(needs([{ kind: "register", name: "a", steps: [{ kind: "op", op: "x:soft" }] }])).toBe(
      false,
    );
    expect(
      needs([
        { kind: "register", name: "a", disabled: true, steps: [{ kind: "op", op: "x:hard" }] },
        { kind: "return" },
      ]),
    ).toBe(false);
  });
});
