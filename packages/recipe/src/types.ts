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
 * Recipe type contracts, Phase 2. See docs/RECIPES.md (the spec) for the meaning of everything here.
 *
 * This file declares TYPES ONLY, plus constants. It contains no implementation logic. Each future
 * module imports its contracts from here.
 *
 * Module map (file in packages/recipe/src -> RECIPES.md section -> work package):
 *   limits.ts, pointer.ts        3.8, 3.7  limits and JSON pointer helpers          WP 2.2
 *   encoding.ts                  3.4       {value, enc} <-> bytes, normal forms     WP 2.2
 *   normalise.ts                 3.6       normalise, resolve, canonical            WP 2.2
 *   validate.ts                  3.7       validateRecipe (structure + catalogue)   WP 2.2
 *   literals.ts                  5.2       FL literal rendering of every param type WP 2.2
 *   compile.ts, stepmap.ts       5         compileRecipe, resolveStepIps            WP 2.2
 *   text.ts                      6         parseRecipeText                          WP 2.3
 *   share.ts                     7         encodeShare, decodeShare                 WP 2.3
 *   recipe.schema.json           3.9       the JSON Schema                          WP 2.2
 */
import type { Breakpoint, EncodingName, ParamSpec, ParamType, SourcePos } from "@forge/lang";

// ---------------------------------------------------------------------------------------------
// Constants (RECIPES.md sections 3.1, 3.8, 5.1, 7.1)
// ---------------------------------------------------------------------------------------------

/** Value of `Recipe.forge`. */
export const RECIPE_FORMAT_VERSION = 1 as const;

/** Value of the `v` key of a share fragment. */
export const SHARE_FORMAT_VERSION = 1 as const;

