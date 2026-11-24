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
// WP 6.28: the content tier of the Operations pane. The pane header says what the data is, and an op
// with input checks is amber with both sides named when the data looks like something else, green when
// the checks pass. The checks load lazily (their own chunks, after start-up).
import { gzipSync } from "node:zlib";
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { test, expect, openApp, opSearch } from "./fixtures";

const GUNZIP = "deflate:gunzip";
const dataLine = (page: Page): Locator => page.locator("forge-operations .data-type");
const gunzip = (page: Page): Locator =>
  page.locator(
    `forge-operations .section:not([data-kind=suggested]) [role=option][title="${GUNZIP}"]`,
  );
const fitToggle = (page: Page): Locator =>
  page.locator("forge-operations").getByRole("button", { name: "Fits the data" });

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(40, 7),
]);
const GZIP = gzipSync(Buffer.from("hello hello hello hello"));

async function loadFile(page: Page, name: string, buffer: Buffer): Promise<void> {
  await page
    .locator("forge-input input#file")
    .setInputFiles({ name, mimeType: "application/octet-stream", buffer });
}

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function audit(page: Page, label: string): Promise<void> {
  let violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"] = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.evaluate(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await Promise.all(document.getAnimations().map((a) => a.finished));
    });
    violations = (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations;
    if (violations.length === 0 || violations.some((v) => v.id !== "color-contrast")) break;
    await page.waitForTimeout(300);
  }
  const summary = violations.map(
    (v) => `${label}: ${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0]?.target.join(" >> ")}`,
  );
  expect(summary, `axe violations\n${summary.join("\n")}`).toEqual([]);
}

async function setTheme(page: Page, label: string, id: string): Promise<void> {
  await page.getByRole("button", { name: /^Theme/ }).click();
  await page.getByRole("menuitemradio", { name: label }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", id);
}

test("PNG data makes Gunzip amber with both sides named; a gzip stream makes it green", async ({
  page,
}) => {
  await openApp(page);
  await opSearch(page).fill("gunzip");
  await expect(gunzip(page)).toBeVisible();

  await loadFile(page, "image.png", PNG);
  await expect(dataLine(page)).toHaveText("Data here: bytes (PNG image)");
  await expect(gunzip(page)).toHaveAttribute("data-fit", "converts");
  await expect(gunzip(page)).toContainText("Expects gzip data; this looks like PNG image");

  // "Fits the data" hides only red: the amber row stays.
  await fitToggle(page).click();
  await expect(gunzip(page)).toBeVisible();
  await fitToggle(page).click();

  await loadFile(page, "data.gz", GZIP);
  await expect(dataLine(page)).toHaveText("Data here: bytes (gzip data)");
  await expect(gunzip(page)).toHaveAttribute("data-fit", "yes");
  await expect(gunzip(page)).toContainText("Expects gzip data");
  await expect(gunzip(page)).not.toContainText("this looks like");
});

test("text that is not gzip says what it is, and an empty input says only what Gunzip expects", async ({
  page,
}) => {
  await openApp(page);
  await opSearch(page).fill("gunzip");
  await expect(gunzip(page)).toContainText("Expects gzip data");
  await expect(gunzip(page)).toHaveAttribute("data-fit", "yes");
  await page.locator("forge-input textarea").fill("just some plain words in a sentence");
  await expect(dataLine(page)).toHaveText(/^Data here: bytes \((ASCII|UTF-8) text/);
  await expect(gunzip(page)).toHaveAttribute("data-fit", "converts");
  await expect(gunzip(page)).toContainText(/Expects gzip data; this is (ASCII|UTF-8) text/);
});

test("the checks are not part of the start-up page, and load in their own chunks once there is data", async ({
  page,
}) => {
  const seen: string[] = [];
  page.on("request", (r) => seen.push(new URL(r.url()).pathname));
  const html = await (await page.request.get("/")).text();
  expect(html, "the entry page names no checks chunk").not.toMatch(/checks/i);
  await openApp(page);
  await opSearch(page).fill("gunzip");
  await loadFile(page, "image.png", PNG);
  await expect(gunzip(page)).toContainText("this looks like PNG image");
  expect(seen.some((p) => /checks/.test(p))).toBe(true);
});

const THEMES = [
  ["Light", "light"],
  ["Dark", "dark"],
  ["High contrast", "contrast"],
] as const;

// One file per test: a second input tab trips an axe finding of the input pane's own tab list
// (aria-required-children), which is not part of this work package; see the report.
for (const [label, id] of THEMES) {
  for (const [state, name, data, expected] of [
    ["amber", "image.png", PNG, "this looks like PNG image"],
    ["green", "data.gz", GZIP, "Expects gzip data"],
  ] as const) {
    test(`axe is clean with a ${state} content row, ${id} theme`, async ({ page }) => {
      await openApp(page);
      await setTheme(page, label, id);
      await opSearch(page).fill("gunzip");
      await loadFile(page, name, data);
      await expect(gunzip(page)).toContainText(expected);
      await expect(gunzip(page)).toHaveAttribute(
        "data-fit",
        state === "amber" ? "converts" : "yes",
      );
      await audit(page, `${id} ${state}`);
    });
  }
}

test.describe("compact layout", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  for (const [label, id] of THEMES) {
    test(`axe is clean with content rows, ${id} theme`, async ({ page }) => {
      await openApp(page);
      await setTheme(page, label, id);
      await page.getByRole("tab", { name: "Input", exact: true }).click();
      await loadFile(page, "image.png", PNG);
      await page.getByRole("tab", { name: "Operations", exact: true }).click();
      await opSearch(page).fill("gunzip");
      await expect(gunzip(page)).toContainText("this looks like PNG image");
      await expect(dataLine(page)).toHaveText("Data here: bytes (PNG image)");
      await audit(page, `${id} compact`);
    });
  }
});
