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
 * P1b: the ESLint guard rails (PACKS.md sections 3.5 and 8.5), run through the repository's own `eslint.config.js`.
 * `test/fixtures/lint/<name>.<rule>.txt` is a source file that must fail with `<rule>`; `<name>.ok.txt` must pass. The
 * text is linted as if it were `packs/fixture/src/<name>.ts`, so the fixtures are not source files of this repository and
 * do not fail the lint of the repository itself.
 */
import { readFileSync, readdirSync } from "node:fs";
import { ESLint } from "eslint";
import { describe, expect, test } from "vitest";
import { FIXTURE_TREE, REPO_ROOT } from "./tree.js";

const LINT_DIR = `${FIXTURE_TREE}/../lint`;
const eslint = new ESLint({ cwd: REPO_ROOT });

async function lint(
  code: string,
  filePath: string,
): Promise<{ ruleId: string | null; message: string }[]> {
  const [result] = await eslint.lintText(code, { filePath: `${REPO_ROOT}/${filePath}` });
  return (result?.messages ?? []).map((m) => ({ ruleId: m.ruleId, message: m.message }));
}

const fixtures = readdirSync(LINT_DIR)
  .filter((f) => f.endsWith(".txt"))
  .sort();

describe("forbidden APIs in pack sources (PACKS 8.5)", () => {
  test("the fixture set is not empty", () => {
    expect(fixtures.length).toBeGreaterThan(30);
  });

  for (const file of fixtures) {
    const parts = file.slice(0, -".txt".length).split(".");
    const rule = parts.slice(1).join(".");
    const code = readFileSync(`${LINT_DIR}/${file}`, "utf8");
    if (rule === "ok") {
      test(`${file} passes`, async () => {
        expect(await lint(code, `packs/fixture/src/${parts[0]}.ts`)).toEqual([]);
      });
    } else {
      test(`${file} fails with ${rule}`, async () => {
        const found = await lint(code, `packs/fixture/src/${parts[0]}.ts`);
        expect(found.map((m) => m.ruleId)).toContain(rule);
      });
    }
  }

  test("fetch is allowed in src/files.ts, the one module for non-JS pack files, and nowhere else", async () => {
    const code = "export const load = (url: string): Promise<unknown> => fetch(url);\n";
    expect(await lint(code, "packs/fixture/src/files.ts")).toEqual([]);
    expect((await lint(code, "packs/fixture/src/other.ts")).map((m) => m.ruleId)).toContain(
      "no-restricted-globals",
    );
    // the exception is for the network only
    const both = 'export const x = (): unknown => [fetch("/a"), localStorage];\n';
    expect((await lint(both, "packs/fixture/src/files.ts")).map((m) => m.ruleId)).toEqual([
      "no-restricted-globals",
    ]);
  });

  test("the rules apply to pack sources only, not to a pack's tests or to core", async () => {
    const code = 'export const run = (): unknown => eval("1");\n';
    expect(await lint(code, "packs/fixture/src/a.test.ts")).toEqual([]);
    expect(await lint(code, "packs/fixture/test/a.ts")).toEqual([]);
    expect(
      (await lint('export const f = (): unknown => fetch("/x");\n', "apps/web/src/a.ts")).map(
        (m) => m.ruleId,
      ),
    ).toEqual([]);
  });
});

describe("core does not import a pack (PACKS 3.5)", () => {
  test.each([
    ["a package import", 'import { run } from "@forge/pack-demo/page";\nexport const x = run;\n'],
    ["a subpath import", 'import "@forge/pack-demo/worker";\n'],
    [
      "a type import",
      'import type { Page } from "@forge/pack-demo/page";\nexport type P = Page;\n',
    ],
    ["a re-export", 'export { run } from "@forge/pack-demo/page";\n'],
    [
      "a relative path into packs/",
      'import { run } from "../../../../packs/demo/src/page.js";\nexport const x = run;\n',
    ],
    ["a relative path to a built file", 'import "../../../../packs/demo/dist/page.js";\n'],
  ])("%s fails in app code", async (_name, code) => {
    expect((await lint(code, "apps/web/src/shell/x.ts")).map((m) => m.ruleId)).toContain(
      "no-restricted-imports",
    );
  });

  test("it fails in a package too", async () => {
    const code = 'import "@forge/pack-demo/worker";\n';
    expect((await lint(code, "packages/worker/src/x.ts")).map((m) => m.ruleId)).toContain(
      "no-restricted-imports",
    );
  });

  test("the generated registries may name packs, and the pack-manager directory is not a pack", async () => {
    const code =
      'import url from "@forge/pack-demo/catalogue.json?url";\nexport const load = () => import("@forge/pack-demo/page");\nexport { url };\n';
    expect(await lint(code, "apps/web/src/packs/registry.generated.ts")).toEqual([]);
    expect(await lint(code, "apps/web/src/bake/worker-packs.generated.ts")).toEqual([]);
    const own =
      'import { PACKS } from "./registry.generated.js";\nimport "../packs/offer/panel.js";\nexport const x = PACKS;\n';
    expect(await lint(own, "apps/web/src/packs/manager.ts")).toEqual([]);
  });

  test("a pack may import its own files and other packs it requires", async () => {
    const code = 'import "./kinds/tally/parse.js";\nimport "@forge/pack-other/page";\n';
    expect((await lint(code, "packs/fixture/src/page.ts")).map((m) => m.ruleId)).not.toContain(
      "no-restricted-imports",
    );
  });
});
