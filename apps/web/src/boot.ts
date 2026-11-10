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
// Start-up (UI.md section 3.4): theme, shell, catalogue, then every feature's `start`.
import { loadCatalogue } from "./catalogue.js";
import { features } from "./modules.js";
import { actions, store } from "./state/app.js";
import { applyTheme, resolveCurrent } from "./state/theme.js";
import "./shell/forge-app.js";

/** Keep `<html data-theme>` in step with the preference and the system settings. */
export function watchTheme(): void {
  const apply = (): void => {
    const resolved = resolveCurrent(store.get().settings.theme);
    applyTheme(resolved);
    actions.setResolvedTheme(resolved);
  };
  store.select((s) => s.settings.theme, apply, { immediate: true });
  for (const query of ["(prefers-color-scheme: dark)", "(prefers-contrast: more)"]) {
    matchMedia(query).addEventListener("change", apply);
  }
}

export async function boot(): Promise<void> {
  watchTheme();
  const ctx = { store, actions };
  const catalogue = loadCatalogue(actions);
  await Promise.all(
    features.map(async (feature) => {
      try {
        await feature.start?.(ctx);
      } catch (e) {
        console.error(`feature "${feature.name}" failed to start`, e);
      }
    }),
  );
  await catalogue;
}
