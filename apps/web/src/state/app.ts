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
// The application singleton. Components import `store` and `actions` from here; tests build their own
// with createAppStore() / createActions().
import { createActions, createAppStore } from "./actions.js";

export const store = createAppStore();
export const actions = createActions(store);

export { createActions, createAppStore };
export type { Actions, AppStore } from "./actions.js";
