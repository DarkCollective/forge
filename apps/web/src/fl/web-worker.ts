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
// The browser connection of the console client: a separate module worker file from our own origin
// (`?worker`, never `?worker&inline`: UI.md section 4 rule 4). Kept apart so tests never import it.
import ConsoleWorker from "./console-worker.ts?worker";
import type { ConsoleTransport } from "./console-client.js";

export function createWebConsoleTransport(): ConsoleTransport {
  const worker = new ConsoleWorker();
  return {
    post: (message) => worker.postMessage(message),
    onMessage: (handler) => worker.addEventListener("message", (e) => handler(e.data)),
    onFailure: (handler) => {
      worker.addEventListener("error", (e) => handler(e.message || "the console worker crashed"));
      worker.addEventListener("messageerror", () =>
        handler("the console worker sent an unreadable message"),
      );
    },
    terminate: () => worker.terminate(),
  };
}
