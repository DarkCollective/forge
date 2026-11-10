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
import { test, expect, openApp, addOpByKeyboard, cards, expectOutput, input } from "./fixtures";

test("save, reload, open", async ({ page }) => {
  await openApp(page);
  await addOpByKeyboard(page, "hex encode");
  await page.keyboard.press("Alt+3");
  await page.keyboard.type("Hi");
  await expectOutput(page, "4869");

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.locator("#save-name").fill("e2e saved recipe");
  await page.locator("#save-input").check();
  await page.getByRole("button", { name: "Save", exact: true }).last().click();
  await expect(page.locator("#save-name")).toHaveCount(0);

  // A real reload from a clean slate (leaving the page first: "/" from "/#..." is a same-document navigation).
  await page.goto("/about/");
  await page.goto("/");
  await expect(page.getByText(/\d+ operations/)).toBeVisible();
  await expect(cards(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("button", { name: "Open e2e saved recipe" }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(input(page)).toHaveValue("Hi");
  await expectOutput(page, "4869");
});

test("promote a recipe to a user word, find it under User words and bake the same", async ({
  page,
}) => {
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
  // The words are written back to IndexedDB after a short debounce: wait for the write before leaving.
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

  // A real reload from a clean slate (leaving the page first: "/" from "/#..." is a same-document navigation).
  await page.goto("/about/");
  await page.goto("/");
  await expect(page.getByText(/\d+ operations/)).toBeVisible();
  const search = page.locator("forge-operations input#op-search");
  await expect(async () => {
    await search.fill("tohex");
    await expect(page.locator("forge-operations [role=option]").first()).toContainText("tohex", {
      timeout: 1000,
    });
  }).toPass({ timeout: 20_000 });
  await search.fill("");
  await expect(page.locator("forge-operations")).toContainText(/User words/i);
  await search.fill("tohex");

  await page.locator("forge-operations [role=option]").first().focus();
  await page.keyboard.press("Enter");
  await expect(cards(page)).toHaveCount(1);
  await page.keyboard.press("Alt+3");
  await page.keyboard.type("Hi");
  await expectOutput(page, "4869");
});
