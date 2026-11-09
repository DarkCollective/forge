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
 * A `WorkerHost` over a `worker_threads` Worker (RECIPES.md section 8.1; entry `@forge/worker/node`).
 * It starts the compiled `worker-node.js`.
 */
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { ClientMessage, CreateNodeWorkerHostFn, WorkerMessage } from "./types.js";

/** Next to this module when compiled; in `../dist` when this file runs from `src/` (under Vitest). */
/* v8 ignore next 6 -- only one of the two paths exists in a given run */
const ENTRY = fileURLToPath(
  new URL(
    import.meta.url.endsWith(".ts") ? "../dist/worker-node.js" : "./worker-node.js",
    import.meta.url,
  ).href,
);

export const createNodeWorkerHost: CreateNodeWorkerHostFn = (options = {}) => {
  const worker = new Worker(ENTRY, {
    workerData: { extraPrimitiveModules: options.extraPrimitiveModules ?? [] },
  });
  let terminated = false;
  return {
    postMessage(message: ClientMessage, transfer?: ArrayBuffer[]): void {
      worker.postMessage(message, transfer);
    },
    onMessage(handler: (message: WorkerMessage) => void): void {
      worker.on("message", (value) => handler(value as WorkerMessage));
    },
    onError(handler: (error: { readonly message: string }) => void): void {
      worker.on("error", (error) => handler({ message: error.message }));
      worker.on("exit", (code) => {
        if (!terminated) handler({ message: `the worker exited with code ${String(code)}` });
      });
    },
    terminate(): void {
      terminated = true;
      void worker.terminate();
    },
  };
};
