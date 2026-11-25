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
 * Steps 4 to 6 of `packs:gen` (PACKS.md section 3.2): build core alone, build each pack on core, write the fragments.
 * This is the fragment build driver. It also decides the checks that need the assembled runtime: `core-depends-on-pack`,
 * `dependency-undeclared`, `conversion-op`, `external-version` and `fragment-drift`.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { cpCompare } from "@forge/lang";
import type { ForgeRuntime } from "@forge/lang";
import {
  assembleRuntime,
  buildCatalogue,
  buildChecks,
  buildHelp,
  createBundleLoader,
  parsePinsCompat,
  scanVocab,
} from "@forge/ops";
import type {
  Catalogue,
  PinsCompat,
  PrimitiveModule,
  SourceFile,
  VectorFile,
  VocabSourceProvider,
} from "@forge/ops";
import { mergeCatalogues } from "../merge.js";
import { packSourceVocabs } from "./checks.js";
import { closureOf } from "./discover.js";
import type { FragmentFiles, GenProblem, SelectedPack } from "./types.js";

/**
 * A provider over one pack directory: `vocab/*.fth` and the compiled primitive modules in `dist/prims/*.js`. A pack is
 * built like `@forge/ops` (PACKS.md section 3.1): `tsc` compiles `src` to `dist` before the generator runs.
 */
export function packProvider(root: string): VocabSourceProvider {
  return {
    fthFiles(): Promise<readonly SourceFile[]> {
      const dir = `${root}/vocab`;
      const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".fth")) : [];
      return Promise.resolve(
        files
          .sort(cpCompare)
          .map((name) => ({ name, text: readFileSync(`${dir}/${name}`, "utf8") })),
      );
    },
    primitiveLoaders(): Readonly<Record<string, () => Promise<PrimitiveModule>>> {
      const dir = `${root}/dist/prims`;
      const out: Record<string, () => Promise<PrimitiveModule>> = {};
      if (!existsSync(dir)) return out;
      for (const f of readdirSync(dir).sort(cpCompare)) {
        if (!f.endsWith(".js") || f.includes(".test.")) continue;
        const href = pathToFileURL(`${dir}/${f}`).href;
        out[f.slice(0, -".js".length)] = () => import(href) as Promise<PrimitiveModule>;
      }
      return out;
    },
  };
}

/** Core and some packs as one provider. */
function composite(parts: readonly VocabSourceProvider[]): VocabSourceProvider {
  return {
    async fthFiles(): Promise<readonly SourceFile[]> {
      return (await Promise.all(parts.map((p) => p.fthFiles()))).flat();
    },
    primitiveLoaders(): Readonly<Record<string, () => Promise<PrimitiveModule>>> {
      return Object.assign({}, ...parts.map((p) => p.primitiveLoaders())) as Readonly<
        Record<string, () => Promise<PrimitiveModule>>
      >;
    },
  };
}

/** The names of the vocabularies core provides: its `.fth` files and primitive modules. */
export async function coreVocabNames(core: VocabSourceProvider): Promise<string[]> {
  const files = await core.fthFiles();
  return [
    ...new Set([
      ...files.map((f) => f.name.replace(/\.fth$/, "")),
      ...Object.keys(core.primitiveLoaders()),
    ]),
  ].sort(cpCompare);
}

function pinsOf(root: string): PinsCompat {
  const file = `${root}/vocab/pins-compat.json`;
  return existsSync(file) ? parsePinsCompat(readFileSync(file, "utf8")) : {};
}

function vectorsOf(pack: SelectedPack): VectorFile[] {
  const dir = `${pack.root}/vocab`;
  if (!existsSync(dir)) return [];
  const own = new Set(pack.manifest.vocabularies.map((v) => v.name));
  return readdirSync(dir)
    .filter((f) => f.endsWith(".test.json"))
    .sort(cpCompare)
    .flatMap((f) => {
      const vocab = f.slice(0, -".test.json".length);
      return own.has(vocab)
        ? [{ vocab, vectors: JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as unknown[] }]
        : [];
    });
}

