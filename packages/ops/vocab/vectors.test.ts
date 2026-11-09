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
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, test } from "vitest";

// Structural check only: this test validates every vocabulary's vector file against
// vectors.schema.json. The vector runner (WP 2.5, packages/worker) runs the ops.
const here = dirname(fileURLToPath(import.meta.url));
const schema: unknown = JSON.parse(readFileSync(join(here, "vectors.schema.json"), "utf8"));
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema as object);
const vectorFiles = readdirSync(here)
  .filter((f) => f.endsWith(".test.json"))
  .sort();

describe("operation test vector files", () => {
  test("at least one vector file exists", () => {
    expect(vectorFiles.length).toBeGreaterThan(0);
  });

  for (const file of vectorFiles) {
    const vocab = file.slice(0, -".test.json".length);

    test(`${file} validates against vectors.schema.json`, () => {
      const data: unknown = JSON.parse(readFileSync(join(here, file), "utf8"));
      const ok = validate(data);
      expect(validate.errors ?? []).toEqual([]);
      expect(ok).toBe(true);
    });

    test(`${file} holds only vectors of the vocabulary "${vocab}"`, () => {
      const data = JSON.parse(readFileSync(join(here, file), "utf8")) as { op: string }[];
      const wrong = data.filter((v) => v.op.split(":")[0] !== vocab).map((v) => v.op);
      expect(wrong).toEqual([]);
    });
  }
});
