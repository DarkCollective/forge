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
// The app's checks loader: the one place that names the lazy chunks. Importing this module costs nothing;
// `@forge/ops/checks.json` and `@forge/ops/checks` (the evaluator, with the file signature table) are
// fetched only when `load` is first called, after start-up (UI.md section 2.3, bundle budget).
import { fetchCatalogue } from "../catalogue.js";
import { createChecksLoader, makeEvaluator } from "./checks-data.js";

export const checksLoader = createChecksLoader({
  loadDoc: async () => (await import("@forge/ops/checks.json")).default,
  loadEvaluator: async () => makeEvaluator(await import("@forge/ops/checks")),
  bundledVersion: async () => (await fetchCatalogue()).version,
});
