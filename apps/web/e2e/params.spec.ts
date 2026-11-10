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
import { test, expect, openApp, addOpByKeyboard, expectOutput, input } from "./fixtures";

test("an invalid parameter is flagged inline and blocks the bake with a reason", async ({
  page,
}) => {
  await openApp(page);
  await addOpByKeyboard(page, "rot");
  await page.keyboard.press("Alt+3");
  await page.keyboard.type("Hello");
  await expect(input(page)).toHaveValue("Hello");

  const amount = page.locator("forge-param-form input").first();
  await amount.fill("5");
  await expect(amount).toHaveAttribute("aria-invalid", "false");
  await expectOutput(page, "Mjqqt");

  await amount.fill("99");
  await expect(amount).toHaveAttribute("aria-invalid", "true");
  // The field has a described error message, and the bake is blocked with a reason rather than run.
  const describedBy = await amount.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  await expect(
    page.locator("forge-param-form [role=alert], forge-param-form .error").first(),
  ).toBeVisible();
  await expect(page.locator("forge-output")).toContainText(
    /cannot|can't|invalid|fix|blocked|not baked/i,
  );
  await expect(page.locator("forge-output pre.text")).toHaveCount(0);

  // Fixing it brings the output back.
  await amount.fill("13");
  await expect(amount).toHaveAttribute("aria-invalid", "false");
  await expectOutput(page, "Uryyb");
});
