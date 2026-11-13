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
// WP 6.1: the operations drawer shows which operations fit the data at the end of the recipe, and the
// browse view starts with the categories closed.
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import {
  test,
  expect,
  openApp,
  addOpByKeyboard,
  cards,
  expectOutput,
  input,
  opSearch,
  tabTo,
} from "./fixtures";

const ops = (page: Page): Locator => page.locator("forge-operations");
const toggles = (page: Page): Locator => page.locator("forge-operations .group-toggle");
const fitToggle = (page: Page): Locator =>
  page.locator("forge-operations").getByRole("button", { name: "Fits the data" });
const dataLine = (page: Page): Locator => page.locator("forge-operations .data-type");
const option = (page: Page, qname: string): Locator =>
  page.locator(`forge-operations [role=option][title="${qname}"]`);

test("the categories start closed, Favourites open, and each header shows its count", async ({
  page,
}) => {
  await openApp(page);
  const count = await toggles(page).count();
  expect(count).toBeGreaterThan(3);
  for (let i = 0; i < count; i++) {
    const t = toggles(page).nth(i);
    const label = (await t.innerText()).trim();
    await expect(t).toHaveText(/\(\d+\)/);
    await expect(t).toHaveAttribute("aria-expanded", /Favourites/i.test(label) ? "true" : "false");
  }
  // Nothing is starred yet, so no operation row is on screen.
  await expect(ops(page).locator("[role=option]")).toHaveCount(0);
});

test("a closed category opens and closes from the keyboard, and the arrow keys work in it", async ({
  page,
}) => {
  await openApp(page);
  await page.keyboard.press("Alt+1");
  await expect(opSearch(page)).toBeFocused();
  // Every group with rows is closed: Down from the search box lands on a group header.
  await page.keyboard.press("ArrowDown");
  const first = toggles(page)
    .filter({ hasNotText: /Favourites/i })
    .first();
  await tabTo(page, first);
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(first).toHaveAttribute("aria-expanded", "true");
  const rows = ops(page).locator("[role=option]");
  expect(await rows.count()).toBeGreaterThan(1);
  // Tab from the header reaches the roving row; the arrows move between rows.
  await page.keyboard.press("Tab");
  await expect(rows.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(rows.nth(0)).toBeFocused();
  // Escape returns to the search box; Alt+1 still focuses it from anywhere.
  await page.keyboard.press("Escape");
  await expect(opSearch(page)).toBeFocused();
  await first.focus();
  await page.keyboard.press("Space");
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect(rows).toHaveCount(0);
  await page.keyboard.press("Alt+1");
  await expect(opSearch(page)).toBeFocused();
});

test("the choice to open a category holds while searching and clearing", async ({ page }) => {
  await openApp(page);
  const first = toggles(page)
    .filter({ hasNotText: /Favourites/i })
    .first();
  await first.click();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await opSearch(page).fill("hex");
  await expect(toggles(page)).toHaveCount(0);
  await opSearch(page).fill("");
  await expect(first).toHaveAttribute("aria-expanded", "true");
});

test("User words start open while categories stay closed", async ({ page }) => {
  await openApp(page);
  await addOpByKeyboard(page, "hex encode");
  await page.keyboard.press("Alt+3");
  await page.keyboard.type("Hi");
  await expectOutput(page, "4869");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.locator("#save-name").fill("tohex");
  await page.getByRole("button", { name: "Save", exact: true }).last().click();
  await expect(page.locator("#save-name")).toHaveCount(0);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("button", { name: "Promote tohex to a word" }).click();
  await page.locator("#word-name").fill("tohex");
  await page.locator("#word-doc").fill("Hex encodes the input");
  await page.getByRole("button", { name: "Add word" }).click();
  await page.keyboard.press("Escape");
  // The words are written back to IndexedDB after a short debounce: wait for the write before reloading.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<string>((resolve) => {
            const open = indexedDB.open("forge");
            open.onsuccess = () => {
              const req = open.result.transaction("kv").objectStore("kv").get("user-source");
              req.onsuccess = () => resolve(String(req.result?.value ?? ""));
              req.onerror = () => resolve("");
            };
            open.onerror = () => resolve("");
          }),
      ),
    )
    .toContain("tohex");
  await page.goto("/about/");
  await page.goto("/");
  await expect(page.getByText(/\d+ operations/)).toBeVisible();
  await expect(toggles(page).filter({ hasText: /User words/i })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(option(page, "user:tohex")).toBeVisible();
  const others = toggles(page).filter({ hasNotText: /Favourites|User words/i });
  const n = await others.count();
  expect(n).toBeGreaterThan(3);
  for (let i = 0; i < n; i++) await expect(others.nth(i)).toHaveAttribute("aria-expanded", "false");
});

