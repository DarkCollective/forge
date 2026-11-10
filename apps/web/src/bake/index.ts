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
import { decodeShare, encodeShare } from "@forge/recipe";
import type { Feature } from "../state/feature.js";
import { createBakeController } from "./controller.js";
import { shortcutAction } from "./format.js";
import { setBakeController } from "./service.js";
import { createUrlSync } from "./url-sync.js";
import { createWebBaker } from "./web-baker.js";
import "./forge-bake-controls.js";
import "./forge-share-dialog.js";

function inTextField(event: KeyboardEvent): boolean {
  const target = event.composedPath()[0];
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLInputElement && !["checkbox", "radio", "button"].includes(target.type))
  );
}

/**
 * Entry of the "bake" work package: import its elements, export its `feature`.
 * Start order matters: the URL sync loads a `#` link before the first auto-bake runs, so the
 * controller starts after it.
 */
export const feature: Feature = {
  name: "bake",
  async start({ store, actions }) {
    const urlSync = createUrlSync({
      store,
      actions,
      env: window,
      encode: encodeShare,
      decode: decodeShare,
    });
    urlSync.start();
    const controller = createBakeController({ store, actions, createBaker: createWebBaker });
    setBakeController(controller);
    window.addEventListener("keydown", (event) => {
      const action = shortcutAction(
        event.key,
        store.get().bake.status === "paused",
        inTextField(event),
      );
      if (action === null) return;
      event.preventDefault();
      if (action === "step") controller.step();
      else controller.continue();
    });
    await controller.start();
  },
};
