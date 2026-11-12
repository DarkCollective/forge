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
// couple of vectors are opened through a share link in the production build. A vector whose expectation is plain
// text must show that text in the output pane. A vector whose expectation is bytes that are not plain text (the
// raw digests of the hashing vocabularies) is viewed as hex, and the hex dump must show the expected bytes. The
// exhaustive check is `npm run gate4:browser -w @forge/worker`.
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
/** A vector is viewed as hex only when its expected bytes fit in a few rows, so every row is rendered. */
const MAX_HEX_BYTES = 64;
/** The input travels in the share link. */
const MAX_INPUT_CHARS = 1000;
const vocabDir = fileURLToPath(new URL("../../../packages/ops/vocab/", import.meta.url));
const catalogue = JSON.parse(
  readFileSync(fileURLToPath(import.meta.resolve("@forge/ops/catalogue.json")), "utf8"),
) as CatalogueView;

/**
 * Output text the pane shows as text: not blank, short, and without control characters other than line feeds, tabs and carriage returns.
 * The pane itself shows any valid utf8 as text (chooseView); the other controls are kept out of the smoke test
 * only because they do not render predictably in the DOM.
 * `toHaveText` compares with collapsed white space, so edge white space and line breaks do not matter.
 */
function showable(s: string): boolean {
  return s.trim().length > 0 && s.length <= 400 && !/\p{C}/u.test(s.replace(/[\n\t\r]/g, ""));
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

/** The expected bytes of a vector that expects bytes (hex or utf8) of 1 to 64 bytes, else null. */
function expectedBytes(v: Vector): Uint8Array | null {
  const { value, enc } = v.expect;
  if (typeof value !== "string" || (enc !== "utf8" && enc !== "hex")) return null;
  const bytes = decodeEncoded({ value, enc });
  return bytes.length >= 1 && bytes.length <= MAX_HEX_BYTES ? bytes : null;
}

/** The hex dump rows show bytes as "48 65 6c ..." (a double space after the eighth); compare as spaced pairs. */
function spacedHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");
}

/**
 * Vectors with a plain utf8 input and a showable text expectation (utf8 expectations first) or, for the
 * remaining places, an expectation of bytes that is viewed as hex; one per op, up to `n`.
 */
function pick(vectors: Vector[], n: number): Vector[] {
  const names = new Set(catalogue.ops.map((o) => o.qname));
  const plain = vectors.filter(
    (v) =>
      names.has(v.op) &&
      v.input.enc === "utf8" &&
      v.input.value.length <= MAX_INPUT_CHARS &&
      !/[\p{C}]/u.test(v.input.value),
  );
  const usable = plain.filter((v) => shown(v) !== null);
  const binary = plain.filter((v) => shown(v) === null && expectedBytes(v) !== null);
  const ordered = [
    ...usable.filter((v) => v.expect.enc === "utf8"),
    ...usable.filter((v) => v.expect.enc !== "utf8"),
    ...binary,
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
    test.skip(
      chosen.length === 0,
      `${file} has no vector with a text or a short bytes expectation`,
    );
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
      const text = shown(v);
      if (text !== null) {
        await expect(outputText(page), `${file} ${v.name ?? v.op}`).toHaveText(text);
        continue;
      }
      // Bytes that are not plain text open in the hex view; bytes that are valid UTF-8 but not showable
      // (control characters) open as text, with a Hex button.
      const toggle = page.getByRole("button", { name: "Hex", exact: true });
      const rows = page.locator("forge-output forge-hex-view .row .hex");
      await expect(toggle.or(rows.first()).first(), `${file} ${v.name ?? v.op}`).toBeVisible();
      if ((await toggle.count()) > 0 && (await toggle.getAttribute("aria-pressed")) !== "true") {
        await toggle.click();
      }
      await expect(rows.first(), `${file} ${v.name ?? v.op}`).toBeVisible();
      await expect
        .poll(async () => (await rows.allTextContents()).join(" ").replace(/\s+/g, " ").trim(), {
          message: `${file} ${v.name ?? v.op} (hex view)`,
        })
        .toBe(spacedHex(expectedBytes(v) as Uint8Array));
    }
  });
}