export const STEP_KINDS = ["op", "fork", "subsection", "if", "repeat", "comment"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

/** Limits applied by `validateRecipe` to every recipe, whatever its source. */
export const RECIPE_LIMITS = Object.freeze({
  /** Steps in the whole tree, children included. */
  maxSteps: 500,
  /** Nesting depth of container steps; the root `steps` list is depth 1. */
  maxDepth: 8,
  /** UTF-8 size of the recipe's JSON text. */
  maxJsonBytes: 262_144,
  /** Raw JSON nesting depth accepted before any recursive check runs. */
  maxJsonDepth: 64,
  maxParamsPerStep: 32,
  maxNameChars: 120,
  maxDescriptionChars: 2000,
  maxNoteChars: 500,
  maxCommentChars: 2000,
  /** Hard cap of `repeat.times` and `repeat.max`. */
  maxRepeat: 1000,
  /** `repeat.max` when `until: "stable"` omits it. */
  defaultRepeatCap: 100,
  /** Regex source length, equal to `DEFAULT_LIMITS.maxRegexLength`. */
  maxRegexChars: 1024,
});

/** Limits applied by the share codec to untrusted fragments. */
export const SHARE_LIMITS = Object.freeze({
  /** Length of the fragment text, without the leading `#`. */
  maxFragmentChars: 65_536,
  /** Size of the inflated recipe JSON. */
  maxRecipeBytes: RECIPE_LIMITS.maxJsonBytes,
  /** Size of the inflated input. */
  maxInputBytes: 1_048_576,
  /** Number of `key=value` pairs. */
  maxPairs: 8,
});

/** The vocabulary that holds the words compiled recipes call (FL: `recipe:section` and so on). */
export const RECIPE_VOCAB = "recipe";

/** Default name of the word a recipe compiles to. */
export const DEFAULT_RECIPE_WORD = "main";

/** The internal vocabulary the baker loads the compiled word into, so user words can never collide with it. */
export const DEFAULT_RECIPE_VOCAB = "bake";

// ---------------------------------------------------------------------------------------------
// Recipe JSON v1 (RECIPES.md section 3)
// ---------------------------------------------------------------------------------------------

/** A value with an explicit text encoding. */
export interface Encoded {
  readonly value: string;
  readonly enc: EncodingName;
}

/** The JSON value of a parameter (RECIPES.md section 3.4). */
export type ParamValue = number | string | boolean | Encoded;

export type ParamValues = Readonly<Record<string, ParamValue>>;

/** Fields every step except `comment` may carry. */
export interface StepCommon {
  readonly disabled?: boolean;
  readonly breakpoint?: boolean;
  readonly note?: string;
}

export interface OpStep extends StepCommon {
  readonly kind: "op";
  /** Canonical qualified name, `vocab:word`. */
  readonly op: string;
  readonly params?: ParamValues;
  /** The op's `hash` when the recipe was pinned. */
  readonly hash?: string;
}

export interface ForkStep extends StepCommon {
  readonly kind: "fork";
  readonly split: Encoded;
  readonly join: Encoded;
  readonly steps: readonly Step[];
}

/** How a regex sees the bytes of the data. */
export type SectionEncoding = "utf8" | "latin1";

export interface SubsectionStep extends StepCommon {
  readonly kind: "subsection";
  readonly pattern: string;
  /** Any of `i`, `m`, `s`; default none. */
  readonly flags?: string;
  readonly encoding?: SectionEncoding;
  readonly steps: readonly Step[];
}

export interface RegexTest {
  readonly kind: "regex";
  readonly pattern: string;
  readonly flags?: string;
  readonly encoding?: SectionEncoding;
}

/** A predicate op: an op whose single output is `bool`. */
export interface OpTest {
  readonly kind: "op";
  readonly op: string;
  readonly params?: ParamValues;
  readonly hash?: string;
}

export type IfTest = RegexTest | OpTest;

export interface IfStep extends StepCommon {
  readonly kind: "if";
  readonly test: IfTest;
  readonly then: readonly Step[];
  readonly else?: readonly Step[];
}

/** Exactly one of `times` or `until` is present; `max` goes with `until`. */
export interface RepeatStep extends StepCommon {
  readonly kind: "repeat";
  readonly times?: number;
  readonly until?: "stable";
  readonly max?: number;
  readonly steps: readonly Step[];
}

export interface CommentStep {
  readonly kind: "comment";
  readonly text: string;
}

export type Step = OpStep | ForkStep | SubsectionStep | IfStep | RepeatStep | CommentStep;

export interface Recipe {
  readonly forge: typeof RECIPE_FORMAT_VERSION;
  readonly name?: string;
  readonly description?: string;
  /** `Catalogue.version` of the catalogue the recipe was created with. */
  readonly catalogue?: string;
  readonly steps: readonly Step[];
}

// ---------------------------------------------------------------------------------------------
// The catalogue as the recipe package sees it (RECIPES.md section 2.3)
// ---------------------------------------------------------------------------------------------

/**
 * The fields of a catalogue op that this package reads. `@forge/ops`' `CatalogueOp` is assignable to
 * it; the package does not depend on `@forge/ops`.
 */
export interface CatalogueOpView {
  readonly qname: string;
  readonly aliases: readonly string[];
  /** Type of the data input. */
  readonly input: ParamType;
  /** Type of the single output. */
  readonly output: ParamType;
  readonly params: readonly ParamSpec[];
  readonly hash: string;
  /** See `CatalogueOp.needsHardKill` in `@forge/ops`. */
  readonly needsHardKill: boolean;
}

export interface CatalogueView {
  readonly version: string;
  readonly ops: readonly CatalogueOpView[];
}

// ---------------------------------------------------------------------------------------------
// Issues (RECIPES.md section 3.7)
// ---------------------------------------------------------------------------------------------

export const RECIPE_ISSUE_CODES = [
  // structure (these mirror recipe.schema.json)
  "type",
  "required",
  "unknown-field",
  "bad-version",
  "bad-kind",
  "bad-value",
  "exclusive",
  "limit",
  // catalogue and parameters
  "unknown-op",
  "not-predicate",
  "unknown-param",
  "missing-param",
  "bad-param",
  "bad-encoding",
  "bad-regex",
  // warnings (errors under the strict pin policy)
  "hash-mismatch",
  "alias-used",
  "catalogue-mismatch",
  // warning from the share codec
  "secret-in-url",
] as const;

export type RecipeIssueCode = (typeof RECIPE_ISSUE_CODES)[number];

export type IssueSeverity = "error" | "warning";

export interface RecipeIssue {
  readonly code: RecipeIssueCode;
  readonly severity: IssueSeverity;
  /** RFC 6901 JSON pointer into the recipe; `""` is the root. Points at where the offending value is or would be. */
  readonly path: string;
  readonly message: string;
  /** Code-specific fields (RECIPES.md section 3.7), JSON-safe. */
  readonly detail?: Readonly<Record<string, unknown>>;
}

/** How a mismatch between a step's `hash` pin and the catalogue is treated. */
export type PinPolicy = "ignore" | "warn" | "strict";

export interface ValidateOptions {
  /** Default `"warn"`. */
  readonly pins?: PinPolicy;
}

export type ValidationResult =
  | { readonly ok: true; readonly recipe: Recipe; readonly issues: readonly RecipeIssue[] }
  | { readonly ok: false; readonly issues: readonly RecipeIssue[] };

// ---------------------------------------------------------------------------------------------
// Compilation (RECIPES.md section 5)
// ---------------------------------------------------------------------------------------------

export interface CompileOptions {
  /** Name of the compiled word, an unreserved word name. Default `DEFAULT_RECIPE_WORD`. */
  readonly word?: string;
  /** Vocabulary the word will be loaded into; only used to build `CompileOutcome.word`. Default `DEFAULT_RECIPE_VOCAB`. */
  readonly vocab?: string;
  /** Default `"warn"`. */
  readonly pins?: PinPolicy;
}

/** The text lines (1-based) a step occupies in the compiled text. */
export interface StepLine {
  /** JSON pointer of the step in the recipe. */
  readonly path: string;
  readonly kind: StepKind;
  /** The first line of the step. */
  readonly startLine: number;
  /** The last line of the step (equal to `startLine` for a one-line step). */
  readonly endLine: number;
  /** True for a step that is disabled or inside a disabled step: it compiles to comment lines. */
  readonly disabled: boolean;
  /** The step's `breakpoint` flag. */
  readonly breakpoint: boolean;
}

export type CompileOutcome =
  | {
      readonly ok: true;
      /** The canonical FL text (RECIPES.md section 6). */
      readonly text: string;
      /** Qualified name of the compiled word, `<vocab>:<word>` (default `bake:main`). */
      readonly word: string;
      /** Every step in document order (parents before children). */
      readonly lines: readonly StepLine[];
      /** Warnings only. */
      readonly issues: readonly RecipeIssue[];
    }
  | { readonly ok: false; readonly issues: readonly RecipeIssue[] };

/** The instruction range of one enabled step in the loaded word. */
export interface StepIp {
  readonly path: string;
  readonly kind: StepKind;
  /** Index of the first instruction of the step. */
  readonly startIp: number;
  /** Index of the first instruction after the step. */
  readonly endIp: number;
  readonly breakpoint: boolean;
}

/** What happens just before the instruction at `ip` runs. */
export interface IpEvent {
  readonly ip: number;
  /** Paths of the steps that end here, innermost first. */
  readonly ends: readonly string[];
  /** Paths of the steps that start here, outermost first. */
  readonly starts: readonly string[];
}

export interface StepIpMap {
  /** Enabled steps only, in document order. */
  readonly steps: readonly StepIp[];
  /** Sorted by `ip`, one entry per ip that has an end or a start. */
  readonly events: readonly IpEvent[];
  /** `{ word, ip: startIp }` for every enabled step whose `breakpoint` is true. */
  readonly breakpoints: readonly Breakpoint[];
}

/** Pure function: map text lines to instruction indices using `CompiledWord.positions` of the loaded word. */
export type ResolveStepIpsFn = (
  word: string,
  lines: readonly StepLine[],
  positions: readonly SourcePos[],
) => StepIpMap;

/**
 * True iff an enabled step needs a hard-kill baker (RECIPES.md section 4.1): a `subsection`, an `if` with a regex
 * test, or an op (or op test) whose catalogue entry has `needsHardKill`.
 */
export type RecipeNeedsHardKillFn = (recipe: Recipe, catalogue: CatalogueView) => boolean;

/** Find the path of the step that raised an error from the error's `frames` (RECIPES.md section 5.7). Returns null when unknown. */
export type AttributeErrorFn = (
  word: string,
  frames: readonly { readonly word: string; readonly ip: number }[],
  map: StepIpMap,
) => string | null;

// ---------------------------------------------------------------------------------------------
// Functions of the package (RECIPES.md sections 3 and 5)
// ---------------------------------------------------------------------------------------------

/** Structural validation, plus catalogue checks when a catalogue is given. Never throws. */
export type ValidateRecipeFn = (
  input: unknown,
  catalogue?: CatalogueView,
  options?: ValidateOptions,
) => ValidationResult;

/** Catalogue-free normal form (RECIPES.md section 3.6). Input must be valid. */
export type NormaliseRecipeFn = (recipe: Recipe) => Recipe;

/** Resolve aliases, materialise defaults, normalise parameter values (section 3.6). Input must be valid. */
export type ResolveRecipeFn = (recipe: Recipe, catalogue: CatalogueView) => Recipe;

/** `normalise(resolve(recipe))`, the form the text parser returns and the identity is stated on. */
export type CanonicalRecipeFn = (recipe: Recipe, catalogue: CatalogueView) => Recipe;

/** Fill `hash` on every op step from the catalogue. Input must be valid. */
export type PinRecipeFn = (recipe: Recipe, catalogue: CatalogueView) => Recipe;

/** Validate, then compile to canonical FL text. Never throws. */
export type CompileRecipeFn = (
  recipe: unknown,
  catalogue: CatalogueView,
  options?: CompileOptions,
) => CompileOutcome;

/** Parse canonical FL text back to canonical recipe JSON. Never throws; the text is never executed. */
export type ParseRecipeTextFn = (text: string, catalogue: CatalogueView) => ValidationResult;

/** `pointer.ts`: RFC 6901 escaping of one reference token. */
export type EscapePointerFn = (token: string) => string;
export type UnescapePointerFn = (token: string) => string;

/** `encoding.ts`: decode an `Encoded` to bytes (the value must already be valid), and the reverse for hex/base64/utf8/latin1. */
export type DecodeEncodedFn = (encoded: Encoded) => Uint8Array;
export type EncodeBytesFn = (bytes: Uint8Array, enc: EncodingName) => string;

// ---------------------------------------------------------------------------------------------
// Share URL (RECIPES.md section 7)
// ---------------------------------------------------------------------------------------------

export interface ShareState {
  readonly recipe: Recipe;
  /** The input bytes, if the link should carry them. */
  readonly input?: Uint8Array;
  /** How the UI shows the input (a presentation hint). Default `"utf8"`. */
  readonly inputEncoding?: EncodingName;
}

export const SHARE_ERROR_CODES = [
  "fragment-too-long",
  "malformed",
  "unsupported-version",
  "bad-base64",
  "bad-compression",
  "too-large",
  "bad-json",
  "invalid-recipe",
  "input-too-large",
] as const;

export type ShareErrorCode = (typeof SHARE_ERROR_CODES)[number];

export interface ShareError {
  readonly code: ShareErrorCode;
  readonly message: string;
  /** Present for `invalid-recipe`. */
  readonly issues?: readonly RecipeIssue[];
}

export interface EncodeShareOptions {
  /** When given, op steps without a pin get one. */
  readonly catalogue?: CatalogueView;
}

export type EncodeShareResult =
  | {
      readonly ok: true;
      /** The fragment without the leading `#`. */
      readonly fragment: string;
      readonly warnings: readonly RecipeIssue[];
    }
  | { readonly ok: false; readonly error: ShareError };

export interface DecodeShareOptions {
  /** When given, the decoded recipe is also checked against it (pins per `pins`). */
  readonly catalogue?: CatalogueView;
  readonly pins?: PinPolicy;
}

export type DecodeShareResult =
  | {
      readonly ok: true;
      readonly recipe: Recipe;
      readonly input?: Uint8Array;
      readonly inputEncoding: EncodingName;
      readonly warnings: readonly RecipeIssue[];
    }
  | { readonly ok: false; readonly error: ShareError };

/** Accepts the fragment with or without the leading `#`. Never throws. */
export type EncodeShareFn = (
  state: ShareState,
  options?: EncodeShareOptions,
) => Promise<EncodeShareResult>;
export type DecodeShareFn = (
  fragment: string,
  options?: DecodeShareOptions,
) => Promise<DecodeShareResult>;
