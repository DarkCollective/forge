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
 * Steps 1 to 3 of `packs:gen` (PACKS.md section 3.2): discover, validate, select.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { cpCompare } from "@forge/lang";
import { validateManifest } from "../validate.js";
import type { KnownPack, ManifestContext } from "../types.js";
import type { DiscoveredPack, GenProblem, SelectedPack } from "./types.js";

/** Forward slashes, no trailing slash. */
export const norm = (p: string): string => p.replaceAll("\\", "/").replace(/\/+$/, "");

/** A path inside a pack, from its manifest-relative form. */
export const inPack = (root: string, rel: string): string => `${norm(root)}/${rel}`;

/**
 * Step 1: the directories of `packsDir` that hold a `manifest.json`, in code-point order of their names. A directory
 * that starts with `_` or `.` is skipped, and so is a directory without a manifest. A missing `packsDir` is no packs.
 */
export function discoverPacks(packsDir: string): {
  packs: DiscoveredPack[];
  problems: GenProblem[];
} {
  const base = norm(packsDir);
  const packs: DiscoveredPack[] = [];
  const problems: GenProblem[] = [];
  if (!existsSync(base)) return { packs, problems };
  const names = readdirSync(base).sort(cpCompare);
  for (const dir of names) {
    if (dir.startsWith("_") || dir.startsWith(".")) continue;
    const root = `${base}/${dir}`;
    if (!statSync(root).isDirectory() || !existsSync(`${root}/manifest.json`)) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(`${root}/manifest.json`, "utf8")) as unknown;
    } catch (e) {
      problems.push({
        code: "schema",
        pack: dir,
        path: "",
        message: `manifest.json is not valid JSON: ${(e as Error).message}`,
      });
      continue;
    }
    packs.push({ dir, root, raw });
  }
  return { packs, problems };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const names = (list: unknown): string[] =>
  Array.isArray(list)
    ? list.flatMap((x) => (isObj(x) && typeof x["name"] === "string" ? [x["name"]] : []))
    : [];

/** What the validator of another pack needs to know about this one, read leniently from a manifest that may be invalid. */
function known(raw: unknown): KnownPack | undefined {
  if (!isObj(raw) || typeof raw["id"] !== "string") return undefined;
  const requires = isObj(raw["requires"]) ? raw["requires"]["packs"] : undefined;
  return {
    id: raw["id"],
    vocabularies: names(raw["vocabularies"]),
    kinds: names(raw["kinds"]),
    requires: Array.isArray(requires)
      ? requires.filter((r): r is string => typeof r === "string")
      : [],
  };
}

/** The package name from `<root>/package.json`, `null` when there is no such file, `undefined` when it has no name. */
function packageNameOf(root: string): string | null | undefined {
  const file = `${root}/package.json`;
  if (!existsSync(file)) return null;
  try {
    const name = (JSON.parse(readFileSync(file, "utf8")) as { name?: unknown }).name;
    return typeof name === "string" ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Step 2: validate each manifest with the schema and the checks of section 2.4 that need only manifests and files.
 * Every discovered pack is validated, internal ones too, so that a mistake in a pack in development shows in CI.
 * Returns the packs that passed.
 */
export function validatePacks(
  discovered: readonly DiscoveredPack[],
  coreVocabs: readonly string[],
): { valid: SelectedPack[]; problems: GenProblem[] } {
  const problems: GenProblem[] = [];
  const valid: SelectedPack[] = [];
  const all = discovered.map((d) => known(d.raw));
  discovered.forEach((d, i) => {
    const pkgName = packageNameOf(d.root);
    if (pkgName === null) {
      problems.push({
        code: "entry-missing",
        pack: d.dir,
        path: "package.json",
        message: "'package.json' does not exist",
      });
    }
    const others = all.filter((k, j): k is KnownPack => j !== i && k !== undefined);
    const context: ManifestContext = {
      dirName: d.dir,
      ...(typeof pkgName === "string" ? { packageName: pkgName } : {}),
      coreVocabs,
      packs: others,
      fileExists: (p) => existsSync(inPack(d.root, p)),
      fileSize: (p) => statSync(inPack(d.root, p)).size,
    };
    const result = validateManifest(d.raw, context);
    if (result.ok) {
      valid.push({ dir: d.dir, root: d.root, manifest: result.manifest });
    } else {
      for (const p of result.problems) {
        problems.push({ code: p.code, pack: d.dir, path: p.path, message: p.message });
      }
    }
  });
  return { valid, problems };
}

/**
 * Step 3: drop `internal` packs unless `internal` is set (PK14), then check that no selected pack requires one that was
 * dropped. The result is in code-point order of id.
 */
export function selectPacks(
  valid: readonly SelectedPack[],
  internal: boolean,
): { selected: SelectedPack[]; problems: GenProblem[] } {
  const selected = valid
    .filter((p) => internal || p.manifest.channel === "stable")
    .sort((a, b) => cpCompare(a.manifest.id, b.manifest.id));
  const problems: GenProblem[] = [];
  const ids = new Set(selected.map((p) => p.manifest.id));
  for (const p of selected) {
    (p.manifest.requires.packs ?? []).forEach((r, i) => {
      if (!ids.has(r) && valid.some((v) => v.manifest.id === r)) {
        problems.push({
          code: "requires-unknown",
          pack: p.manifest.id,
          path: `/requires/packs/${i}`,
          message: `required pack '${r}' is an internal pack and is not in this build`,
        });
      }
    });
  }
  return { selected, problems };
}

/** The closure of a pack under `requires`, in the order of `selected`. */
export function closureOf(selected: readonly SelectedPack[], id: string): SelectedPack[] {
  const byId = new Map(selected.map((p) => [p.manifest.id, p]));
  const out = new Set<string>();
  const add = (x: string): void => {
    if (out.has(x)) return;
    out.add(x);
    for (const r of byId.get(x)?.manifest.requires.packs ?? []) add(r);
  };
  add(id);
  return selected.filter((p) => out.has(p.manifest.id));
}
