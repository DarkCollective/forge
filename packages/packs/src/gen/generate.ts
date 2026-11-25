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
 * `packs:gen` (PACKS.md section 3.2): discover, validate, select, build core alone, build each pack on core, write the
 * fragments, write the registries. `generate` does it in memory and returns the result; `writeGenerated` and
 * `checkGenerated` are the two modes of the command.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parsePinsCompat } from "@forge/ops";
import type { PinsCompat, VocabSourceProvider } from "@forge/ops";
import { checkCsp, checkExternalSha, checkParserImports, checkVocabFiles } from "./checks.js";
import { discoverPacks, norm, selectPacks, validatePacks } from "./discover.js";
import { buildFragments, checkDependencies, coreVocabNames } from "./fragments.js";
import { renderPageRegistry, renderWorkerRegistry } from "./registry.js";
import type { GenOptions, GenProblem, GenResult, SelectedPack } from "./types.js";

const read = (path: string): string => (existsSync(path) ? readFileSync(path, "utf8") : "");

/** `registry.generated.ts` and `worker-packs.generated.ts` as the options place them. */
export function registryPaths(options: GenOptions): { page: string; worker: string } {
  const root = norm(options.repoRoot);
  return {
    page: options.pageRegistryPath ?? `${root}/apps/web/src/packs/registry.generated.ts`,
    worker: options.workerRegistryPath ?? `${root}/apps/web/src/bake/worker-packs.generated.ts`,
  };
}

/**
 * Format with the repository's Prettier, so that the committed text passes `prettier --check` and `--check` compares like
 * with like. Prettier is a development tool of the repository, not a dependency of this package: without it the text
 * is returned as rendered.
 */
async function format(text: string, path: string): Promise<string> {
  try {
    const prettier = (await import("prettier")) as typeof import("prettier");
    const config = (await prettier.resolveConfig(path)) ?? {};
    return await prettier.format(text, { ...config, filepath: path });
  } catch {
    return text;
  }
}

async function defaultCore(): Promise<VocabSourceProvider> {
  const node = await import("@forge/ops/node");
  return node.createNodeProvider();
}

/** Steps 1 to 7 in memory. Nothing is written. */
export async function generate(options: GenOptions): Promise<GenResult> {
  const root = norm(options.repoRoot);
  const packsDir = options.packsDir ?? `${root}/packs`;
  const internal = options.internal ?? process.env["FORGE_PACKS_INTERNAL"] === "1";
  const core = options.coreProvider ?? (await defaultCore());
  const problems: GenProblem[] = [];

  // 1 discover, 2 validate, 3 select
  const found = discoverPacks(packsDir);
  problems.push(...found.problems);
  const validated = validatePacks(found.packs, await coreVocabNames(core));
  problems.push(...validated.problems);
  const picked = selectPacks(validated.valid, internal);
  problems.push(...picked.problems);
  const selected = picked.selected;

  // the checks that need the pack's files
  for (const p of selected) {
    problems.push(...checkVocabFiles(p), ...checkParserImports(p), ...checkExternalSha(p));
  }
  const cspTexts = (
    options.cspFiles ?? [`${root}/infra/site.tf`, `${root}/apps/web/scripts/serve-prod.mjs`]
  ).map(read);
  problems.push(...checkCsp(selected, cspTexts));

  // 4 and 5 build core alone and each pack on core
  let fragments: GenResult["fragments"] = [];
  if (options.skipRuntime !== true && problems.length === 0) {
    problems.push(...(await checkDependencies(core, validated.valid, selected)));
    if (problems.length === 0) {
      const corePins: PinsCompat =
        options.corePinsRoot === undefined
          ? {}
          : parsePinsCompat(read(`${norm(options.corePinsRoot)}/vocab/pins-compat.json`));
      const built = await buildFragments(core, selected, corePins);
      problems.push(...built.problems);
      fragments = built.fragments;
    }
  }

  // 7 the registries
  const manifests = selected.map((p: SelectedPack) => p.manifest);
  const paths = registryPaths(options);
  const files = new Map<string, string>([
    [paths.page, await format(renderPageRegistry(manifests), paths.page)],
    [paths.worker, await format(renderWorkerRegistry(manifests), paths.worker)],
  ]);
  return { problems, files, fragments, selected: manifests.map((m) => m.id) };
}

/** `--check`: a problem for each generated file that differs from `generate`'s text. */
export function staleFiles(result: GenResult): GenProblem[] {
  const out: GenProblem[] = [];
  for (const [path, text] of result.files) {
    if (read(path) !== text) {
      out.push({
        code: "generated-stale",
        path,
        message: `${path} is stale: run 'npm run packs:gen -w @forge/packs' and commit the result`,
      });
    }
  }
  return out;
}

/**
 * Step 6 and 7 on disk: the fragments go to `packs/<id>/dist/`, the registries to their paths. Not called when there is a
 * problem.
 */
export function writeGenerated(options: GenOptions, result: GenResult): void {
  const packsDir = options.packsDir ?? `${norm(options.repoRoot)}/packs`;
  for (const f of result.fragments) {
    const dir = `${packsDir}/${f.id}/dist`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/catalogue.json`, f.catalogue);
    writeFileSync(`${dir}/help.json`, f.help);
    writeFileSync(`${dir}/checks.json`, f.checks);
  }
  for (const [path, text] of result.files) {
    mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    writeFileSync(path, text);
  }
}
