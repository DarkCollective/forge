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
import { test, expect, openApp, addOpByKeyboard, cards, input } from "./fixtures";

test("a failing step shows the error panel and marks the step", async ({ page }) => {
  await openApp(page);
  await addOpByKeyboard(page, "hex decode");
  await page.keyboard.press("Alt+3");
  await page.keyboard.type("not hex at all");

  const panel = page.locator("forge-output .error-panel");
  await expect(panel).toBeVisible();
  await expect(panel).not.toBeEmpty();
  await expect(cards(page).first()).toHaveClass(/failed/);
  await expect(input(page)).toHaveValue("not hex at all");

  // Valid input clears the error and the mark.
  await input(page).fill("48656c6c6f");
  await expect(panel).toHaveCount(0);
  await expect(cards(page).first()).not.toHaveClass(/failed/);
  await expect(page.locator("forge-output pre.text")).toHaveText("Hello");
});
