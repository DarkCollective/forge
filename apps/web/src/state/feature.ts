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
// How a work package plugs into the app (UI.md section 3.4). Each WP has one entry module,
// `src/<dir>/index.ts`, that registers its custom elements (by importing them) and exports a
// `feature`. The shell's `src/modules.ts` lists the entries; a WP never edits another WP's files.
import type { Actions, AppStore } from "./actions.js";

export interface AppContext {
  readonly store: AppStore;
  readonly actions: Actions;
}

export interface Feature {
  /** Short id for logs, e.g. "bake". */
  readonly name: string;
  /** Called once after the shell is in the DOM. May be async; a rejection is logged and does not stop other features. */
  start?(ctx: AppContext): void | Promise<void>;
}
