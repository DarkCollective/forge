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
 * The `worker_threads` entry (RECIPES.md section 8.1).
 */
import { loadBundleNode } from "@forge/ops/node";
import { parentPort, workerData } from "node:worker_threads";
import { createBakerCore } from "./core.js";
import { withPrimitiveModules } from "./extra.js";
import { attachBakerCore } from "./port.js";
import type { ClientMessage } from "./types.js";

const port = parentPort;
if (port === null) throw new Error("worker-node.js must run in a worker thread");
const extra = (workerData as { extraPrimitiveModules?: string[] } | null)?.extraPrimitiveModules;

attachBakerCore(
  {
    postMessage: (message, transfer) => port.postMessage(message, transfer),
    onMessage: (h) => port.on("message", (value) => h(value as ClientMessage)),
  },
  createBakerCore({
    loadBundle: withPrimitiveModules(loadBundleNode, extra ?? []),
    hardKill: true,
  }),
);
