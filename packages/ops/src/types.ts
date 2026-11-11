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
 * @forge/ops type contracts, Phase 2. See docs/RECIPES.md (the spec) section 2 for the meaning of
 * everything here.
 *
 * This file declares TYPES ONLY, plus a few constants. It contains no implementation logic.
 *
 * Module map (file in packages/ops -> work package that implements it), see RECIPES.md section 11:
 *   src/scan.ts                WP 2.1  scan vocab files, check them, dependency-sort the units
 *   src/bundle.ts              WP 2.1  createBundleLoader(provider), assembleRuntime()
 *   src/sources-node.ts        WP 2.1  VocabSourceProvider over the file system  (entry: @forge/ops/node)
 *   src/sources-vite.ts        WP 2.1  VocabSourceProvider over import.meta.glob (entry: @forge/ops/vite)
 *   src/catalogue.ts           WP 2.1  buildCatalogue(runtime)
 *   scripts/catalogue.ts       WP 2.1  build script: writes dist/catalogue.json
 *   src/prims/<vocab>.ts       WP 2.1  TypeScript primitives of one vocabulary
 *   src/regex-engine.ts        WP 2.1  the regex seam used by the regex and recipe primitives
 */
import type {
  EffectLabel,
  ForgeRuntime,
  Limits,
  ParamSpec,
  ParamType,
  PrimitiveDef,
  WordMeta,
} from "@forge/lang";

// ---------------------------------------------------------------------------------------------
// Constants (RECIPES.md section 2.2)
// ---------------------------------------------------------------------------------------------

/** Version of the catalogue JSON format (`Catalogue.format`). */
export const CATALOGUE_FORMAT = 1 as const;

/**
 * Internal vocabularies: `recipe` (the words compiled recipes call), `bake` (where the baker loads the
 * compiled recipe word), `util` (shared FL helpers for the op vocabularies) and `blockmode` (the shared
 * block cipher modes and PKCS#7 padding, driven by a block function quotation), `random` (the shared host CSPRNG words) and `list` (the shared sort and shuffle words), `json` (the shared JSON reader and writer;
 * `clock` is not internal because its one word with no input is never an op). Their words are never
 * listed in the catalogue, whatever their metadata says, and a user unit cannot define into them.
 */
export const INTERNAL_VOCABS: readonly string[] = Object.freeze([
  "recipe",
  "bake",
  "util",
  "blockmode",
  "random",
  "list",
  "json",
]);

/**
 * Parameter types a UI form can edit and a recipe can carry as JSON. An exported word is a catalogue
 * op only if every one of its parameters has one of these types.
 */
export const UI_PARAM_TYPES: readonly ParamType[] = Object.freeze([
  "bytes",
  "str",
  "int",
  "num",
  "number",
  "bool",
  "choice",
  "toggle",
  "regex",
  "charset",
  "key",
]);

// ---------------------------------------------------------------------------------------------
// The catalogue (RECIPES.md section 2.3)
// ---------------------------------------------------------------------------------------------

/** One operation, a projection of its `WordMeta`. Key order here is the canonical serialisation order. */
export interface CatalogueOp {
  /** `vocab:name`, canonical (never an alias). */
  readonly qname: string;
  readonly name: string;
  readonly vocab: string;
  readonly category: string | null;
  readonly doc: string | null;
  readonly aliases: readonly string[];
  readonly seeAlso: readonly string[];
  /** Type of the data input (`effect.inputs[0]`). */
  readonly input: ParamType;
  /** Type of the single output (`effect.outputs[0]`). */
  readonly output: ParamType;
  /** `effect.text`, the canonical stack-effect text. */
  readonly effect: string;
  /** `WordMeta.params` unchanged. */
  readonly params: readonly ParamSpec[];
  readonly effects: readonly EffectLabel[];
  readonly version: string;
  /** `WordMeta.hash`. */
  readonly hash: string;
  /**
   * True when the op, or any word it calls (transitively, through `CompiledWord.deps`), is a regex-engine
   * primitive (RECIPES.md section 4.1). Computed from the loaded runtime, never written by hand.
   */
  readonly needsHardKill: boolean;
}

/** The catalogue document (`dist/catalogue.json`). */
export interface Catalogue {
  readonly format: typeof CATALOGUE_FORMAT;
  /** First 16 hex digits of SHA-256 over the canonical JSON text of `ops`. A content id, never bumped by hand. */
  readonly version: string;
  /** Vocabularies that contribute at least one op to `ops`, sorted by code point. */
  readonly vocabs: readonly string[];
  /** Sorted by `qname` in code-point order. */
  readonly ops: readonly CatalogueOp[];
}

export interface BuildCatalogueOptions {
  /**
   * Vocabularies of the bundle. A word of one of these that is an op but lacks `doc` or `category` makes
   * `buildCatalogue` throw. For any other vocabulary (user units) such a word is skipped and `warn` is called.
   * Default: every vocabulary is a bundle vocabulary.
   */
  readonly bundleVocabs?: readonly string[];
  readonly warn?: (message: string) => void;
}

