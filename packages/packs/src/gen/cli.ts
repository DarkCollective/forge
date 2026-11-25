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
 * The `packs:gen` command (PACKS.md section 3.2):
 *
 *   npm run packs:gen -w @forge/packs                 write the fragments and the two registries
 *   npm run packs:gen -w @forge/packs -- --check      run everything in memory; fail on a problem or a stale file
 *
 * Options: `--internal` includes internal packs (the same as FORGE_PACKS_INTERNAL=1); `--root <dir>` names the
 * repository root (default: three levels above this file's package, found from its location).
 */
import { fileURLToPath } from "node:url";
import { generate, staleFiles, writeGenerated } from "./generate.js";
import type { GenOptions, GenProblem } from "./types.js";

function describe(p: GenProblem): string {
  const where = [p.pack, p.path].filter((x) => x !== undefined && x !== "").join(" ");
  return `  ${p.code}${where === "" ? "" : `  ${where}`}: ${p.message}`;
}

async function main(argv: readonly string[]): Promise<number> {
  const check = argv.includes("--check");
  const rootAt = argv.indexOf("--root");
  // <root>/packages/packs/dist/gen/cli.js: five segments below the repository root
  const here = fileURLToPath(import.meta.url).replaceAll("\\", "/");
  const repoRoot =
    rootAt >= 0 ? (argv[rootAt + 1] as string) : here.split("/").slice(0, -5).join("/");
  const options: GenOptions = {
    repoRoot,
    ...(argv.includes("--internal") ? { internal: true } : {}),
    corePinsRoot: `${repoRoot}/packages/ops`,
  };
  const result = await generate(options);
  const problems = [...result.problems];
  if (check) problems.push(...staleFiles(result));
  if (problems.length > 0) {
    process.stderr.write(
      `packs:gen${check ? " --check" : ""} failed:\n${problems.map(describe).join("\n")}\n`,
    );
    return 1;
  }
  if (!check) writeGenerated(options, result);
  process.stdout.write(
    `packs:gen${check ? " --check" : ""}: ${result.selected.length} pack(s) [${result.selected.join(", ")}], ${check ? "generated files are current" : `${result.files.size} registries written`}\n`,
  );
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(
      `packs:gen failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`,
    );
    process.exitCode = 1;
  },
);
