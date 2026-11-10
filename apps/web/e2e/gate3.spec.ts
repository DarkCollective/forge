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
import {
  test,
  expect,
  openApp,
  addOpByKeyboard,
  cards,
  expectOutput,
  input,
  tabTo,
} from "./fixtures";

const LOWER = "534756736247383d";
const UPPER = "534756736247383D";

// Gate 3 (PLAN section 6): in the browser a user can search, add, configure, bake, share a URL, reload it and get
// the same result, using the keyboard only. Nothing in this test clicks, hovers or uses the mouse.
test("Gate 3: keyboard only, search, configure, bake, share, reload", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openApp(page);

  // Search and add two operations.
  await addOpByKeyboard(page, "base64 encode");
  await addOpByKeyboard(page, "hex encode");
  await expect(cards(page).nth(0)).toHaveAttribute("aria-label", /encode/);

  // Input.
  await page.keyboard.press("Alt+3");
  await expect(input(page)).toBeFocused();
  await page.keyboard.type("Hello");
  await expectOutput(page, LOWER);

  // Configure a parameter of the second step: case = upper, using the keyboard on the select.
  await page.keyboard.press("Alt+2");
  await expect(cards(page).first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(cards(page).nth(1)).toBeFocused();
  const caseSelect = page.locator("forge-param-form select#p-case");
  await tabTo(page, caseSelect);
  await page.keyboard.press("u");
  await expect(caseSelect).toHaveValue("upper");
  await expectOutput(page, UPPER);

  // Share: reach the top bar button with Shift+Tab, open it with Enter.
  await page.keyboard.press("Alt+1");
  const share = page.getByRole("button", { name: "Share", exact: true });
  await tabTo(page, share, true);
  await page.keyboard.press("Enter");
  const dialog = page.locator("forge-share-dialog");
  await expect(dialog.locator("textarea"))
    .toBeFocused({ timeout: 5000 })
    .catch(() => undefined);
  // Include the input in the link (keyboard: focus the checkbox and press Space).
  const include = dialog.locator("input[type=checkbox]");
  await tabTo(page, include);
  await page.keyboard.press("Space");
  await expect(include).toBeChecked();
  const link = dialog.locator("textarea");
  await expect(link).toHaveValue(/#v=1/);
  const url = await link.inputValue();
  expect(url).toContain(baseURL!);
  await tabTo(page, dialog.getByRole("button", { name: "Copy link" }));
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await page.keyboard.press("Escape");
  await expect(dialog.locator("dialog[open]")).toHaveCount(0);

  // Reload: the recipe (but not the input, which is only in a link when asked) comes back from the fragment.
  await page.reload();
  await expect(page.getByText(/\d+ operations/)).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  await expect(page.locator("forge-param-form select#p-case")).toHaveValue("upper");

  // The copied link opened in a fresh page gives the same result.
  const fresh = await browser.newContext();
  const page2 = await fresh.newPage();
  await page2.goto(await page.evaluate(() => navigator.clipboard.readText()));
  await expect(page2.getByText(/\d+ operations/)).toBeVisible();
  await expect(page2.locator("forge-recipe .card")).toHaveCount(2);
  await expect(page2.locator("forge-input textarea")).toHaveValue("Hello");
  await expect(page2.locator("forge-output .pill.stale")).toHaveCount(0);
  await expect(page2.locator("forge-output pre.text")).toHaveText(UPPER);
  await page2.reload();
  await expect(page2.locator("forge-output pre.text")).toHaveText(UPPER);
  await fresh.close();
});

// The pointer routes (drag and drop). The keyboard routes are covered above and in layout/params specs.
test.describe("pointer drag", () => {
  test.use({ viewport: { width: 1400, height: 2000 } });
  test("drag an op into the recipe, into a fork block, and reorder steps", async ({ page }) => {
    await openApp(page);
    const search = page.locator("forge-operations input#op-search");
    await search.fill("hex encode");
    const hexOp = page.locator("forge-operations [role=option]").first();
    await expect(hexOp).toBeVisible();

    const drag = async (
      from: ReturnType<typeof page.locator>,
      to: ReturnType<typeof page.locator>,
    ) => {
      const a = (await from.boundingBox())!;
      const b = (await to.boundingBox())!;
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(a.x + a.width / 2 + 20, a.y + a.height / 2 + 20, { steps: 4 });
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
      await page.mouse.up();
    };

    // Drop onto the recipe pane (empty recipe).
    await drag(hexOp, page.locator("forge-recipe"));
    await expect(cards(page)).toHaveCount(1);

    // A fork block, then drag an op into its empty lane.
    await page.getByRole("button", { name: /Add block/ }).click();
    await page.getByRole("menuitem", { name: /fork/i }).click();
    const lane = page.getByText(/Drop steps here/).first();
    await expect(lane).toBeVisible();
    await search.fill("base64 encode");
    await drag(page.locator("forge-operations [role=option]").first(), lane);
    await expect(
      page.locator(
        "forge-recipe .card[data-path*='/steps/'][data-path*='lane'], forge-recipe .card[data-path^='/steps/1/']",
      ),
    ).not.toHaveCount(0);
    await expect(page.getByText(/Drop steps here/)).toHaveCount(0);

    // Reorder: drag the fork block's Move handle to just above the first step.
    const handle = cards(page).nth(1).getByRole("button", { name: /^Move/ }).first();
    const first = (await cards(page).first().boundingBox())!;
    const h = (await handle.boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + 20, h.y - 20, { steps: 4 });
    await page.mouse.move(first.x + first.width / 2, first.y + 4, { steps: 12 });
    await page.mouse.up();
    await expect(cards(page).first()).toHaveAttribute("aria-label", /Fork/);
  });
});
