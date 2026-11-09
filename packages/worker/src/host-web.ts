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
 * A `WorkerHost` over a Web Worker (RECIPES.md section 8.1). The caller creates the Worker, so the
 * bundler sees the `?worker` import (section 8.7).
 */
import type { ClientMessage, CreateWebWorkerHostFn, WorkerMessage } from "./types.js";

export const createWebWorkerHost: CreateWebWorkerHostFn = (create) => {
  const worker = create();
  return {
    postMessage(message: ClientMessage, transfer?: ArrayBuffer[]): void {
      worker.postMessage(message, transfer ?? []);
    },
    onMessage(handler: (message: WorkerMessage) => void): void {
      worker.addEventListener("message", (event) => handler(event.data as WorkerMessage));
    },
    onError(handler: (error: { readonly message: string }) => void): void {
      worker.addEventListener("error", (event) =>
        handler({ message: event.message ?? "worker error" }),
      );
    },
    terminate(): void {
      worker.terminate();
    },
  };
};
