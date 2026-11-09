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
import { combined, extras, recipeOf, seed } from "../test/helpers.js";
import {
  canonicalRecipe,
  isEncodedShape,
  normaliseRecipe,
  pinOps,
  pinRecipe,
  resolveRecipe,
} from "./normalise.js";
import { recipeNeedsHardKill } from "./stepmap.js";
import type { Recipe } from "./types.js";
import { validateRecipe } from "./validate.js";

const json = (r: unknown) => JSON.stringify(r);
const normalise = (r: unknown) => json(normaliseRecipe(r as Recipe));
const hashOf = (q: string) => seed.ops.find((o) => o.qname === q)?.hash;

describe("normaliseRecipe (RECIPES.md sections 3.6 and 12.4)", () => {
  test.each<[string, unknown, string]>([
    ["key order", { steps: [], forge: 1 }, '{"forge":1,"steps":[]}'],
    [
      "defaults are omitted, flags rewritten",
      {
        forge: 1,
        name: "",
        steps: [
          { kind: "op", op: "text:upper", params: {}, disabled: false, note: "" },
          { kind: "subsection", pattern: "a", flags: "mi", encoding: "utf8", steps: [] },
          { kind: "repeat", until: "stable", max: 100, steps: [] },
        ],
      },
      '{"forge":1,"steps":[{"kind":"op","op":"text:upper"},{"kind":"subsection","pattern":"a","flags":"im","steps":[]},{"kind":"repeat","until":"stable","steps":[]}]}',
    ],
    [
      "a hex fork separator",
      {
        forge: 1,
        steps: [
          {
            kind: "fork",
            split: { value: "DE AD", enc: "hex" },
            join: { enc: "utf8", value: "" },
            steps: [],
          },
        ],
      },
      '{"forge":1,"steps":[{"kind":"fork","split":{"value":"dead","enc":"hex"},"join":{"value":"","enc":"utf8"},"steps":[]}]}',
    ],
    [
      "a base64 separator is padded",
      {
        forge: 1,
        steps: [
          {
            kind: "fork",
            split: { value: "3q2+7w", enc: "base64" },
            join: { value: " 3q2+ 7w== ", enc: "base64" },
            steps: [],
          },
        ],
      },
      '{"forge":1,"steps":[{"kind":"fork","split":{"value":"3q2+7w==","enc":"base64"},"join":{"value":"3q2+7w==","enc":"base64"},"steps":[]}]}',
    ],
    [
      "params keys are sorted, encoded params are normalised by shape",
      {
        forge: 1,
        steps: [
          { kind: "op", op: "x:y", params: { z: 1, a: { value: "AB", enc: "hex" }, m: "AB" } },
        ],
      },
      '{"forge":1,"steps":[{"kind":"op","op":"x:y","params":{"a":{"value":"ab","enc":"hex"},"m":"AB","z":1}}]}',
    ],
    [
      "every kind in the documented key order, with the common fields last",
      {
        steps: [
          {
            note: "n",
            breakpoint: true,
            disabled: true,
            hash: "a".repeat(64),
            params: { b: 1 },
            op: "a:b",
            kind: "op",
          },
          {
            steps: [],
            else: undefined,
            kind: "if",
            then: [],
            test: { hash: "b".repeat(64), op: "a:b", kind: "op", params: { q: true } },
          },
          {
            else: [{ text: "c", kind: "comment" }],
            then: [],
            test: { encoding: "latin1", flags: "sm", pattern: "p", kind: "regex" },
            kind: "if",
            note: "x",
          },
          { steps: [], max: 5, until: "stable", kind: "repeat" },
          { steps: [], times: 4, kind: "repeat", max: 7 },
          { steps: [], encoding: "latin1", flags: "s", pattern: "p", kind: "subsection" },
          {
            join: { enc: "latin1", value: "j" },
            steps: [],
            split: { enc: "utf8", value: "s" },
            kind: "fork",
          },
        ],
        description: "d",
        catalogue: "0123456789abcdef",
        name: "n",
        forge: 1,
      },
      '{"forge":1,"name":"n","description":"d","catalogue":"0123456789abcdef","steps":[' +
        `{"kind":"op","op":"a:b","params":{"b":1},"hash":"${"a".repeat(64)}","disabled":true,"breakpoint":true,"note":"n"},` +
        `{"kind":"if","test":{"kind":"op","op":"a:b","params":{"q":true},"hash":"${"b".repeat(64)}"},"then":[]},` +
        '{"kind":"if","test":{"kind":"regex","pattern":"p","flags":"ms","encoding":"latin1"},"then":[],"else":[{"kind":"comment","text":"c"}],"note":"x"},' +
        '{"kind":"repeat","until":"stable","max":5,"steps":[]},' +
        '{"kind":"repeat","times":4,"steps":[]},' +
        '{"kind":"subsection","pattern":"p","flags":"s","encoding":"latin1","steps":[]},' +
        '{"kind":"fork","split":{"value":"s","enc":"utf8"},"join":{"value":"j","enc":"latin1"},"steps":[]}]}',
    ],
    [
      "an empty else and an if test with default flags",
      {
        forge: 1,
        steps: [
          {
            kind: "if",
            test: { kind: "regex", pattern: "a", flags: "", encoding: "utf8" },
            then: [],
            else: [],
          },
        ],
      },
      '{"forge":1,"steps":[{"kind":"if","test":{"kind":"regex","pattern":"a"},"then":[]}]}',
    ],
  ])("%s", (_name, input, expected) => {
    expect(normalise(input)).toBe(expected);
  });

  test("it is idempotent and builds fresh objects", () => {
    const input = {
      forge: 1,
      steps: [{ kind: "op", op: "a:b", params: { z: 1, a: 2 } }],
    } as unknown as Recipe;
    const once = normaliseRecipe(input);
    expect(json(normaliseRecipe(once))).toBe(json(once));
    expect(once).not.toBe(input);
    expect(once.steps[0]).not.toBe(input.steps[0]);
  });

  test("a __proto__ own key is copied as data, never as a prototype", () => {
    const input = JSON.parse(
      '{"forge":1,"steps":[{"kind":"op","op":"a:b","params":{"__proto__":1}}]}',
    ) as Recipe;
    const out = normaliseRecipe(input);
    expect(Object.getPrototypeOf((out.steps[0] as { params: object }).params)).toBe(
      Object.prototype,
    );
    expect(json(out)).toContain('"__proto__":1');
  });

  test("isEncodedShape", () => {
    expect(isEncodedShape({ value: "a", enc: "utf8" })).toBe(true);
    for (const v of [null, 1, "x", {}, { value: 1, enc: "utf8" }, { value: "a" }])
      expect(isEncodedShape(v)).toBe(false);
  });
});

