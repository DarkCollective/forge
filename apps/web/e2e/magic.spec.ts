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
// WP 6.30: Magic in the web app. The button on the input pane opens the Magic dialog and runs the engine
// (WP 6.29) in a baker of its own; the ranked candidates can be added to the recipe.
import { gzipSync } from "node:zlib";
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { test, expect, openApp, addOpByKeyboard, cards, expectOutput, input } from "./fixtures";

const PLAIN = "Hello, World! This is a secret message for the magic engine.";
/**
 * Base64 of gzip of Base64 of the text. (The hex layering of the engine's own test, hex of gzip of Base64, is
 * found too but ranks second: `oid:from-hex` reads the hex as an OID dump and scores a little higher, a known
 * limit of the engine, RECIPES.md 8.9.)
 */
const LAYERED = gzipSync(Buffer.from(Buffer.from(PLAIN).toString("base64"))).toString("base64");
const CHAIN = ["base64:decode", "deflate:gunzip", "base64:decode"];

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

const magicButton = (page: Page): Locator =>
  page.locator("forge-input").getByRole("button", { name: "Magic", exact: true });
const dialog = (page: Page): Locator => page.locator("forge-magic-dialog");
const candidates = (page: Page): Locator => dialog(page).locator("li.candidate");
const status = (page: Page): Locator => dialog(page).locator("[role=status]");

/** Types the layered input and opens Magic; waits for the result. */
async function runMagic(page: Page): Promise<void> {
  await input(page).fill(LAYERED);
  await magicButton(page).click();
  await expect(dialog(page).getByRole("dialog")).toBeVisible();
  await expect(candidates(page).first()).toBeVisible({ timeout: 30_000 });
}

test("a layered input: the chain is the top candidate, and Add to recipe puts it in the recipe", async ({
  page,
}) => {
  await openApp(page);
  await runMagic(page);
  await expect(candidates(page).first().locator("ol.steps code")).toHaveText(CHAIN);
  await expect(candidates(page).first()).toContainText(PLAIN.slice(0, 40));
  await expect(candidates(page).first().getByRole("list", { name: "Reasons" })).toBeVisible();
  await expect(status(page)).toHaveText(/Magic found \d+ candidates?/);

  await candidates(page)
    .first()
    .getByRole("button", { name: /Add to recipe/ })
    .click();
  await expect(dialog(page).getByRole("dialog")).toBeHidden();
  await expect(cards(page)).toHaveCount(3);
  await expectOutput(page, "Hello, World! This is a secret message for the magic engine.");

  // Undo restores the empty recipe.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(cards(page)).toHaveCount(0);
});

test("with steps in the recipe Add to recipe asks first, and Undo brings the recipe back", async ({
  page,
}) => {
  await openApp(page);
  await addOpByKeyboard(page, "hex encode");
  await runMagic(page);
  await candidates(page)
    .first()
    .getByRole("button", { name: /Add to recipe/ })
    .click();
  const confirm = dialog(page).getByRole("group", { name: "Replace the recipe?" });
  await expect(confirm).toBeVisible();
  await expect(cards(page)).toHaveCount(1);

  // Cancel keeps the recipe.
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  await expect(cards(page)).toHaveCount(1);

  await candidates(page)
    .first()
    .getByRole("button", { name: /Add to recipe/ })
    .click();
  await dialog(page).getByRole("button", { name: "Replace the recipe" }).click();
  await expect(cards(page)).toHaveCount(3);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(cards(page)).toHaveCount(1);
});

test("Add first step appends the first operation of the candidate", async ({ page }) => {
  await openApp(page);
  await addOpByKeyboard(page, "hex encode");
  await runMagic(page);
  await candidates(page)
    .first()
    .getByRole("button", { name: /Add first step/ })
    .click();
  await expect(dialog(page).getByRole("dialog")).toBeHidden();
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).last()).toContainText(/decode/i);
  await expect(cards(page).last()).toContainText(/base64/i);
});

test("Cancel stops a run that is still starting", async ({ page }) => {
  // Hold back the lazily loaded engine so that the run is certainly still in progress when Cancel is clicked.
  await page.route("**/assets/magic-*.js", async (route) => {
    await new Promise((r) => setTimeout(r, 2000));
    await route.continue();
  });
  await openApp(page);
  await input(page).fill(LAYERED);
  await magicButton(page).click();
  await expect(status(page)).toHaveText("Magic started");
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(status(page)).toHaveText("Magic cancelled", { timeout: 30_000 });
  await expect(dialog(page).getByRole("heading", { name: /cancelled/ })).toBeFocused();
  await expect(candidates(page)).toHaveCount(0);
});

test("no candidate gives a clear message; an empty input says so", async ({ page }) => {
  await openApp(page);
  await magicButton(page).click();
  await expect(dialog(page)).toContainText("The input is empty");
  await page.keyboard.press("Escape");
  await expect(dialog(page).getByRole("dialog")).toBeHidden();

  await input(page).fill("just some ordinary words");
  await magicButton(page).click();
  await expect(dialog(page).getByRole("heading", { name: /^No candidate/ })).toBeVisible({
    timeout: 30_000,
  });
  await expect(status(page)).toHaveText("Magic found no candidate");
  await expect(candidates(page)).toHaveCount(0);
});

test("a crib and a depth can be set, and Run again runs with them", async ({ page }) => {
  await openApp(page);
  await runMagic(page);
  await dialog(page).getByLabel("Depth, the most steps in a candidate").selectOption("2");
  await dialog(page).getByRole("button", { name: "Run again" }).click();
  await expect(status(page)).toHaveText(/Magic found \d+ candidates?/);
  await expect(candidates(page).first().locator("ol.steps code")).toHaveText([
    "base64:decode",
    "deflate:gunzip",
  ]);
  await dialog(page).getByLabel("Crib (optional)").fill("secret message");
  await dialog(page).getByLabel("Depth, the most steps in a candidate").selectOption("3");
  await dialog(page).getByRole("button", { name: "Run again" }).click();
  // The ranking with a crib is the engine's, tested there; here only that the crib is accepted.
  await expect(status(page)).toHaveText(/Magic found \d+ candidates?/, { timeout: 30_000 });
});

const THEMES = [
  ["Light", "light"],
  ["Dark", "dark"],
  ["High contrast", "contrast"],
] as const;

for (const [label, id] of THEMES) {
  test(`axe: the Magic dialog with results and with the replace prompt, ${id} theme`, async ({
    page,
  }) => {
    await openApp(page);
    await setTheme(page, label, id);
    await addOpByKeyboard(page, "hex encode");
    await runMagic(page);
    await audit(page, `${id} magic results`);
    await candidates(page)
      .first()
      .getByRole("button", { name: /Add to recipe/ })
      .click();
    await expect(dialog(page).getByRole("group", { name: "Replace the recipe?" })).toBeVisible();
    await audit(page, `${id} magic replace prompt`);
  });
}

test.describe("compact layout", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  for (const [label, id] of THEMES) {
    test(`axe: results and the empty message, ${id} theme`, async ({ page }) => {
      await openApp(page);
      await setTheme(page, label, id);
      await page.getByRole("tab", { name: "Input", exact: true }).click();
      await magicButton(page).click();
      await expect(dialog(page)).toContainText("The input is empty");
      await audit(page, `${id} compact magic empty`);
      await page.keyboard.press("Escape");
      await runMagic(page);
      await audit(page, `${id} compact magic results`);
    });
  }
});
