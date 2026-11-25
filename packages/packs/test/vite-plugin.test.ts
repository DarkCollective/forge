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
 * P1b: the `forgePacks()` Vite plugin (PACKS.md section 3.5). The analysis is tested on synthetic chunk graphs; the plugin is
 * tested by real Vite builds of a small project in a temporary directory: a static import from core into `packs/` fails
 * the build, a dynamic one does not, and the report holds the chunks of the pack with their sizes.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";
import { build } from "vite";
import { analyseChunks, buildReport, forgePacks, packOfModule } from "../src/gen/vite-plugin.js";
import type { ChunkInfo, PacksReport } from "../src/gen/vite-plugin.js";

const PACKS = "/repo/packs";
const chunk = (fileName: string, over: Partial<ChunkInfo> = {}): ChunkInfo => ({
  fileName,
  code: `// ${fileName}\n`.repeat(40),
  imports: [],
  dynamicImports: [],
  isEntry: false,
  moduleIds: [],
  ...over,
});

const facts = (over: Record<string, unknown> = {}) => ({
  id: "demo",
  channel: "stable",
  workerEntry: "src/worker.ts",
  pageEntry: "src/page.ts",
  enginePaths: ["engine/e.mjs"],
  budget: { total: 1000, worker: 800, page: 300 },
  ...over,
});

describe("packOfModule", () => {
  test.each([
    ["/repo/packs/demo/dist/worker.js", "demo"],
    ["/repo/packs/demo/dist/worker.js?v=1", "demo"],
    ["/repo/node_modules/@forge/pack-demo/dist/page.js", "demo"],
    ["/repo/apps/web/src/main.ts", undefined],
    ["/repo/packs-other/x.js", undefined],
  ])("%s", (id, pack) => {
    expect(packOfModule(id, PACKS)).toBe(pack);
  });
});

