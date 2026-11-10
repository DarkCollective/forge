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

/* global console, process, URL */

// Bundle budget check (UI.md section 7, PLAN.md section 6).
//
// Counted: the app entry chunk referenced by dist/index.html, its static CSS, and every chunk the
// entry reaches through static imports or modulepreload (the shared chunks needed for first paint).
// Not counted: lazy assets, i.e. anything reached only through dynamic import() or a Worker URL
// (bake and console workers, op primitive chunks) and the catalogue JSON.
//
// Budget: 250 kB gzip, with kB = 1000 bytes. Exits 1 when the counted total is over budget.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const BUDGET_BYTES = 250_000;

const distDir = fileURLToPath(new URL("../dist/", import.meta.url));
const indexPath = join(distDir, "index.html");

if (!existsSync(indexPath)) {
  console.error(`check-size: ${indexPath} not found. Run "npm run build" first.`);
  process.exit(1);
}

const html = readFileSync(indexPath, "utf8");

// Resolve a URL from the HTML or from a JS file to a path relative to dist (leading slash).
function resolveFrom(fromPath, ref) {
  if (ref.startsWith("/")) return ref;
  return posix.normalize(posix.join(dirname(fromPath), ref));
}

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]+)"`).exec(tag);
  return m ? m[1] : undefined;
};

const entries = [];
const stylesheets = [];
const preloads = [];
for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
  const src = attr(tag, "src");
  if (src && /\btype="module"/.test(tag)) entries.push(src);
}
for (const tag of html.match(/<link\b[^>]*>/g) ?? []) {
  const rel = attr(tag, "rel") ?? "";
  const href = attr(tag, "href");
  if (!href) continue;
  if (rel.split(/\s+/).includes("stylesheet")) stylesheets.push(href);
  else if (rel.split(/\s+/).includes("modulepreload")) preloads.push(href);
}

// Static imports only: `from"./x.js"` and `import"./x.js"`. Dynamic `import("...")` has a `(`
// before the string, so it is not matched and stays lazy.
const STATIC_IMPORT = /\b(?:from|import)\s*"((?:\.{1,2}\/|\/)[^"]+\.js)"/g;

const counted = new Map(); // path -> gzip-able file
const queue = [...entries, ...preloads].map((p) => resolveFrom("/", p));
const seen = new Set();
while (queue.length > 0) {
  const path = queue.shift();
  if (seen.has(path)) continue;
  seen.add(path);
  const abs = join(distDir, path);
  if (!existsSync(abs)) {
    console.error(`check-size: referenced file missing from dist: ${path}`);
    process.exit(1);
  }
  counted.set(path, abs);
  const code = readFileSync(abs, "utf8");
  for (const m of code.matchAll(STATIC_IMPORT)) {
    queue.push(resolveFrom(path, m[1]));
  }
}
for (const href of stylesheets) {
  const path = resolveFrom("/", href);
  const abs = join(distDir, path);
  if (!existsSync(abs)) {
    console.error(`check-size: referenced stylesheet missing from dist: ${path}`);
    process.exit(1);
  }
  counted.set(path, abs);
}

// Every JS and CSS asset, so the table shows what is excluded and why.
const assetsDir = join(distDir, "assets");
const allAssets = existsSync(assetsDir)
  ? readdirSync(assetsDir)
      .filter((f) => /\.(js|css)$/.test(f))
      .map((f) => `/assets/${f}`)
  : [];

const rows = [];
let total = 0;
for (const path of [...new Set([...counted.keys(), ...allAssets])].sort()) {
  const abs = join(distDir, path);
  const raw = statSync(abs).size;
  const gz = gzipSync(readFileSync(abs), { level: 9 }).length;
  const isCounted = counted.has(path);
  if (isCounted) total += gz;
  rows.push({ path, raw, gz, isCounted });
}

const kb = (bytes) => (bytes / 1000).toFixed(2);
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
const nameWidth = Math.max(4, ...rows.map((r) => r.path.length));

console.log("");
console.log(`${pad("File", nameWidth)}  ${lpad("raw kB", 9)}  ${lpad("gzip kB", 9)}  Counted`);
console.log(`${"-".repeat(nameWidth)}  ${"-".repeat(9)}  ${"-".repeat(9)}  -------`);
for (const r of rows) {
  console.log(
    `${pad(r.path, nameWidth)}  ${lpad(kb(r.raw), 9)}  ${lpad(kb(r.gz), 9)}  ${r.isCounted ? "yes" : "no (lazy)"}`,
  );
}
console.log("");
console.log(`Core + UI shell, gzip: ${kb(total)} kB of ${kb(BUDGET_BYTES)} kB budget`);

if (total > BUDGET_BYTES) {
  console.error(`check-size: over budget by ${kb(total - BUDGET_BYTES)} kB`);
  process.exit(1);
}
console.log("check-size: within budget");
