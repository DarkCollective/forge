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
// WP 6.13: the operations help shows when to use an operation, runnable examples, the inverse and links.
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { test, expect, openApp, cards, expectOutput, input, opSearch, tabTo } from "./fixtures";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const dialog = (page: Page): Locator => page.locator("forge-op-help dialog");

/** Alt+1, search for the exact name, Enter into the list, `?`: keyboard only. */
async function openHelp(page: Page, qname: string): Promise<void> {
  await page.keyboard.press("Alt+1");
  await expect(opSearch(page)).toBeFocused();
  await opSearch(page).fill(qname);
  await page.keyboard.press("Enter");
  await expect(
    page.locator(`forge-operations [role=option][title="${qname}"]`).first(),
  ).toBeFocused();
  await page.keyboard.press("?");
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).locator("h2")).toHaveText(qname);
}

const tryIt = (page: Page, title: string): Locator =>
  dialog(page).getByRole("button", { name: `Try it: ${title}` });

test("help for base64:decode shows the use-when line, an example and a link", async ({ page }) => {
  await openApp(page);
  await openHelp(page, "base64:decode");
  await expect(dialog(page).getByRole("heading", { name: "Use this when" })).toBeVisible();
  await expect(dialog(page)).toContainText("want the bytes it stands for");
  await expect(dialog(page).getByRole("heading", { name: "Decode plain text" })).toBeVisible();
  await expect(dialog(page)).toContainText("Zm9vYmFy");
  await expect(dialog(page)).toContainText("Source: RFC 4648");
  // the example that fails shows its error code; the hex result is shown as hex
  await expect(dialog(page)).toContainText("Fails with the error E_COERCE");
  const link = dialog(page).getByRole("link", { name: /RFC 4648, section 4/ });
  await expect(link).toHaveAttribute("href", "https://www.rfc-editor.org/rfc/rfc4648#section-4");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(link).toContainText("opens in a new tab");
  // The old help is still there.
  await expect(dialog(page).getByRole("heading", { name: "Parameters" })).toBeVisible();
  await expect(dialog(page)).toContainText("alphabet");
  // Escape closes it and focus returns to the row.
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator('forge-operations [role=option][title="base64:decode"]')).toBeFocused();
});

test("Try it on an empty workbench runs the example", async ({ page }) => {
  await openApp(page);
  await openHelp(page, "base64:decode");
  await tabTo(page, tryIt(page, "Decode plain text"));
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeHidden();
  await expect(cards(page)).toHaveCount(1);
  await expect(input(page)).toHaveValue("Zm9vYmFy");
  await expectOutput(page, "foobar");
  await expect(page.locator("[role=status]").filter({ hasText: "Loaded the example" })).toHaveCount(
    1,
  );
});

test("Try it passes the example's parameters and shows hex results", async ({ page }) => {
  await openApp(page);
  await openHelp(page, "base64:decode");
  await tryIt(page, "Decode the URL-safe alphabet").click();
  await expect(input(page)).toHaveValue("-_8");
  // Not text (0xfb 0xff), so the output pane shows it as bytes.
  await expect(page.locator("forge-output")).toContainText(/fb\s*ff/i);
  await expect(cards(page).first()).toContainText("url");
});

test("Try it carries byte, choice and number parameters and a hex input (hkdf:derive)", async ({
  page,
}) => {
  await openApp(page);
  await openHelp(page, "hkdf:derive");
  await tryIt(page, "RFC 5869 test case 1: SHA-256 with salt and info").click();
  await expect(dialog(page)).toBeHidden();
  await expect(cards(page)).toHaveCount(1);
  // The input is in the example's own encoding, not re-read as text.
  await expect(input(page)).toHaveAttribute("aria-label", /Hex/);
  await expect(input(page)).toHaveValue(Array(22).fill("0b").join(" "));
  // No validation issue on the card, and the 42 bytes of RFC 5869 test case 1 are the output.
  await expect(page.locator("forge-recipe [role=alert]")).toHaveCount(0);
  const out = page.locator("forge-output");
  await expect(out.locator(".pill.stale")).toHaveCount(0);
  await expect(out).toContainText(/3c\s*b2\s*5f\s*25\s*fa\s*ac\s*d5\s*7a/i);
  await expect(out).toContainText(/58\s*65/i);
});

