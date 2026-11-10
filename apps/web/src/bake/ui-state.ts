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
// State that belongs to the bake package only (the shared AppState has no field for it): the debug
// switches of the controls and the notice about a share link that could not be loaded cleanly.
import { createStore } from "../state/store.js";
import type { Store } from "../state/store.js";

/** Why a `#` link was not applied cleanly. Shown in the status bar and in the share dialog. */
export interface LinkNotice {
  readonly severity: "error" | "warning";
  /** One line, plain text. */
  readonly summary: string;
  /** Further lines (issues, warnings), plain text. */
  readonly details: readonly string[];
}

export interface BakeUiState {
  /** Debug mode: bakes run with `debug` so breakpoints pause them. */
  readonly debug: boolean;
  /** In debug mode, also pause before the first step. */
  readonly startPaused: boolean;
  readonly notice: LinkNotice | null;
}

export type BakeUiStore = Store<BakeUiState>;

export function createBakeUiStore(): BakeUiStore {
  return createStore<BakeUiState>({ debug: false, startPaused: false, notice: null });
}

export const bakeUi: BakeUiStore = createBakeUiStore();
