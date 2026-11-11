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
 * `npm run dupes -w @forge/ops`: prints the exact and near duplicate helpers across the
 * vocabularies (see src/dupes.ts for the rules). Always exits 0; `src/dupes.test.ts` is what fails
 * on an exact duplicate. Runs against the compiled package (`../dist`).
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extractDefinitions, findDuplicates, formatReport, primitiveSet } from "../dist/dupes.js";
import { createNodeProvider } from "../dist/sources-node.js";

const here = fileURLToPath(import.meta.url).replaceAll("\\", "/");
const root = here.slice(0, here.lastIndexOf("/", here.lastIndexOf("/") - 1));

const files = readdirSync(`${root}/vocab`)
  .filter((name) => name.endsWith(".fth"))
  .sort()
  .map((name) => ({ name, text: readFileSync(`${root}/vocab/${name}`, "utf8") }));
// The primitives (TypeScript, in dist/prims), so that calls to them keep their vocabulary.
const prims = await primitiveSet(createNodeProvider(root).primitiveLoaders());
const defs = extractDefinitions(files, prims);
process.stdout.write(`${defs.length} definitions in ${files.length} vocabularies\n\n`);
process.stdout.write(`${formatReport(findDuplicates(defs))}\n`);