test("Try it with existing work asks first and loses nothing", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("Alt+1");
  await opSearch(page).fill("hex:encode");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(cards(page)).toHaveCount(1);
  await input(page).fill("my own data");
  await expectOutput(page, "6d79206f776e2064617461");

  await openHelp(page, "base64:decode");
  await tryIt(page, "Decode plain text").click();
  // Not yet: the dialog asks, and nothing has changed.
  const confirm = dialog(page).getByRole("group", { name: "Replace the recipe?" });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("Undo");
  await expect(dialog(page).getByRole("button", { name: "Replace the recipe" })).toBeFocused();
  await expect(input(page)).toHaveValue("my own data");
  await expect(cards(page)).toHaveCount(1);
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  await expect(cards(page)).toHaveCount(1);
  await expectOutput(page, "6d79206f776e2064617461");

  // Confirm: the example gets its own input tab, the user's input stays in its tab, Undo restores the recipe.
  await tryIt(page, "Decode plain text").click();
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeHidden();
  await expect(input(page)).toHaveValue("Zm9vYmFy");
  await expectOutput(page, "foobar");
  await expect(page.getByRole("tab", { name: /Example: Decode plain text/ })).toBeVisible();
  await page.getByRole("tab", { name: /Input 1/ }).click();
  await expect(input(page)).toHaveValue("my own data");
  await page.locator("forge-recipe").getByRole("button", { name: /Undo/ }).click();
  await expect(page.locator("forge-recipe .card").first()).toContainText("hex");
  await expectOutput(page, "6d79206f776e2064617461");
});

test("an operation with no help data shows the old help only", async ({ page }) => {
  await openApp(page);
  // A user word never gets help from the document, whatever its name, so this stays true however much
  // bundled content the document covers. Make one the way persist.spec.ts does.
  await page.keyboard.press("Alt+1");
  await opSearch(page).fill("hex:encode");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(cards(page)).toHaveCount(1);
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
  await expect(async () => {
    await page.keyboard.press("Alt+1");
    await opSearch(page).fill("tohex");
    await expect(page.locator("forge-operations [role=option]").first()).toContainText("tohex", {
      timeout: 1000,
    });
  }).toPass({ timeout: 20_000 });
  await page.keyboard.press("Enter");
  await page.keyboard.press("?");
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).locator("h2")).toHaveText(/tohex/);
  // Wait for the help document to finish loading, so the absences below are not just "not yet".
  await expect(dialog(page)).not.toContainText("Loading examples");
  await expect(dialog(page).getByRole("heading", { name: "Parameters" })).toBeVisible();
  await expect(dialog(page).getByRole("heading", { name: "Use this when" })).toHaveCount(0);
  await expect(dialog(page).getByRole("heading", { name: "Examples" })).toHaveCount(0);
  // A user word has no reference page (pages exist for the bundled catalogue only), so no links at all.
  await expect(dialog(page).getByRole("link")).toHaveCount(0);
  await expect(dialog(page).getByRole("alert")).toHaveCount(0);
});

