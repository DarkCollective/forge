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

// Gate 4 (docs/PLAN.md section 7, RECIPES.md section 9.3): run the op vector runner (`runOpVectors`) over every
// packages/ops/vocab/*.test.json against a baker in a real Web Worker in headless Chromium. The vectors are read
// here and passed to the harness page (mode=vectors) with page.evaluate, so the gate covers whatever vocabularies
// exist. Production build of the harness, with and without COOP/COEP; `--dev` adds the Vite dev server.
// Exit status 1 on any failing vector or any catalogue op without a vector.
//
// Needs the built packages (`npm run build`) and a browser (`npx playwright install chromium`).
// Run it with `npm run gate4:browser -w @forge/worker`.
/* global console, process, URL, window */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { build, createServer, preview } from "vite";

const harness = fileURLToPath(new URL("../harness", import.meta.url));
const configFile = join(harness, "vite.config.ts");
const vocabDir = fileURLToPath(new URL("../../ops/vocab/", import.meta.url));
const withDev = process.argv.includes("--dev");

function loadVectorFiles() {
  const files = {};
  for (const name of readdirSync(vocabDir)
    .filter((f) => f.endsWith(".test.json"))
    .sort()) {
    files[name] = JSON.parse(readFileSync(join(vocabDir, name), "utf8"));
  }
  return files;
}

const headersFor = (isolated) =>
  isolated
    ? {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      }
    : {};

async function serve(kind, isolated) {
  const headers = headersFor(isolated);
  if (kind === "dev") {
    const server = await createServer({
      root: harness,
      configFile,
      logLevel: "warn",
      server: { host: "127.0.0.1", port: 0, headers },
    });
    await server.listen();
    return { url: server.resolvedUrls.local[0], stop: () => server.close() };
  }
  const outDir = mkdtempSync(join(tmpdir(), "forge-gate4-"));
  await build({
    root: harness,
    configFile,
    logLevel: "warn",
    build: { outDir, emptyOutDir: true },
  });
  const server = await preview({
    root: harness,
    configFile,
    logLevel: "warn",
    build: { outDir },
    preview: { host: "127.0.0.1", port: 0, headers },
  });
  return {
    url: server.resolvedUrls.local[0],
    stop: async () => {
      await server.close();
      rmSync(outDir, { recursive: true, force: true });
    },
  };
}

/** Runs one configuration and returns the number of problems found. */
async function runCombination(browser, files, kind, isolated) {
  console.log(`\n${kind} server, ${isolated ? "with" : "without"} COOP/COEP`);
  const { url, stop } = await serve(kind, isolated);
  const context = await browser.newContext();
  let problems = 0;
  const bad = (message) => {
    problems++;
    console.log(`  FAIL ${message}`);
  };
  try {
    const page = await context.newPage();
    const pageProblems = [];
    page.on("pageerror", (e) => pageProblems.push(`page error: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && pageProblems.push(`console: ${m.text()}`));

    await page.goto(`${url}?mode=vectors`);
    await page.waitForFunction(() => window.__gate4?.ready === true, null, { timeout: 120_000 });
    const g = await page.evaluate(() => ({
      error: window.__gate4.error,
      isolated: window.__gate4.crossOriginIsolated,
      sharedAbort: window.__gate4.sharedAbort,
    }));
    if (g.error !== undefined) {
      bad(`the harness failed to start: ${g.error}`);
      return problems;
    }
    if (g.isolated !== isolated) bad(`crossOriginIsolated is ${g.isolated}, expected ${isolated}`);
    if (g.sharedAbort !== isolated) bad(`the shared abort flag is ${g.sharedAbort ? "on" : "off"}`);

    const report = await page.evaluate((f) => window.__gate4.run(f), files);
    console.log(
      `  ${report.passed}/${report.total} vectors passed in ${Object.keys(files).length} file(s)`,
    );
    for (const f of report.failures) bad(f.message);
    for (const q of report.uncovered) bad(`${q} has no vector`);
    if (report.total === 0) bad("no vectors were run");
    if (pageProblems.length > 0) bad(`page or console errors: ${pageProblems.join("; ")}`);
    if (problems === 0) console.log("  ok");
  } finally {
    await context.close();
    await stop();
  }
  return problems;
}

async function main() {
  const files = loadVectorFiles();
  const count = Object.values(files).reduce((n, v) => n + v.length, 0);
  console.log(
    `Gate 4: ${count} vectors in ${Object.keys(files).length} files (${Object.keys(files).join(", ")})`,
  );
  let browser;
  try {
    browser = await chromium.launch();
  } catch (e) {
    console.error(`cannot start Chromium: ${e.message}\nRun: npx playwright install chromium`);
    process.exit(2);
  }
  let problems = 0;
  try {
    for (const kind of withDev ? ["build", "dev"] : ["build"]) {
      for (const isolated of [true, false]) {
        problems += await runCombination(browser, files, kind, isolated);
      }
    }
  } finally {
    await browser.close();
  }
  if (problems > 0) {
    console.error(`\nGate 4 FAILED: ${problems} problem(s)`);
    process.exit(1);
  }
  console.log("\nGate 4 passed: every vector and every catalogue op, in the browser.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
