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
 * The Web Worker entry (RECIPES.md section 8.1). Import it with Vite's `?worker`, never `?worker&inline`.
 */
import { loadBundleVite } from "@forge/ops/vite";
import { createBakerCore } from "./core.js";
import { attachBakerCore } from "./port.js";
import type { ClientMessage } from "./types.js";

let handler: ((message: ClientMessage) => void) | undefined;

attachBakerCore(
  {
    postMessage: (message, transfer) => self.postMessage(message, transfer),
    onMessage: (h) => {
      handler = h;
    },
  },
  createBakerCore({ loadBundle: loadBundleVite, hardKill: true }),
);

self.addEventListener("message", (event) => handler?.(event.data as ClientMessage));
