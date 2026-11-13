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
// WP 6.19: input that arrives with its bytes (a share link) gets its line ending inferred, so an edit keeps it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { encodeShare } from "@forge/recipe";
import type { CatalogueView, Recipe } from "@forge/recipe";
import { test, expect, openApp, expectOutput, input } from "./fixtures";

const catalogue = JSON.parse(
  readFileSync(fileURLToPath(import.meta.resolve("@forge/ops/catalogue.json")), "utf8"),
) as CatalogueView;

async function hashFor(text: string): Promise<string> {
  const recipe = { forge: 1, steps: [{ kind: "op", op: "hex:encode" }] } as unknown as Recipe;
  const shared = await encodeShare(
    { recipe, input: new TextEncoder().encode(text), inputEncoding: "utf8" },
    { catalogue },
  );
  if (!shared.ok) throw new Error(shared.error.message);
  return "#" + shared.fragment;
}

test("a share link with CR LF input shows CR LF and an edit keeps the line breaks (WP 6.19)", async ({
  page,
}) => {
  await openApp(page, await hashFor("a\r\nb\r\n"));
  await expectOutput(page, "610d0a620d0a");
  await expect(page.locator("forge-input").getByLabel("Line ending")).toHaveValue("crlf");
  await input(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("c");
  await expectOutput(page, "610d0a620d0a63");
});

test("a share link with LF input and one with no line breaks show LF (WP 6.19)", async ({
  page,
}) => {
  await openApp(page, await hashFor("a\nb\n"));
  await expect(page.locator("forge-input").getByLabel("Line ending")).toHaveValue("lf");
  await expectOutput(page, "610a620a");
});
