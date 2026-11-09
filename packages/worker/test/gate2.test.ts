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

// Gate 2, parts G2-1 to G2-3 (RECIPES.md section 10.3).
import { loadBundleNode } from "@forge/ops/node";
import {
  decodeShare,
  encodeShare,
  normaliseRecipe,
  pinRecipe,
  validateRecipe,
} from "@forge/recipe";
import type { Recipe } from "@forge/recipe";
import { createNodeWorkerHost } from "../src/host-node.js";
import { describe, expect, test } from "vitest";
import { createBakerClient, createInProcessBaker } from "../src/index.js";
import type { BakeResult } from "../src/index.js";
import {
  GATE2_FRAGMENT,
  GATE2_HEX,
  GATE2_RECIPE,
  GATE2_TEXT,
  catalogue,
  resultKey,
  utf8,
} from "./helpers.js";

const recipe = GATE2_RECIPE as unknown as Recipe;
const input = utf8(GATE2_TEXT);

describe("G2-1: build, encode, decode", () => {
  test("the recipe validates cleanly", () => {
    const v = validateRecipe(recipe, catalogue);
    expect(v.ok).toBe(true);
    expect(v.issues).toEqual([]);
  });

  test("encode then decode gives the pinned, normalised recipe", async () => {
    const enc = await encodeShare({ recipe, input, inputEncoding: "utf8" }, { catalogue });
    expect(enc.ok).toBe(true);
    if (!enc.ok) return;
    expect(enc.warnings.map((w) => w.code)).not.toContain("secret-in-url");
    const dec = await decodeShare(enc.fragment, { catalogue });
    expect(dec.ok).toBe(true);
    if (!dec.ok) return;
    expect(dec.recipe).toEqual(pinRecipe(normaliseRecipe(recipe), catalogue));
    expect(dec.input).toEqual(input);
    expect(dec.warnings).toEqual([]);
  });

  test("the golden fragment decodes to the normalised recipe", async () => {
    const dec = await decodeShare(GATE2_FRAGMENT, { catalogue });
    expect(dec.ok).toBe(true);
    if (!dec.ok) return;
    expect(dec.recipe).toEqual(normaliseRecipe(recipe));
    expect(dec.input).toEqual(input);
  });
});

async function decoded(): Promise<{ recipe: Recipe; input: Uint8Array }> {
  const enc = await encodeShare({ recipe, input, inputEncoding: "utf8" }, { catalogue });
  if (!enc.ok) throw new Error("encode failed");
  const dec = await decodeShare(enc.fragment, { catalogue });
  if (!dec.ok || dec.input === undefined) throw new Error("decode failed");
  return { recipe: dec.recipe, input: dec.input };
}

function expectGate2(result: BakeResult): void {
  expect(result).toMatchObject({
    ok: true,
    output: { kind: "str", text: GATE2_HEX },
    coercions: [],
    warnings: [],
  });
  expect(result.steps.map((s) => [s.path, s.runs])).toEqual([
    ["/steps/0", 1],
    ["/steps/1", 1],
    ["/steps/2", 1],
  ]);
}

describe("G2-2 and G2-3: in process and in a worker thread", () => {
  test("G2-2: the in-process baker", async () => {
    const d = await decoded();
    const baker = createInProcessBaker({ loadBundle: loadBundleNode });
    const info = await baker.init();
    expect(info.catalogueVersion).toBe(catalogue.version);
    expect(baker.hardKill).toBe(false);
    const result = await baker.bake(d.recipe, d.input, { trust: "trusted" });
    expectGate2(result);
    await baker.dispose();
  });

  test("G2-3: a worker_threads client gives an identical result", { timeout: 30_000 }, async () => {
    const d = await decoded();
    const local = createInProcessBaker({ loadBundle: loadBundleNode });
    await local.init();
    const expected = await local.bake(d.recipe, d.input, { trust: "trusted" });

    const client = createBakerClient({ host: () => createNodeWorkerHost() });
    try {
      expect(client.hardKill).toBe(true);
      const info = await client.init();
      expect(info.catalogueVersion).toBe(catalogue.version);
      const result = await client.bake(d.recipe, d.input, { trust: "untrusted" });
      expectGate2(result);
      expect(resultKey(result)).toBe(resultKey(expected));
      // The caller's input is untouched: the client transferred a copy.
      expect(d.input.length).toBe(GATE2_TEXT.length);
    } finally {
      await client.dispose();
    }
  });
});
