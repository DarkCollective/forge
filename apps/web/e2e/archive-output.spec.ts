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

// Wave 6 (WP 5.40): Unzip and Untar return a list of records, which the output pane renders as a tree.
// The archives are the vectors of vocab/zip.test.json and vocab/tar.test.json (made by Python and bsdtar).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodeEncoded, encodeShare } from "@forge/recipe";
import type { CatalogueView, Recipe } from "@forge/recipe";
import { test, expect, openApp } from "./fixtures";

interface Vector {
  name: string;
  op: string;
  params: Record<string, unknown>;
  input: { value: string; enc: string };
}

const vocabDir = fileURLToPath(new URL("../../../packages/ops/vocab/", import.meta.url));
const catalogue = JSON.parse(
  readFileSync(fileURLToPath(import.meta.resolve("@forge/ops/catalogue.json")), "utf8"),
) as CatalogueView;

function vector(file: string, start: string): Vector {
  const all = JSON.parse(readFileSync(vocabDir + file, "utf8")) as Vector[];
  const v = all.find((x) => x.name.startsWith(start));
  if (!v) throw new Error(`${file}: no vector named ${start}`);
  return v;
}

async function openArchive(page: Parameters<typeof openApp>[0], v: Vector): Promise<void> {
  const recipe = {
    forge: 1,
    steps: [{ kind: "op", op: v.op, params: v.params }],
  } as unknown as Recipe;
  const shared = await encodeShare(
    { recipe, input: decodeEncoded(v.input as never), inputEncoding: "hex" },
    { catalogue },
  );
  if (!shared.ok) throw new Error(`cannot share ${v.name}: ${shared.error.message}`);
  await openApp(page, "#" + shared.fragment);
  await expect(page.locator("forge-output .pill.stale")).toHaveCount(0);
}

test("Untar: the list of records renders as a tree in the output pane", async ({ page }) => {
  await openArchive(page, vector("tar.test.json", "untar: bsdtar --format ustar"));
  const tree = page.locator("forge-output ul.tree");
  await expect(tree).toBeVisible();
  await expect(tree.locator("summary .tag").first()).toHaveText(/list of 5/);
  await expect(tree).toContainText('"tt/"');
  await expect(tree).toContainText('"tt/f1.txt"');
  await expect(tree).toContainText('"tt/sub/f2.bin"');
  await expect(tree.locator(".key", { hasText: /^size$/ }).first()).toBeVisible();
  await expect(tree.locator(".key", { hasText: /^mode$/ }).first()).toBeVisible();
  // the data of a text file is shown as text, a directory's empty data as an empty string
  await expect(tree).toContainText("hello hello hello");
});

test("Unzip: the list of records renders as a tree in the output pane", async ({ page }) => {
  await openArchive(page, vector("zip.test.json", "unzip: three entries"));
  const tree = page.locator("forge-output ul.tree");
  await expect(tree).toBeVisible();
  await expect(tree.locator("summary .tag").first()).toHaveText(/list of 3/);
  await expect(tree).toContainText('"a.txt"');
  await expect(tree).toContainText('"dir/"');
  await expect(tree).toContainText('"dir/b.bin"');
  await expect(tree).toContainText("hello hello hello");
  await expect(tree.locator(".key", { hasText: /^mtime$/ }).first()).toBeVisible();
});