describe("resolveRecipe and canonicalRecipe (RECIPES.md section 12.4)", () => {
  const resolve = (step: unknown, catalogue = seed) =>
    resolveRecipe(recipeOf([step]), catalogue).steps[0] as unknown;

  test("an alias is replaced and defaults are filled in ParamSpec order", () => {
    expect(resolve({ kind: "op", op: "classical:rot13" })).toEqual({
      kind: "op",
      op: "classical:rot",
      params: { amount: 13 },
    });
    expect(json(resolve({ kind: "op", op: "hex:encode", params: { case: "upper" } }))).toBe(
      '{"kind":"op","op":"hex:encode","params":{"delimiter":"none","case":"upper"}}',
    );
  });

  test("an int decimal string that is a safe integer becomes a number; a larger one stays", () => {
    expect(resolve({ kind: "op", op: "classical:rot", params: { amount: "13" } })).toEqual({
      kind: "op",
      op: "classical:rot",
      params: { amount: 13 },
    });
    const step = {
      kind: "op",
      op: "x:nums",
      params: { big: "9007199254740993", count: "-0", pick: "5" },
    };
    expect(resolve(step, extras)).toMatchObject({
      params: { count: "-0", big: "9007199254740993", pick: 5 },
    });
  });

  test("bytes, toggle and key values are normalised by the type", () => {
    const step = {
      kind: "op",
      op: "x:text",
      params: { raw: "DE AD" },
    };
    expect(resolve(step, extras)).toMatchObject({ params: { raw: "dead" } });
    expect(
      resolve(
        { kind: "op", op: "x:toggle", params: { mode: { value: "3q2+7w", enc: "base64" } } },
        extras,
      ),
    ).toMatchObject({
      params: { mode: { value: "3q2+7w==", enc: "base64" } },
    });
    // defaults are normalised too
    expect(resolve({ kind: "op", op: "x:text", params: {} }, extras)).toMatchObject({
      params: { raw: "ab01", set: "abc" },
    });
    expect(resolve({ kind: "op", op: "x:text", params: { raw: 5 } }, extras)).toMatchObject({
      params: { raw: 5 },
    });
    expect(resolve({ kind: "op", op: "x:toggle", params: { mode: "oops" } }, extras)).toMatchObject(
      { params: { mode: "oops" } },
    );
    expect(resolve({ kind: "op", op: "x:nums", params: { count: 7.5 } }, extras)).toMatchObject({
      params: { count: 7.5 },
    });
  });

  test("params is present exactly when the op has parameters; hashes and common fields are kept", () => {
    const hash = "a".repeat(64);
    expect(
      json(resolve({ kind: "op", op: "text:upper", params: {}, hash, disabled: true, note: "n" })),
    ).toBe(`{"kind":"op","op":"text:upper","hash":"${hash}","disabled":true,"note":"n"}`);
    expect(json(resolve({ kind: "op", op: "hex:decode" }))).toBe('{"kind":"op","op":"hex:decode"}');
  });

  test("op tests are resolved too; unknown ops are left alone; other steps are copied", () => {
    const test = {
      kind: "if",
      test: { kind: "op", op: "regex:test", params: { pattern: "a" } },
      then: [{ kind: "op", op: "nope:x", params: { a: 1 } }],
      else: [{ kind: "comment", text: "c" }],
    };
    expect(resolve(test)).toEqual({
      kind: "if",
      test: { kind: "op", op: "regex:test", params: { pattern: "a", flags: "" } },
      then: [{ kind: "op", op: "nope:x", params: { a: 1 } }],
      else: [{ kind: "comment", text: "c" }],
    });
    const regex = { kind: "if", test: { kind: "regex", pattern: "a" }, then: [] };
    expect(resolve(regex)).toEqual(regex);
    const nested = {
      kind: "fork",
      split: { value: "x", enc: "utf8" },
      join: { value: "", enc: "utf8" },
      steps: [
        {
          kind: "subsection",
          pattern: "a",
          steps: [{ kind: "repeat", times: 2, steps: [{ kind: "op", op: "classical:rot13" }] }],
        },
      ],
    };
    expect(json(resolve(nested))).toContain('"op":"classical:rot","params":{"amount":13}');
  });

  test("a missing required parameter is not invented", () => {
    expect(resolve({ kind: "op", op: "regex:test" })).toEqual({
      kind: "op",
      op: "regex:test",
      params: { flags: "" },
    });
  });

  test("canonical = resolve(normalise)", () => {
    const r = recipeOf([{ kind: "op", op: "classical:rot13", params: {}, disabled: false }], {
      name: "",
    });
    expect(json(canonicalRecipe(r, seed))).toBe(json(resolveRecipe(normaliseRecipe(r), seed)));
    expect(json(canonicalRecipe(r, seed))).toBe(
      '{"forge":1,"steps":[{"kind":"op","op":"classical:rot","params":{"amount":13}}]}',
    );
  });

  test("normalise, resolve and canonical are idempotent on generated recipes", () => {
    for (let i = 1; i <= 150; i++) {
      const recipe = genRecipe(new Rng(i * 31), combined);
      expect(validateRecipe(recipe, combined, { pins: "ignore" }).ok).toBe(true);
      const n = normaliseRecipe(recipe);
      expect(json(normaliseRecipe(n))).toBe(json(n));
      const c = canonicalRecipe(recipe, combined);
      expect(json(canonicalRecipe(c, combined))).toBe(json(c));
      expect(json(resolveRecipe(c, combined))).toBe(json(c));
      // the canonical form is valid and has the same meaning
      expect(validateRecipe(c, combined, { pins: "ignore" }).ok).toBe(true);
    }
  });
});

