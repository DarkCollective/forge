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

// @forge/ops main entry: no node:fs and no import.meta.glob. The loaders are `@forge/ops/node`
// and `@forge/ops/vite` (RECIPES.md R10, R24).
export type * from "./types.js";
export { CATALOGUE_FORMAT, INTERNAL_VOCABS, UI_PARAM_TYPES } from "./types.js";
export { scanVocab } from "./scan.js";
export { assembleRuntime, createBundleLoader } from "./bundle.js";
export { buildCatalogue, isCatalogueOp } from "./catalogue.js";
export { REGEX_LIMITS, execAll, isRegexPrimitive, markRegexPrimitive } from "./regex-engine.js";
