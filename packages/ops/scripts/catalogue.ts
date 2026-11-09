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
 * Build script (RECIPES.md section 2.6): loads every bundled vocabulary, derives the catalogue from the
 * loaded runtime, validates it against the schema and writes `dist/catalogue.json` and a copy of
 * `catalogue.schema.json`. Any failure (a scan error, a `.fth` that does not compile, a schema
 * violation) fails the build with a message that names the file.
 *
 * Runs against the compiled package (`../dist`), so `tsc -p tsconfig.build.json` runs first.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WORD_META_SCHEMA } from "@forge/lang";
import Ajv2020 from "ajv/dist/2020.js";
import { assembleRuntime } from "../dist/bundle.js";
import { buildCatalogue } from "../dist/catalogue.js";
import { loadBundleNode } from "../dist/sources-node.js";

const here = fileURLToPath(import.meta.url).replaceAll("\\", "/");
const root = here.slice(0, here.lastIndexOf("/", here.lastIndexOf("/") - 1));
const schemaText = readFileSync(`${root}/src/catalogue.schema.json`, "utf8");

async function main(): Promise<void> {
  const runtime = assembleRuntime(await loadBundleNode("all"));
  const catalogue = buildCatalogue(runtime, {
    warn: (message) => process.stderr.write(`${message}\n`),
  });

  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addSchema(WORD_META_SCHEMA);
  const validate = ajv.compile(JSON.parse(schemaText) as object);
  if (!validate(catalogue)) {
    throw new Error(`catalogue.schema.json: ${ajv.errorsText(validate.errors)}`);
  }

  mkdirSync(`${root}/dist`, { recursive: true });
  writeFileSync(`${root}/dist/catalogue.json`, JSON.stringify(catalogue, null, 2) + "\n");
  writeFileSync(`${root}/dist/catalogue.schema.json`, schemaText);
  process.stdout.write(
    `catalogue ${catalogue.version}: ${catalogue.ops.length} operations in ${catalogue.vocabs.length} vocabularies\n`,
  );
}

main().catch((e: unknown) => {
  process.stderr.write(`catalogue build failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});
