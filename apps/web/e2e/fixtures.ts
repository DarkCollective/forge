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
import { test as base, expect, type Locator, type Page } from "@playwright/test";

export { expect };

/**
 * Console messages that are not defects, per test (`test.use({ ignoredProblems: [...] })`). Used only by the
 * 404 page test: Chromium logs a console error for the failed document load itself.
 */

/**
 * The shared fixture: every test fails on any console error or warning, uncaught page error, failed request or
 * `securitypolicyviolation` event, and the page must be cross-origin isolated (the production headers).
 */
export const test = base.extend<{ problems: string[]; ignoredProblems: RegExp[] }>({
  ignoredProblems: [[], { option: true }],
  problems: [
    async ({ page, ignoredProblems }, use) => {
      const problems: string[] = [];
      page.on("console", (m) => {
        if (m.type() !== "error" && m.type() !== "warning") return;
        const text = m.text();
        if (!ignoredProblems.some((r) => r.test(text)))
          problems.push(`console.${m.type()}: ${text}`);
      });
      page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
      page.on("requestfailed", (r) =>
        problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ""}`),
      );
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (e) => {
          console.error(`securitypolicyviolation: ${e.violatedDirective} ${e.blockedURI}`);
        });
      });
      await use(problems);
      expect(problems, "console errors, page errors, failed requests or CSP violations").toEqual(
        [],
      );
    },
    { auto: true },
  ],
});

/** Opens the app and waits until the operations are loaded. */
export async function openApp(page: Page, hash = ""): Promise<void> {
  await page.goto("/" + hash);
  await expect(page.getByText(/\d+ operations/)).toBeVisible();
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
}

export const opSearch = (page: Page): Locator => page.locator("forge-operations input#op-search");
export const input = (page: Page): Locator => page.locator("forge-input textarea");
export const outputText = (page: Page): Locator => page.locator("forge-output pre.text");
export const cards = (page: Page): Locator => page.locator("forge-recipe .card");

/** Adds an operation using only the keyboard: Alt+1, type the query, Enter (into the list), Enter (add). */
export async function addOpByKeyboard(page: Page, query: string): Promise<void> {
  const before = await cards(page).count();
  await page.keyboard.press("Alt+1");
  await expect(opSearch(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await page.keyboard.type(query);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(cards(page)).toHaveCount(before + 1);
}

/** Waits for the output to settle on the expected text (not stale). */
export async function expectOutput(page: Page, expected: string): Promise<void> {
  await expect(page.locator("forge-output .pill.stale")).toHaveCount(0);
  await expect(outputText(page)).toHaveText(expected);
}

/** Moves keyboard focus to `target` by pressing Tab (or Shift+Tab) at most `max` times. */
export async function tabTo(page: Page, target: Locator, back = false, max = 60): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el.matches(":focus"))) return;
    await page.keyboard.press(back ? "Shift+Tab" : "Tab");
  }
  throw new Error("tabTo: target never received focus");
}

/** A pointer drag from the centre of `from` to the centre of `to` (or `y` pixels below the top of `to`). */
export async function dragTo(page: Page, from: Locator, to: Locator): Promise<void> {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 20, a.y + a.height / 2 + 20, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}
