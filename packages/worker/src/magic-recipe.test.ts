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

/*
 * The `magic` vocabulary in recipes (PLAN.md WP 6.32, RECIPES.md section 3.2): an `if` step whose test is
 * the op `magic:is-format` needs no new field; the validator rejects an unknown format (bad-param) and a
 * test that is not a predicate (not-predicate); the generated FL view of such a recipe round-trips.
 */
import { loadBundleNode } from "@forge/ops/node";
import { compileRecipe, parseRecipeText, validateRecipe } from "@forge/recipe";
import type { CatalogueView } from "@forge/recipe";
import { gzipSync } from "fflate";
import { describe, expect, test } from "vitest";
import { catalogue } from "../test/helpers.js";
import { createInProcessBaker } from "./inprocess.js";

const view = catalogue as unknown as CatalogueView;
const enc = (s: string) => new TextEncoder().encode(s);
const hexOf = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

const branching = (test: unknown) => ({
  forge: 1,
  steps: [
    {
      kind: "if",
      test,
      then: [{ kind: "op", op: "text:upper" }],
      else: [{ kind: "op", op: "text:lower" }],
    },
  ],
});
const isGzip = { kind: "op", op: "magic:is-format", params: { format: "gzip" } };

describe("magic:is-format as the test of an if step", () => {
  test("runs then for gzip data and else for text", async () => {
    const baker = createInProcessBaker({ loadBundle: loadBundleNode });
    await baker.init();
    const recipe = {
      forge: 1,
      steps: [
        {
          kind: "if",
          test: isGzip,
          then: [{ kind: "op", op: "hex:encode", params: { case: "lower", delimiter: "none" } }],
          else: [{ kind: "op", op: "text:upper" }],
        },
      ],
    };
    const gz = gzipSync(enc("hello"));
    const zipped = await baker.bake(recipe, gz, { trust: "trusted" });
    if (!zipped.ok) throw new Error(`${zipped.error.code}: ${zipped.error.message}`);
    // then ran: the gzip bytes as hex, 1f8b first
    expect(zipped.output).toMatchObject({ text: hexOf(gz) });
    const plain = await baker.bake(recipe, enc("hello"), { trust: "trusted" });
    if (!plain.ok) throw new Error(`${plain.error.code}: ${plain.error.message}`);
    // else ran: the text in upper case
    expect(plain.output).toMatchObject({ text: "HELLO" });
    await baker.dispose();
  });
});

describe("validation of magic ops as tests", () => {
  test("a valid if on magic:is-format has no issues", () => {
    expect(validateRecipe(branching(isGzip), view, { pins: "ignore" }).issues).toEqual([]);
  });

  test("an unknown format is bad-param", () => {
    const r = validateRecipe(
      branching({ kind: "op", op: "magic:is-format", params: { format: "no-such-format" } }),
      view,
      { pins: "ignore" },
    );
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.code)).toEqual(["bad-param"]);
  });

  test("magic:identify as a test is not-predicate", () => {
    const r = validateRecipe(branching({ kind: "op", op: "magic:identify" }), view, {
      pins: "ignore",
    });
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.code)).toEqual(["not-predicate"]);
  });
});

describe("the generated FL view", () => {
  test("round-trips through the text and back", () => {
    const checked = validateRecipe(branching(isGzip), view, { pins: "ignore" });
    if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
    const out = compileRecipe(checked.recipe, view, { pins: "ignore" });
    if (!out.ok) throw new Error(JSON.stringify(out.issues));
    expect(out.text).toContain("magic:is-format");
    const parsed = parseRecipeText(out.text, view);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const again = compileRecipe(parsed.recipe, view, { pins: "ignore" });
    if (!again.ok) throw new Error(JSON.stringify(again.issues));
    expect(again.text).toBe(out.text);
  });
});
