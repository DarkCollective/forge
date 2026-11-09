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

/*
 * The in-process baker (RECIPES.md section 8.1): the core itself, for tests, the CLI and trusted use.
 * It cancels through an AbortController only (hardKill is false).
 */
import { createBakerCore } from "./core.js";
import type { CreateInProcessBakerFn } from "./types.js";

export const createInProcessBaker: CreateInProcessBakerFn = (options) =>
  createBakerCore({ loadBundle: options.loadBundle });
