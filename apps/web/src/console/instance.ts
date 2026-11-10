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
// The application's one console controller, created on first use over the real worker.
import { createConsoleClient } from "../fl/console-client.js";
import { createWebConsoleTransport } from "../fl/web-worker.js";
import { actions, store } from "../state/app.js";
import { createConsoleController, type ConsoleController } from "./controller.js";

let instance: ConsoleController | undefined;

export function getConsoleController(): ConsoleController {
  if (instance === undefined) {
    const holder: { controller?: ConsoleController } = {};
    const client = createConsoleClient({
      createTransport: createWebConsoleTransport,
      onRestart: (result) => holder.controller?.restarted(result),
    });
    instance = holder.controller = createConsoleController({ client, store, actions });
  }
  return instance;
}
