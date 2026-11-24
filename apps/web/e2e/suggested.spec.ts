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
// F1 (T58, UI-TOOLKIT.md section 2.6): the "Suggested next" group at the top of the operations drawer, for
// text, for encoded bytes and for a table, and the "Data here" line that follows a lazy viewer.
import { gzipSync } from "node:zlib";
import type { Locator, Page } from "@playwright/test";
import { audit } from "./audit";
import { addOpByKeyboard, cards, expect, input, openApp, opSearch, test } from "./fixtures";

const group = (page: Page): Locator =>
  page.locator("forge-operations .section[data-kind=suggested]");
const rows = (page: Page): Locator => group(page).locator("[role=option]");
const dataLine = (page: Page): Locator => page.locator("forge-operations .data-type");
const titles = async (page: Page): Promise<(string | null)[]> =>
  rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")));

const TABLE = JSON.stringify({
  columns: [
    { name: "id", type: "int" },
    { name: "name", type: "str" },
    { name: "score", type: "num" },
  ],
  rows: [
    [1, "ann", 1.5],
    [2, "bo", 3],
    [3, "cy", 4.5],
    [4, "di", 6],
  ],
});

async function bakeTable(page: Page): Promise<void> {
  await openApp(page);
  await addOpByKeyboard(page, "table from text");
  await page.keyboard.press("Alt+3");
  await input(page).fill(TABLE);
  await expect(page.locator("forge-output .pill.stale")).toHaveCount(0);
  await expect(page.locator("forge-output [role=grid]")).toBeAttached();
}

test("raw text: the group tops the drawer with text-taking operations, none red, at most eight", async ({
  page,
}) => {
  await openApp(page);
  await input(page).fill("just some plain words in a sentence");
  await expect(dataLine(page)).toHaveText(/^Data here: bytes \((ASCII|UTF-8) text/);
  await expect(group(page)).toBeVisible();
  // It is the first group on the page, above Favourites.
  await expect(page.locator("forge-operations .section").first()).toHaveAttribute(
    "data-kind",
    "suggested",
  );
  await expect(group(page).locator(".group-toggle")).toContainText("Suggested next");
  const count = await rows(page).count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(8);
  for (let i = 0; i < count; i++) {
    await expect(rows(page).nth(i)).not.toHaveAttribute("data-fit", "no");
  }
  // The decoders for formats the text does not look like are not on the list ahead of the rest.
  expect(await titles(page)).not.toContain("deflate:gunzip");
});

test("Base64 text suggests the Base64 decoder first", async ({ page }) => {
  await openApp(page);
  await input(page).fill("SGVsbG8sIFdvcmxkISBIZWxsbywgV29ybGQh");
  await expect(dataLine(page)).toHaveText("Data here: bytes (Base64 text)");
  await expect(rows(page).first()).toHaveAttribute("title", "base64:decode");
  await expect(rows(page).first()).toContainText("Expects Base64 text");
});

test("gzip data suggests gunzip first, and no operation that needs text", async ({ page }) => {
  await openApp(page);
  await page.locator("forge-input input#file").setInputFiles({
    name: "data.gz",
    mimeType: "application/octet-stream",
    buffer: gzipSync(Buffer.from("hello hello hello hello")),
  });
  await expect(dataLine(page)).toHaveText("Data here: bytes (gzip data)");
  await expect(rows(page).first()).toHaveAttribute("title", "deflate:gunzip");
  for (const op of await titles(page)) {
    expect(op).not.toBe("text:split");
  }
});

test("a table suggests the table words, and its shape arrives in the Data here line", async ({
  page,
}) => {
  await bakeTable(page);
  // The lazy table viewer has loaded: the line states the shape (the stale-facts defect of D3).
  await expect(dataLine(page)).toHaveText("Data here: table (3 columns, 4 rows)");
  await opSearch(page).fill(""); // adding the op left its name in the search box
  await expect(group(page)).toBeVisible();
  const names = await titles(page);
  expect(names).toEqual(expect.arrayContaining(["table:to-csv", "table:to-json"]));
  expect(names).not.toContain("text:split");
  expect(names).not.toContain("hex:encode");
});

test("the Data here line follows a table viewer that loads after the bake has settled", async ({
  page,
}) => {
  // Hold the lazy viewer back, so that the facts are first read without it and nothing else changes after.
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/assets\/table-view-[^/]*\.js/, async (route) => {
    await gate;
    await route.continue();
  });
  await openApp(page);
  await addOpByKeyboard(page, "table from text");
  await page.keyboard.press("Alt+3");
  await input(page).fill(TABLE);
  await expect(page.locator("forge-output .pill.stale")).toHaveCount(0);
  await expect(dataLine(page)).toHaveText("Data here: table extension value");
  await page.waitForTimeout(500);
  await expect(dataLine(page)).toHaveText("Data here: table extension value");
  release();
  await expect(dataLine(page)).toHaveText("Data here: table (3 columns, 4 rows)");
});

test("the group works from the keyboard like the others, and adds the operation", async ({
  page,
}) => {
  await openApp(page);
  await input(page).fill("SGVsbG8sIFdvcmxkISBIZWxsbywgV29ybGQh");
  await expect(rows(page).first()).toHaveAttribute("title", "base64:decode");
  await page.keyboard.press("Alt+1");
  await expect(opSearch(page)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(rows(page).first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(rows(page).nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toContainText(/base64/i);
  // The header folds and unfolds it with the keyboard.
  const toggle = group(page).locator(".group-toggle");
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(rows(page)).toHaveCount(0);
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
});

test("in a search the group stays above the results and the first match still comes first", async ({
  page,
}) => {
  await openApp(page);
  await input(page).fill("SGVsbG8sIFdvcmxkISBIZWxsbywgV29ybGQh");
  await expect(rows(page).first()).toHaveAttribute("title", "base64:decode");
  await opSearch(page).fill("hex encode");
  await expect(group(page)).toBeVisible();
  await expect(page.locator("forge-operations .section").first()).toHaveAttribute(
    "data-kind",
    "suggested",
  );
  // Only matches of the query are suggested: each one is also a row of the results.
  const found = await page
    .locator("forge-operations .section[data-kind=results] [role=option]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("title")));
  for (const name of await titles(page)) expect(found).toContain(name);
  await addOpByKeyboard(page, "hex encode");
  await expect(cards(page).first()).toContainText("encode");
});

test("Fits the data and the groups are unchanged: the toggle hides red rows, never a suggestion", async ({
  page,
}) => {
  await openApp(page);
  await input(page).fill("hello");
  await expect(rows(page).first()).toBeVisible();
  await page.waitForTimeout(600); // the content checks settle 150 ms after the data changes
  const before = await titles(page);
  await page.locator("forge-operations").getByRole("button", { name: "Fits the data" }).click();
  expect(await titles(page)).toEqual(before);
});

for (const [label, id] of [
  ["Light", "light"],
  ["Dark", "dark"],
  ["High contrast", "contrast"],
] as const) {
  test(`axe is clean with the Suggested next group visible (${id})`, async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: /^Theme/ }).click();
    await page.getByRole("menuitemradio", { name: label }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", id);
    await input(page).fill("SGVsbG8sIFdvcmxkISBIZWxsbywgV29ybGQh");
    await expect(rows(page).first()).toHaveAttribute("title", "base64:decode");
    await expect(group(page)).toBeVisible();
    await audit(page, `${id} suggested`);
  });
}
