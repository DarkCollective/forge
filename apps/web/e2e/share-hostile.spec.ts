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
import { test, expect, openApp, cards } from "./fixtures";

const HOSTILE: readonly [name: string, fragment: string][] = [
  ["a bad recipe payload", "#v=1&r=0A"],
  ["an unknown version", "#v=2&r=AA"],
  ["a 70 000 character fragment", "#v=1&r=" + "A".repeat(70_000)],
  ["random punctuation", "#%%%&&&===v"],
];

for (const [name, fragment] of HOSTILE) {
  test(`${name} never crashes the app and shows a notice`, async ({ page }) => {
    await openApp(page, fragment);
    await expect(page.locator(".notice").first()).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
    // The app is still usable.
    await page.keyboard.press("Alt+1");
    await expect(page.locator("forge-operations input#op-search")).toBeFocused();
  });
}
