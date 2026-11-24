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
import type { Page } from "@playwright/test";
import { audit } from "./audit";
import { addOpByKeyboard, expect, input, openApp, test } from "./fixtures";

// The table viewer (UI-TOOLKIT.md section 1.7), end to end on the production build: a real recipe, the op
// `table:from-text`, with the faithful text form of a table as its input. Nothing is faked.

type Cell = string | number | boolean | null;

interface Spec {
  readonly columns: readonly { name: string; type: string }[];
  readonly rows: readonly (readonly Cell[])[];
}

/** The faithful text form (JSON with a column header) that `table:from-text` reads. */
function tableText(spec: Spec): string {
  return JSON.stringify(spec);
}

/** `n` rows of an int id, a str name with a null every 7th row, an empty string every 11th, and a num. */
function people(n: number): Spec {
  const rows: Cell[][] = [];
  for (let i = 1; i <= n; i++) {
    rows.push([
      i,
      i % 7 === 0 ? null : i % 11 === 0 ? "" : `person ${i}`,
      i === 3 ? "null" : "NZ",
      i * 1.5,
    ]);
  }
  return {
    columns: [
      { name: "id", type: "int" },
      { name: "name", type: "str" },
      { name: "country", type: "str" },
      { name: "score", type: "num" },
    ],
    rows,
  };
}

async function bakeTable(page: Page, spec: Spec): Promise<void> {
  await openApp(page);
  await addOpByKeyboard(page, "table from text");
  await page.keyboard.press("Alt+3");
  await input(page).fill(tableText(spec));
  // Wait for the bake to settle, so that the grid a test uses is not replaced by a later result.
  await expect(page.locator("forge-output .pill.stale")).toHaveCount(0);
  await expect(page.locator("forge-output [role=grid]")).toBeAttached();
  await expect(page.locator("forge-output .pill.stale")).toHaveCount(0);
}

const output = (page: Page) => page.locator("forge-output");
const grid = (page: Page) => page.locator("forge-output [role=grid]");
const cell = (page: Page, r: number, c: number) =>
  grid(page).locator(`[data-r="${r}"][data-c="${c}"]`);

/** The position of the focused cell inside the grid. */
async function focused(page: Page): Promise<string> {
  return grid(page).evaluate((g) => {
    const root = g.getRootNode() as ShadowRoot;
    const a = root.activeElement as HTMLElement | null;
    return a?.dataset["r"] === undefined ? "none" : `${a.dataset["r"]},${a.dataset["c"]}`;
  });
}

