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
// Catalogue loading (UI.md section 3.5). The build-time catalogue is a static file next to the app;
// the console worker (WP 3.8) later publishes a richer one that includes user ops through the same
// `actions.setCatalogue`.
import catalogueUrl from "@forge/ops/catalogue.json?url";
import type { Catalogue } from "@forge/ops";
import type { Actions, AppStore } from "./state/actions.js";

export async function fetchCatalogue(url: string = catalogueUrl): Promise<Catalogue> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as Catalogue;
  if (data.format !== 1 || !Array.isArray(data.ops)) throw new Error("unexpected catalogue format");
  return data;
}

/**
 * Load the build-time catalogue. Ordering rule: a catalogue already published (by the console worker,
 * which includes `user:` ops) always wins, so a late fetch never overwrites it and a failed fetch
 * never replaces it with an error.
 */
export async function loadCatalogue(
  actions: Actions,
  store: AppStore,
  fetcher: () => Promise<Catalogue> = fetchCatalogue,
): Promise<void> {
  if (store.get().catalogue.status !== "ready") actions.setCatalogueLoading();
  try {
    const catalogue = await fetcher();
    if (store.get().catalogue.status !== "ready") actions.setCatalogue(catalogue);
  } catch (e) {
    if (store.get().catalogue.status !== "ready") {
      actions.setCatalogueError(e instanceof Error ? e.message : String(e));
    }
  }
}
