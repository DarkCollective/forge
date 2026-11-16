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
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect, openApp } from "./fixtures";

// The tab list of the Input pane follows the WAI-ARIA tabs pattern: `role="tablist"` owns only `role="tab"`
// elements (axe: aria-required-children), with the close and rename controls outside it.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const THEMES = [
  ["Light", "light"],
  ["Dark", "dark"],
  ["High contrast", "contrast"],
] as const;

async function audit(page: Page, label: string): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.evaluate(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await Promise.all(document.getAnimations().map((a) => a.finished));
    });
    const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const summary = violations.map(
      (v) =>
        `${label}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" >> ")).join(" | ")}`,
    );
    if (
      violations.length === 0 ||
      violations.some((v) => v.id !== "color-contrast") ||
      attempt === 5
    ) {
      expect(summary, `axe violations\n${summary.join("\n")}`).toEqual([]);
      return;
    }
    await page.waitForTimeout(300);
  }
}

async function openSecondTab(page: Page): Promise<void> {
  await page.getByRole("button", { name: "New input tab" }).click();
  await expect(page.locator("forge-input [role=tab]")).toHaveCount(2);
}

for (const [label, id] of THEMES) {
  test(`input tabs: no axe violations with two tabs, ${label} theme`, async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await openApp(page);
    await page.getByRole("button", { name: /^Theme/ }).click();
    await page.getByRole("menuitemradio", { name: label }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", id);
    await openSecondTab(page);
    await audit(page, `${id} two input tabs`);
  });
}

test("input tabs: no axe violations with two tabs, compact layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openApp(page);
  await page.getByRole("tab", { name: "Input", exact: true }).click();
  await openSecondTab(page);
  await audit(page, "compact two input tabs");
});

test("input tabs: tablist holds only tabs; arrows, Home, End and close work", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await openApp(page);
  await openSecondTab(page);
  const tabs = page.locator("forge-input [role=tab]");
  await expect(page.locator("forge-input [role=tablist] > *:not([role=tab])")).toHaveCount(0);
  await tabs.nth(1).focus();
  await page.keyboard.press("Home");
  await expect(tabs.nth(0)).toBeFocused();
  await page.keyboard.press("End");
  await expect(tabs.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(0)).toBeFocused();
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: /^Close / }).click();
  await expect(tabs).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^Close / })).toHaveCount(0);
});
