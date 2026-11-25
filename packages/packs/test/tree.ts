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
 * Test helpers for the generator (PACKS.md section 10): a copy of the fixture pack tree in a temporary directory, which a
 * test can then change, and the fixture core that the generator builds the packs on.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packProvider } from "../src/gen/fragments.js";
import { generate } from "../src/gen/generate.js";
import type { GenOptions, GenResult } from "../src/gen/types.js";

const here = dirname(fileURLToPath(import.meta.url)).replaceAll("\\", "/");

/** The repository root: `packages/packs/test` is three levels below it. */
export const REPO_ROOT = join(here, "..", "..", "..").replaceAll("\\", "/");

export const FIXTURE_TREE = `${here}/fixtures/tree`;

export interface TestTree {
  /** A temporary repository root: `packs/`, `core/`, and the place of the generated registries. */
  readonly root: string;
  readonly options: GenOptions;
  /** Read, write and remove a file under the root. */
  read(path: string): string;
  write(path: string, text: string): void;
  remove(path: string): void;
  /** Run the generator on the tree. */
  run(extra?: Partial<GenOptions>): Promise<GenResult>;
  dispose(): void;
}

/** A copy of the fixture tree. The repository's Prettier configuration is copied too, so the generated text is formatted as committed. */
export function makeTree(): TestTree {
  const root = mkdtempSync(join(tmpdir(), "forge-packs-")).replaceAll("\\", "/");
  cpSync(FIXTURE_TREE, root, { recursive: true });
  writeFileSync(`${root}/.prettierrc`, readFileSync(`${REPO_ROOT}/.prettierrc`, "utf8"));
  const options: GenOptions = {
    repoRoot: root,
    coreProvider: packProvider(`${root}/core`),
  };
  return {
    root,
    options,
    read: (p) => readFileSync(`${root}/${p}`, "utf8"),
    write(p, text) {
      mkdirSync(dirname(`${root}/${p}`), { recursive: true });
      writeFileSync(`${root}/${p}`, text);
    },
    remove: (p) => rmSync(`${root}/${p}`, { recursive: true, force: true }),
    run: (extra = {}) => generate({ ...options, ...extra }),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}
