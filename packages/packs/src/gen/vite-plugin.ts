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
 * The `forgePacks()` Vite plugin (PACKS.md section 3.5). After the bundle is built it
 *
 *   1. attributes chunks to packs, and fails the build with `core-imports-pack` when a static import edge leads from the
 *      core entry graph into `packs/` (the only edges allowed are the dynamic imports of the two generated registries),
 *      and with `channel-production` when a production build contains an internal pack;
 *   2. measures the gzip size of each chunk at level 9, as `apps/web/scripts/check-size.mjs` does;
 *   3. writes the report `reports/packs.json` (PACKS.md section 3.5), which `npm run size` reads (P7).
 *
 * The plugin is given to the page build and to the worker build (`worker.plugins`): a bake or console worker is a build of
 * its own, and its static edges are checked the same way. The two share one record, written to the report by the page
 * build, which finishes last.
 */
import { mkdirSync, readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import type { Plugin } from "vite";

export interface ForgePacksOptions {
  /** Absolute path of the repository's `packs/` directory. */
  readonly packsDir: string;
  /** Absolute path of the report to write. `undefined` writes none. */
  readonly reportPath?: string;
  /** Include internal packs (`FORGE_PACKS_INTERNAL=1`). Default: from the environment. */
  readonly internal?: boolean;
  /** `worker` for the plugin instance of a worker build: it checks and records, and writes no report. */
  readonly side?: "page" | "worker";
}

/** The part of a manifest the plugin reads. The generator has validated it already. */
interface PackFacts {
  readonly id: string;
  readonly channel: string;
  readonly workerEntry: string | undefined;
  readonly pageEntry: string | undefined;
  readonly enginePaths: readonly string[];
  readonly budget: { total: number; worker?: number; page?: number };
}

export type ChunkRole = "worker" | "page" | "prims" | "engine" | "shared";

export interface ReportChunk {
  readonly file: string;
  readonly role: ChunkRole;
  readonly raw: number;
  readonly gzip: number;
}

export interface PackReport {
  readonly id: string;
  readonly chunks: readonly ReportChunk[];
  readonly total: number;
  readonly worker: number;
  readonly page: number;
  readonly budget: { total: number; worker?: number; page?: number };
}

export interface PacksReport {
  readonly format: 1;
  readonly packs: readonly PackReport[];
}

/** A chunk as the analysis sees it: the fields of Rollup's `OutputChunk` that it reads. */
export interface ChunkInfo {
  readonly fileName: string;
  readonly code: string;
  readonly imports: readonly string[];
  readonly dynamicImports: readonly string[];
  readonly isEntry: boolean;
  readonly moduleIds: readonly string[];
}

/** A pack's chunk in one build: its role, sizes and the sets (worker, page) that reach it. */
export interface ChunkRecord {
  role: ChunkRole;
  raw: number;
  gzip: number;
  sets: Set<"worker" | "page">;
}

/** Pack id to its chunks (by file) in one build. */
export type PackChunks = Map<string, Map<string, ChunkRecord>>;

type BuildError = { code: "core-imports-pack" | "channel-production"; message: string };

const norm = (p: string): string => p.replaceAll("\\", "/").replace(/\/+$/, "");
const noQuery = (id: string): string => id.replace(/[?#].*$/, "");

/** Read the facts of every pack under `packsDir`. */
export function readPackFacts(packsDir: string): PackFacts[] {
  const base = norm(packsDir);
  if (!existsSync(base)) return [];
  const out: PackFacts[] = [];
  for (const dir of readdirSync(base).sort()) {
    if (dir.startsWith("_") || dir.startsWith(".")) continue;
    const file = `${base}/${dir}/manifest.json`;
    if (!existsSync(file)) continue;
    const m = JSON.parse(readFileSync(file, "utf8")) as {
      id: string;
      channel: string;
      entries: { worker: string; page?: string };
      externalCode?: { path: string }[];
      budget: { total: number; worker?: number; page?: number };
    };
    out.push({
      id: m.id,
      channel: m.channel,
      workerEntry: m.entries.worker,
      pageEntry: m.entries.page,
      enginePaths: (m.externalCode ?? []).map((e) => e.path),
      budget: m.budget,
    });
  }
  return out;
}

/** `src/worker.ts` is built to `dist/worker.js`: the module a chunk holds. */
const builtPath = (src: string): string =>
  src.replace(/^src\//, "dist/").replace(/\.(ts|tsx|mts)$/, ".js");

/**
 * The pack a module id belongs to, or `undefined`: a file under `<packsDir>/<id>/`, or under a `@forge/pack-<id>` package
 * in `node_modules` when the bundler did not resolve the workspace link.
 */
export function packOfModule(id: string, packsDir: string): string | undefined {
  const p = noQuery(id).replaceAll("\\", "/");
  const base = `${norm(packsDir)}/`;
  if (p.startsWith(base)) return p.slice(base.length).split("/")[0];
  const m = /\/node_modules\/@forge\/pack-([a-z0-9-]+)\//.exec(p);
  return m?.[1];
}

/** The chunks reachable from `roots` through `edges`. */
function reach(
  roots: readonly string[],
  edges: (file: string) => readonly string[],
  stop: ReadonlySet<string> = new Set(),
): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  for (let f = queue.pop(); f !== undefined; f = queue.pop()) {
    if (seen.has(f) || stop.has(f)) continue;
    seen.add(f);
    queue.push(...edges(f));
  }
  return seen;
}

/**
 * Analyse one build's chunks (PACKS.md section 3.5): the static-import rule, the production rule, and for each pack the
 * chunks reachable from its entry chunks, minus those the core graph reaches.
 */
export function analyseChunks(
  chunks: readonly ChunkInfo[],
  facts: readonly PackFacts[],
  packsDir: string,
  internal: boolean,
): { errors: BuildError[]; packs: PackChunks } {
  const errors: BuildError[] = [];
  const byFile = new Map(chunks.map((c) => [c.fileName, c]));
  const packsOf = (c: ChunkInfo): Set<string> =>
    new Set(c.moduleIds.flatMap((id) => packOfModule(id, packsDir) ?? []));
  const staticEdges = (f: string): readonly string[] => byFile.get(f)?.imports ?? [];
  const allEdges = (f: string): readonly string[] => [
    ...(byFile.get(f)?.imports ?? []),
    ...(byFile.get(f)?.dynamicImports ?? []),
  ];

  // the core graph: everything an entry reaches by static imports
  const entries = chunks.filter((c) => c.isEntry).map((c) => c.fileName);
  const coreReach = reach(entries, staticEdges);
  for (const f of coreReach) {
    const c = byFile.get(f);
    if (c === undefined) continue;
    for (const id of c.moduleIds) {
      const pack = packOfModule(id, packsDir);
      if (pack !== undefined) {
        errors.push({
          code: "core-imports-pack",
          message: `core code reaches the pack '${pack}' by a static import: ${noQuery(id)} is in ${f}, which an entry chunk imports statically. Only the dynamic imports of the generated registries may lead into packs/.`,
        });
      }
    }
  }

  // an internal pack in a production build
  const known = new Map(facts.map((x) => [x.id, x]));
  for (const c of chunks) {
    for (const id of packsOf(c)) {
      const x = known.get(id);
      if (!internal && x?.channel === "internal") {
        errors.push({
          code: "channel-production",
          message: `the production build contains the internal pack '${id}' (${c.fileName}); set FORGE_PACKS_INTERNAL=1 for a build that should have it`,
        });
      }
    }
  }

  const packs: PackChunks = new Map();
  const sizes = new Map(
    chunks.map((c) => [
      c.fileName,
      { raw: Buffer.byteLength(c.code), gzip: gzipSync(c.code, { level: 9 }).length },
    ]),
  );
  for (const x of facts) {
    if (!internal && x.channel === "internal") continue;
    const holds = (c: ChunkInfo, rel: string): boolean =>
      c.moduleIds.some((id) => noQuery(id).replaceAll("\\", "/").endsWith(`/${x.id}/${rel}`));
    const rootOf = (entry: string | undefined): string[] =>
      entry === undefined
        ? []
        : chunks
            .filter((c) => holds(c, builtPath(entry)) || holds(c, entry))
            .map((c) => c.fileName);
    const workerRoots = rootOf(x.workerEntry);
    const pageRoots = rootOf(x.pageEntry);
    const sets = new Map<"worker" | "page", Set<string>>([
      ["worker", reach(workerRoots, allEdges, coreReach)],
      ["page", reach(pageRoots, allEdges, coreReach)],
    ]);
    const mine = new Map<string, ChunkRecord>();
    for (const [name, files] of sets) {
      for (const f of files) {
        const c = byFile.get(f);
        if (c === undefined) continue;
        const size = sizes.get(f) as { raw: number; gzip: number };
        const entry = mine.get(f) ?? { role: "shared" as ChunkRole, ...size, sets: new Set() };
        entry.sets.add(name);
        mine.set(f, entry);
      }
    }
    for (const [f, entry] of mine) {
      const c = byFile.get(f) as ChunkInfo;
      const engine = x.enginePaths.some((p) => holds(c, p));
      const prims = c.moduleIds.some(
        (id) =>
          noQuery(id).replaceAll("\\", "/").includes(`/${x.id}/`) && /\/prims\//.test(noQuery(id)),
      );
      entry.role = engine
        ? "engine"
        : prims
          ? "prims"
          : entry.sets.size === 2
            ? "shared"
            : entry.sets.has("worker")
              ? "worker"
              : "page";
    }
    packs.set(x.id, mine);
  }
  return { errors, packs };
}

/** Merge the findings of the builds into the report of PACKS.md section 3.5. */
export function buildReport(
  facts: readonly PackFacts[],
  parts: readonly PackChunks[],
  internal: boolean,
): PacksReport {
  const packs: PackReport[] = [];
  for (const x of facts) {
    if (!internal && x.channel === "internal") continue;
    const chunks = new Map<string, ChunkRecord>();
    for (const part of parts) {
      for (const [file, c] of part.get(x.id) ?? []) chunks.set(file, c);
    }
    const list = [...chunks].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const sum = (pick: (c: { sets: Set<"worker" | "page"> }) => boolean): number =>
      list.reduce((n, [, c]) => (pick(c) ? n + c.gzip : n), 0);
    packs.push({
      id: x.id,
      chunks: list.map(([file, c]) => ({ file, role: c.role, raw: c.raw, gzip: c.gzip })),
      total: sum(() => true),
      worker: sum((c) => c.sets.has("worker")),
      page: sum((c) => c.sets.has("page")),
      budget: x.budget,
    });
  }
  return { format: 1, packs };
}

/** The records of the worker builds in this process, read by the page build's report. Reset by the page build. */
let workerParts: PackChunks[] = [];

export function forgePacks(options: ForgePacksOptions): Plugin {
  const side = options.side ?? "page";
  const internal = options.internal ?? process.env["FORGE_PACKS_INTERNAL"] === "1";
  return {
    name: "forge-packs",
    apply: "build",
    buildStart() {
      if (side === "page") workerParts = [];
    },
    generateBundle(_options, bundle) {
      const chunks: ChunkInfo[] = [];
      for (const item of Object.values(bundle)) {
        if (item.type !== "chunk") continue;
        chunks.push({
          fileName: item.fileName,
          code: item.code,
          imports: item.imports,
          dynamicImports: item.dynamicImports,
          isEntry: item.isEntry,
          moduleIds: Object.keys(item.modules),
        });
      }
      const facts = readPackFacts(options.packsDir);
      const found = analyseChunks(chunks, facts, options.packsDir, internal);
      if (found.errors.length > 0) {
        const first = found.errors[0] as BuildError;
        this.error(`${first.code}: ${first.message}`);
      }
      if (side === "worker") {
        workerParts.push(found.packs);
        return;
      }
      if (options.reportPath !== undefined) {
        const report = buildReport(facts, [found.packs, ...workerParts], internal);
        const path = norm(options.reportPath);
        mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
        writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
      }
    },
  };
}
