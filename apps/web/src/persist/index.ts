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
import type { Feature } from "../state/feature.js";
import "./forge-save-dialog.js";
import "./forge-open-dialog.js";
import { getServices, STORAGE_UNAVAILABLE_MESSAGE } from "./services.js";
import { loadIntoStore, startWriteBack } from "./sync.js";

/**
 * Entry of the "persist" work package. Starts first: loads favourites, options and the user words
 * into the store, then writes changes back (debounced). Without IndexedDB it works in memory and
 * says so once.
 */
export const feature: Feature = {
  name: "persist",
  async start({ store, actions }) {
    const services = await getServices();
    if (services.unavailable !== null) {
      console.warn(`persist: IndexedDB unavailable: ${services.unavailable}`);
      actions.announce(STORAGE_UNAVAILABLE_MESSAGE);
    }
    const problems = await loadIntoStore(services.db, actions);
    for (const p of problems) console.warn(`persist: could not read ${p}`);

    let reported = false;
    const writer = startWriteBack(store, services.db, (message) => {
      console.warn(`persist: could not write: ${message}`);
      if (!reported) {
        reported = true;
        actions.announce("Your changes could not be saved to browser storage.");
      }
    });
    // A tab that is closing or hidden must not lose the last 300 ms of changes.
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") void writer.flush();
      });
      window.addEventListener("pagehide", () => void writer.flush());
    }
  },
};
