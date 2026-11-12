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
// The app's help loader: the one place that names the lazy chunk. Importing this module costs nothing;
// `@forge/ops/help.json` is fetched only when `load` is first called (UI.md section 7, bundle budget).
import { fetchCatalogue } from "../catalogue.js";
import { createHelpLoader } from "./help-data.js";

export const helpLoader = createHelpLoader({
  loadDoc: async () => (await import("@forge/ops/help.json")).default,
  bundledVersion: async () => (await fetchCatalogue()).version,
});
