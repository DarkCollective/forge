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
// Vite wiring of the generated reference pages (UI.md section 8.2): reads the catalogue and the help
// document of @forge/ops, builds every page with src/pages/build.ts, and either writes them into the
// build output or serves them from memory in `vite dev`. All the logic is in the pure modules under
// src/pages/ (unit tested); this file only does the file and server plumbing.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import type { Catalogue, HelpDoc } from "@forge/ops";
import { addToSitemap, buildReferencePages } from "./src/pages/build.js";
import type { ReferencePage } from "./src/pages/build.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const requireFromHere = createRequire(import.meta.url);

/** The built template page: dist/pages/ops/template/index.html (before the pages directory is removed). */
export const TEMPLATE_BUILT = join("pages", "ops", "template", "index.html");
/** The template page's source, relative to apps/web (a Vite entry, so the build hashes its assets). */
export const TEMPLATE_SOURCE = "pages/ops/template/index.html";

function readOps<T>(specifier: string): T {
  let file: string;
  try {
    file = requireFromHere.resolve(specifier);
  } catch {
    throw new Error(
      `reference pages: cannot find ${specifier}; run "npm run build -w @forge/ops" first`,
    );
  }
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

/** Builds the pages for a template. */
export function generate(template: string): Promise<ReferencePage[]> {
  const catalogue = readOps<Catalogue>("@forge/ops/catalogue.json");
  const help = readOps<HelpDoc>("@forge/ops/help.json");
  if (help.catalogue !== catalogue.version) {
    throw new Error(
      `reference pages: help.json was built for catalogue ${help.catalogue}, catalogue.json is ${catalogue.version}; rebuild @forge/ops`,
    );
  }
  return buildReferencePages(catalogue, help, template);
}

/**
 * Build: after the bundle is written, fill the built template for every page, write them under
 * dist/ops/, add them to dist/sitemap.xml and remove the template. Called by the flatten plugin before
 * it removes dist/pages (closeBundle hooks may run in parallel, so the order is made explicit there).
 */
export async function writeReferencePages(outDir: string): Promise<void> {
  const started = performance.now();
  const templateFile = join(outDir, TEMPLATE_BUILT);
  const template = readFileSync(templateFile, "utf8");
  const pages = await generate(template);
  rmSync(join(outDir, "ops"), { recursive: true, force: true });
  let bytes = 0;
  for (const page of pages) {
    const file = join(outDir, page.file);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, page.html);
    bytes += Buffer.byteLength(page.html);
  }
  const sitemapFile = join(outDir, "sitemap.xml");
  writeFileSync(sitemapFile, addToSitemap(readFileSync(sitemapFile, "utf8"), pages));
  rmSync(templateFile, { force: true });
  const ms = Math.round(performance.now() - started);
  console.log(`reference pages: ${pages.length} pages, ${(bytes / 1024).toFixed(0)} KiB, ${ms} ms`);
}

/** Dev: /ops/... is answered from memory with the Vite dev head (source CSS and the theme module). */
export function referencePagesDev(): Plugin {
  let pages: Promise<Map<string, ReferencePage>> | null = null;
  return {
    name: "forge-reference-pages-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!url.pathname.startsWith("/ops/")) return next();
        pages ??= generate(readFileSync(join(here, TEMPLATE_SOURCE), "utf8")).then(
          (list) => new Map(list.map((p) => [p.path, p])),
        );
        const normalised = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
        pages
          .then(async (map) => {
            const page = map.get(normalised);
            if (page === undefined) return next();
            const html = await server.transformIndexHtml(url.pathname, page.html);
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.end(html);
          })
          .catch((error: unknown) => {
            pages = null;
            next(error);
          });
      });
    },
  };
}
