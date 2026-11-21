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
// Ajv compiles schemas with `new Function`, which the production CSP forbids: it is used by the tests only.
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, test } from "vitest";
import { fixtureFiles, fixtureText } from "../test/helpers.js";
import schema from "./recipe.schema.json";
import { validateRecipe } from "./validate.js";

const ajv = new Ajv2020({ strict: true, allErrors: false });
const accepts = ajv.compile(schema);

function corpus(dir: "valid" | "invalid"): [string, unknown][] {
  return fixtureFiles(`corpus/${dir}`).map((f) => [
    f.replace(/\.json$/, ""),
    JSON.parse(fixtureText(`corpus/${dir}`, f)) as unknown,
  ]);
}

function v11(dir: "valid" | "invalid" | "validator-only"): [string, unknown][] {
  return fixtureFiles(`corpus/v11/${dir}`).map((f) => [
    f.replace(/\.json$/, ""),
    JSON.parse(fixtureText(`corpus/v11/${dir}`, f)) as unknown,
  ]);
}

describe("recipe.schema.json and validateRecipe agree (RECIPES.md section 11.3, item 5)", () => {
  test("the schema is a valid draft 2020-12 schema in strict mode", () => {
    expect(schema.$id).toBe("urn:forge:schema:recipe:1");
    expect(typeof accepts).toBe("function");
  });

  test("the corpus is not empty", () => {
    expect(corpus("valid").length).toBeGreaterThanOrEqual(15);
    expect(corpus("invalid").length).toBeGreaterThanOrEqual(60);
  });

  test.each(corpus("valid"))("valid document %s is accepted by both", (_name, doc) => {
    expect(accepts(doc)).toBe(true);
    const result = validateRecipe(doc);
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test.each(corpus("invalid"))("invalid document %s is rejected by both", (_name, doc) => {
    expect(accepts(doc)).toBe(false);
    const result = validateRecipe(doc);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.severity === "error")).toBe(true);
  });

  test("the validator is stricter in the places the spec names (validator-only checks)", () => {
    // lone surrogate, bad hex, empty-decoding separator, regexes that do not compile, 9 nested levels
    const stricter: unknown[] = [
      { forge: 1, name: "\ud800", steps: [] },
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
      {
        forge: 1,
        steps: [
          {
            kind: "fork",
            split: { value: " ", enc: "hex" },
            join: { value: "", enc: "utf8" },
            steps: [],
          },
        ],
      },
      { forge: 1, steps: [{ kind: "subsection", pattern: "(", steps: [] }] },
    ];
    for (const doc of stricter) {
      expect(accepts(doc)).toBe(true);
      expect(validateRecipe(doc).ok).toBe(false);
    }
    let deep: unknown = [];
    for (let i = 0; i < 9; i++) {
      deep = [
        {
          kind: "fork",
          split: { value: "x", enc: "utf8" },
          join: { value: "", enc: "utf8" },
          steps: deep,
        },
      ];
    }
    const nine = { forge: 1, steps: deep };
    expect(accepts(nine)).toBe(true);
    expect(validateRecipe(nine).ok).toBe(false);
  });
});

describe("the Recipe JSON v1.1 corpus (RECIPES-1.1.md sections 4.2 and 6)", () => {
  test("the v1.1 corpus is not empty", () => {
    expect(v11("valid").length).toBeGreaterThanOrEqual(8);
    expect(v11("invalid").length).toBeGreaterThanOrEqual(4);
    expect(v11("validator-only").length).toBeGreaterThanOrEqual(8);
  });

  test.each(v11("valid"))("valid v1.1 document %s is accepted by both", (_name, doc) => {
    expect(accepts(doc)).toBe(true);
    const result = validateRecipe(doc);
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test.each(v11("invalid"))("invalid v1.1 document %s is rejected by both", (_name, doc) => {
    expect(accepts(doc)).toBe(false);
    const result = validateRecipe(doc);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.severity === "error")).toBe(true);
  });

  test.each(v11("validator-only"))(
    "v1.1 document %s is a question only the validator answers (scope, position, count)",
    (_name, doc) => {
      expect(accepts(doc)).toBe(true);
      const result = validateRecipe(doc);
      expect(result.ok).toBe(false);
      expect(result.issues.some((i) => i.severity === "error")).toBe(true);
    },
  );

  test("the schema still accepts every document that it accepted before: the same $id and forge const", () => {
    expect(schema.$id).toBe("urn:forge:schema:recipe:1");
    expect(schema.properties.forge).toEqual({ const: 1 });
  });
});
