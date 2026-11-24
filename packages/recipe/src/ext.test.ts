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
// Ext parameters (RECIPES-1.2.md sections 3 and 15.3): the conformance cases CR220 to CR225 and CR230, and the
// rule that this package holds no kind registry.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import type { ParamSpec } from "@forge/lang";
import { slotCatalogue } from "../test/helpers.js";
import { compileRecipe } from "./compile.js";
import { canonicalRecipe, normaliseRecipe, resolveRecipe } from "./normalise.js";
import { parseRecipeText } from "./text.js";
import { RECIPE_LIMITS } from "./types.js";
import type { CatalogueOpView, CatalogueView, Recipe } from "./types.js";
import { validateRecipe } from "./validate.js";

const filter: CatalogueOpView = {
  qname: "table:filter",
  aliases: [],
  input: "ext",
  output: "ext",
  params: [
    { name: "expr", type: "ext", kind: "relix-expr", required: true, index: 1 } as ParamSpec,
  ],
  hash: "ab".repeat(32),
  needsHardKill: false,
};
const withDefault: CatalogueOpView = {
  ...filter,
  qname: "table:keep",
  params: [
    { name: "expr", type: "ext", kind: "relix-expr", required: false, index: 1, default: "true" },
  ] as ParamSpec[],
  hash: "cd".repeat(32),
};
const cat: CatalogueView = {
  version: slotCatalogue.version,
  ops: [...slotCatalogue.ops, filter, withDefault],
};
const R = (...steps: unknown[]) => ({ forge: 1, steps }) as unknown as Recipe;
const filterWith = (expr: unknown) =>
  R({ kind: "op", op: "csv:parse" }, { kind: "op", op: "table:filter", params: { expr } });
const check = (r: Recipe) => validateRecipe(r, cat, { pins: "ignore" });
const exprOf = (r: Recipe) => (r.steps[1] as unknown as { params: { expr: string } }).params.expr;

describe("ext parameters in the validator", () => {
  test("CR220 a string is valid", () => {
    expect(check(filterWith('age > 30 and name <> "Bob"')).ok).toBe(true);
  });

  test("CR221 nothing but a string", () => {
    for (const bad of [30, true, { value: "a", enc: "utf8" }]) {
      const res = check(filterWith(bad));
      expect(res.ok).toBe(false);
      const issue = res.issues[0];
      expect(issue?.code).toBe("bad-param");
      expect(issue?.path).toBe("/steps/1/params/expr");
      expect(issue?.detail).toMatchObject({ param: "expr", reason: "expected a string" });
    }
  });

  test("CR222 4096 code points are valid, 4097 are not, and astral characters count once", () => {
    expect(RECIPE_LIMITS.maxExtChars).toBe(4096);
    expect(check(filterWith("x".repeat(4096))).ok).toBe(true);
    expect(check(filterWith("\u{1F600}".repeat(4096))).ok).toBe(true);
    for (const s of ["x".repeat(4097), "\u{1F600}".repeat(4097)]) {
      const res = check(filterWith(s));
      expect(res.ok).toBe(false);
      expect(res.issues[0]?.code).toBe("bad-param");
      expect(res.issues[0]?.detail).toMatchObject({ constraint: "length <= 4096" });
    }
  });

  test("CR223 a lone surrogate has the code and message that a str parameter gets", () => {
    const str = check(R({ kind: "op", op: "relix:recur", params: { name: "a\ud800" } }));
    const ext = check(filterWith("a\ud800"));
    expect(ext.ok).toBe(false);
    expect(ext.issues[0]?.code).toBe(str.issues[0]?.code);
    expect(ext.issues[0]?.message).toBe(str.issues[0]?.message);
  });

  test("CR224 a register supplies an ext parameter; CR225 invalid Relix text is valid here", () => {
    const res = check(
      R(
        { kind: "register", name: "test", steps: [{ kind: "op", op: "table:to-json" }] },
        { kind: "op", op: "csv:parse" },
        { kind: "op", op: "table:filter", params: { expr: { ref: "test" } } },
        { kind: "op", op: "table:filter", params: { expr: "age >>" } },
      ),
    );
    expect(res.ok).toBe(true);
    expect(res.issues).toEqual([]);
  });

  test("the spec constraint plays no part: only the length is checked", () => {
    const strict: CatalogueView = {
      version: cat.version,
      ops: [
        {
          ...filter,
          params: [
            {
              name: "expr",
              type: "ext",
              kind: "relix-expr",
              required: true,
              index: 1,
              constraint: { maxLength: 2 },
            } as ParamSpec,
          ],
        },
      ],
    };
    const r = R({ kind: "op", op: "table:filter", params: { expr: "long text" } });
    expect(validateRecipe(r, strict, { pins: "ignore" }).ok).toBe(true);
  });
});

describe("ext parameters in the normal forms and the text form", () => {
  test("CR230 an ext string is kept as written, in normalise and in canonical", () => {
    for (const expr of ["age>30", "age > 30", "  spaced  ", "é́"]) {
      const r = filterWith(expr);
      expect(exprOf(normaliseRecipe(r))).toBe(expr);
      expect(exprOf(canonicalRecipe(r, cat))).toBe(expr);
    }
  });

  test("resolve writes the default of an omitted ext parameter as it is", () => {
    const out = resolveRecipe(R({ kind: "op", op: "table:keep" }), cat).steps[0] as unknown as {
      params: { expr: string };
    };
    expect(out.params.expr).toBe("true");
  });

  test("text round trip, with quotes, backslashes, newlines and astral characters", () => {
    for (const expr of [
      'age > 30 and name <> "Bob"',
      "a \\ b\nc\td",
      "café \u{1F600}",
      "age>30",
      "",
    ]) {
      const r = filterWith(expr);
      const out = compileRecipe(r, cat, { pins: "ignore" });
      if (!out.ok) throw new Error(JSON.stringify(out.issues));
      const parsed = parseRecipeText(out.text, cat);
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
      expect(parsed.recipe).toEqual(canonicalRecipe(r, cat));
      expect(exprOf(parsed.recipe)).toBe(expr);
    }
  });

  test("a register reference in an ext position round trips", () => {
    const r = R(
      { kind: "register", name: "test", steps: [{ kind: "op", op: "table:to-json" }] },
      { kind: "op", op: "csv:parse" },
      { kind: "op", op: "table:filter", params: { expr: { ref: "test" } } },
    );
    const out = compileRecipe(r, cat, { pins: "ignore" });
    if (!out.ok) throw new Error(JSON.stringify(out.issues));
    const parsed = parseRecipeText(out.text, cat);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(parsed.recipe).toEqual(canonicalRecipe(r, cat));
  });
});

describe("@forge/recipe is kind-blind", () => {
  test("no source file names a kind or a fromText hook", () => {
    const here = join(fileURLToPath(import.meta.url), "..");
    const files = readdirSync(here).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const code = readFileSync(join(here, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(code, f).not.toMatch(
        /fromText|toText|relix-expr|kindRegistry|registerKind|KIND_REGISTRY/,
      );
    }
  });
});
