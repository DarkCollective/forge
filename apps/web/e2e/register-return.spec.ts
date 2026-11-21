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
// WP 6.40: the keyboard-only path through the Register and Return blocks (promoted from the WP 6.39 check).
import { test, expect, openApp, addOpByKeyboard } from "./fixtures";
import { audit } from "./audit";

test("keyboard: add a register, rename it, use it, reorder, place a return; axe clean", async ({
  page,
}) => {
  await openApp(page);
  const menu = page.getByRole("button", { name: "Add block" });
  await menu.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: /Register/ }).press("Enter");
  const card = page.locator('forge-recipe .card[data-path="/steps/0"]');
  await expect(card).toHaveAttribute("aria-label", "Step 1: Register value");
  const name = page.locator("forge-recipe #f-steps-0-name");
  await name.focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("iv");
  await page.keyboard.press("Enter");
  await expect(card).toHaveAttribute("aria-label", "Step 1: Register iv");

  // an op parameter takes its value from the register
  await addOpByKeyboard(page, "rot");
  const useRegister = page.locator(
    'forge-param-form button[aria-label="Use a register for amount"]',
  );
  await useRegister.focus();
  await page.keyboard.press("Enter");
  const pick = page.locator("forge-param-form select#p-amount");
  await expect(pick).toHaveValue("iv");
  await expect(page.locator("forge-param-form")).toContainText("checked");
  await audit(page, "register picked");

  // renaming the register updates the reference
  await name.focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("nonce");
  await page.keyboard.press("Enter");
  await expect(pick).toHaveValue("nonce");

  // an invalid name is not committed
  await name.focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Bad Name");
  await page.keyboard.press("Enter");
  await expect(page.locator("forge-recipe #f-steps-0-name-problem")).toBeVisible();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await page.keyboard.press("Tab");
  await expect(card).toHaveAttribute("aria-label", "Step 1: Register nonce");

  // lifting the op above the register: the field says the register is defined later
  const handle = page.locator(
    'forge-recipe .card[data-path="/steps/1"] button[data-action="handle"]',
  );
  await handle.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Space");
  await expect(page.locator("forge-param-form .errors")).toContainText("defined later");
  await audit(page, "register defined later");

  // Add block > Return puts it at the top level, with the unreachable-step warning on what follows
  await menu.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: /Return/ }).press("Enter");
  await expect(page.locator("forge-recipe .card").nth(1)).toHaveAttribute("aria-label", /Return/);
  await expect(page.locator("forge-recipe .card").nth(2)).toHaveClass(/register/);
  await expect(page.locator("forge-recipe .issues")).toContainText("never runs");
  await audit(page, "return placed");
});

test("keyboard: a return cannot be lifted into a fork, but can into an if", async ({ page }) => {
  await openApp(page);
  const menu = page.getByRole("button", { name: "Add block" });
  for (const re of [/Fork/, /Return/]) {
    await menu.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: re }).press("Enter");
  }
  await expect(page.locator("forge-recipe .card").nth(1)).toHaveAttribute("aria-label", /Return/);
  const handle = page.locator(
    'forge-recipe .card[data-path="/steps/1"] button[data-action="handle"]',
  );
  await expect(handle).toBeVisible();
  const into = page.locator('forge-recipe .card[data-path="/steps/1"] button[data-action="in"]');
  await expect(into).toHaveAttribute("aria-disabled", "true");
  await handle.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[role="status"]').first()).toContainText(/Return can only go/);
  await page.keyboard.press("Escape");

  // an If takes it
  await menu.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: /If/ }).press("Enter");
  await expect(page.locator('forge-recipe .card[data-path="/steps/2"]')).toBeVisible();
  await handle.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await expect(page.locator('forge-recipe .card[data-path="/steps/1/then/0"]')).toHaveAttribute(
    "aria-label",
    /Return/,
  );
});
