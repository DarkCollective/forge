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
import { test, expect, openApp } from "./fixtures";

async function run(page: import("@playwright/test").Page, line: string): Promise<void> {
  const field = page.locator("forge-console input#cmd");
  await field.fill(line);
  await page.keyboard.press("Enter");
}

test("the console evaluates, defines words and recovers from a runaway loop", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("Alt+5");
  await expect(page.locator("forge-console input#cmd")).toBeFocused();
  const log = page.locator("forge-console [role=log]");

  await run(page, "2 3 + .s");
  await expect(log).toContainText("<1> 5");

  await run(page, ": sq ( n:int -- int ) n n * ;");
  await run(page, "7 sq .");
  await expect(log).toContainText("49");

  // A runaway loop is stopped (by the Stop button or the watchdog) and the console recovers.
  await run(page, "[ true ] [ ] while");
  const stop = page.getByRole("button", { name: "Stop" });
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(stop).toBeHidden({ timeout: 20_000 });
  await run(page, "10 20 + .");
  await expect(log).toContainText("30", { timeout: 20_000 });
});
