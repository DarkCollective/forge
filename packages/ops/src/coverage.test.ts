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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  catalogueWords,
  checkCoverage,
  loadCoverage,
  renderCoverage,
} from "../scripts/coverage-lib.js";
import type { CoverageData } from "../scripts/coverage-lib.js";
import { assembleRuntime } from "./bundle.js";
import { buildCatalogue } from "./catalogue.js";
import { loadBundleNode } from "./sources-node.js";

// docs/coverage/*.json against its schema and the catalogue, and docs/COVERAGE.md against the data.
const here = fileURLToPath(import.meta.url).replaceAll("\\", "/");
const docs = `${here.slice(0, here.lastIndexOf("/packages/"))}/docs/`;
const catalogue = buildCatalogue(assembleRuntime(await loadBundleNode("all")));
const words = catalogueWords(catalogue);
const data = loadCoverage(`${docs}coverage`);

describe("the committed coverage data", () => {
  const checked = checkCoverage(data, words);

  test("the reference list has 506 distinct operations", () => {
    expect(checked.reference).toHaveLength(506);
  });

  test("every mapping file is valid", () => {
    expect(checked.errors).toEqual([]);
  });

  test("docs/COVERAGE.md is up to date", () => {
    const committed = readFileSync(`${docs}COVERAGE.md`, "utf8");
    const message =
      "docs/COVERAGE.md is out of date with docs/coverage/*.json or the catalogue: run `npm run coverage` and commit the result.";
    expect(committed === renderCoverage(checked.reference, checked.mappings), message).toBe(true);
  });
});

describe("checkCoverage rules", () => {
  const reference = [
    { name: "To Foo", category: "Data format" },
    { name: "From Foo", category: "Data format" },
  ];
  const run = (entries: unknown, extra: unknown[] = []): string[] => {
    const d: CoverageData = {
      reference,
      schema: data.schema,
      files: [
        { file: "a.json", entries },
        ...extra.map((e, i) => ({ file: `b${i}.json`, entries: e })),
      ],
    };
    return checkCoverage(d, new Set(["base64:encode", "classical:rot13"])).errors;
  };
  const ok = { cyberchef: "To Foo", status: "covered", forge: ["base64:encode"] };

  test("a valid entry passes, an alias and a step are accepted", () => {
    expect(run([ok])).toEqual([]);
    expect(
      run([{ cyberchef: "To Foo", status: "redesigned", forge: ["classical:rot13"], note: "n" }]),
    ).toEqual([]);
    expect(
      run([{ cyberchef: "To Foo", status: "redesigned", forge: ["step:fork"], note: "n" }]),
    ).toEqual([]);
    expect(run([{ cyberchef: "To Foo", status: "dropped", note: "why" }])).toEqual([]);
  });

  test("a name that is not in the reference list is reported", () => {
    expect(run([{ ...ok, cyberchef: "To Bar" }]).join()).toMatch(/not a name in cyberchef.json/);
  });

  test("a name claimed twice is reported, in one file or two", () => {
    expect(run([ok, ok]).join()).toMatch(/already mapped/);
    expect(run([ok], [[ok]]).join()).toMatch(/already mapped in a.json/);
  });

  test("an unknown word is reported; unknown step kinds fail the schema", () => {
    expect(run([{ ...ok, forge: ["base64:nope"] }]).join()).toMatch(/not a catalogue op or alias/);
    expect(run([{ ...ok, forge: ["step:goto"] }]).length).toBeGreaterThan(0);
    expect(run([{ ...ok, forge: ["util:space?"] }]).join()).toMatch(/not a catalogue op/);
  });

  test("vocabulary names are lower-kebab-case: hyphens inside are fine, other shapes fail the schema", () => {
    const shape = (w: string) => run([{ ...ok, forge: [w] }]).join();
    // a well-formed name passes the schema (the only complaint is that it is not in the catalogue)
    expect(shape("quoted-printable:encode")).toMatch(/not a catalogue op/);
    expect(shape("a-b-c1:decode")).toMatch(/not a catalogue op/);
    for (const bad of ["Quoted:x", "-a:b", "a-:b", "a--b:c", "a_b:c", "1a:b", ":x"]) {
      expect(shape(bad), bad).toMatch(/pattern/);
    }
  });

  test("schema rules: forge, note and status", () => {
    expect(run([{ cyberchef: "To Foo", status: "covered" }]).length).toBeGreaterThan(0);
    expect(run([{ cyberchef: "To Foo", status: "covered", forge: [] }]).length).toBeGreaterThan(0);
    expect(
      run([{ cyberchef: "To Foo", status: "redesigned", forge: ["base64:encode"] }]).length,
    ).toBeGreaterThan(0);
    expect(run([{ cyberchef: "To Foo", status: "dropped" }]).length).toBeGreaterThan(0);
    expect(
      run([{ cyberchef: "To Foo", status: "dropped", forge: ["base64:encode"], note: "n" }]).length,
    ).toBeGreaterThan(0);
    expect(run([{ ...ok, status: "planned" }]).length).toBeGreaterThan(0);
    expect(run([{ ...ok, extra: 1 }]).length).toBeGreaterThan(0);
  });
});

describe("renderCoverage", () => {
  test("is deterministic, shows unmapped names as not yet and escapes pipes", () => {
    const reference = [
      { name: "A", category: "X" },
      { name: "B", category: "X" },
      { name: "C", category: "Y" },
    ];
    const mappings = [
      { cyberchef: "A", status: "covered" as const, forge: ["base64:encode"], note: "a | b" },
    ];
    const text = renderCoverage(reference, mappings);
    expect(renderCoverage(reference, mappings)).toBe(text);
    expect(text).toMatch(/Do not edit/);
    expect(text).toContain("| A | covered | `base64:encode` | a \\| b |");
    expect(text).toContain("| B | not yet |  |  |");
    expect(text).toContain("| X | 1 | 0 | 0 | 1 | 2 |");
    expect(text).toContain("| **Total** | **1** | **0** | **0** | **2** | **3** |");
  });
});
