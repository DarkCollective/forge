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

/** The effect labels a manifest may list (PACKS section 6.2). The list is closed (PK11). */
export type ManifestEffect = "+async" | "+random" | "+time" | "+media";

/** CSP sources a manifest may ask for (PK19). */
export type CspSource = "blob:" | "data:";

export interface ManifestVocabulary {
  readonly name: string;
  readonly internal?: boolean;
}

export interface ManifestKind {
  readonly name: string;
  readonly label: string;
  readonly viewer: boolean;
  readonly paramHelper: boolean;
  readonly parser?: string;
}

export interface ManifestConversion {
  readonly from: string;
  readonly to: string;
  readonly op: string;
  readonly atEnd?: true;
}

export interface ManifestExternalCode {
  readonly id: string;
  readonly version: string;
  readonly path: string;
  readonly sha256: string;
  readonly licence: string;
  readonly maxGzip: number;
  readonly primitives: "*" | readonly string[];
}

/** A pack manifest, format 1 (PACKS section 2.2). */
export interface PackManifest {
  readonly $schema?: string;
  readonly format: 1;
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly description: string;
  readonly version: string;
  readonly channel: "stable" | "internal";
  readonly licence: string;
  readonly notice?: string;
  readonly requires: { readonly packApi: number; readonly packs?: readonly string[] };
  readonly vocabularies: readonly ManifestVocabulary[];
  readonly kinds?: readonly ManifestKind[];
  readonly conversions?: readonly ManifestConversion[];
  readonly entries: { readonly worker: string; readonly page?: string };
  readonly capabilities: {
    readonly effects: readonly ManifestEffect[];
    readonly csp?: {
      readonly "img-src"?: readonly CspSource[];
      readonly "media-src"?: readonly CspSource[];
      readonly "font-src"?: readonly CspSource[];
    };
  };
  readonly externalCode?: readonly ManifestExternalCode[];
  readonly budget: { readonly total: number; readonly worker?: number; readonly page?: number };
}

/** The stable codes of PACKS section 2.4 that this package can decide without a runtime. */
export type ManifestCheckCode =
  | "schema"
  | "id-dir"
  | "id-reserved"
  | "vocab-clash"
  | "kind-clash"
  | "kind-reserved"
  | "entry-missing"
  | "requires-unknown"
  | "requires-cycle"
  | "requires-api"
  | "licence-list";

/** One problem found in a manifest. `path` is a JSON Pointer into the manifest, `""` for the whole. */
export interface ManifestProblem {
  readonly code: ManifestCheckCode;
  readonly path: string;
  readonly message: string;
}

export type ManifestResult =
  | { readonly ok: true; readonly manifest: PackManifest; readonly problems: readonly [] }
  | { readonly ok: false; readonly problems: readonly ManifestProblem[] };

/** What the validator needs to know about another pack in the build. */
export interface KnownPack {
  readonly id: string;
  readonly vocabularies: readonly string[];
  readonly kinds: readonly string[];
  readonly requires?: readonly string[];
}

/**
 * The surroundings of a manifest. Every field is optional: a check whose input is absent does not
 * run, so `validateManifest(m)` alone is the schema plus the checks that need no other pack.
 */
export interface ManifestContext {
  /** The directory name `packs/<dir>` and the package name `@forge/pack-<id>` (check `id-dir`). */
  readonly dirName?: string;
  readonly packageName?: string;
  /**
   * Names of the core vocabularies: the files of `packages/ops/vocab`, the modules of
   * `packages/ops/src/prims`. Added to the static set (`CORE_VOCAB_NAMES`).
   */
  readonly coreVocabs?: readonly string[];
  /** The other packs in the build (this one is not listed): vocabulary and kind ownership, `requires`. */
  readonly packs?: readonly KnownPack[];
  /** Whether a file of the pack exists, by manifest-relative path (checks `entry-missing`). */
  readonly fileExists?: (path: string) => boolean;
  /** The size in bytes of a file of the pack (an empty NOTICE is a `licence-list` problem). */
  readonly fileSize?: (path: string) => number;
}