const CONVERSION_MESSAGES = [
  "is not a catalogue operation",
  "the data input of",
  "the output of",
  "has no default",
];

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Deep equality of two JSON values by canonical text (key order is the builders' own and is part of the claim). */
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Steps 4 and 5, the checks that read the dependency graph: scan core and every pack together once. A pack unit that
 * names a vocabulary of a pack outside its `requires` closure is `dependency-undeclared`; a core unit that names a pack
 * vocabulary is `core-depends-on-pack`. Then scan core alone, which is what `core-depends-on-pack` protects.
 * `all` is every valid pack, the unselected internal ones included, so that a reference to one is read as a dependency
 * and not as an unknown vocabulary.
 */
export async function checkDependencies(
  core: VocabSourceProvider,
  all: readonly SelectedPack[],
  selected: readonly SelectedPack[],
): Promise<GenProblem[]> {
  const problems: GenProblem[] = [];
  const coreFiles = await core.fthFiles();
  const corePrims = Object.keys(core.primitiveLoaders());
  const packFiles = await Promise.all(all.map((p) => packProvider(p.root).fthFiles()));
  const packPrims = all.flatMap((p) => packSourceVocabs(p.root).prims);
  const owner = new Map<string, string>();
  all.forEach((p) => p.manifest.vocabularies.forEach((v) => owner.set(v.name, p.manifest.id)));

  let world;
  try {
    world = scanVocab([...coreFiles, ...packFiles.flat()], [...corePrims, ...packPrims]);
  } catch (e) {
    return [{ code: "gen-error", message: `scanning core and the packs: ${messageOf(e)}` }];
  }
  const coreNames = new Set(coreFiles.map((f) => f.name.replace(/\.fth$/, "")));
  for (const unit of world.units) {
    if (coreNames.has(unit.vocab)) {
      for (const dep of unit.deps) {
        const pack = owner.get(dep);
        if (pack !== undefined) {
          problems.push({
            code: "core-depends-on-pack",
            path: unit.name,
            message: `core vocabulary '${unit.vocab}' names '${dep}', a vocabulary of the pack '${pack}'`,
          });
        }
      }
    }
  }
  for (const p of selected) {
    const id = p.manifest.id;
    const allowed = new Set(closureOf(all, id).map((q) => q.manifest.id));
    const own = new Set(p.manifest.vocabularies.map((v) => v.name));
    for (const unit of world.units) {
      if (!own.has(unit.vocab)) continue;
      for (const dep of unit.deps) {
        const pack = owner.get(dep);
        if (pack !== undefined && !allowed.has(pack)) {
          problems.push({
            code: "dependency-undeclared",
            pack: id,
            path: unit.name,
            message: `'${unit.vocab}' names '${dep}', a vocabulary of the pack '${pack}', which '${id}' does not require`,
          });
        }
      }
    }
  }
  if (!problems.some((x) => x.code === "core-depends-on-pack")) {
    try {
      scanVocab(coreFiles, corePrims);
    } catch (e) {
      problems.push({ code: "gen-error", message: `core does not build alone: ${messageOf(e)}` });
    }
  }
  return problems;
}

async function runtimeOf(
  core: VocabSourceProvider,
  packs: readonly SelectedPack[],
): Promise<ForgeRuntime> {
  const provider = composite([core, ...packs.map((p) => packProvider(p.root))]);
  return assembleRuntime(await createBundleLoader(provider)("all"));
}

/** Each primitive module in `src/prims` has to be compiled before the generator can load it. */
function unbuilt(pack: SelectedPack): GenProblem[] {
  return packSourceVocabs(pack.root)
    .prims.filter((n) => !existsSync(`${pack.root}/dist/prims/${n}.js`))
    .map((n) => ({
      code: "gen-error" as const,
      pack: pack.manifest.id,
      path: `src/prims/${n}.ts`,
      message: `dist/prims/${n}.js does not exist: build the pack (npm run build -w @forge/pack-${pack.manifest.id}) before packs:gen`,
    }));
}

const internalVocabsOf = (packs: readonly SelectedPack[]): string[] =>
  packs.flatMap((p) =>
    p.manifest.vocabularies.filter((v) => v.internal === true).map((v) => v.name),
  );

const pinsOfAll = (packs: readonly SelectedPack[]): PinsCompat =>
  Object.assign({}, ...packs.map((p) => pinsOf(p.root))) as PinsCompat;

/** `external-version`: a primitive named by `externalCode.primitives` has a `version` that contains the engine's. */
function checkExternalVersion(pack: SelectedPack, runtime: ForgeRuntime): GenProblem[] {
  const problems: GenProblem[] = [];
  const own = pack.manifest.vocabularies.map((v) => v.name);
  const primitives = (vocab: string): string[] =>
    runtime.registry.list(vocab).map((d) => `${d.vocab}:${d.name}`);
  const all = own.flatMap(primitives);
  (pack.manifest.externalCode ?? []).forEach((e, i) => {
    const named = e.primitives === "*" ? all : e.primitives;
    for (const q of named) {
      const [vocab, name] = q.split(":") as [string, string];
      const def = own.includes(vocab) ? runtime.registry.get(vocab, name) : undefined;
      if (def === undefined) {
        problems.push({
          code: "external-version",
          pack: pack.manifest.id,
          path: `/externalCode/${i}/primitives`,
          message: `'${q}' is named by externalCode '${e.id}' and is not a primitive of the pack`,
        });
      } else if (!(def.version ?? "").includes(e.version)) {
        problems.push({
          code: "external-version",
          pack: pack.manifest.id,
          path: `/externalCode/${i}/version`,
          message: `primitive '${q}' has version '${def.version ?? ""}', which does not contain '${e.version}'`,
        });
      }
    }
  });
  return problems;
}

export interface BuiltFragments {
  readonly problems: GenProblem[];
  readonly fragments: FragmentFiles[];
}

/**
 * Steps 4 to 6 for the selected packs: the core catalogue, then for each pack the runtime of core, the pack and its
 * required packs, and from it the catalogue fragment, the help fragment and the checks fragment. Last, the merge-equality
 * check (`fragment-drift`, PACKS.md section 5.2) for each pack with its closure and for all selected packs together.
 */
export async function buildFragments(
  core: VocabSourceProvider,
  selected: readonly SelectedPack[],
  corePins: PinsCompat,
): Promise<BuiltFragments> {
  const problems: GenProblem[] = [];
  const fragments: FragmentFiles[] = [];
  const warn = (): void => undefined;
  for (const p of selected) problems.push(...unbuilt(p));
  if (problems.length > 0) return { problems, fragments };

  let coreCatalogue: Catalogue;
  try {
    coreCatalogue = buildCatalogue(await runtimeOf(core, []), { pinsCompat: corePins, warn });
  } catch (e) {
    return { problems: [{ code: "gen-error", message: `core: ${messageOf(e)}` }], fragments };
  }

  const catalogues = new Map<string, Catalogue>();
  for (const p of selected) {
    const id = p.manifest.id;
    try {
      const runtime = await runtimeOf(core, closureOf(selected, id));
      problems.push(...checkExternalVersion(p, runtime));
      const catalogue = buildCatalogue(runtime, {
        pinsCompat: pinsOf(p.root),
        internalVocabs: p.manifest.vocabularies
          .filter((v) => v.internal === true)
          .map((v) => v.name),
        onlyVocabs: p.manifest.vocabularies.map((v) => v.name),
        conversions: p.manifest.conversions ?? [],
        warn,
      });
      catalogues.set(id, catalogue);
      // `buildHelp` and `buildChecks` accept only the catalogue of the whole runtime. Give them that catalogue narrowed to
      // the pack's ops (same version, so the check passes), then stamp the documents with the fragment's own version.
      const whole = buildCatalogue(runtime, { warn });
      const own = new Set(catalogue.ops.map((o) => o.qname));
      const narrowed: Catalogue = { ...whole, ops: whole.ops.filter((o) => own.has(o.qname)) };
      const help = { ...buildHelp(runtime, narrowed, vectorsOf(p)), catalogue: catalogue.version };
      const checks = { ...buildChecks(runtime, narrowed), catalogue: catalogue.version };
      fragments.push({
        id,
        catalogue: JSON.stringify(catalogue, null, 2) + "\n",
        help: JSON.stringify(help, null, 2) + "\n",
        checks: JSON.stringify(checks, null, 2) + "\n",
      });
    } catch (e) {
      const message = messageOf(e);
      const conversion = CONVERSION_MESSAGES.some((m) => message.includes(m));
      problems.push({
        code: conversion ? "conversion-op" : "gen-error",
        pack: id,
        message: conversion ? message : `building the fragments: ${message}`,
      });
    }
  }
  if (problems.length > 0) return { problems, fragments };

  // fragment-drift: merge equality for each pack on its own with its closure, and for all selected packs together
  const sets = [...selected.map((p) => closureOf(selected, p.manifest.id)), [...selected]];
  for (const set of sets) {
    const label = set.map((p) => p.manifest.id).join("+");
    try {
      const merged = mergeCatalogues(
        coreCatalogue,
        set.map((p) => catalogues.get(p.manifest.id) as Catalogue),
      );
      const whole = buildCatalogue(await runtimeOf(core, set), {
        pinsCompat: { ...corePins, ...pinsOfAll(set) },
        internalVocabs: internalVocabsOf(set),
        conversions: set.flatMap((p) => p.manifest.conversions ?? []),
        warn,
      });
      if (!same(merged, whole)) {
        problems.push({
          code: "fragment-drift",
          message: `the merged catalogue of core and ${label} (${merged.version}) differs from the catalogue built from one runtime (${whole.version})`,
        });
      }
    } catch (e) {
      problems.push({
        code: "fragment-drift",
        message: `merge equality of core and ${label}: ${messageOf(e)}`,
      });
    }
  }
  return { problems, fragments };
}
