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
 * P1b: the generator (PACKS.md sections 3.2, 3.3 and 10.2). It runs on the fixture pack tree under `test/fixtures/tree`
 * (core `cx`, packs alpha, beta, gamma and the internal delta, and a skipped `_skipped` directory), never on real packs.
 */
import { afterEach, describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { packProvider } from "../src/gen/fragments.js";
import { generate, staleFiles, writeGenerated } from "../src/gen/generate.js";
import { renderPageRegistry, renderWorkerRegistry } from "../src/gen/registry.js";
import type { GenCheckCode, GenProblem } from "../src/gen/types.js";
import { mergeCatalogues } from "../src/merge.js";
import type { Catalogue } from "@forge/ops";
import { FIXTURE_TREE, REPO_ROOT, makeTree } from "./tree.js";
import type { TestTree } from "./tree.js";

const trees: TestTree[] = [];
const tree = (): TestTree => {
  const t = makeTree();
  trees.push(t);
  return t;
};
afterEach(() => {
  for (const t of trees.splice(0)) t.dispose();
});

const codes = (problems: readonly GenProblem[]): GenCheckCode[] => problems.map((p) => p.code);

/** Change a manifest of the tree. */
function edit(t: TestTree, id: string, change: (m: Record<string, unknown>) => void): void {
  const m = JSON.parse(t.read(`packs/${id}/manifest.json`)) as Record<string, unknown>;
  change(m);
  t.write(`packs/${id}/manifest.json`, JSON.stringify(m, null, 2) + "\n");
}

describe("the generator on the fixture tree", () => {
  test("selects the stable packs, skips _skipped and the internal pack, and finds no problem", async () => {
    const t = tree();
    const r = await t.run();
    expect(r.problems).toEqual([]);
    expect(r.selected).toEqual(["alpha", "beta", "gamma"]);
  });

  test("an internal pack is selected only with the internal flag (PK14)", async () => {
    const t = tree();
    const r = await t.run({ internal: true });
    expect(r.problems).toEqual([]);
    expect(r.selected).toEqual(["alpha", "beta", "delta", "gamma"]);
  });

  test("the registries hold what the manifests say, in id order", async () => {
    const t = tree();
    const r = await t.run();
    const page = r.files.get(`${t.root}/apps/web/src/packs/registry.generated.ts`) as string;
    const worker = r.files.get(`${t.root}/apps/web/src/bake/worker-packs.generated.ts`) as string;
    expect(page).toContain("export const PACKS: readonly PackInfo[] = [");
    expect(page.indexOf('id: "alpha"')).toBeLessThan(page.indexOf('id: "beta"'));
    expect(page.indexOf('id: "beta"')).toBeLessThan(page.indexOf('id: "gamma"'));
    expect(page).not.toContain("delta");
    expect(page).toContain('import("@forge/pack-alpha/page")');
    expect(page).toContain('import catalogue_alpha from "@forge/pack-alpha/catalogue.json?url";');
    expect(page).toContain('requires: ["alpha"]');
    expect(page).toContain("loadPage: undefined"); // gamma has no page entry
    expect(page).toContain('"alpha-tally"');
    expect(worker).toContain('import("@forge/pack-beta/worker")');
    expect(worker).toContain('kinds: ["alpha-tally"]');
    // every import in either file is a literal
    for (const text of [page, worker]) {
      for (const m of text.matchAll(/import\(([^)]*)\)/g)) expect(m[1]).toMatch(/^"[^"]+"$/);
    }
  });

  test("the generated text passes Prettier", async () => {
    const t = tree();
    const r = await t.run();
    const prettier = await import("prettier");
    for (const [path, text] of r.files) {
      expect(
        await prettier.check(text, { ...(await prettier.resolveConfig(path)), filepath: path }),
      ).toBe(true);
    }
  });

  test("fragments: the pack's own ops only, internal vocabulary left out, conversions carried", async () => {
    const t = tree();
    const r = await t.run();
    const byId = new Map(r.fragments.map((f) => [f.id, f]));
    const alpha = JSON.parse((byId.get("alpha") as { catalogue: string }).catalogue) as Catalogue;
    expect(alpha.ops.map((o) => o.qname)).toEqual(["a1:loud", "a1:plain"]);
    expect(alpha.vocabs).toEqual(["a1"]);
    const beta = JSON.parse((byId.get("beta") as { catalogue: string }).catalogue) as Catalogue;
    expect(beta.ops.map((o) => o.qname)).toEqual(["b1:louder"]);
    const gamma = JSON.parse((byId.get("gamma") as { catalogue: string }).catalogue) as Catalogue;
    expect(gamma.conversions).toEqual([{ from: "str", to: "int", op: "c1:size" }]);
    for (const f of r.fragments) {
      expect(JSON.parse(f.help)).toHaveProperty("ops");
      expect(JSON.parse(f.checks)).toHaveProperty("ops");
    }
  });

  test("the merge of core and the fragments is what one runtime gives (the check ran)", async () => {
    const t = tree();
    const r = await t.run();
    const core = JSON.parse(
      JSON.stringify(
        mergeCatalogues(
          { format: 1, version: "x", vocabs: [], ops: [] } as unknown as Catalogue,
          r.fragments.map((f) => JSON.parse(f.catalogue) as Catalogue),
        ),
      ),
    ) as Catalogue;
    expect(core.ops.map((o) => o.qname)).toEqual(["a1:loud", "a1:plain", "b1:louder", "c1:size"]);
    expect(codes(r.problems)).not.toContain("fragment-drift");
  });

  test("writeGenerated writes the fragments to dist and the registries; then --check passes", async () => {
    const t = tree();
    const r = await t.run();
    writeGenerated(t.options, r);
    expect(existsSync(`${t.root}/packs/alpha/dist/catalogue.json`)).toBe(true);
    expect(existsSync(`${t.root}/packs/alpha/dist/help.json`)).toBe(true);
    expect(existsSync(`${t.root}/packs/alpha/dist/checks.json`)).toBe(true);
    expect(existsSync(`${t.root}/packs/delta/dist`)).toBe(false);
    expect(staleFiles(await t.run())).toEqual([]);
  });

  test("--check fails on a stale file", async () => {
    const t = tree();
    writeGenerated(t.options, await t.run());
    // a registry edited by hand
    t.write(
      "apps/web/src/packs/registry.generated.ts",
      t.read("apps/web/src/packs/registry.generated.ts") + "\n// hand edit\n",
    );
    const stale = staleFiles(await t.run());
    expect(stale.map((p) => p.code)).toEqual(["generated-stale"]);
    expect(stale[0]?.path).toContain("registry.generated.ts");
    // a manifest changed after the registries were written
    writeGenerated(t.options, await t.run());
    edit(t, "gamma", (m) => (m["version"] = "0.2.0"));
    expect(staleFiles(await t.run()).length).toBe(2 - 1); // the page registry carries the version, the worker registry does not
    // a registry that is missing
    t.remove("apps/web/src/bake/worker-packs.generated.ts");
    expect(staleFiles(await t.run()).length).toBe(2);
  });

  test("with no packs the registries are empty but valid, and equal the committed files", async () => {
    const t = tree();
    t.remove("packs");
    const r = await t.run();
    expect(r.problems).toEqual([]);
    expect(r.selected).toEqual([]);
    expect(r.fragments).toEqual([]);
    const page = r.files.get(`${t.root}/apps/web/src/packs/registry.generated.ts`) as string;
    const worker = r.files.get(`${t.root}/apps/web/src/bake/worker-packs.generated.ts`) as string;
    expect(page).toContain("export const PACKS: readonly PackInfo[] = [];");
    expect(worker).toContain(
      "export const WORKER_PACKS: Readonly<Record<string, WorkerPackEntry>> = {};",
    );
    expect(page).not.toMatch(/^import /m);
    // the committed files in the repository are the empty ones, until the first real pack lands
    expect(readFileSync(`${REPO_ROOT}/apps/web/src/packs/registry.generated.ts`, "utf8")).toBe(
      page,
    );
    expect(readFileSync(`${REPO_ROOT}/apps/web/src/bake/worker-packs.generated.ts`, "utf8")).toBe(
      worker,
    );
  });

  test("the unformatted renderers are deterministic", () => {
    expect(renderPageRegistry([])).toBe(renderPageRegistry([]));
    expect(renderWorkerRegistry([])).toBe(renderWorkerRegistry([]));
  });

  test("the repository's committed registries are current for the packs it has (--check on the real tree)", async () => {
    const r = await generate({
      repoRoot: REPO_ROOT,
      coreProvider: packProvider(`${FIXTURE_TREE}/core`),
      skipRuntime: true,
    });
    expect(r.problems).toEqual([]);
    expect(staleFiles(r)).toEqual([]);
  });
});

