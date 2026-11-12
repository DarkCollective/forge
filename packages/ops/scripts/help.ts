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
 * Build script for the help document (LANGUAGE-0.2.md section 7): loads every bundled vocabulary,
 * builds the catalogue, reads `vocab/*.test.json`, runs `buildHelp`, validates the result against
 * `help.schema.json`, checks the size budget and writes `dist/help.json` and a copy of
 * `help.schema.json`. `dist/catalogue.json` is not touched.
 *
 * Runs against the compiled package (`../dist`), so `tsc -p tsconfig.build.json` runs first.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WORD_META_SCHEMA } from "@forge/lang";
import Ajv2020 from "ajv/dist/2020.js";
import { assembleRuntime } from "../dist/bundle.js";
import { buildCatalogue } from "../dist/catalogue.js";
import { buildHelp } from "../dist/help.js";
import { loadBundleNode } from "../dist/sources-node.js";
import { HELP_MAX_BYTES } from "../dist/types.js";

// The package builds without DOM or Node typings (see ambient.d.ts); this is the one global used.
declare const TextEncoder: new () => { encode(text: string): { readonly length: number } };

const here = fileURLToPath(import.meta.url).replaceAll("\\", "/");
const root = here.slice(0, here.lastIndexOf("/", here.lastIndexOf("/") - 1));
const schemaText = readFileSync(`${root}/src/help.schema.json`, "utf8");

async function main(): Promise<void> {
  const runtime = assembleRuntime(await loadBundleNode("all"));
  const catalogue = buildCatalogue(runtime, { warn: (m) => process.stderr.write(`${m}\n`) });
  const vectorFiles = readdirSync(`${root}/vocab`)
    .filter((f) => f.endsWith(".test.json"))
    .sort()
    .map((f) => ({
      vocab: f.slice(0, -".test.json".length),
      vectors: JSON.parse(readFileSync(`${root}/vocab/${f}`, "utf8")) as unknown[],
    }));
  const help = buildHelp(runtime, catalogue, vectorFiles);

  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addSchema(WORD_META_SCHEMA);
  const validate = ajv.compile(JSON.parse(schemaText) as object);
  if (!validate(help)) throw new Error(`help.schema.json: ${ajv.errorsText(validate.errors)}`);

  const text = JSON.stringify(help, null, 2) + "\n";
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > HELP_MAX_BYTES) {
    throw new Error(`help.json is ${bytes} bytes, over the budget of ${HELP_MAX_BYTES}`);
  }
  mkdirSync(`${root}/dist`, { recursive: true });
  writeFileSync(`${root}/dist/help.json`, text);
  writeFileSync(`${root}/dist/help.schema.json`, schemaText);
  process.stdout.write(
    `help ${help.version}: ${help.ops.length} operations with help, ${bytes} bytes\n`,
  );
}

main().catch((e: unknown) => {
  process.stderr.write(`help build failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});