describe("analyseChunks", () => {
  const graph = (): ChunkInfo[] => [
    chunk("entry.js", {
      isEntry: true,
      moduleIds: ["/repo/apps/web/src/main.ts", "/repo/apps/web/src/packs/registry.generated.ts"],
      imports: ["shared.js"],
      dynamicImports: ["worker.js", "page.js"],
    }),
    chunk("shared.js", { moduleIds: ["/repo/packages/lang/src/x.ts"] }),
    chunk("worker.js", {
      moduleIds: ["/repo/packs/demo/dist/worker.js"],
      imports: ["shared.js", "pack-shared.js"],
      dynamicImports: ["prims.js"],
    }),
    chunk("page.js", {
      moduleIds: ["/repo/packs/demo/dist/page.js"],
      imports: ["pack-shared.js", "shared.js"],
    }),
    chunk("pack-shared.js", { moduleIds: ["/repo/packs/demo/dist/util.js"] }),
    chunk("prims.js", {
      moduleIds: ["/repo/packs/demo/dist/prims/demo.js"],
      dynamicImports: ["engine.js"],
    }),
    chunk("engine.js", { moduleIds: ["/repo/packs/demo/engine/e.mjs"] }),
  ];

  test("a graph with only dynamic edges into the pack has no error", () => {
    expect(analyseChunks(graph(), [facts()], PACKS, false).errors).toEqual([]);
  });

  test("a pack's chunks are those reachable from its entries, minus the core graph", () => {
    const { packs } = analyseChunks(graph(), [facts()], PACKS, false);
    const chunks = packs.get("demo") as Map<string, { role: string; sets: Set<string> }>;
    expect([...chunks.keys()].sort()).toEqual([
      "engine.js",
      "pack-shared.js",
      "page.js",
      "prims.js",
      "worker.js",
    ]);
    expect(chunks.has("shared.js")).toBe(false); // core reaches it
    expect(chunks.get("engine.js")?.role).toBe("engine");
    expect(chunks.get("prims.js")?.role).toBe("prims");
    expect(chunks.get("worker.js")?.role).toBe("worker");
    expect(chunks.get("page.js")?.role).toBe("page");
    expect(chunks.get("pack-shared.js")?.role).toBe("shared");
    expect([...(chunks.get("engine.js")?.sets ?? [])]).toEqual(["worker"]);
  });

  test("the report sums gzip sizes per set", () => {
    const { packs } = analyseChunks(graph(), [facts()], PACKS, false);
    const report = buildReport([facts()], [packs], false);
    const demo = report.packs[0] as PacksReport["packs"][number];
    const gz = (file: string): number => demo.chunks.find((c) => c.file === file)?.gzip ?? 0;
    expect(demo.chunks.map((c) => c.file)).toEqual([
      "engine.js",
      "pack-shared.js",
      "page.js",
      "prims.js",
      "worker.js",
    ]);
    expect(demo.worker).toBe(
      gz("worker.js") + gz("pack-shared.js") + gz("prims.js") + gz("engine.js"),
    );
    expect(demo.page).toBe(gz("page.js") + gz("pack-shared.js"));
    expect(demo.total).toBe(demo.chunks.reduce((n, c) => n + c.gzip, 0));
    expect(demo.budget).toEqual({ total: 1000, worker: 800, page: 300 });
    expect(demo.chunks.every((c) => c.raw > c.gzip && c.gzip > 0)).toBe(true);
  });

  test("a static import from the entry graph into a pack is core-imports-pack", () => {
    const g = graph();
    g[0] = chunk("entry.js", { ...g[0], imports: ["shared.js", "worker.js"] });
    const { errors } = analyseChunks(g, [facts()], PACKS, false);
    expect(new Set(errors.map((e) => e.code))).toEqual(new Set(["core-imports-pack"]));
    expect(errors.some((e) => e.message.includes("packs/demo/dist/worker.js"))).toBe(true);
  });

  test("a pack module that was merged into a core chunk is the same error", () => {
    const g = graph();
    g[1] = chunk("shared.js", {
      moduleIds: ["/repo/packages/lang/src/x.ts", "/repo/packs/demo/dist/util.js"],
    });
    expect(analyseChunks(g, [facts()], PACKS, false).errors.map((e) => e.code)).toEqual([
      "core-imports-pack",
    ]);
  });

  test("an internal pack in a production build is channel-production; with the flag it is fine", () => {
    const internal = facts({ channel: "internal" });
    expect(analyseChunks(graph(), [internal], PACKS, false).errors.map((e) => e.code)).toEqual([
      "channel-production",
      "channel-production",
      "channel-production",
      "channel-production",
      "channel-production",
    ]);
    expect(analyseChunks(graph(), [internal], PACKS, true).errors).toEqual([]);
  });

  test("an internal pack is left out of a production report", () => {
    expect(buildReport([facts({ channel: "internal" })], [], false).packs).toEqual([]);
    expect(buildReport([facts({ channel: "internal" })], [], true).packs).toHaveLength(1);
  });

  test("a pack that no chunk reaches has an empty entry", () => {
    const report = buildReport(
      [facts()],
      [analyseChunks([chunk("entry.js", { isEntry: true })], [facts()], PACKS, false).packs],
      false,
    );
    expect(report.packs[0]).toMatchObject({ id: "demo", chunks: [], total: 0, worker: 0, page: 0 });
  });
});

