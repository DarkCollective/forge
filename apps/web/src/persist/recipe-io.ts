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
// Import and export of recipe JSON files. Imported text is untrusted: size-capped, parsed, validated.
import { RECIPE_LIMITS, validateRecipe } from "@forge/recipe";
import type { CatalogueView, Recipe } from "@forge/recipe";

export type ImportResult =
  | { readonly ok: true; readonly recipe: Recipe; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly error: string };

/** Parse and validate the text of a recipe JSON file. `catalogue` may be absent (structure only). */
export function parseRecipeFile(text: string, catalogue?: CatalogueView): ImportResult {
  if (text.length > RECIPE_LIMITS.maxJsonBytes) {
    return { ok: false, error: "That file is too large to be a recipe." };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not valid JSON." };
  }
  const result = validateRecipe(json, catalogue);
  if (!result.ok) {
    const first = result.issues.find((i) => i.severity === "error") ?? result.issues[0];
    return {
      ok: false,
      error: `That file is not a valid recipe${first === undefined ? "." : `: ${first.message}`}`,
    };
  }
  return {
    ok: true,
    recipe: result.recipe,
    warnings: result.issues.filter((i) => i.severity !== "error").map((i) => i.message),
  };
}

/** Pretty JSON for a stored or current recipe, with its name and description filled in. */
export function recipeToJson(recipe: unknown, name: string, description: string): string {
  const base =
    typeof recipe === "object" && recipe !== null && !Array.isArray(recipe)
      ? (recipe as Record<string, unknown>)
      : {};
  return `${JSON.stringify(
    { ...base, ...(name === "" ? {} : { name }), ...(description === "" ? {} : { description }) },
    null,
    2,
  )}\n`;
}

/** A safe download file name for a recipe name. */
export function fileNameFor(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug === "" ? "recipe" : slug}.forge.json`;
}

/** Offer `text` as a download through a blob URL (CSP: blob: navigation of the user's own data). */
export function downloadText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
