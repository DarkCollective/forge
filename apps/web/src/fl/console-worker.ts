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
// The console worker entry (UI.md section 5.2). Import it with `?worker`, never `?worker&inline`.
// All logic lives in console-core.ts; this file only connects it to `postMessage`.
import { loadBundleVite } from "@forge/ops/vite";
import { createConsoleCore } from "./console-core.js";
import { parseClientMessage, type WorkerMessage } from "./protocol.js";

const core = createConsoleCore({ loadBundle: loadBundleVite });
const post = (message: WorkerMessage): void => self.postMessage(message);

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = parseClientMessage(event.data);
  if (message === null) {
    post({ type: "fatal", message: "malformed message from the page" });
    return;
  }
  void core.handle(message, post);
});