test("operations that do not fit are dimmed, explained and still addable", async ({ page }) => {
  await openApp(page);
  await expect(dataLine(page)).toHaveText("Data here: bytes (valid text)");
  await opSearch(page).fill("text join");
  const join = option(page, "text:join");
  await expect(join).toBeVisible();
  await expect(join).toHaveAttribute("data-fit", "no");
  await expect(join).toContainText("needs a list");
  // The (empty) input is valid UTF-8, so the bytes-to-text conversion is certain: text:split is green.
  await opSearch(page).fill("text split");
  await expect(option(page, "text:split")).toHaveAttribute("data-fit", "yes");
  await opSearch(page).fill("text join");
  // Still addable with the keyboard.
  await option(page, "text:join").focus();
  await page.keyboard.press("Enter");
  await expect(cards(page)).toHaveCount(1);
});

test("Fits the data hides what does not fit, in browse and in search, and follows the recipe", async ({
  page,
}) => {
  await openApp(page);
  await expect(fitToggle(page)).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Alt+1");
  await page.keyboard.press("Tab");
  await expect(fitToggle(page)).toBeFocused();
  await page.keyboard.press("Space");
  await expect(fitToggle(page)).toHaveAttribute("aria-pressed", "true");

  // Search: the one list-taking operation is gone, with an explanation when nothing is left.
  await opSearch(page).fill("text join");
  await expect(option(page, "text:join")).toHaveCount(0);
  await opSearch(page).fill("text:join");
  await expect(ops(page).locator("p.empty")).toContainText(
    /hidden because it does not fit the data/,
  );
  await opSearch(page).fill("");

  // Browse: the counts reflect the filter.
  await toggles(page)
    .filter({ hasNotText: /Favourites/i })
    .first()
    .click();
  const text = toggles(page).filter({ hasText: /^\s*Text/ });
  await expect(text).toHaveCount(1);
  await text.click();
  await expect(option(page, "text:join")).toHaveCount(0);
  await expect(option(page, "text:split")).toHaveCount(1);

  // After an operation that leaves text, text:split fits and text:join still does not.
  await addOpByKeyboard(page, "hex encode");
  await expect(dataLine(page)).toHaveText("Data here: text");
  await opSearch(page).fill("text split");
  await expect(option(page, "text:split")).toBeVisible();
  await expect(option(page, "text:split")).toHaveAttribute("data-fit", "yes");
  await expect(option(page, "text:join")).toHaveCount(0);
  await option(page, "text:split").focus();
  await page.keyboard.press("Enter");
  await expect(cards(page)).toHaveCount(2);

  // The data is now a list: text:join fits.
  await expect(dataLine(page)).toHaveText("Data here: list");
  await opSearch(page).fill("text join");
  await expect(option(page, "text:join")).toBeVisible();

  // Turning the filter off shows everything again, dimmed where it does not fit.
  await fitToggle(page).click();
  await expect(fitToggle(page)).toHaveAttribute("aria-pressed", "false");
  await opSearch(page).fill("hex encode");
  await expect(option(page, "hex:encode")).toHaveAttribute("data-fit", "no");
});

