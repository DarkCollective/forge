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
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { KnownPack, ManifestContext } from "../src/index.js";

const root = join(fileURLToPath(import.meta.url), "..", "manifests");

export interface CorpusFile {
  /** `valid/relix.json` */
  readonly name: string;
  /** For an invalid file, the code in front of `--` (or the whole stem). */
  readonly code: string;
  readonly manifest: unknown;
}

function load(dir: "valid" | "invalid"): CorpusFile[] {
  return readdirSync(join(root, dir))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({
      name: `${dir}/${f}`,
      code: f.replace(/\.json$/, "").split("--")[0] ?? "",
      manifest: JSON.parse(readFileSync(join(root, dir, f), "utf8")) as unknown,
    }));
}

export const validFiles = (): CorpusFile[] => load("valid");
export const invalidFiles = (): CorpusFile[] => load("invalid");

/** The fake core of PACKS 10.1: a few core vocabulary names and two other packs. */
export const FIXTURE_PACKS: readonly KnownPack[] = [
  { id: "other", vocabularies: ["othervoc"], kinds: ["other-kind"], requires: [] },
  { id: "loop", vocabularies: ["loopvoc"], kinds: [], requires: ["relix"] },
];
export const FIXTURE_CORE_VOCABS: readonly string[] = ["base64", "hex", "text"];

interface Override {
  dirName?: string;
  packageName?: string;
  missing?: readonly string[];
  emptyNotice?: boolean;
}

/** Per-file changes to the surroundings. Everything else uses the plain fixture context. */
const OVERRIDES: Record<string, Override> = {
  "invalid/id-dir--dir-differs.json": { dirName: "demo-x" },
  "invalid/id-dir--package-differs.json": { packageName: "@forge/pack-other" },
  "invalid/entry-missing--worker.json": { missing: ["src/worker.ts"] },
  "invalid/entry-missing--parser.json": { missing: ["src/kinds/demo-tally/parse.ts"] },
  "invalid/entry-missing--external.json": { missing: ["engine/relix-web.mjs"] },
  "invalid/licence-list--empty-notice.json": { emptyNotice: true },
};

export function fixtureContext(file: CorpusFile): ManifestContext {
  const o = OVERRIDES[file.name] ?? {};
  const id = (file.manifest as { id?: string } | null)?.id;
  const missing = new Set(o.missing ?? []);
  return {
    dirName: o.dirName ?? id,
    packageName: o.packageName ?? (id === undefined ? undefined : `@forge/pack-${id}`),
    coreVocabs: FIXTURE_CORE_VOCABS,
    packs: FIXTURE_PACKS,
    fileExists: (p) => !missing.has(p),
    fileSize: (p) => (o.emptyNotice === true && p === "NOTICE" ? 0 : 100),
  };
}