describe("forgePacks in a real build", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function project(main: string, channel = "stable"): { root: string; report: string } {
    const root = mkdtempSync(`${tmpdir()}/forge-vite-`).replaceAll("\\", "/");
    dirs.push(root);
    const w = (p: string, text: string): void => {
      mkdirSync(`${root}/${p.slice(0, Math.max(0, p.lastIndexOf("/")))}`, { recursive: true });
      writeFileSync(`${root}/${p}`, text);
    };
    w(
      "packs/demo/manifest.json",
      JSON.stringify({
        id: "demo",
        channel,
        entries: { worker: "src/worker.ts", page: "src/page.ts" },
        externalCode: [{ path: "engine/e.mjs" }],
        budget: { total: 50000, worker: 40000, page: 10000 },
      }),
    );
    w(
      "packs/demo/dist/worker.js",
      'globalThis.worker = "w";\nimport("./prims/demo.js").then((m) => m.prim());\n',
    );
    w("packs/demo/dist/page.js", 'globalThis.page = "p".repeat(2000) + Math.random();\n');
    w(
      "packs/demo/dist/prims/demo.js",
      'export const prim = () => import("../../engine/e.mjs").then((m) => { globalThis.engine = m.engine; });\n',
    );
    w(
      "packs/demo/engine/e.mjs",
      `export const engine = ${JSON.stringify("e".repeat(5000))} + Math.random();\n`,
    );
    w("app/main.js", main);
    w("app/w.js", 'self.hello = "from the worker";\nimport("../packs/demo/dist/worker.js");\n');
    return { root, report: `${root}/reports/packs.json` };
  }

  function run(p: { root: string; report: string }, internal = false): Promise<unknown> {
    return build({
      root: `${p.root}/app`,
      configFile: false,
      logLevel: "silent",
      build: {
        outDir: `${p.root}/out`,
        emptyOutDir: true,
        rollupOptions: { input: `${p.root}/app/main.js` },
      },
      worker: {
        format: "es",
        plugins: () => [forgePacks({ packsDir: `${p.root}/packs`, side: "worker", internal })],
      },
      plugins: [forgePacks({ packsDir: `${p.root}/packs`, reportPath: p.report, internal })],
    });
  }

  test("dynamic imports into the pack build, and the report lists the pack's chunks", async () => {
    const p = project(
      'import("../packs/demo/dist/worker.js");\nimport("../packs/demo/dist/page.js");\n',
    );
    await run(p);
    const report = JSON.parse(readFileSync(p.report, "utf8")) as PacksReport;
    expect(report.format).toBe(1);
    const demo = report.packs[0] as PacksReport["packs"][number];
    expect(demo.id).toBe("demo");
    expect(demo.chunks.map((c) => c.role).sort()).toEqual(["engine", "page", "prims", "worker"]);
    expect(demo.chunks.find((c) => c.role === "engine")?.raw).toBeGreaterThan(5000);
    expect(demo.total).toBeGreaterThan(0);
    expect(demo.worker).toBeGreaterThan(0);
    expect(demo.page).toBeGreaterThan(0);
    expect(demo.budget).toEqual({ total: 50000, worker: 40000, page: 10000 });
  });

  test("a static import from core into the pack fails the build with core-imports-pack", async () => {
    const p = project('import "../packs/demo/dist/worker.js";\nglobalThis.x = 1;\n');
    await expect(run(p)).rejects.toThrow(/core-imports-pack/);
  });

  test("a static import of the page entry fails it too", async () => {
    const p = project('import "../packs/demo/dist/page.js";\nglobalThis.x = 1;\n');
    await expect(run(p)).rejects.toThrow(/core-imports-pack/);
  });

  test("a worker that imports a pack statically fails the build", async () => {
    const p = project(
      'globalThis.w = new Worker(new URL("./w.js", import.meta.url), { type: "module" });\n',
    );
    writeFileSync(
      `${p.root}/app/w.js`,
      'import "../packs/demo/dist/worker.js";\nglobalThis.x = 1;\n',
    );
    await expect(run(p)).rejects.toThrow(/core-imports-pack/);
  });

  test("a worker that reaches the pack dynamically is recorded in the page build's report", async () => {
    const p = project(
      'globalThis.w = new Worker(new URL("./w.js", import.meta.url), { type: "module" });\n',
    );
    await run(p);
    const demo = (JSON.parse(readFileSync(p.report, "utf8")) as PacksReport)
      .packs[0] as PacksReport["packs"][number];
    expect(demo.chunks.map((c) => c.role).sort()).toEqual(["engine", "prims", "worker"]);
    expect(demo.worker).toBe(demo.total);
  });

  test("an internal pack in a production build fails; with the flag it builds", async () => {
    const p = project('import("../packs/demo/dist/worker.js");\n', "internal");
    await expect(run(p)).rejects.toThrow(/channel-production/);
    await run(p, true);
    expect(
      (JSON.parse(readFileSync(p.report, "utf8")) as PacksReport).packs.map((x) => x.id),
    ).toEqual(["demo"]);
  });

  test("with no pack in the build the report lists the pack with no chunks", async () => {
    const p = project("globalThis.x = 1;\n");
    await run(p);
    const demo = (JSON.parse(readFileSync(p.report, "utf8")) as PacksReport).packs[0];
    expect(demo).toMatchObject({ id: "demo", chunks: [], total: 0 });
  });

  test("with no packs directory at all the report is empty", async () => {
    const p = project("globalThis.x = 1;\n");
    rmSync(`${p.root}/packs`, { recursive: true });
    await run(p);
    expect(JSON.parse(readFileSync(p.report, "utf8"))).toEqual({ format: 1, packs: [] });
  });
});
