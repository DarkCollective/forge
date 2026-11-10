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
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { pageInputs } from "./vite.pages.js";

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

const ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

// Production rules that shape this file (UI.md section 4): no inline scripts or styles, workers are
// separate files (`?worker`, never `?worker&inline`), everything comes from our own origin.
export default defineConfig({
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: {
        main: here("./index.html"),
        ...Object.fromEntries(Object.entries(pageInputs).map(([name, file]) => [name, here(file)])),
      },
    },
  },
  // Primitive modules are lazy chunks, which a module worker can only load as ES modules.
  worker: { format: "es" },
  // The same isolation headers as production, so SharedArrayBuffer cancellation works in `npm run dev`.
  server: { headers: ISOLATION_HEADERS },
  preview: { headers: ISOLATION_HEADERS },
});
