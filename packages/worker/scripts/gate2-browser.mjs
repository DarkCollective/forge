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

// Gate 2, part G2-5 (docs/RECIPES.md section 10.3): bake the Gate 2 recipe in a real Web Worker in headless
// Chromium and check that the result equals the Node result. Every combination of
//   - the Vite dev server and a production build served by `vite preview`, and
//   - with and without COOP/COEP (cross-origin isolation, so with and without the SharedArrayBuffer flag)
// is run, and cancellation is exercised in each. Exit status 1 on any difference.
//
// Needs the built packages (`npm run build`) and a browser (`npx playwright install chromium`).
// Run it with `npm run gate2:browser -w @forge/worker`.
/* global console, process, URL, window */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBundleNode } from "@forge/ops/node";
import { decodeShare } from "@forge/recipe";
import { createInProcessBaker, stripTimings } from "@forge/worker";
import { chromium } from "playwright";
import { build, createServer, preview } from "vite";

const harness = fileURLToPath(new URL("../harness", import.meta.url));
const configFile = join(harness, "vite.config.ts");

const GOLDEN =
  "v=1&r=1bY2xDgIhEAX_5dU0F43F_oqx2IP1jggsYTGaEP7dWBqvmW5mBu7aNgEtDtalGug68IglgKAV7gvCyiaXMwXxGgQOlRtnAw1wqjuv0kGwziVwC5jTHTR8YrPoOVHT_tvI-iwdtJyOzV3eJOVv7dkEhKQvaXAIkmKOXRoIRYtgztv8AA&i=0VlhKNWVXSXNJRXBpWlhseElRPT0&ie=utf8";
const EXPECTED_TEXT = "48656c6c6f2c20576f726c6421";

const failures = [];
const check = (ok, message) => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${message}`);
  if (!ok) failures.push(message);
};

/** The result of G2-2: the same fragment, baked in this process. */
async function nodeReference() {
  const baker = createInProcessBaker({ loadBundle: loadBundleNode });
  const info = await baker.init();
  const catalogue = JSON.parse(
    (await import("node:fs")).readFileSync(
      fileURLToPath(import.meta.resolve("@forge/ops/catalogue.json")),
      "utf8",
    ),
  );
  const decoded = await decodeShare(GOLDEN, { catalogue });
  if (!decoded.ok) throw new Error(`cannot decode the golden fragment: ${decoded.error.message}`);
  const result = await baker.bake(decoded.recipe, decoded.input, { trust: "untrusted" });
  return {
    json: JSON.stringify(stripTimings(result)),
    catalogueVersion: info.catalogueVersion,
    buildVersion: catalogue.version,
  };
}

function headersFor(isolated) {
  return isolated
    ? {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      }
    : {};
}

/** Starts a server for one combination. Returns its URL and a function that stops it. */
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
  const outDir = mkdtempSync(join(tmpdir(), "forge-gate2-"));
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

async function runCombination(browser, reference, kind, isolated) {
  console.log(`\n${kind} server, ${isolated ? "with" : "without"} COOP/COEP`);
  const { url, stop } = await serve(kind, isolated);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const problems = [];
    page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));

    await page.goto(url);
    await page.waitForFunction(() => window.__gate2?.done === true, null, { timeout: 120_000 });
    const g = await page.evaluate(() => window.__gate2);
    check(
      g.error === undefined,
      `the harness ran without an error${g.error ? `: ${g.error}` : ""}`,
    );
    check(
      g.crossOriginIsolated === isolated,
      `crossOriginIsolated is ${g.crossOriginIsolated} (expected ${isolated})`,
    );
    check(
      g.sharedAbort === isolated,
      `the shared abort flag is ${g.sharedAbort ? "in use" : "off"}`,
    );
    check(
      g.result?.ok === true && g.result.output?.text === EXPECTED_TEXT,
      `the output is ${g.result?.output?.text}`,
    );
    check(
      g.catalogueVersion === reference.catalogueVersion &&
        g.catalogueVersion === reference.buildVersion,
      `the browser catalogue version ${g.catalogueVersion} equals the Node (${reference.catalogueVersion}) and build-time (${reference.buildVersion}) versions`,
    );
    check(
      JSON.stringify(g.result) === reference.json,
      "the result equals the Node result (after stripTimings)",
    );

    const cancelPage = await context.newPage();
    cancelPage.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
    await cancelPage.goto(`${url}?mode=cancel`);
    await cancelPage.waitForFunction(() => window.__gate2cancel?.done === true, null, {
      timeout: 120_000,
    });
    const c = await cancelPage.evaluate(() => window.__gate2cancel);
    check(
      c.error === undefined,
      `the cancel harness ran without an error${c.error ? `: ${c.error}` : ""}`,
    );
    check(
      c.loop?.code === "E_ABORTED" && c.loop.terminated === false,
      `cancel stops an FL loop without terminating the worker (${JSON.stringify(c.loop)})`,
    );
    check(
      c.regex?.code === "E_ABORTED" && c.regex.terminated === true,
      `cancel terminates a worker stuck in a regex (${JSON.stringify(c.regex)})`,
    );
    check(c.after === "OK", `the next bake runs on a fresh worker (${c.after})`);
    check(
      problems.length === 0,
      `no page or console errors${problems.length ? `: ${problems.join("; ")}` : ""}`,
    );
  } finally {
    await context.close();
    await stop();
  }
}

async function main() {
  const reference = await nodeReference();
  console.log(`Node reference: ${reference.json.slice(0, 120)}...`);
  let browser;
  try {
    browser = await chromium.launch();
  } catch (e) {
    console.error(`cannot start Chromium: ${e.message}\nRun: npx playwright install chromium`);
    process.exit(2);
  }
  try {
    for (const kind of ["dev", "build"]) {
      for (const isolated of [true, false]) {
        await runCombination(browser, reference, kind, isolated);
      }
    }
  } finally {
    await browser.close();
  }
  if (failures.length > 0) {
    console.error(`\nGate 2 (G2-5) FAILED: ${failures.length} check(s)`);
    process.exit(1);
  }
  console.log("\nGate 2 (G2-5) passed in all four combinations.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
