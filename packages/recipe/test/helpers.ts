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
/** Shared test helpers: the fixture catalogue, an extra catalogue for the parameter types, golden files. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ParamSpec } from "@forge/lang";
import seedJson from "./fixtures/catalogue.json";
import type { CatalogueOpView, CatalogueView, Recipe } from "../src/types.js";

/** The twelve seed ops of RECIPES.md section 10.1 (hand-written fixture; the hashes are arbitrary). */
export const seed = seedJson as unknown as CatalogueView;

const here = join(fileURLToPath(import.meta.url), "..");

export function golden(name: string): string {
  return readFileSync(join(here, "goldens", name), "utf8");
}

export function fixtureFiles(dir: string): string[] {
  return readdirSync(join(here, dir)).sort();
}

export function fixtureText(dir: string, name: string): string {
  return readFileSync(join(here, dir, name), "utf8");
}

export function recipeOf(steps: unknown[], extra: Record<string, unknown> = {}): Recipe {
  return { forge: 1, ...extra, steps } as unknown as Recipe;
}

function spec(
  s: Partial<ParamSpec> & { name: string; type: ParamSpec["type"] },
  index: number,
): ParamSpec {
  return { required: s.default === undefined, ...s, index } as ParamSpec;
}

function op(
  qname: string,
  input: string,
  output: string,
  params: (Partial<ParamSpec> & { name: string; type: ParamSpec["type"] })[],
  extra: Partial<CatalogueOpView> = {},
): CatalogueOpView {
  return {
    qname,
    aliases: [],
    input,
    output,
    params: params.map((p, i) => spec(p, i + 1)),
    hash: qname.length.toString(16).padStart(2, "0").repeat(32),
    needsHardKill: false,
    ...extra,
  } as CatalogueOpView;
}

/** Ops that exercise every parameter type; the seed catalogue has only some of them. */
export const extras: CatalogueView = {
  version: "0123456789abcdef",
  ops: [
    op("x:key", "bytes", "bytes", [
      {
        name: "key",
        type: "key",
        options: ["utf8", "hex"],
        constraint: { minLength: 2, maxLength: 4 },
      },
    ]),
    op("x:secret", "bytes", "bytes", [
      { name: "secret", type: "key", default: { value: "", enc: "utf8" } },
    ]),
    op("x:toggle", "bytes", "bytes", [
      { name: "mode", type: "toggle", default: { value: "ab", enc: "latin1" } },
    ]),
    op("x:nums", "bytes", "bytes", [
      { name: "count", type: "int", constraint: { min: 1, max: 100 }, default: 5 },
      { name: "big", type: "int", default: "9007199254740993" },
      { name: "pick", type: "int", constraint: { oneOf: [1, 3, 5] }, default: 3 },
      { name: "ratio", type: "num", constraint: { min: 0, max: 1 }, default: 0.5 },
      { name: "any", type: "number", default: 2 },
      { name: "on", type: "bool", default: false },
    ]),
    op("x:text", "str", "str", [
      { name: "set", type: "charset", constraint: { maxLength: 4 }, default: "abc" },
      { name: "raw", type: "bytes", constraint: { lengthOneOf: [2, 3] }, default: "ab01" },
      { name: "word", type: "str", constraint: { minLength: 1, maxLength: 5 }, default: "hey" },
      { name: "rx", type: "regex", constraint: { maxLength: 8 }, default: "a+" },
      { name: "pick", type: "choice", options: ["a", "b"], default: "a" },
    ]),
    op("x:tuple", "bytes", "bytes", [
      { name: "one", type: "int", constraint: { min: 0, max: 0 }, default: 0 },
      { name: "low", type: "int", constraint: { min: 1 }, default: 1 },
      { name: "high", type: "int", constraint: { max: 9 }, default: 9 },
      { name: "pat", type: "str", constraint: { pattern: "[a-z]*" }, default: "" },
    ]),
    op("x:pred", "str", "bool", [{ name: "needle", type: "str" }], { aliases: ["has"] }),
    op("x:ghost", "bytes", "bytes", [{ name: "items", type: "list" as ParamSpec["type"] }]),
    op("x:hard", "bytes", "bytes", [], { needsHardKill: true }),
    op("x:soft", "bytes", "bytes", []),
    // an alias that equals the name of another op: the canonical name wins
    op("y:rot", "bytes", "bytes", [], { aliases: ["rot13", "clash"] }),
    op("y:clash", "bytes", "bytes", []),
  ],
};

/** The seed ops and the extra ops together. */
export const combined: CatalogueView = {
  version: seed.version,
  ops: [...seed.ops, ...extras.ops],
};
