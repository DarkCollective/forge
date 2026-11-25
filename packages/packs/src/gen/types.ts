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

import type { VocabSourceProvider } from "@forge/ops";
import type { ManifestCheckCode, PackManifest } from "../types.js";

/**
 * The codes of PACKS section 2.4 that the generator decides (`vocab-file`, `parser-imports`,
 * `dependency-undeclared`, `core-depends-on-pack`, `conversion-op`, `external-sha`, `external-version`,
 * `csp-unsatisfied`, `channel-production`, `fragment-drift`), the two it adds for its own steps, and the codes
 * of `validateManifest` that it passes on.
 */
export type GenCheckCode =
  | ManifestCheckCode
  | "vocab-file"
  | "parser-imports"
  | "dependency-undeclared"
  | "core-depends-on-pack"
  | "conversion-op"
  | "external-sha"
  | "external-version"
  | "csp-unsatisfied"
  | "channel-production"
  | "fragment-drift"
  /** A committed generated file differs from what the manifests produce (`--check`). */
  | "generated-stale"
  /** The generator could not do a step (a build failure that has no code of its own). */
  | "gen-error";

/** One problem, with the pack id when it belongs to one. */
export interface GenProblem {
  readonly code: GenCheckCode;
  readonly pack?: string;
  readonly path?: string;
  readonly message: string;
}

/** A pack found on disk. */
export interface DiscoveredPack {
  /** The directory name under `packs/`. */
  readonly dir: string;
  /** Absolute path of the pack directory, with `/` separators. */
  readonly root: string;
  /** The parsed `manifest.json`, or `undefined` when it is not valid JSON (then `problems` says so). */
  readonly raw: unknown;
}

/** A pack that passed validation and selection. */
export interface SelectedPack {
  readonly dir: string;
  readonly root: string;
  readonly manifest: PackManifest;
}

/** The text of a pack's catalogue fragment, help fragment and checks fragment (PACKS section 5.1). */
export interface FragmentFiles {
  readonly id: string;
  readonly catalogue: string;
  readonly help: string;
  readonly checks: string;
}

export interface GenOptions {
  /** The repository root: holds `packs/` and `apps/web`. */
  readonly repoRoot: string;
  /** Default: `<repoRoot>/packs`. */
  readonly packsDir?: string;
  /** Default: `<repoRoot>/apps/web/src/packs/registry.generated.ts`. */
  readonly pageRegistryPath?: string;
  /** Default: `<repoRoot>/apps/web/src/bake/worker-packs.generated.ts`. */
  readonly workerRegistryPath?: string;
  /** Include `internal` packs. Default: `FORGE_PACKS_INTERNAL === "1"`. */
  readonly internal?: boolean;
  /**
   * Where core's vocabulary sources come from. Default: `createNodeProvider()` of `@forge/ops/node`, which reads the
   * built `@forge/ops` package. Tests pass a small fixture core.
   */
  readonly coreProvider?: VocabSourceProvider;
  /** The directory with core's `vocab/pins-compat.json`. Default: none. */
  readonly corePinsRoot?: string;
  /** Files whose text states what the deployed CSP allows (`csp-unsatisfied`). Default: `infra/site.tf` and `apps/web/scripts/serve-prod.mjs` under `repoRoot`. */
  readonly cspFiles?: readonly string[];
  /** Skip the runtime steps (4 to 6): the registries come from the manifests alone. Default: false. */
  readonly skipRuntime?: boolean;
}

export interface GenResult {
  readonly problems: readonly GenProblem[];
  /** Generated source files by absolute path (the two registries). */
  readonly files: ReadonlyMap<string, string>;
  /** The fragments, when the runtime steps ran and there was no problem before them. */
  readonly fragments: readonly FragmentFiles[];
  /** The ids of the selected packs. */
  readonly selected: readonly string[];
}
