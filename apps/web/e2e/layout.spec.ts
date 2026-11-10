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
import { test, expect, openApp, addOpByKeyboard } from "./fixtures";

const THEMES = [
  ["Light", "light"],
  ["Dark", "dark"],
  ["High contrast", "contrast"],
] as const;

test("themes switch and persist across a reload", async ({ page }) => {
  await openApp(page);
  for (const [label, id] of THEMES) {
    await page.getByRole("button", { name: /^Theme/ }).click();
    await page.getByRole("menuitemradio", { name: label }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", id);
    await page.reload();
    await expect(page.getByText(/\d+ operations/)).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", id);
  }
});

test("a splitter resizes with the keyboard and the size survives a reload", async ({ page }) => {
  await openApp(page);
  const splitter = page.locator("forge-splitter").first();
  await splitter.focus();
  const before = Number(await splitter.getAttribute("aria-valuenow"));
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => Number(await splitter.getAttribute("aria-valuenow")))
    .toBeGreaterThan(before);
  await page.keyboard.press("ArrowRight");
  const after = Number(await splitter.getAttribute("aria-valuenow"));
  await page.keyboard.press("Shift+ArrowLeft");
  await expect
    .poll(async () => Number(await splitter.getAttribute("aria-valuenow")))
    .toBeLessThan(after);
  await page.keyboard.press("Home");
  const min = Number(await splitter.getAttribute("aria-valuenow"));
  await page.keyboard.press("End");
  await expect
    .poll(async () => Number(await splitter.getAttribute("aria-valuenow")))
    .toBeGreaterThan(min);
  const set = Number(await splitter.getAttribute("aria-valuenow"));
  await page.reload();
  await expect(page.getByText(/\d+ operations/)).toBeVisible();
  await expect(page.locator("forge-splitter").first()).toHaveAttribute(
    "aria-valuenow",
    String(set),
  );
});

test.describe("compact layout", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("tabs replace the panes and nothing overflows horizontally", async ({ page }) => {
    await openApp(page);
    const tabs = page.getByRole("tab");
    await expect(tabs.first()).toBeVisible();
    await expect(page.getByRole("tab", { name: "Recipe", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const overflows = (): Promise<boolean> =>
      page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
    expect(await overflows()).toBe(false);
    for (const name of ["Operations", "Input", "Output", "Recipe"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(await overflows()).toBe(false);
    }
    // The app works here too: add an operation from the Operations tab.
    await addOpByKeyboard(page, "hex encode");
    expect(await overflows()).toBe(false);
  });
});
