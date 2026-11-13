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
// Builds every reference page from the catalogue and the help document (UI.md section 8.2). Pure apart
// from the share encoding (async, no I/O): the Vite plugin (vite.reference.ts) reads the inputs and writes
// the result. Same input, same bytes: nothing here reads the clock, the environment or a random source.
import { encodeShare } from "@forge/recipe";
import type { Catalogue, HelpDoc } from "@forge/ops";
import { planTryIt } from "../ops/try-it.js";
import { SITE_ORIGIN, renderIndexPage, renderOpPage } from "./render.js";
import type { PageParts, RenderData } from "./render.js";
import { escapeText } from "./html.js";
import { INDEX_PATH, assertUniquePaths, fileOfPath, opPath } from "./slug.js";

/** The markers a template (pages/ops/template/index.html) holds exactly once each. */
export const HEAD_MARKER = "<!--forge:head-->";
export const BODY_MARKER = "<!--forge:body-->";

export interface ReferencePage {
  /** URL path, with leading and trailing slash: /ops/ or /ops/<vocab>/<name>/. */
  readonly path: string;
  /** File inside the output directory: ops/index.html or ops/<vocab>/<name>/index.html. */
  readonly file: string;
  readonly html: string;
}

function once(template: string, marker: string): number {
  const first = template.indexOf(marker);
  if (first < 0 || template.indexOf(marker, first + 1) >= 0) {
    throw new Error(`reference pages: the template must contain ${marker} exactly once`);
  }
  return first;
}

/** Puts a page into the template. Plain slicing, so $ sequences in the page are never interpreted. */
export function fillTemplate(template: string, parts: PageParts): string {
  const head = once(template, HEAD_MARKER);
  const body = once(template, BODY_MARKER);
  if (head > body)
    throw new Error("reference pages: the head marker must come before the body marker");
  const meta = [
    `<title>${escapeText(parts.title)}</title>`,
    `<meta name="description" content="${escapeText(parts.description)}" />`,
    `<link rel="canonical" href="${escapeText(parts.canonical)}" />`,
  ].join("\n    ");
  return (
    template.slice(0, head) +
    meta +
    template.slice(head + HEAD_MARKER.length, body) +
    parts.body.toString() +
    template.slice(body + BODY_MARKER.length)
  );
}

/** The share fragments of every example of every op, built with the app's own encoder. */
export async function buildShares(
  catalogue: Catalogue,
  help: HelpDoc,
): Promise<Map<string, (string | null)[]>> {
  const shares = new Map<string, (string | null)[]>();
  for (const entry of help.ops) {
    const out: (string | null)[] = [];
    for (const ex of entry.examples) {
      const plan = planTryIt(entry.qname, ex);
      if (!plan.ok) {
        out.push(null);
        continue;
      }
      const result = await encodeShare(
        { recipe: plan.recipe, input: plan.bytes, inputEncoding: plan.encoding },
        { catalogue },
      );
      out.push(result.ok ? result.fragment : null);
    }
    shares.set(entry.qname, out);
  }
  return shares;
}

/** All pages: the index first, then one per operation in catalogue order. */
export async function buildReferencePages(
  catalogue: Catalogue,
  help: HelpDoc,
  template: string,
): Promise<ReferencePage[]> {
  assertUniquePaths(catalogue);
  const data: RenderData = {
    catalogue,
    help: new Map(help.ops.map((o) => [o.qname, o])),
    shares: await buildShares(catalogue, help),
  };
  const pages: ReferencePage[] = [];
  const add = (path: string, parts: PageParts): void => {
    pages.push({ path, file: fileOfPath(path), html: fillTemplate(template, parts) });
  };
  add(INDEX_PATH, renderIndexPage(data));
  for (const op of catalogue.ops) add(opPath(op), renderOpPage(op, data));
  return pages;
}

/** The sitemap with the reference pages added before the closing tag; the existing entries are kept. */
export function addToSitemap(sitemap: string, pages: readonly ReferencePage[]): string {
  const close = "</urlset>";
  const at = sitemap.lastIndexOf(close);
  if (at < 0) throw new Error("reference pages: sitemap.xml has no </urlset>");
  const entries = pages
    .map((p) => `  <url>\n    <loc>${escapeText(SITE_ORIGIN + p.path)}</loc>\n  </url>\n`)
    .join("");
  return sitemap.slice(0, at) + entries + sitemap.slice(at);
}
