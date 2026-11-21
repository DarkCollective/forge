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
// WP 6.40: recipe M (RECIPES-1.1.md CR131), the registers listed at a pause (CR137), a register error (CR133),
// the share-dialog note (Q18) and the FL dialog, against the production build with the production headers.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { encodeShare } from "@forge/recipe";
import type { CatalogueView, Recipe } from "@forge/recipe";
import type { Page } from "@playwright/test";
import { test, expect, openApp, expectOutput } from "./fixtures";
import { audit } from "./audit";

const catalogue = JSON.parse(
  readFileSync(fileURLToPath(import.meta.resolve("@forge/ops/catalogue.json")), "utf8"),
) as CatalogueView;

const BLOB_HEX =
  "a0a1a2a3a4a5a6a7a8a9aaabacadaeaf000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f" +
  "6f498b8b870a0d8175f26312b99705c8";

function take(start: number, length: number): unknown {
  return { kind: "op", op: "bytes-slice:take", params: { start, length } };
}

/** Recipe M (CR101). */
const RECIPE_M = {
  forge: 1,
  steps: [
    { kind: "register", name: "iv", steps: [take(0, 16)] },
    { kind: "register", name: "key", steps: [take(16, 32)] },
    { kind: "op", op: "bytes-slice:remove", params: { start: 0, length: 48 } },
    {
      kind: "op",
      op: "aes:decrypt",
      params: { key: { ref: "key" }, iv: { ref: "iv" }, mode: "CBC" },
    },
  ],
} as unknown as Recipe;

async function link(recipe: Recipe, input: Uint8Array, encoding: "hex" | "utf8"): Promise<string> {
  const shared = await encodeShare({ recipe, input, inputEncoding: encoding }, { catalogue });
  if (!shared.ok) throw new Error(shared.error.message);
  return "#" + shared.fragment;
}

const hexBytes = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));

async function openM(page: Page): Promise<void> {
  await openApp(page, await link(RECIPE_M, hexBytes(BLOB_HEX), "hex"));
}

test("recipe M decrypts the 64-byte blob to 'attack at dawn' (CR131)", async ({ page }) => {
  await openM(page);
  await expect(page.locator("forge-recipe .card")).toHaveCount(6);
  await expectOutput(page, "attack at dawn");
});

test("a pause lists the registers, secret ones redacted, and the view is axe clean (CR137)", async ({
  page,
}) => {
  await openM(page);
  await expectOutput(page, "attack at dawn");
  // the register panel is absent when nothing is paused
  await expect(page.locator("forge-output .registers")).toHaveCount(0);

  const aes = page.locator('forge-recipe .card[data-path="/steps/3"]');
  const toggle = aes.locator('button[data-action="breakpoint"]');
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Debug", exact: true }).click();
  await page.getByRole("button", { name: "Bake", exact: true }).click();

  const panel = page.locator("forge-output .registers");
  await expect(panel).toBeVisible();
  await expect(page.locator("forge-bake-controls")).toContainText("Paused at step");
  const rows = panel.locator("li");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("iv");
  await expect(rows.nth(0)).toContainText("<redacted>");
  await expect(rows.nth(1)).toContainText("key");
  await expect(rows.nth(1)).toContainText("<redacted>");
  // the key bytes are never rendered in the panel
  expect(await panel.innerText()).not.toMatch(/0001020304|a0a1a2a3/i);
  await audit(page, "registers at a pause");

  // Show step selects the defining register step
  await rows.nth(0).getByRole("button").click();
  await expect(page.locator('forge-recipe .card[data-path="/steps/0"]')).toBeVisible();

  // continuing clears the panel and finishes the bake
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(panel).toHaveCount(0);
  await expectOutput(page, "attack at dawn");
});

test("a pause shows the plain value of a register that is not secret (CR137)", async ({ page }) => {
  const recipe = {
    forge: 1,
    steps: [
      { kind: "register", name: "head", steps: [take(0, 2)] },
      { kind: "op", op: "hex:encode", breakpoint: true },
    ],
  } as unknown as Recipe;
  await openApp(page, await link(recipe, new TextEncoder().encode("hello"), "utf8"));
  await page.getByRole("button", { name: "Debug", exact: true }).click();
  await page.getByRole("button", { name: "Bake", exact: true }).click();
  const row = page.locator("forge-output .registers li");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("head");
  await expect(row).toContainText('"he"');
  await expect(row).not.toContainText("<redacted>");
  await audit(page, "plain register at a pause");
});

test("a register error names the register that supplied the parameter (CR133)", async ({
  page,
}) => {
  const recipe = {
    forge: 1,
    steps: [
      { kind: "register", name: "n", steps: [take(0, 1)] },
      { kind: "op", op: "classical:rot", params: { amount: { ref: "n" } } },
    ],
  } as unknown as Recipe;
  await openApp(page, await link(recipe, new TextEncoder().encode("banana"), "utf8"));
  const panel = page.locator("forge-output .error-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("E_TYPE");
  await expect(panel).toContainText(/The parameter amount was supplied by\s+register n\./);
  await audit(page, "register error");
});

test("the share dialog notes that the recipe needs Forge 1.1, and the key sentence", async ({
  page,
}) => {
  await openM(page);
  await page.getByRole("button", { name: "Share" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "This recipe needs Forge 1.1 or later; older versions show an error.",
  );
  await expect(dialog).toContainText("A register takes its key from the input");
  await audit(page, "share dialog with the 1.1 note");
});

test("the share dialog has no 1.1 note for a recipe without registers", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Share" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).not.toContainText("Forge 1.1");
});

test("the FL dialog shows the compiled FL of a recipe with registers", async ({ page }) => {
  await openM(page);
  await page.getByRole("button", { name: "View FL" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("$iv");
  await expect(dialog).toContainText("$key");
  await audit(page, "FL dialog with registers");
});

test("the FL dialog shows a return as core:exit", async ({ page }) => {
  const recipe = {
    forge: 1,
    steps: [{ kind: "op", op: "hex:decode" }, { kind: "return" }, { kind: "op", op: "text:upper" }],
  } as unknown as Recipe;
  await openApp(page, await link(recipe, new TextEncoder().encode("6162"), "utf8"));
  await expectOutput(page, "ab");
  await page.getByRole("button", { name: "View FL" }).click();
  await expect(page.getByRole("dialog")).toContainText("core:exit");
});