test.describe("the table viewer", () => {
  test("shows the headers, the first 100 rows, the total and the limit", async ({ page }) => {
    await bakeTable(page, people(250));
    await expect(grid(page)).toBeVisible();
    await expect(grid(page)).toHaveAttribute("aria-label", "Table, 250 rows, 4 columns");
    await expect(output(page).locator(".summary")).toHaveText(
      "250 rows, 4 columns. Showing the first 100 rows.",
    );
    await expect(output(page).locator(".hint")).toHaveText(
      "To see the rest, add a step that selects fewer rows.",
    );
    await expect(grid(page)).toHaveAttribute("aria-rowcount", "101");
    await expect(grid(page)).toHaveAttribute("aria-colcount", "5");
    // 100 rows by 4 columns is 400 cells: drawn whole.
    await expect(grid(page).locator("[role=row]")).toHaveCount(101);
    await expect(grid(page).locator("[role=columnheader]")).toHaveCount(5);
    await expect(grid(page).locator("[role=columnheader]").nth(2)).toHaveAttribute(
      "aria-label",
      "name, str",
    );
    await expect(grid(page).locator("[role=columnheader]").nth(4)).toHaveAttribute(
      "aria-label",
      "score, num",
    );
    await expect(page.locator("forge-output .footer")).toContainText("Type: ext{table}");
    await expect(cell(page, 1, 2)).toHaveText("person 1");
    await expect(cell(page, 100, 1)).toHaveText("100");
  });

  test("says no more when nothing is cut", async ({ page }) => {
    await bakeTable(page, people(5));
    await expect(output(page).locator(".summary")).toHaveText("5 rows, 4 columns.");
    await expect(output(page).locator(".hint")).toHaveCount(0);
  });

  test("a null, an empty string and the text null look different", async ({ page }) => {
    await bakeTable(page, people(30));
    const nul = cell(page, 7, 2);
    await expect(nul).toHaveText("null");
    await expect(nul).toHaveAttribute("aria-label", "null, no value");
    await expect(nul).toHaveClass(/null/);
    const empty = cell(page, 11, 2);
    await expect(empty).toHaveText('""');
    await expect(empty).toHaveAttribute("aria-label", "empty text");
    await expect(empty).toHaveClass(/empty/);
    const word = cell(page, 3, 3);
    await expect(word).toHaveText("null");
    await expect(word).not.toHaveClass(/null/);
    await expect(word).not.toHaveAttribute("aria-label", /.+/);
    const style = (r: number, c: number) =>
      cell(page, r, c).evaluate((el) => getComputedStyle(el).fontStyle);
    const styles = { nul: await style(7, 2), word: await style(3, 3), empty: await style(11, 2) };
    expect(styles).toEqual({ nul: "italic", word: "normal", empty: "normal" });
  });

  test("the keyboard moves by cell with a roving tabindex", async ({ page }) => {
    await bakeTable(page, people(40));
    await expect(grid(page)).toBeVisible();
    // Exactly one cell is in the tab order.
    await expect(grid(page).locator('[tabindex="0"]')).toHaveCount(1);
    await cell(page, 1, 1).focus();
    expect(await focused(page)).toBe("1,1");
    await page.keyboard.press("ArrowDown");
    expect(await focused(page)).toBe("2,1");
    await page.keyboard.press("ArrowRight");
    expect(await focused(page)).toBe("2,2");
    await page.keyboard.press("End");
    expect(await focused(page)).toBe("2,4");
    await page.keyboard.press("Home");
    expect(await focused(page)).toBe("2,0");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    expect(await focused(page)).toBe("0,0");
    await page.keyboard.press("Control+End");
    expect(await focused(page)).toBe("40,4");
    await page.keyboard.press("Control+Home");
    expect(await focused(page)).toBe("0,0");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("PageDown");
    expect(Number((await focused(page)).split(",")[0])).toBeGreaterThan(3);
    await page.keyboard.press("PageUp");
    expect(await focused(page)).toBe("1,0");
    // The roving tab stop followed the focus, and Tab leaves the grid.
    await expect(grid(page).locator('[tabindex="0"]')).toHaveCount(1);
    await page.keyboard.press("Tab");
    expect(await focused(page)).toBe("none");
  });

  test("Ctrl+C on a cell copies its text", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await bakeTable(page, people(12));
    await cell(page, 2, 2).focus();
    await page.keyboard.press("Control+C");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("person 2");
  });

  test("a table beyond 5,000 cells is windowed and every row stays reachable", async ({ page }) => {
    const columns = Array.from({ length: 60 }, (_, i) => ({ name: `col${i}`, type: "str" }));
    const rows = Array.from({ length: 100 }, (_, r) =>
      columns.map((_c, c) => `r${r + 1}c${c + 1}`),
    );
    await bakeTable(page, { columns, rows });
    await expect(grid(page)).toBeVisible();
    const drawn = await grid(page).locator("[role=gridcell]").count();
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(100 * 60);
    await expect(grid(page)).toHaveAttribute("aria-rowcount", "101");
    await cell(page, 1, 1).focus();
    await page.keyboard.press("Control+End");
    expect(await focused(page)).toBe("100,60");
    await expect(cell(page, 100, 60)).toHaveText("r100c60");
    await expect(grid(page).locator('[role=row][aria-rowindex="101"]')).toHaveCount(1);
    await page.keyboard.press("Control+Home");
    expect(await focused(page)).toBe("0,0");
    await page.keyboard.press("PageDown");
    await page.keyboard.press("PageDown");
    await page.keyboard.press("PageDown");
    const row = Number((await focused(page)).split(",")[0]);
    expect(row).toBeGreaterThan(10);
    await expect(cell(page, row, 0)).toBeVisible();
  });

  test("Convert to bytes offers CSV and JSON, and the next bake is bytes", async ({ page }) => {
    await bakeTable(page, people(4));
    await expect(grid(page)).toBeVisible();
    await expect(output(page).getByRole("button", { name: "Move to input" })).toHaveCount(0);
    await output(page).getByRole("button", { name: "Convert to bytes" }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Table to CSV", "Table to JSON"]);
    await page.getByRole("menuitem", { name: "Table to CSV" }).click();
    await expect(output(page).locator("pre.text")).toContainText("id,name,country,score");
    await expect(output(page).locator("pre.text")).toContainText("1,person 1,NZ,1.5");
    await expect(output(page).getByRole("button", { name: "Move to input" })).toBeVisible();
  });

  test("hostile cells and names are text, long cells are cut by the layout, and nothing runs", async ({
    page,
  }) => {
    page.on("dialog", (d) => {
      throw new Error(`unexpected dialog: ${d.message()}`);
    });
    const long = "x".repeat(6000);
    const columns = Array.from({ length: 40 }, (_, i) => ({ name: `c${i}`, type: "str" }));
    columns[0] = { name: "<img src=x onerror=alert(1)>", type: "str" };
    columns[1] = { name: "w".repeat(300), type: "str" };
    const rows: Cell[][] = [
      columns.map((_c, i) =>
        i === 0
          ? "<img src=x onerror=alert(1)></script>"
          : i === 1
            ? long
            : i === 2
              ? "a\u0007b‮c\u0000d\ne"
              : i === 3
                ? "héllo 世界 😀"
                : "",
      ),
    ];
    await bakeTable(page, { columns, rows });
    await expect(grid(page)).toBeVisible();
    await expect(grid(page).locator("img")).toHaveCount(0);
    await expect(cell(page, 1, 1)).toHaveText("<img src=x onerror=alert(1)></script>");
    await expect(cell(page, 1, 3)).toHaveText("a\\x07b\\u202Ec\\x00d\\ne");
    await expect(cell(page, 1, 4)).toHaveText("héllo 世界 😀");
    // The whole text is in the DOM and the width is limited by the layout (24 rem at most).
    await expect(cell(page, 1, 2)).toHaveText(long);
    const box = (await cell(page, 1, 2).boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(24 * 16 + 2);
    // Many columns scroll inside the grid; the page does not.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(await grid(page).evaluate((g) => g.scrollWidth > g.clientWidth)).toBe(true);
  });
});

for (const [label, id] of [
  ["Light", "light"],
  ["Dark", "dark"],
  ["High contrast", "contrast"],
] as const) {
  test.describe(`${label} theme`, () => {
    test.use({ viewport: { width: 1400, height: 1600 } });

    test("the table passes axe", async ({ page }) => {
      await bakeTable(page, people(250));
      await expect(grid(page)).toBeVisible();
      await page.getByRole("button", { name: /^Theme/ }).click();
      await page.getByRole("menuitemradio", { name: label }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", id);
      await audit(page, `${id} table`);
    });
  });
}

test.describe("a narrow screen", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("the grid scrolls inside its own region and the page does not", async ({ page }) => {
    await bakeTable(page, people(30));
    await page.getByRole("tab", { name: "Output", exact: true }).click();
    await expect(grid(page)).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const box = (await cell(page, 1, 1).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(36);
  });
});