test("valid text input: text operations are green, a conversion is amber, the toggle hides only red", async ({
  page,
}) => {
  await openApp(page);
  await input(page).fill("hello");
  await expect(dataLine(page)).toHaveText("Data here: bytes (valid text)");
  await opSearch(page).fill("text split");
  await expect(option(page, "text:split")).toHaveAttribute("data-fit", "yes");
  await opSearch(page).fill("text join");
  await expect(option(page, "text:join")).toHaveAttribute("data-fit", "no");

  // After an operation that leaves text, an operation that takes bytes needs a conversion: amber.
  await addOpByKeyboard(page, "hex encode");
  await expect(dataLine(page)).toHaveText("Data here: text");
  await opSearch(page).fill("hex:encode");
  const encode = option(page, "hex:encode");
  await expect(encode).toHaveAttribute("data-fit", "converts");
  await expect(encode).toContainText("converts to bytes");
  await expect(encode.locator("svg.mark.converts")).toHaveAttribute("aria-hidden", "true");

  // The toggle hides red rows only: amber and green stay.
  await fitToggle(page).click();
  await expect(option(page, "hex:encode")).toBeVisible();
  await opSearch(page).fill("text split");
  await expect(option(page, "text:split")).toHaveAttribute("data-fit", "yes");
  await opSearch(page).fill("text join");
  await expect(option(page, "text:join")).toHaveCount(0);
});

test("a list result: most operations are red and hidden by the toggle, Join is green", async ({
  page,
}) => {
  await openApp(page);
  await input(page).fill("a,b,c");
  await addOpByKeyboard(page, "text split");
  await expect(dataLine(page)).toHaveText("Data here: list");
  await opSearch(page).fill("text join");
  await expect(option(page, "text:join")).toHaveAttribute("data-fit", "yes");
  await opSearch(page).fill("hex:encode");
  await expect(option(page, "hex:encode")).toHaveAttribute("data-fit", "no");
  await expect(option(page, "hex:encode")).toContainText("needs bytes");
  await fitToggle(page).click();
  await expect(option(page, "hex:encode")).toHaveCount(0);
  await opSearch(page).fill("text join");
  await expect(option(page, "text:join")).toBeVisible();
});

test("bytes that are not valid UTF-8: text operations are red with a hint", async ({ page }) => {
  await openApp(page);
  await input(page).fill("ff fe");
  await addOpByKeyboard(page, "hex decode");
  await expect(dataLine(page)).toHaveText("Data here: bytes");
  await opSearch(page).fill("text split");
  const split = option(page, "text:split");
  await expect(split).toHaveAttribute("data-fit", "no");
  await expect(split).toContainText("needs valid text");
  await expect(split.locator("svg.mark.no")).toHaveAttribute("aria-hidden", "true");
  // The toggle hides it; a bytes operation stays.
  await fitToggle(page).click();
  await expect(option(page, "text:split")).toHaveCount(0);
  await opSearch(page).fill("hex:encode");
  await expect(option(page, "hex:encode")).toHaveAttribute("data-fit", "yes");
});

for (const [label, id] of [
  ["Light", "light"],
  ["Dark", "dark"],
  ["High contrast", "contrast"],
] as const) {
  test(`axe is clean with dimmed operations and the filter on (${id})`, async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: /^Theme/ }).click();
    await page.getByRole("menuitemradio", { name: label }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", id);
    // Text data: red (needs a list), green and amber (needs bytes) rows are all on screen.
    await addOpByKeyboard(page, "hex encode");
    await expect(dataLine(page)).toHaveText("Data here: text");
    await opSearch(page).fill("text");
    await expect(option(page, "text:join")).toHaveAttribute("data-fit", "no");
    await expect(ops(page).locator("[data-fit=converts]").first()).toBeVisible();
    await expect(ops(page).locator("[data-fit=yes]").first()).toBeVisible();
    for (const pressed of [false, true]) {
      if (pressed) await fitToggle(page).click();
      let violations: string[] = [];
      for (let attempt = 0; attempt < 6; attempt++) {
        await page.evaluate(async () => {
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          await Promise.all(document.getAnimations().map((a) => a.finished));
        });
        const result = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();
        violations = result.violations.map(
          (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" >> ")).join(" | ")}`,
        );
        if (violations.length === 0 || !result.violations.every((v) => v.id === "color-contrast"))
          break;
        await page.waitForTimeout(300);
      }
      expect(violations).toEqual([]);
    }
  });
}
