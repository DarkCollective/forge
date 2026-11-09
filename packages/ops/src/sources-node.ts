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
 * The Node vocabulary source provider (entry `@forge/ops/node`): finds `vocab/*.fth` and the
 * primitive modules by pattern in the file system (RECIPES.md section 2.4).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBundleLoader } from "./bundle.js";
import type { LoadBundleFn, PrimitiveModule, SourceFile, VocabSourceProvider } from "./types.js";

const MODULE_PATH = fileURLToPath(import.meta.url).replaceAll("\\", "/");

/** Running from `src/` (TypeScript, e.g. under Vitest) or from `dist/` (compiled)? */
const SOURCE_EXT = MODULE_PATH.endsWith(".ts") ? ".ts" : ".js";

function parentOf(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf("/")));
}

/** The package root: one level up from `src/` or `dist/`. */
const DEFAULT_ROOT = parentOf(parentOf(MODULE_PATH));

/**
 * The vocabulary a file in `prims/` provides, or `undefined` when the file is not a primitive module
 * for this build: wrong extension, a declaration file (`*.d.ts`) or a test (`*.test.*`).
 */
export function primitiveVocabOf(fileName: string, ext: string = SOURCE_EXT): string | undefined {
  if (!fileName.endsWith(ext) || fileName.endsWith(".d.ts")) return undefined;
  const vocab = fileName.slice(0, -ext.length);
  return vocab === "" || vocab.includes(".test.") || vocab.endsWith(".test") ? undefined : vocab;
}

/**
 * Reads `<root>/vocab/*.fth` and the primitive modules in `<root>/src/prims` (running from `src/`)
 * or `<root>/dist/prims` (running from `dist/`). `root` defaults to the package root.
 */
export function createNodeProvider(root: string = DEFAULT_ROOT): VocabSourceProvider {
  const base = root.replaceAll("\\", "/").replace(/\/+$/, "");
  const vocabDir = `${base}/vocab`;
  const primsDir = `${base}/${SOURCE_EXT === ".ts" ? "src" : "dist"}/prims`;
  return {
    fthFiles(): Promise<readonly SourceFile[]> {
      const names = existsSync(vocabDir) ? readdirSync(vocabDir) : [];
      return Promise.resolve(
        names
          .filter((name) => name.endsWith(".fth"))
          .sort()
          .map((name) => ({ name, text: readFileSync(`${vocabDir}/${name}`, "utf8") })),
      );
    },
    primitiveLoaders(): Readonly<Record<string, () => Promise<PrimitiveModule>>> {
      const loaders: Record<string, () => Promise<PrimitiveModule>> = {};
      const names = existsSync(primsDir) ? readdirSync(primsDir).sort() : [];
      for (const name of names) {
        const vocab = primitiveVocabOf(name);
        if (vocab === undefined) continue;
        const href = pathToFileURL(`${primsDir}/${name}`).href;
        loaders[vocab] = () => import(href) as Promise<PrimitiveModule>;
      }
      return loaders;
    },
  };
}

let defaultLoader: LoadBundleFn | undefined;

/** `loadBundle` over the package's own sources; the provider is created on first use. */
export const loadBundleNode: LoadBundleFn = (names) => {
  defaultLoader ??= createBundleLoader(createNodeProvider());
  return defaultLoader(names);
};
