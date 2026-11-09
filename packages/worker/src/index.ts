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

// @forge/worker main entry (RECIPES.md section 11.5). Nothing here touches Node or the DOM: the
// worker_threads host is `@forge/worker/node`, the Web Worker entry `@forge/worker/worker-web`.
export type * from "./types.js";
export {
  PROGRESS_INTERVAL_MS,
  PROTOCOL_VERSION,
  RENDER_LIMITS,
  UNTRUSTED_LIMITS,
  WATCHDOG_DEFAULTS,
} from "./types.js";
export { effectiveLimits } from "./limits.js";
export { createBakerCore } from "./core.js";
export { createInProcessBaker } from "./inprocess.js";
export { attachBakerCore } from "./port.js";
export { createBakerClient } from "./client.js";
export { createWebWorkerHost } from "./host-web.js";
export { outputToJson, renderValue, stripTimings } from "./render.js";
export { isClientMessage, isWorkerMessage } from "./protocol.js";
export { runOpVectors } from "./vectors.js";
