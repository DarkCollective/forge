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
// Stand-alone page for checking `forge-param-form` in a production build (see vite.harness.config.ts).
// It loads the real catalogue and a three-step recipe whose steps render one form each.
import "../../styles/tokens.css";
import "../../styles/global.css";
import { fetchCatalogue } from "../../catalogue.js";
import { actions, store } from "../../state/app.js";
import "../index.js";

declare global {
  interface Window {
    forgeHarness: { store: typeof store; actions: typeof actions };
  }
}

async function main(): Promise<void> {
  actions.setCatalogue(await fetchCatalogue());
  actions.setRecipe({
    forge: 1,
    steps: [
      { kind: "op", op: "base64:encode" },
      { kind: "op", op: "classical:rot", params: { amount: "1e" } },
      { kind: "op", op: "regex:replace", params: { pattern: "(" } },
    ],
  } as never);
  window.forgeHarness = { store, actions };
  const host = document.getElementById("host") as HTMLElement;
  store.get().recipe.steps.forEach((_, i) => {
    const section = document.createElement("section");
    const h = document.createElement("h2");
    h.textContent = `Step ${i}`;
    const form = document.createElement("forge-param-form");
    form.path = `/steps/${i}`;
    section.append(h, form);
    host.append(section);
  });
}

void main();
