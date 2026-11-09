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

// The op test vectors of every vocabulary run through the in-process baker (RECIPES.md section 9.3).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBundleNode } from "@forge/ops/node";
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, test } from "vitest";
import { createInProcessBaker, runOpVectors } from "../src/index.js";
import type { OpTestVector } from "../src/index.js";
import { catalogue } from "./helpers.js";

const vocabDir = fileURLToPath(new URL("../../ops/vocab", import.meta.url).href);
const names = readdirSync(vocabDir)
  .filter((f) => f.endsWith(".test.json"))
  .sort();
const files: Record<string, OpTestVector[]> = {};
for (const name of names) {
  files[name] = JSON.parse(readFileSync(join(vocabDir, name), "utf8")) as OpTestVector[];
}
const schema = JSON.parse(readFileSync(join(vocabDir, "vectors.schema.json"), "utf8")) as object;
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

describe("op test vectors", () => {
  test("the files are valid, and each belongs to an existing vocabulary", () => {
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(validate(files[name]), `${name}: ${JSON.stringify(validate.errors)}`).toBe(true);
      const vocab = name.slice(0, -".test.json".length);
      expect(catalogue.vocabs, `${name} has no vocabulary`).toContain(vocab);
    }
  });

  test("every vector passes and every op is covered", { timeout: 60_000 }, async () => {
    const baker = createInProcessBaker({ loadBundle: loadBundleNode });
    const info = await baker.init({ vocabs: "all" });
    expect(info.catalogueVersion).toBe(catalogue.version);
    const report = await runOpVectors({ baker, catalogue, files });
    expect(report.failures.map((f) => f.message)).toEqual([]);
    expect(report.uncovered).toEqual([]);
    expect(report.passed).toBe(report.total);
    expect(report.total).toBeGreaterThan(50);
  });
});
