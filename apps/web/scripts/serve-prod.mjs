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

// A tiny static server for apps/web/dist that mimics production: the security headers of infra/site.tf (the
// CSP string is read from there so the two cannot drift) and CloudFront's rewrite of directory URLs to
// index.html, with missing paths answered by /404.html with status 404.
/* global console, process, URL */
import { createServer } from "node:http";
import { readFileSync, statSync, existsSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const dist = join(here, "..", "dist");
const siteTf = join(here, "..", "..", "..", "infra", "site.tf");

/** The CSP, read from the Terraform so the e2e suite tests what is deployed. Fails loudly. */
export function readCsp() {
  const text = readFileSync(siteTf, "utf8");
  const match = /^\s*csp\s*=\s*"([^"\n]+)"/m.exec(text);
  if (!match) throw new Error(`serve-prod: no csp = "..." local found in ${siteTf}`);
  return match[1];
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

function resolveFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const clean = normalize(decoded);
  const last = clean.split("/").pop() ?? "";
  const rel = clean.endsWith("/")
    ? clean + "index.html"
    : last.includes(".")
      ? clean
      : clean + "/index.html";
  const full = join(dist, rel);
  if (full !== dist && !full.startsWith(dist + sep)) return null;
  return existsSync(full) && statSync(full).isFile() ? full : null;
}

export function startServer(port) {
  const csp = readCsp();
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    let file = resolveFile(pathname);
    let status = 200;
    if (!file) {
      file = join(dist, "404.html");
      status = 404;
    }
    const immutable = pathname.startsWith("/assets/");
    res.writeHead(status, {
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      "Content-Security-Policy": csp,
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": immutable
        ? "public, max-age=31536000, immutable"
        : "public, max-age=0, must-revalidate",
    });
    if (req.method === "HEAD") res.end();
    else res.end(readFileSync(file));
  });
  server.listen(port, "127.0.0.1");
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? process.argv[2] ?? 4783);
  if (!existsSync(join(dist, "index.html"))) {
    console.error("serve-prod: apps/web/dist is missing; run `npm run build` first");
    process.exit(1);
  }
  startServer(port);
  console.log(`serve-prod: http://127.0.0.1:${port}/`);
}
