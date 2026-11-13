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
 * Build script for the checks document (LANGUAGE.md section 5.9): loads every bundled vocabulary,
 * builds the catalogue, runs `buildChecks`, validates the result against `checks.schema.json`,
 * checks the size budget and writes `dist/checks.json` and a copy of `checks.schema.json`.
 * `dist/catalogue.json` and `dist/help.json` are not touched.
 *
 * Runs against the compiled package (`../dist`), so `tsc -p tsconfig.build.json` runs first.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WORD_META_SCHEMA } from "@forge/lang";
import Ajv2020 from "ajv/dist/2020.js";
import { assembleRuntime } from "../dist/bundle.js";
import { buildCatalogue } from "../dist/catalogue.js";
import { buildChecks } from "../dist/checks-doc.js";
import { loadBundleNode } from "../dist/sources-node.js";
import { CHECKS_MAX_BYTES } from "../dist/types.js";

// The package builds without DOM or Node typings (see ambient.d.ts); this is the one global used.
declare const TextEncoder: new () => { encode(text: string): { readonly length: number } };

const here = fileURLToPath(import.meta.url).replaceAll("\\", "/");
const root = here.slice(0, here.lastIndexOf("/", here.lastIndexOf("/") - 1));
const schemaText = readFileSync(`${root}/src/checks.schema.json`, "utf8");

async function main(): Promise<void> {
  const runtime = assembleRuntime(await loadBundleNode("all"));
  const catalogue = buildCatalogue(runtime, { warn: (m) => process.stderr.write(`${m}\n`) });
  const checks = buildChecks(runtime, catalogue);

  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addSchema(WORD_META_SCHEMA);
  const validate = ajv.compile(JSON.parse(schemaText) as object);
  if (!validate(checks)) throw new Error(`checks.schema.json: ${ajv.errorsText(validate.errors)}`);

  const text = JSON.stringify(checks, null, 2) + "\n";
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > CHECKS_MAX_BYTES) {
    throw new Error(`checks.json is ${bytes} bytes, over the budget of ${CHECKS_MAX_BYTES}`);
  }
  mkdirSync(`${root}/dist`, { recursive: true });
  writeFileSync(`${root}/dist/checks.json`, text);
  writeFileSync(`${root}/dist/checks.schema.json`, schemaText);
  process.stdout.write(
    `checks ${checks.version}: ${Object.keys(checks.ops).length} operations with checks, ${bytes} bytes\n`,
  );
}

main().catch((e: unknown) => {
  process.stderr.write(`checks build failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});
