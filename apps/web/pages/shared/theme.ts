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
// The only script of the static pages (UI.md section 8): apply the theme the reader chose in the
// app, with the same logic the app uses. The pages work without it; they then follow the system.
import { applyTheme, loadThemePreference, resolveCurrent } from "../../src/state/theme.js";

const preference = loadThemePreference();

function apply(): void {
  applyTheme(resolveCurrent(preference));
}

apply();

// "system" follows the operating system, so the page must follow live changes too.
for (const query of ["(prefers-color-scheme: dark)", "(prefers-contrast: more)"]) {
  matchMedia(query).addEventListener("change", apply);
}