describe("checks that need the pack's files and runtime (PACKS 2.4)", () => {
  async function problemsOf(t: TestTree, extra = {}): Promise<GenProblem[]> {
    return [...(await t.run(extra)).problems];
  }

  test("vocab-file: a listed vocabulary without a file, and a file that is not listed", async () => {
    const t = tree();
    t.remove("packs/gamma/vocab/c1.fth");
    t.write("packs/gamma/vocab/stray.fth", "IN: stray\n");
    const p = await problemsOf(t);
    expect(p.filter((x) => x.code === "vocab-file").map((x) => x.message)).toEqual([
      "vocabulary 'c1' has neither vocab/c1.fth nor src/prims/c1.ts",
      "vocab/stray.fth is not a listed vocabulary",
    ]);
  });

  test("vocab-file: an unlisted primitive module", async () => {
    const t = tree();
    t.write("packs/gamma/src/prims/extra.ts", "export {};\n");
    const p = await problemsOf(t);
    expect(codes(p)).toEqual(["vocab-file"]);
  });

  test("entry-missing: an entry, and the package.json", async () => {
    const t = tree();
    t.remove("packs/alpha/src/page.ts");
    t.remove("packs/beta/package.json");
    const p = await problemsOf(t);
    expect(p.filter((x) => x.code === "entry-missing").map((x) => [x.pack, x.path])).toEqual([
      ["alpha", "/entries/page"],
      ["beta", "package.json"],
    ]);
  });

  test("id-dir, vocab-clash and kind-reserved reach the generator from the validator", async () => {
    const t = tree();
    edit(t, "gamma", (m) => (m["id"] = "other"));
    edit(t, "beta", (m) => (m["vocabularies"] = [{ name: "cx" }]));
    edit(t, "alpha", (m) => {
      m["kinds"] = [{ name: "table", label: "t", viewer: false, paramHelper: false }];
    });
    const p = codes(await problemsOf(t));
    expect(p).toContain("id-dir");
    expect(p).toContain("vocab-clash");
    expect(p).toContain("kind-reserved");
  });

  test("a manifest that is not JSON is a schema problem naming the pack", async () => {
    const t = tree();
    t.write("packs/gamma/manifest.json", "{ not json");
    const p = await problemsOf(t);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ code: "schema", pack: "gamma" });
  });

  describe("parser-imports", () => {
    test.each([
      [
        "a value import from outside the directory",
        'import { x } from "../../worker.js";\nexport const y = x;\n',
      ],
      ["a package", 'import { createHash } from "node:crypto";\nexport const y = createHash;\n'],
      ["a re-export from outside", 'export { z } from "../../page.js";\n'],
      ["a dynamic import", 'export const y = () => import("../../page.js");\n'],
      ["a side-effect import", 'import "../../page.js";\n'],
    ])("%s", async (_name, source) => {
      const t = tree();
      t.write("packs/alpha/src/kinds/tally/parse.ts", source);
      const p = await problemsOf(t);
      expect(codes(p)).toEqual(["parser-imports"]);
    });

    test("follows a file the parser imports", async () => {
      const t = tree();
      t.write(
        "packs/alpha/src/kinds/tally/norm.ts",
        'import { x } from "../../worker.js";\nexport const norm = x;\n',
      );
      expect(codes(await problemsOf(t))).toEqual(["parser-imports"]);
    });

    test("allows own-directory imports, type imports and comments that look like imports", async () => {
      const t = tree();
      t.write(
        "packs/alpha/src/kinds/tally/parse.ts",
        '// import { x } from "../../worker.js";\nimport type { Page } from "../../page.js";\nimport { norm } from "./norm.js";\nexport const p = (s: string): string => norm(s);\nexport type { Page };\n',
      );
      expect(await problemsOf(t)).toEqual([]);
    });
  });

  test("dependency-undeclared: a vocabulary that names another pack's vocabulary without requiring it", async () => {
    const t = tree();
    edit(t, "beta", (m) => (m["requires"] = { packApi: 1 }));
    const p = await problemsOf(t);
    expect(codes(p)).toEqual(["dependency-undeclared"]);
    expect(p[0]).toMatchObject({ pack: "beta", path: "b1.fth" });
  });

  test("dependency-undeclared: through a required pack is declared enough", async () => {
    const t = tree();
    edit(t, "gamma", (m) => (m["requires"] = { packApi: 1, packs: ["beta"] }));
    t.write(
      "packs/gamma/vocab/c1.fth",
      t.read("packs/gamma/vocab/c1.fth") +
        ': over ( s:str -- str ) "D." doc "Fixture" category s a1:loud ;\n',
    );
    expect(await problemsOf(t)).toEqual([]);
  });

  test("core-depends-on-pack: core names a pack vocabulary", async () => {
    const t = tree();
    t.write(
      "core/vocab/cx.fth",
      t.read("core/vocab/cx.fth") +
        ': bad ( s:str -- str ) "D." doc "Fixture" category s a1:plain ;\n',
    );
    const p = await problemsOf(t);
    expect(codes(p)).toEqual(["core-depends-on-pack"]);
    expect(p[0]?.message).toContain("'a1'");
  });

  test("requires-unknown: a stable pack that requires an internal pack that this build drops", async () => {
    const t = tree();
    edit(t, "gamma", (m) => (m["requires"] = { packApi: 1, packs: ["delta"] }));
    const p = await problemsOf(t);
    expect(codes(p)).toEqual(["requires-unknown"]);
    expect(p[0]?.message).toContain("internal");
    expect(await problemsOf(t, { internal: true })).toEqual([]);
  });

  test("requires-cycle across the tree", async () => {
    const t = tree();
    edit(t, "alpha", (m) => (m["requires"] = { packApi: 1, packs: ["beta"] }));
    expect(codes(await problemsOf(t))).toContain("requires-cycle");
  });

  test("conversion-op: an op that does not take the from kind", async () => {
    const t = tree();
    edit(t, "gamma", (m) => (m["conversions"] = [{ from: "int", to: "int", op: "c1:size" }]));
    const p = await problemsOf(t);
    expect(codes(p)).toEqual(["conversion-op"]);
    expect(p[0]?.pack).toBe("gamma");
  });

  test("conversion-op: an op of another vocabulary", async () => {
    const t = tree();
    edit(t, "gamma", (m) => (m["conversions"] = [{ from: "str", to: "str", op: "cx:shout" }]));
    expect(codes(await problemsOf(t))).toEqual(["conversion-op"]);
  });

  describe("externalCode", () => {
    const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
    function addExternal(t: TestTree, digest: string, primitives: unknown): void {
      t.write("packs/gamma/engine/e.mjs", "export const engine = 1;\n");
      t.write("packs/gamma/NOTICE", "Engine notice.\n");
      edit(t, "gamma", (m) => {
        m["notice"] = "NOTICE";
        m["externalCode"] = [
          {
            id: "e",
            version: "1.0.0",
            path: "engine/e.mjs",
            sha256: digest,
            licence: "MIT",
            maxGzip: 1000,
            primitives,
          },
        ];
      });
    }

    test("external-sha: the file does not hash to the manifest's digest", async () => {
      const t = tree();
      addExternal(t, sha("something else"), "*");
      expect(codes(await problemsOf(t))).toEqual(["external-sha"]);
    });

    test("external-sha passes for the right digest", async () => {
      const t = tree();
      addExternal(t, sha("export const engine = 1;\n"), "*");
      expect(await problemsOf(t)).toEqual([]);
    });

    test("external-version: a named primitive that does not exist", async () => {
      const t = tree();
      addExternal(t, sha("export const engine = 1;\n"), ["c1:nothing"]);
      const p = await problemsOf(t);
      expect(codes(p)).toEqual(["external-version"]);
      expect(p[0]?.message).toContain("not a primitive");
    });
  });

  describe("csp-unsatisfied", () => {
    function ask(t: TestTree): void {
      edit(t, "gamma", (m) => {
        m["capabilities"] = { effects: [], csp: { "img-src": ["blob:"] } };
      });
    }

    test("the deployed CSP does not allow the source", async () => {
      const t = tree();
      ask(t);
      t.write("infra/site.tf", "csp = \"default-src 'none'; img-src 'self'; font-src 'self'\"\n");
      const p = await problemsOf(t);
      expect(codes(p)).toEqual(["csp-unsatisfied"]);
    });

    test("the deployed CSP allows it", async () => {
      const t = tree();
      ask(t);
      t.write(
        "infra/site.tf",
        "csp = \"default-src 'none'; img-src 'self' data: blob:; font-src 'self'\"\n",
      );
      expect(await problemsOf(t)).toEqual([]);
    });

    test("no file states a policy", async () => {
      const t = tree();
      ask(t);
      const p = await problemsOf(t);
      expect(codes(p)).toEqual(["csp-unsatisfied"]);
      expect(p[0]?.message).toContain("no file states");
    });
  });

  test("fragment-drift: a catalogue that depends on something other than core and the required packs", async () => {
    const t = tree();
    // A core whose source changes between the builds stands for an op whose entry depends on which other packs are on.
    let calls = 0;
    const real = packProvider(`${t.root}/core`);
    const flaky = {
      fthFiles: async () => {
        calls++;
        const files = await real.fthFiles();
        return calls < 7
          ? files
          : files.map((f) => ({ ...f, text: f.text.replace("s upper", "s upper upper") }));
      },
      primitiveLoaders: () => real.primitiveLoaders(),
    };
    const p = await problemsOf(t, { coreProvider: flaky });
    expect(codes(p)).toContain("fragment-drift");
  });

  test("a pack with a primitive module that is not built is refused with its way out", async () => {
    const t = tree();
    t.write("packs/gamma/src/prims/c1.ts", "export {};\n");
    const p = await problemsOf(t);
    expect(p.map((x) => x.code)).toEqual(["gen-error"]);
    expect(p[0]?.message).toContain("build the pack");
  });
});
