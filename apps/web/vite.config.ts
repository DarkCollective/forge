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
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { pageInputs, referenceTemplateInput } from "./vite.pages.js";
import { referencePagesDev, writeReferencePages } from "./vite.reference.js";

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

// Vite writes an HTML entry at its path relative to the root, so the static pages land in
// dist/pages/<name>/index.html. CloudFront needs them at the root: dist/<name>/index.html, and
// dist/404.html for the error response. This moves them after the bundle is written. Their asset
// URLs are already absolute (/assets/...), so they keep working from any depth. It then writes the
// generated operation pages (vite.reference.ts) from the built template, which it removes with dist/pages.
// Dev: the pages are at /pages/<name>/ (e.g. http://localhost:5173/pages/about/); /404.html is
// only served by CloudFront and by `vite preview` of the built dist.
function flattenPages(outDir: string): Plugin {
  return {
    name: "forge-flatten-pages",
    apply: "build",
    async closeBundle() {
      const pagesDir = join(outDir, "pages");
      if (!existsSync(pagesDir)) return;
      for (const name of Object.keys(pageInputs)) {
        const from = join(pagesDir, name === "notFound" ? "404" : name, "index.html");
        const to =
          name === "notFound" ? join(outDir, "404.html") : join(outDir, name, "index.html");
        mkdirSync(dirname(to), { recursive: true });
        renameSync(from, to);
      }
      // The reference pages are written from the built template before dist/pages goes away.
      await writeReferencePages(outDir);
      rmSync(pagesDir, { recursive: true, force: true });
    },
  };
}

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
        ...Object.fromEntries(
          Object.entries({ ...pageInputs, ...referenceTemplateInput }).map(([name, file]) => [
            name,
            here(file),
          ]),
        ),
      },
    },
  },
  // Primitive modules are lazy chunks, which a module worker can only load as ES modules.
  worker: { format: "es" },
  plugins: [flattenPages(here("./dist")), referencePagesDev()],
  // The same isolation headers as production, so SharedArrayBuffer cancellation works in `npm run dev`.
  server: { headers: ISOLATION_HEADERS },
  preview: { headers: ISOLATION_HEADERS },
});
