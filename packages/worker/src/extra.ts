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

/*
 * Appends the primitives of extra modules to a bundle (test fixtures: RECIPES.md section 10.3, G2-4).
 */
import type { LoadBundleFn, PrimitiveModule } from "@forge/ops";

/**
 * Wraps `loadBundle`: every bundle also holds the `primitives` of each module (by URL, loaded with
 * `import()`), and their vocabularies are added to `vocabs`.
 */
export function withPrimitiveModules(
  loadBundle: LoadBundleFn,
  urls: readonly string[],
): LoadBundleFn {
  if (urls.length === 0) return loadBundle;
  return async (names) => {
    const bundle = await loadBundle(names);
    const extra = (
      await Promise.all(urls.map((url) => import(url) as Promise<PrimitiveModule>))
    ).flatMap((m) => m.primitives);
    const vocabs = new Set([...bundle.vocabs, ...extra.map((p) => p.vocab)]);
    return {
      ...bundle,
      vocabs: [...vocabs].sort(),
      primitives: [...bundle.primitives, ...extra],
    };
  };
}