describe("pinRecipe", () => {
  const recipe = recipeOf([
    { kind: "op", op: "classical:rot13", hash: "0".repeat(64), breakpoint: true },
    { kind: "op", op: "text:upper" },
    { kind: "op", op: "nope:x" },
    {
      kind: "if",
      test: { kind: "op", op: "regex:test", params: { pattern: "a" } },
      then: [{ kind: "op", op: "text:lower" }],
      else: [{ kind: "op", op: "hex:decode" }],
    },
    { kind: "if", test: { kind: "regex", pattern: "a" }, then: [] },
    {
      kind: "fork",
      split: { value: "x", enc: "utf8" },
      join: { value: "", enc: "utf8" },
      steps: [
        { kind: "comment", text: "c" },
        { kind: "op", op: "text:reverse" },
      ],
    },
  ]);

  test("sets hash on every op step and op test, overwriting", () => {
    const pinned = pinRecipe(recipe, seed);
    const steps = pinned.steps as unknown as Record<string, unknown>[];
    expect(steps[0]).toEqual({
      kind: "op",
      op: "classical:rot13",
      hash: hashOf("classical:rot"),
      breakpoint: true,
    });
    expect(steps[1]?.hash).toBe(hashOf("text:upper"));
    expect(steps[2]).toEqual({ kind: "op", op: "nope:x" });
    const branch = steps[3] as {
      test: { hash: string };
      then: { hash: string }[];
      else: { hash: string }[];
    };
    expect(branch.test.hash).toBe(hashOf("regex:test"));
    expect(branch.then[0]?.hash).toBe(hashOf("text:lower"));
    expect(branch.else[0]?.hash).toBe(hashOf("hex:decode"));
    expect(steps[4]).toEqual({ kind: "if", test: { kind: "regex", pattern: "a" }, then: [] });
    expect((steps[5] as { steps: { hash?: string }[] }).steps[1]?.hash).toBe(
      hashOf("text:reverse"),
    );
    // the input is untouched
    expect((recipe.steps[0] as { hash: string }).hash).toBe("0".repeat(64));
  });

  test("onlyMissing keeps pins that are there", () => {
    const pinned = pinOps(recipe, seed, true);
    expect((pinned.steps[0] as { hash: string }).hash).toBe("0".repeat(64));
    expect((pinned.steps[1] as { hash: string }).hash).toBe(hashOf("text:upper"));
  });
});