test("a failed help load degrades to the old help", async ({ page, problems }) => {
  await page.route(/\/assets\/help-[^/]*\.js/, (route) => route.abort());
  await openApp(page);
  await openHelp(page, "base64:decode");
  await expect(dialog(page).getByRole("alert")).toContainText("could not be loaded");
  await expect(dialog(page).getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(dialog(page).getByRole("heading", { name: "Parameters" })).toBeVisible();
  await expect(dialog(page)).toContainText("alphabet");
  await expect(dialog(page).getByRole("heading", { name: "Examples" })).toHaveCount(0);
  // The blocked request is the point of the test; anything else would still fail it.
  expect(problems.every((p) => /help-[\w-]+\.js|ERR_FAILED/.test(p))).toBe(true);
  problems.length = 0;
});

test("the inverse can be added or followed", async ({ page }) => {
  await openApp(page);
  await openHelp(page, "base64:decode");
  await dialog(page).getByRole("button", { name: "Show help for base64:encode" }).click();
  await expect(dialog(page).locator("h2")).toHaveText("base64:encode");
  await expect(dialog(page).locator("h2")).toBeFocused();
  await dialog(page).getByRole("button", { name: "Back to base64:decode" }).click();
  await expect(dialog(page).locator("h2")).toHaveText("base64:decode");
  await expect(dialog(page).locator("h2")).toBeFocused();
  // Transient UI state: nothing about the open help reaches the URL.
  expect(page.url()).not.toContain("help");
  await dialog(page).getByRole("button", { name: "Add base64:encode to the recipe" }).click();
  await expect(dialog(page)).toBeHidden();
  // The announcement is made after the dialog has closed (the live region is inert behind a modal).
  await expect(
    page.locator("[role=status]").filter({ hasText: "Added base64:encode to the recipe" }),
  ).toHaveCount(1);
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toContainText("encode");
});

test("the help dialog is accessible", async ({ page }) => {
  await openApp(page);
  await openHelp(page, "base64:decode");
  const run = async (): Promise<void> => {
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations().map((a) => a.finished));
    });
    const v = (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations;
    expect(v.map((x) => `${x.id}: ${x.nodes[0]?.target.join(" ")}`)).toEqual([]);
  };
  await run();
  await page.keyboard.press("Escape");
  for (const [label, id] of [
    ["Dark", "dark"],
    ["High contrast", "contrast"],
  ] as const) {
    await page.getByRole("button", { name: /^Theme/ }).click();
    await page.getByRole("menuitemradio", { name: label }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", id);
    await openHelp(page, "base64:decode");
    await run();
    await page.keyboard.press("Escape");
  }
});

test.describe("compact layout", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("help works with touch-style clicks and Try it shows the output", async ({ page }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Operations", exact: true }).click();
    await opSearch(page).fill("base64:decode");
    await page.locator('forge-operations button[aria-label="Help for base64:decode"]').click();
    await expect(dialog(page)).toBeVisible();
    const box = (await dialog(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    // no horizontal scrolling inside the dialog
    expect(
      await dialog(page).evaluate((d) => d.querySelector(".body")!.scrollWidth <= d.clientWidth),
    ).toBe(true);
    await tryIt(page, "Decode plain text").click();
    await expect(dialog(page)).toBeHidden();
    await expect(page.getByRole("tab", { name: "Output", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expectOutput(page, "foobar");
  });
});

test("Try it on an example with CR LF input sets the tab's line ending", async ({ page }) => {
  await openApp(page);
  await openHelp(page, "csv:to-json");
  await tryIt(page, "Rows read as objects keyed by the header").click();
  await expect(dialog(page)).toBeHidden();
  // The input tab shows CR LF, not the default LF, so a later edit keeps the line breaks.
  await expect(page.locator("forge-input").getByLabel("Line ending")).toHaveValue("crlf");
  await expectOutput(
    page,
    JSON.stringify(
      [
        { name: "Ada", age: "36" },
        { name: "Alan", age: "41" },
      ],
      null,
      2,
    ),
  );
});

test("a bundled op links to its reference page, which exists", async ({ page, request }) => {
  await openApp(page);
  await openHelp(page, "base64:decode");
  // base64:decode also has outside links; the same-origin one is the op's own page (WP 6.17).
  const own = dialog(page).locator('a[href^="/"]');
  await expect(own).toHaveCount(1);
  await expect(own).toHaveText("Reference page");
  const href = (await own.getAttribute("href")) as string;
  expect(href).toBe("/ops/base64/decode/");
  expect((await request.get(href)).status()).toBe(200);
});
