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

// X0 SPIKE (throwaway): Parse CSV over a pasted CSV input bakes and the output pane shows the table viewer,
// in the built app served with the production headers. The shared fixture fails every test on any console
// message, page error, failed request or CSP violation.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CatalogueView, Recipe } from "@forge/recipe";
import { encodeShare } from "@forge/recipe";
import type { Page } from "@playwright/test";
import { audit } from "./audit";
import { test, expect, openApp } from "./fixtures";

const catalogue = JSON.parse(
  readFileSync(fileURLToPath(import.meta.resolve("@forge/ops/catalogue.json")), "utf8"),
) as CatalogueView;

const CSV = "name,age,active\r\nAda,36,true\r\nAlan,41,false\r\nGrace,,true\r\nLin,29,false\r\n";
const SHOTS = process.env.X0_SHOTS ?? "";

async function open(page: Page, steps: unknown[]): Promise<void> {
  const recipe = { forge: 1, steps } as unknown as Recipe;
  const shared = await encodeShare(
    { recipe, input: new TextEncoder().encode(CSV), inputEncoding: "utf8" },
    { catalogue },
  );
  if (!shared.ok) throw new Error(shared.error.message);
  await openApp(page, "#" + shared.fragment);
  await expect(page.locator("forge-output .pill.stale")).toHaveCount(0);
}

async function setTheme(page: Page, label: string, id: string): Promise<void> {
  await page.getByRole("button", { name: /^Theme/ }).click();
  await page.getByRole("menuitemradio", { name: label }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", id);
}

test("Parse CSV bakes and the output pane shows the table viewer", async ({ page }) => {
  await open(page, [{ kind: "op", op: "table:from-csv" }]);
  const view = page.locator("forge-output forge-table-view");
  await expect(view).toBeVisible();
  await expect(view.locator(".summary")).toHaveText("4 rows, 3 columns");
  await expect(view.locator("thead th").nth(1)).toContainText("name");
  await expect(view.locator("thead th").nth(1)).toContainText("str");
  await expect(view.locator("thead th").nth(2)).toContainText("num");
  await expect(view.locator("thead th").nth(3)).toContainText("bool");
  await expect(view.locator("tbody tr")).toHaveCount(4);
  await expect(view.locator("tbody tr").nth(2).locator("td.null")).toHaveText("null");
  expect(await page.locator("forge-output forge-table-view").evaluate((e) => !!e.shadowRoot)).toBe(
    true,
  );
});

for (const [label, id] of [
  ["Light", "light"],
  ["Dark", "dark"],
  ["High contrast", "contrast"],
] as const) {
  test(`the table viewer in the ${label} theme passes axe`, async ({ page }) => {
    await open(page, [{ kind: "op", op: "table:from-csv" }]);
    await setTheme(page, label, id);
    await expect(page.locator("forge-output forge-table-view tbody tr")).toHaveCount(4);
    await audit(page, `x0 table ${id}`);
    if (SHOTS !== "") await page.screenshot({ path: `${SHOTS}/table-${id}.png` });
  });
}

test("Filter keeps the matching rows and the parameter field checks the text", async ({ page }) => {
  await open(page, [
    { kind: "op", op: "table:from-csv" },
    { kind: "op", op: "table:filter", params: { expr: "age > 30" } },
  ]);
  const view = page.locator("forge-output forge-table-view");
  await expect(view.locator(".summary")).toHaveText("2 rows, 3 columns");
  await expect(view.locator("tbody tr")).toHaveCount(2);

  // select the Filter step: its parameter form offers the columns of the table and checks the text live
  await page.locator("forge-recipe .card").nth(1).click();
  const field = page.locator("forge-param-form input#p-expr");
  await expect(field).toHaveValue("age > 30");
  await expect(page.locator("forge-param-form .ext-status.ok")).toHaveText("Valid.");
  await expect(page.locator("forge-param-form .cols button")).toHaveCount(3);
  await field.fill("height > 3");
  await expect(page.locator("forge-param-form .ext-status.bad")).toContainText(
    'No column "height"',
  );
  await field.fill("age >");
  await expect(page.locator("forge-param-form .ext-status.bad")).toContainText("Expected a value");
  await field.fill('name = "Ada"');
  await expect(page.locator("forge-param-form .ext-status.ok")).toBeVisible();
  await expect(page.locator("forge-output forge-table-view .summary")).toHaveText(
    "1 row, 3 columns",
  );
  if (SHOTS !== "") await page.screenshot({ path: `${SHOTS}/filter-params.png` });
});

test("a kind with no viewer falls back to its text form", async ({ page }) => {
  const recipe = {
    forge: 1,
    steps: [{ kind: "op", op: "table:to-expr" }],
  } as unknown as Recipe;
  const shared = await encodeShare(
    {
      recipe,
      input: new TextEncoder().encode('age > 30 and name <> "Bob"'),
      inputEncoding: "utf8",
    },
    { catalogue },
  );
  if (!shared.ok) throw new Error(shared.error.message);
  await openApp(page, "#" + shared.fragment);
  await expect(page.locator("forge-output .pill.stale")).toHaveCount(0);
  await expect(page.locator("forge-output forge-table-view")).toHaveCount(0);
  await expect(page.locator("forge-output pre.text")).toHaveText('age > 30 and name <> "Bob"');
});

test("a bad CSV is a normal bake error", async ({ page }) => {
  const recipe = { forge: 1, steps: [{ kind: "op", op: "table:from-csv" }] } as unknown as Recipe;
  const shared = await encodeShare(
    { recipe, input: new TextEncoder().encode("a,a\r\n1,2\r\n"), inputEncoding: "utf8" },
    { catalogue },
  );
  if (!shared.ok) throw new Error(shared.error.message);
  await openApp(page, "#" + shared.fragment);
  await expect(page.locator("forge-output .error-panel")).toContainText("E_COERCE");
});
