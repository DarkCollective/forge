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
// The list of work-package entries (UI.md section 3.4). Owned by the shell (WP 3.1): a WP adds its
// elements and its `feature` in its own `src/<dir>/index.ts`, never here. Order = start order.
import type { Feature } from "./state/feature.js";
import { feature as persist } from "./persist/index.js";
import { feature as ops } from "./ops/index.js";
import { feature as params } from "./params/index.js";
import { feature as recipe } from "./recipe/index.js";
import { feature as io } from "./io/index.js";
import { feature as bake } from "./bake/index.js";
import { feature as consolePane } from "./console/index.js";

// persist first: it loads favourites, options and user words before the bake controller reads them.
export const features: readonly Feature[] = [persist, ops, params, recipe, io, bake, consolePane];