/** `buildCatalogue(runtime, options?)`: derive the catalogue from the loaded runtime. Skips `core` and `INTERNAL_VOCABS`. */
export type BuildCatalogueFn = (
  runtime: ForgeRuntime,
  options?: BuildCatalogueOptions,
) => Catalogue;

/** `isCatalogueOp(meta)`: rules 1 to 6 of RECIPES.md section 2.2 (not the internal-vocabulary rule's warning behaviour). */
export type IsCatalogueOpFn = (meta: WordMeta) => boolean;

// ---------------------------------------------------------------------------------------------
// Vocabulary sources (RECIPES.md section 2.4)
// ---------------------------------------------------------------------------------------------

/** One `.fth` source unit of a vocabulary. */
export interface VocabUnit {
  /** The vocabulary the unit defines into: its file name without `.fth`. */
  readonly vocab: string;
  /** `LoadOptions.unit`, e.g. `base64.fth`. */
  readonly name: string;
  readonly source: string;
  /** Other vocabularies the unit needs at compile time (`USING:` plus qualified references), sorted, never `core` and never itself. */
  readonly deps: readonly string[];
}

/** What a `src/prims/<vocab>.ts` module exports. Every def has `vocab` equal to the file name. */
export interface PrimitiveModule {
  readonly primitives: readonly PrimitiveDef[];
}

/** Everything needed to assemble a runtime for a set of vocabularies. */
export interface VocabBundle {
  /** Vocabulary names in the bundle, sorted by code point. */
  readonly vocabs: readonly string[];
  /** The `.fth` units in dependency order: a unit comes after every unit it depends on. */
  readonly units: readonly VocabUnit[];
  /** The primitives of all vocabularies in the bundle. */
  readonly primitives: readonly PrimitiveDef[];
}

/** `loadBundle(names)`: the named vocabularies plus everything they depend on; `"all"` (the default) is every vocabulary. Lazy-loads primitive modules. */
export type LoadBundleFn = (names?: readonly string[] | "all") => Promise<VocabBundle>;

/** Optional extras for `assembleRuntime`. User units that define into a bundle or internal vocabulary fail with `E_READONLY`. */
export interface AssembleOptions {
  readonly limits?: Partial<Limits>;
  /** Extra untrusted units loaded after the bundle (user vocabularies). */
  readonly units?: readonly { readonly name: string; readonly source: string }[];
}

/** `assembleRuntime(bundle)`: `createRuntime`, then `load` each unit in order. Throws the `ForgeError` of the first failure. */
export type AssembleRuntimeFn = (bundle: VocabBundle, options?: AssembleOptions) => ForgeRuntime;

/** A source file found by a provider. */
export interface SourceFile {
  /** File name with extension, e.g. `base64.fth`. */
  readonly name: string;
  readonly text: string;
}

/**
 * Where the vocabulary sources come from. `sources-node.ts` reads `vocab/` and `src/prims/` (or `dist/prims/`) from
 * the file system; `sources-vite.ts` uses `import.meta.glob`. Both find files by pattern, so adding a file needs no
 * registry edit.
 */
export interface VocabSourceProvider {
  /** Every `vocab/*.fth` file. */
  fthFiles(): Promise<readonly SourceFile[]>;
  /** Vocabulary name to a loader of its primitive module; one entry per `prims/<vocab>.ts` file. */
  primitiveLoaders(): Readonly<Record<string, () => Promise<PrimitiveModule>>>;
}

export interface ScanResult {
  /** All `.fth` units in dependency order. */
  readonly units: readonly VocabUnit[];
  /** Every vocabulary found (units and primitive modules), sorted by code point. */
  readonly vocabs: readonly string[];
}

/** `scanVocab(files, primitiveVocabs)`: check the units and sort them. Throws an `Error` naming the file on any violation. */
export type ScanVocabFn = (
  files: readonly SourceFile[],
  primitiveVocabs: readonly string[],
) => ScanResult;

/** `createNodeProvider(root?)` and `createViteProvider()`: see RECIPES.md section 2.4. */
export type CreateNodeProviderFn = (root?: string) => VocabSourceProvider;
export type CreateViteProviderFn = () => VocabSourceProvider;

/** A regex-engine match (UTF-16 indices); see RECIPES.md section 4.1. */
export interface RegexMatch {
  readonly index: number;
  readonly end: number;
  readonly text: string;
  readonly groups: readonly (string | undefined)[];
}

/** Limits of the regex primitives. */
export interface RegexLimits {
  readonly maxInputChars: number;
  readonly maxMatches: number;
}

/** `execAll(pattern, flags, text)`: all non-overlapping matches, enforcing `RegexLimits`. */
export type RegexExecAllFn = (pattern: string, flags: string, text: string) => RegexMatch[];

/** `markRegexPrimitive(def)`: returns `def` and records its qualified name for `isRegexPrimitive`. */
export type MarkRegexPrimitiveFn = (def: PrimitiveDef) => PrimitiveDef;
export type IsRegexPrimitiveFn = (qname: string) => boolean;

/** `createBundleLoader(provider)`: the `LoadBundleFn` over a provider. Scans and checks on the first call and caches. */
export type CreateBundleLoaderFn = (provider: VocabSourceProvider) => LoadBundleFn;
