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
 * `npm run coverage -w @forge/ops` (or `npm run coverage` at the root): validates docs/coverage/*.json
 * against its schema and the built catalogue (dist/catalogue.json), then writes docs/COVERAGE.md.
 * Exits 1 with a list of problems when the data is invalid (and writes nothing).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  catalogueWords,
  checkCoverage,
  loadCoverage,
  renderCoverage,
  summarize,
} from "./coverage-lib.js";

const here = fileURLToPath(import.meta.url).replaceAll("\\", "/");
const root = here.slice(0, here.lastIndexOf("/", here.lastIndexOf("/") - 1));
const docs = `${root}/../../docs`;

const catalogue = JSON.parse(readFileSync(`${root}/dist/catalogue.json`, "utf8")) as Parameters<
  typeof catalogueWords
>[0];
const { errors, reference, mappings } = checkCoverage(
  loadCoverage(`${docs}/coverage`),
  catalogueWords(catalogue),
);
if (errors.length > 0) {
  process.stderr.write(
    `coverage: ${errors.length} problem(s)\n${errors.map((e) => `  ${e}\n`).join("")}`,
  );
  process.exitCode = 1;
} else {
  writeFileSync(`${docs}/COVERAGE.md`, renderCoverage(reference, mappings));
  process.stdout.write(`coverage: ${summarize(reference, mappings)}\n`);
}
