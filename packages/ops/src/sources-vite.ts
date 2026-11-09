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
 * The Vite vocabulary source provider (entry `@forge/ops/vite`): finds `vocab/*.fth` and the
 * primitive modules with `import.meta.glob` (RECIPES.md section 2.4). Primitive modules become lazy
 * chunks. `package.json` maps this entry to the source file, so Vite itself transforms the globs.
 *
 * Both globs are relative to this file, which sits next to `vocab/` (one level up) in `src/` and in `dist/`.
 */
import { createBundleLoader } from "./bundle.js";
import type { LoadBundleFn, PrimitiveModule, SourceFile, VocabSourceProvider } from "./types.js";

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function createViteProvider(): VocabSourceProvider {
  const fth = import.meta.glob<string>("../vocab/*.fth", {
    query: "?raw",
    import: "default",
    eager: true,
  });
  const prims = import.meta.glob<PrimitiveModule>([
    "./prims/*.{ts,js}",
    "!./prims/*.d.ts",
    "!./prims/*.test.*",
  ]);
  return {
    fthFiles(): Promise<readonly SourceFile[]> {
      return Promise.resolve(
        Object.entries(fth)
          .map(([path, text]) => ({ name: baseName(path), text }))
          .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
      );
    },
    primitiveLoaders(): Readonly<Record<string, () => Promise<PrimitiveModule>>> {
      const loaders: Record<string, () => Promise<PrimitiveModule>> = {};
      for (const [path, load] of Object.entries(prims)) {
        const file = baseName(path);
        loaders[file.slice(0, file.lastIndexOf("."))] = load;
      }
      return loaders;
    },
  };
}

let defaultLoader: LoadBundleFn | undefined;

/** `loadBundle` over the package's own sources; the provider is created on first use. */
export const loadBundleVite: LoadBundleFn = (names) => {
  defaultLoader ??= createBundleLoader(createViteProvider());
  return defaultLoader(names);
};
