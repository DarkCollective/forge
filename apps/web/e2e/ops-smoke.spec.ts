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

// Gate 4 smoke test (PLAN section 7): data-driven from packages/ops/vocab/*.test.json. For every vocabulary, a
// couple of vectors with a utf8 text expectation are opened through a share link in the production build and
// the output pane must show the expected text. The exhaustive check is `npm run gate4:browser -w @forge/worker`.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodeEncoded, encodeShare } from "@forge/recipe";
import type { CatalogueView, Recipe } from "@forge/recipe";
import { test, expect, openApp, outputText } from "./fixtures";

interface Encoded {
  value: string;
  enc: string;
}
interface Vector {
  name?: string;
  op: string;
  params: Record<string, unknown>;
  input: Encoded;
  expect: Partial<Encoded> & { error?: string; json?: unknown };
}

const PER_VOCAB = 2;
const vocabDir = fileURLToPath(new URL("../../../packages/ops/vocab/", import.meta.url));
const catalogue = JSON.parse(
  readFileSync(fileURLToPath(import.meta.resolve("@forge/ops/catalogue.json")), "utf8"),
) as CatalogueView;

/** Output text the pane shows verbatim: a non-empty, single-line utf8 value without edge whitespace. */
function showable(s: string): boolean {
  return s.length > 0 && s.length <= 200 && s === s.trim() && !/[\p{C}\n\r]/u.test(s);
}

/** The text the output pane shows for the expectation, or null when it is not plain text: the pane shows bytes that are valid utf8 as text. */
function shown(v: Vector): string | null {
  const { value, enc } = v.expect;
  if (typeof value !== "string" || (enc !== "utf8" && enc !== "hex")) return null;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(decodeEncoded({ value, enc }));
  } catch {
    return null;
  }
  return showable(text) ? text : null;
}

/** Vectors with a plain utf8 input and a showable expectation, utf8 expectations first, one per op, up to `n`. */
function pick(vectors: Vector[], n: number): Vector[] {
  const names = new Set(catalogue.ops.map((o) => o.qname));
  const usable = vectors.filter(
    (v) =>
      names.has(v.op) &&
      shown(v) !== null &&
      v.input.enc === "utf8" &&
      !/[\p{C}]/u.test(v.input.value),
  );
  const ordered = [
    ...usable.filter((v) => v.expect.enc === "utf8"),
    ...usable.filter((v) => v.expect.enc !== "utf8"),
  ];
  const chosen: Vector[] = [];
  const seen = new Set<string>();
  for (const v of ordered) {
    if (seen.has(v.op)) continue;
    seen.add(v.op);
    chosen.push(v);
    if (chosen.length === n) break;
  }
  return chosen;
}

const files = readdirSync(vocabDir)
  .filter((f) => f.endsWith(".test.json"))
  .sort();

for (const file of files) {
  const vectors = JSON.parse(readFileSync(vocabDir + file, "utf8")) as Vector[];
  const chosen = pick(vectors, PER_VOCAB);
  const vocab = file.slice(0, -".test.json".length);

  test(`${vocab}: vectors bake to the expected text through the UI`, async ({ page }) => {
    test.skip(chosen.length === 0, `${file} has no vector with a plain utf8 expectation`);
    let first = true;
    for (const v of chosen) {
      const recipe = {
        forge: 1,
        steps: [{ kind: "op", op: v.op, params: v.params }],
      } as unknown as Recipe;
      const shared = await encodeShare(
        { recipe, input: decodeEncoded(v.input as never), inputEncoding: "utf8" },
        { catalogue },
      );
      if (!shared.ok) throw new Error(`cannot share ${file} ${v.op}: ${shared.error.message}`);
      const hash = "#" + shared.fragment;
      if (first) await openApp(page, hash);
      else {
        await page.goto("/" + hash);
        await page.reload();
        await expect(page.getByText(/\d+ operations/)).toBeVisible();
      }
      first = false;
      await expect(page.locator("forge-output .pill.stale"), v.name ?? v.op).toHaveCount(0);
      await expect(outputText(page), `${file} ${v.name ?? v.op}`).toHaveText(shown(v) as string);
    }
  });
}
