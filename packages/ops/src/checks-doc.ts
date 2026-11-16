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
 * The checks document (LANGUAGE.md section 5.9): the `checks` and `expects` clauses of every op of
 * the catalogue, keyed by qname. Pure. The clauses are validated by `@forge/lang` when a word is
 * compiled, so nothing is re-validated here; the build script checks the result against
 * `checks.schema.json`. Nothing here reaches `CatalogueOp`, the catalogue `version` or a word hash.
 */
import { cpCompare, sha256 } from "@forge/lang";
import type { ForgeRuntime } from "@forge/lang";
import { buildCatalogue } from "./catalogue.js";
import { CHECKS_FORMAT } from "./types.js";
import type { BuildChecksFn, Catalogue, ChecksDoc, ChecksOp } from "./types.js";

export const buildChecks: BuildChecksFn = (
  runtime: ForgeRuntime,
  catalogue: Catalogue,
): ChecksDoc => {
  if (buildCatalogue(runtime, { warn: () => undefined }).version !== catalogue.version) {
    throw new Error("the catalogue was not built from this runtime");
  }
  const found: [string, ChecksOp][] = [];
  for (const { qname } of catalogue.ops) {
    const discovery = runtime.meta(qname).discovery;
    const checks = discovery?.checks ?? [];
    const expects = discovery?.expects ?? null;
    if (checks.length === 0 && expects === null) continue;
    found.push([qname, { expects, checks }]);
  }
  found.sort((a, b) => cpCompare(a[0], b[0]));
  const ops = Object.fromEntries(found);
  return {
    format: CHECKS_FORMAT,
    catalogue: catalogue.version,
    version: sha256(JSON.stringify(ops)).slice(0, 16),
    ops,
  };
};