describe("recipeNeedsHardKill (RECIPES.md section 4.1)", () => {
  const needs = (steps: unknown[], catalogue = seed) =>
    recipeNeedsHardKill(recipeOf(steps), catalogue);
  const sub = { kind: "subsection", pattern: "a", steps: [] };
  const fork = (steps: unknown[], extra: Record<string, unknown> = {}) => ({
    kind: "fork",
    split: { value: "x", enc: "utf8" },
    join: { value: "", enc: "utf8" },
    steps,
    ...extra,
  });

  test("a plain recipe does not", () => {
    expect(needs([])).toBe(false);
    expect(
      needs([
        { kind: "op", op: "text:upper" },
        { kind: "comment", text: "c" },
        { kind: "op", op: "unknown:op" },
      ]),
    ).toBe(false);
  });

  test("a subsection, an if with a regex test, or an op that needs it does", () => {
    expect(needs([sub])).toBe(true);
    expect(needs([{ kind: "if", test: { kind: "regex", pattern: "a" }, then: [] }])).toBe(true);
    expect(
      needs([{ kind: "op", op: "regex:replace", params: { pattern: "a", replacement: "b" } }]),
    ).toBe(true);
    expect(needs([{ kind: "op", op: "x:hard" }], extras)).toBe(true);
    expect(needs([{ kind: "op", op: "x:soft" }], extras)).toBe(false);
    expect(
      needs([
        { kind: "if", test: { kind: "op", op: "regex:test", params: { pattern: "a" } }, then: [] },
      ]),
    ).toBe(true);
    expect(
      needs(
        [{ kind: "if", test: { kind: "op", op: "x:pred", params: { needle: "a" } }, then: [] }],
        extras,
      ),
    ).toBe(false);
  });

  test("it looks into every container and branch", () => {
    expect(needs([fork([fork([sub])])])).toBe(true);
    expect(
      needs([
        {
          kind: "repeat",
          times: 2,
          steps: [{ kind: "op", op: "regex:test", params: { pattern: "a" } }],
        },
      ]),
    ).toBe(true);
    expect(
      needs(
        [
          {
            kind: "if",
            test: { kind: "op", op: "x:pred", params: { needle: "a" } },
            then: [],
            else: [sub],
          },
        ],
        extras,
      ),
    ).toBe(true);
    expect(
      needs(
        [{ kind: "if", test: { kind: "op", op: "x:pred", params: { needle: "a" } }, then: [sub] }],
        extras,
      ),
    ).toBe(true);
    expect(
      needs(
        [{ kind: "if", test: { kind: "op", op: "x:pred", params: { needle: "a" } }, then: [] }],
        extras,
      ),
    ).toBe(false);
  });

  test("disabled steps, and everything inside them, do not count", () => {
    expect(needs([{ ...sub, disabled: true }])).toBe(false);
    expect(needs([fork([sub], { disabled: true })])).toBe(false);
    expect(needs([{ kind: "op", op: "x:hard", disabled: true }], extras)).toBe(false);
    expect(
      needs([{ kind: "if", test: { kind: "regex", pattern: "a" }, then: [], disabled: true }]),
    ).toBe(false);
    expect(
      needs([
        fork([
          { ...sub, disabled: true },
          { kind: "op", op: "text:upper" },
        ]),
      ]),
    ).toBe(false);
    expect(needs([fork([{ ...sub, disabled: true }, sub])])).toBe(true);
  });

  test("an alias of an op that needs it", () => {
    const hard = {
      ...extras,
      ops: [{ ...extras.ops[0]!, qname: "k:go", aliases: ["run"], needsHardKill: true }],
    };
    expect(needs([{ kind: "op", op: "k:run" }], hard)).toBe(true);
  });
});
