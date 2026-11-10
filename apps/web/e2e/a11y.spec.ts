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
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect, openApp, addOpByKeyboard, dragTo, cards, expectOutput } from "./fixtures";

// WCAG 2.0, 2.1 and 2.2, levels A and AA. Zero violations is the target. Rules are never disabled wholesale: an
// exclusion needs a written justification next to it; there are none.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function audit(page: Page, label: string): Promise<void> {
  type Violation = Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"][number];
  let violations: Violation[] = [];
  // A theme switch starts colour transitions, and axe measures contrast on the colours in flight. When the only
  // findings are contrast ones, look again after the transitions have had time to end: a real contrast failure
  // is still there, a half-faded one is not.
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.evaluate(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await Promise.all(document.getAnimations().map((a) => a.finished));
    });
    violations = (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations;
    if (violations.length === 0 || violations.some((v) => v.id !== "color-contrast")) break;
    await page.waitForTimeout(300);
  }
  const summary = violations.map(
    (v) =>
      `${label}: ${v.id} (${v.impact}) x${v.nodes.length}: ` +
      v.nodes
        .slice(0, 3)
        .map(
          (n) =>
            `${n.target.join(" >> ")} [${(n.any[0]?.message ?? n.failureSummary ?? "").slice(0, 160)}]`,
        )
        .join(" | "),
  );
  expect(summary, `axe violations\n${summary.join("\n")}`).toEqual([]);
}

const THEMES = [
  ["Light", "light"],
  ["Dark", "dark"],
  ["High contrast", "contrast"],
] as const;

async function setTheme(page: Page, label: string, id: string): Promise<void> {
  await page.getByRole("button", { name: /^Theme/ }).click();
  await page.getByRole("menuitemradio", { name: label }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", id);
}

/** Builds a recipe with a nested block and a failing step, and some input. */
async function populate(page: Page): Promise<void> {
  await addOpByKeyboard(page, "hex decode");
  await page.getByRole("button", { name: /Add block/ }).click();
  await page.getByRole("menuitem", { name: /fork/i }).click();
  const lane = page.getByText(/Drop steps here/).first();
  await page.locator("forge-operations input#op-search").fill("base64 encode");
  await dragTo(page, page.locator("forge-operations [role=option]").first(), lane);
  await expect(cards(page)).toHaveCount(3);
  await page.keyboard.press("Alt+3");
  await page.keyboard.type("not hex at all");
  await expect(page.locator("forge-output .error-panel")).toBeVisible();
}

for (const [label, id] of THEMES) {
  test.describe(`${label} theme`, () => {
    test.use({ viewport: { width: 1400, height: 1600 } });

    test("empty app", async ({ page }) => {
      await openApp(page);
      await setTheme(page, label, id);
      await audit(page, `${id} empty`);
    });

    test("populated recipe with nested blocks and an error", async ({ page }) => {
      await openApp(page);
      await setTheme(page, label, id);
      await populate(page);
      await audit(page, `${id} populated`);
    });

    test("a good bake and the hex view", async ({ page }) => {
      await openApp(page);
      await setTheme(page, label, id);
      await addOpByKeyboard(page, "hex decode");
      await page.keyboard.press("Alt+3");
      await page.keyboard.type("48656c6c6f");
      await expectOutput(page, "Hello");
      await page.getByRole("button", { name: "Hex", exact: true }).click();
      await audit(page, `${id} hex view`);
    });
  });
}

test.describe("dialogs, menus and the console", () => {
  test.use({ viewport: { width: 1400, height: 1000 } });

  const dialogs: [string, (page: Page) => Promise<void>][] = [
    [
      "share",
      (p) =>
        p
          .getByRole("button", { name: "Share", exact: true })
          .click()
          .then(() => undefined),
    ],
    [
      "save",
      (p) =>
        p
          .getByRole("button", { name: "Save", exact: true })
          .click()
          .then(() => undefined),
    ],
    [
      "open",
      (p) =>
        p
          .getByRole("button", { name: "Open", exact: true })
          .click()
          .then(() => undefined),
    ],
    [
      "view FL",
      (p) =>
        p
          .getByRole("button", { name: "View FL" })
          .click()
          .then(() => undefined),
    ],
    [
      "shortcuts",
      async (p) => {
        await p.getByRole("button", { name: "More" }).click();
        await p.getByRole("menuitem", { name: "Keyboard shortcuts" }).click();
      },
    ],
  ];

  for (const [theme, id] of [THEMES[0], THEMES[1], THEMES[2]]) {
    for (const [name, open] of dialogs) {
      test(`${name} dialog, ${id} theme`, async ({ page }) => {
        await openApp(page);
        await setTheme(page, theme, id);
        await addOpByKeyboard(page, "hex encode");
        await open(page);
        await expect(page.locator("dialog[open]")).toBeVisible();
        await audit(page, `${id} ${name} dialog`);
      });
    }
  }

  test("open dialog with a saved recipe and the promote form", async ({ page }) => {
    await openApp(page);
    await addOpByKeyboard(page, "hex encode");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.locator("#save-name").fill("audit recipe");
    await page.getByRole("button", { name: "Save", exact: true }).last().click();
    await expect(page.locator("#save-name")).toHaveCount(0);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.getByRole("button", { name: "Promote audit recipe to a word" }).click();
    await expect(page.locator("#word-name")).toBeVisible();
    await audit(page, "open dialog with promote form");
    await page.getByRole("tab", { name: /My words/ }).click();
    await audit(page, "open dialog, my words");
  });

  test("menus", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: /^Theme/ }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await audit(page, "theme menu");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await audit(page, "more menu");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /Add block/ }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await audit(page, "add block menu");
  });

  test("operations help popover", async ({ page }) => {
    await openApp(page);
    await page.locator("forge-operations input#op-search").fill("rot");
    await page.locator("forge-operations [role=option]").first().focus();
    await page.keyboard.press("?");
    await audit(page, "operations help");
  });

  test("console open with output", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("Alt+5");
    await page.locator("forge-console input#cmd").fill("2 3 + .s");
    await page.keyboard.press("Enter");
    await expect(page.locator("forge-console [role=log]")).toContainText("<1> 5");
    await audit(page, "console");
  });

  test("a recipe opened from a share link with warnings", async ({ page }) => {
    await openApp(page, "#v=2&r=AA");
    await expect(page.locator(".notice").first()).toBeVisible();
    await audit(page, "link notice");
  });
});

test.describe("compact layout", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  for (const [label, id] of THEMES) {
    test(`all tabs, ${id} theme`, async ({ page }) => {
      await openApp(page);
      await setTheme(page, label, id);
      await addOpByKeyboard(page, "hex encode");
      for (const name of ["Operations", "Recipe", "Input", "Output"]) {
        await page.getByRole("tab", { name, exact: true }).click();
        await audit(page, `${id} compact ${name}`);
      }
    });
  }
});

test.describe("site pages", () => {
  for (const path of ["/about/", "/privacy/", "/terms/", "/security/", "/accessibility/"]) {
    test(`${path}`, async ({ page }) => {
      await page.goto(path);
      await audit(page, path);
    });
  }
  test("404", async ({ page }) => {
    await page.goto("/404.html");
    await audit(page, "404");
  });
});

for (const [label, id] of THEMES.slice(1)) {
  test(`site page in the ${id} theme`, async ({ page }) => {
    await openApp(page);
    await setTheme(page, label, id);
    await page.goto("/about/");
    await audit(page, `about ${id}`);
  });
}
