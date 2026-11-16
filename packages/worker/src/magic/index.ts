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

// `@forge/worker/magic`: the Magic engine (PLAN.md WP 6.29). Not part of the main entry, so the page only loads it
// when the Magic button is used.
export { magic } from "./search.js";
export { MAGIC_LIMITS, MAGIC_OUTPUT_KEEP, MAGIC_RUN_LIMITS } from "./types.js";
export type {
  MagicCandidate,
  MagicOp,
  MagicOptions,
  MagicProgress,
  MagicResult,
  MagicRunLimits,
  MagicStop,
} from "./types.js";
export { ENTROPY_FULL_DROP, MAGIC_WEIGHTS, MIN_GAIN, MIN_RESULT_GAIN } from "./score.js";
