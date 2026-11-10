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
// The shared storage handles of the persist feature: one database, one `RecipeStore`. Opened lazily
// and once; the feature entry and both dialogs await the same promise.
import { openDatabase } from "./db.js";
import type { Database } from "./db.js";
import { createRecipeStore } from "./recipe-store.js";
import type { RecipeStore } from "./recipe-store.js";

export interface PersistServices {
  readonly db: Database;
  readonly recipes: RecipeStore;
  /** Why IndexedDB is not in use (data is kept in memory only), or null. */
  readonly unavailable: string | null;
}

let pending: Promise<PersistServices> | null = null;

export function getServices(): Promise<PersistServices> {
  pending ??= openDatabase().then(({ db, unavailable }) => ({
    db,
    recipes: createRecipeStore(db),
    unavailable,
  }));
  return pending;
}

export const STORAGE_UNAVAILABLE_MESSAGE =
  "Browser storage is unavailable (a private window, perhaps), so saved recipes, favourites and your words will be lost when you close this tab.";
