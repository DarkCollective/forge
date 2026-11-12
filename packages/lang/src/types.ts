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
 * FL type contracts, v0.1. See docs/LANGUAGE.md (the spec) for the meaning of everything here.
 *
 * This file declares TYPES ONLY, plus the single runtime constant DEFAULT_LIMITS. It contains no
 * implementation logic. Each future module imports its contracts from here.
 *
 * Module map (file in packages/lang/src -> work package that implements it):
 *   reader.ts                    WP 1.2  tokenizer (ReadFn), source positions
 *   values.ts, errors.ts         WP 1.3  value helpers, coercion table, ForgeError
 *   dictionary.ts                WP 1.4  Dictionary, vocabularies, name resolution
 *   compiler.ts                  WP 1.5  tokens -> CompiledWord (Instruction[]), CompileFn
 *   vm.ts                        WP 1.6  run loop, limits, hooks, trace
 *   primitives.ts                WP 1.7  PrimitiveRegistry / definePrimitive
 *   vocab/core.ts                WP 1.7  the `core` vocabulary (LANGUAGE.md section 13)
 *   meta.ts, meta.schema.json    WP 1.8  parseHeader (HeaderParseFn), WordMeta desugaring, JSON Schema
 *   sha256.ts                    WP 1.8  synchronous SHA-256 (Sha256Fn), used for WordMeta.hash
 *   runtime.ts                   facade  createRuntime (CreateRuntimeFn) implementing ForgeRuntime
 */

// ---------------------------------------------------------------------------------------------
// Source positions and tokens (spec section 2)
// ---------------------------------------------------------------------------------------------

/** A position in source text. `offset` is a 0-based UTF-16 index; `line` and `col` are 1-based. */
export interface SourcePos {
  readonly offset: number;
  readonly line: number;
  readonly col: number;
}

export type TokenKind =
  | "int"
  | "float"
  | "str"
  | "char"
  | "bytes"
  | "bool"
  | "word"
  | "qword"
  | "lbracket"
  | "rbracket"
  | "lbrace"
  | "rbrace"
  | "header"
  | "eof";

interface TokenBase {
  /** Exact source slice of the token. */
  readonly text: string;
  /** Start of the token. */
  readonly pos: SourcePos;
  /** Position just after the token (exclusive). */
  readonly end: SourcePos;
}

export type Token =
  | (TokenBase & { readonly kind: "int"; readonly value: number | bigint })
  | (TokenBase & { readonly kind: "float"; readonly value: number })
  | (TokenBase & { readonly kind: "str"; readonly value: string })
  /** A char literal; `value` is the code point. The compiler treats it as an `int`. */
  | (TokenBase & { readonly kind: "char"; readonly value: number })
  | (TokenBase & { readonly kind: "bytes"; readonly value: Uint8Array })
  | (TokenBase & { readonly kind: "bool"; readonly value: boolean })
  /** Unqualified word, including the keywords `:` `;` `IN:` `USING:` `META:` and reserved words. */
  | (TokenBase & { readonly kind: "word" })
  | (TokenBase & { readonly kind: "qword"; readonly vocab: string; readonly name: string })
  | (TokenBase & { readonly kind: "lbracket" })
  | (TokenBase & { readonly kind: "rbracket" })
  | (TokenBase & { readonly kind: "lbrace" })
  | (TokenBase & { readonly kind: "rbrace" })
  /** Stack-effect header; `headerText` is the raw text between the parentheses. */
  | (TokenBase & {
      readonly kind: "header";
      readonly headerText: string;
      readonly headerTextPos: SourcePos;
    })
  | (TokenBase & { readonly kind: "eof" });

/** Reader options; omitted fields default to DEFAULT_LIMITS. */
export interface ReadOptions {
  readonly maxSourceChars?: number;
  readonly maxIntBits?: number;
}

/**
 * Reader contract: throws a ForgeError with E_LEX on the first lexical error, E_LIMIT_SOURCE when the
 * source is too long, and E_LIMIT_VALUE for an integer literal over `maxIntBits` bits. The result ends
 * with `eof`.
 */
export type ReadFn = (source: string, opts?: ReadOptions) => Token[];

// ---------------------------------------------------------------------------------------------
// Values (spec sections 3 and 4)
// ---------------------------------------------------------------------------------------------

export type Tag = "bytes" | "str" | "int" | "num" | "bool" | "list" | "quot" | "record" | "file";

/** Payload of a `file` value (reserved in v0.1). */
export interface FileValue {
  readonly name: string;
  readonly type: string;
  readonly bytes: Uint8Array;
}

/**
 * A first-class quotation: code reference plus the locals array of the frame that created it.
 * Quotation bodies live inside `code.code`, starting at index `start`, and end with `ret`.
 */
export interface Quotation {
  readonly code: CompiledWord;
  readonly start: number;
  readonly env: readonly Value[];
}

/**
 * A tagged value. `int` payloads are in normal form: a JS `number` iff the value is a safe
 * integer, otherwise a `bigint`.
 */
export type Value =
  /** `secret` marks values bound to a `key` slot; diagnostics render them as `<redacted>` (spec 10.14). */
  | { readonly tag: "bytes"; readonly v: Uint8Array; readonly secret?: true }
  | { readonly tag: "str"; readonly v: string }
  | { readonly tag: "int"; readonly v: number | bigint }
  | { readonly tag: "num"; readonly v: number }
  | { readonly tag: "bool"; readonly v: boolean }
  | { readonly tag: "list"; readonly v: readonly Value[] }
  | { readonly tag: "quot"; readonly v: Quotation }
  | { readonly tag: "record"; readonly v: ReadonlyMap<string, Value> }
  | { readonly tag: "file"; readonly v: FileValue };

// ---------------------------------------------------------------------------------------------
// Errors (spec section 11)
// ---------------------------------------------------------------------------------------------

export type ErrorCode =
  // read / compile
  | "E_LEX"
  | "E_SYNTAX"
  | "E_TOPLEVEL"
  | "E_NAME"
  | "E_HEADER"
  | "E_META"
  | "E_UNDEFINED"
  | "E_AMBIGUOUS"
  | "E_PRIVATE"
  | "E_NO_VOCAB"
  | "E_REDEFINED"
  | "E_READONLY"
  | "E_UNTRUSTED"
  | "E_NO_PRIMITIVE"
  // run
  | "E_STACK_UNDERFLOW"
  | "E_TYPE"
  | "E_COERCE"
  | "E_PARAM_INVALID"
  | "E_EFFECT"
  | "E_DIV_ZERO"
  | "E_RANGE"
  | "E_USER"
  | "E_PRIMITIVE"
  | "E_FORBIDDEN"
  // limits
  | "E_LIMIT_STEPS"
  | "E_LIMIT_STACK"
  | "E_LIMIT_RETURN"
  | "E_LIMIT_VALUE"
  | "E_LIMIT_TOTAL"
  | "E_LIMIT_TIME"
  | "E_LIMIT_OUTPUT"
  | "E_LIMIT_SOURCE"
  // control
  | "E_ABORTED"
  | "E_INTERNAL";

/** One entry of ForgeError.frames: an active word frame. */
export interface ErrorFrame {
  readonly word: string;
  readonly ip: number;
}

/** Constructor argument of ForgeError (implemented in errors.ts). Omitted fields default as noted. */
export interface ForgeErrorInit {
  readonly code: ErrorCode;
  readonly message: string;
  /** Qualified name of the innermost word, default null. */
  readonly word?: string | null;
  /** Default null. */
  readonly vocab?: string | null;
  /** Step counter when raised, default null (compile and read errors). */
  readonly step?: number | null;
  /** Instruction index in `word`, default null. */
  readonly ip?: number | null;
  /** Source position, default null. */
  readonly pos?: SourcePos | null;
  /** Top (at most 16) data-stack values, bottom to top, default []. */
  readonly stackSnapshot?: readonly Value[];
  /** Return-stack word frames, innermost first, default []; at most 64 are kept. */
  readonly frames?: readonly ErrorFrame[];
  /** Frames dropped between the kept innermost and outermost runs. Default 0. */
  readonly framesSkipped?: number;
  /** Code-specific fields (spec section 11.1), default {}. */
  readonly detail?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

/** The shape every ForgeError instance has. The class itself lives in errors.ts. */
export interface ForgeErrorShape extends Error {
  readonly name: "ForgeError";
  readonly code: ErrorCode;
  readonly word: string | null;
  readonly vocab: string | null;
  readonly step: number | null;
  readonly ip: number | null;
  readonly pos: SourcePos | null;
  readonly stackSnapshot: readonly Value[];
  readonly frames: readonly ErrorFrame[];
  readonly framesSkipped: number;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
  /** JSON form: all fields, with values replaced by their `.s` reprs. */
  toJSON(): Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------------
// Parameter types, stack effects, metadata (spec sections 5.4 to 5.6 and 12)
// ---------------------------------------------------------------------------------------------

export type ParamType =
  | "any"
  | "bytes"
  | "str"
  | "int"
  | "num"
  | "number"
  | "bool"
  | "list"
  | "quot"
  | "record"
  | "file"
  | "choice"
  | "toggle"
  | "regex"
  | "charset"
  | "key";

export type EncodingName = "hex" | "utf8" | "latin1" | "base64";

/** Declared constraints (spec section 5.5). Numeric value constraints and length constraints are separate. */
export interface Constraint {
  readonly min?: number;
  readonly max?: number;
  readonly oneOf?: readonly number[];
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly lengthOneOf?: readonly number[];
  /** JS regex source, `u` flag, matched against the whole string. */
  readonly pattern?: string;
}

/** For `toggle` and `key` parameters the default is `{value, enc}` with `enc` the first-listed encoding. */
export type ParamDefault =
  number | string | boolean | { readonly value: string; readonly enc: string };

/** One input or output of a stack effect. */
export interface StackSlot {
  /** Name (a header `name:` or a bare label), or null for an anonymous slot. */
  readonly name: string | null;
  readonly type: ParamType;
  /** `choice` options, or the listed encodings of `toggle` / `key`. */
  readonly options?: readonly string[];
  readonly constraint?: Constraint;
  readonly default?: ParamDefault;
  /** Help text from `META: … param`. */
  readonly doc?: string;
}

/** An input slot at index >= 1: a parameter. */
export interface ParamSpec extends StackSlot {
  readonly name: string;
  /** Index into `StackEffect.inputs` (>= 1). */
  readonly index: number;
  /** True when there is no default. */
  readonly required: boolean;
}

export interface StackEffect {
  /** Deepest first; inputs[0] is the data input. */
  readonly inputs: readonly StackSlot[];
  readonly outputs: readonly StackSlot[];
  /** True for `-- ..`: the output depth is not checked. */
  readonly unchecked: boolean;
  /** True for a leading `..` input (lenient headers only): any number of values below the fixed inputs. */
  readonly variadicInput: boolean;
  /** Canonical text (spec section 12.3). */
  readonly text: string;
}

export type EffectLabel = "+async" | "+random" | "+time";

export type WordKind = "fl" | "primitive" | "intrinsic" | "constant" | "variable";

export interface SourceInfo {
  /** Name of the source unit (`LoadOptions.unit`), or null. */
  readonly unit: string | null;
  /** Verbatim source text of the definition, or null (primitives, intrinsics). */
  readonly text: string | null;
  readonly pos: SourcePos | null;
}

/** The JSON-serialisable metadata record of a word (spec section 12). */
/** A `link` clause: an https URL and an optional label (LANGUAGE-0.2.md section 1). */
export interface MetaLink {
  readonly url: string;
  readonly label: string | null;
}

/**
 * Discovery metadata (`use-when`, `link`, `inverse`). Absent from `WordMeta` when nothing is set;
 * each member is omitted when unset.
 */
export interface WordDiscovery {
  /** `use-when`. */
  readonly useWhen?: string;
  /** `link` clauses, in order. Omitted when empty. */
  readonly links?: readonly MetaLink[];
  /** `inverse`: a qualified name in the same vocabulary. */
  readonly inverse?: string;
}

export interface WordMeta {
  readonly name: string;
  readonly vocab: string;
  readonly qname: string;
  readonly kind: WordKind;
  readonly exported: boolean;
  readonly op: boolean;
  readonly effect: StackEffect;
  readonly params: readonly ParamSpec[];
  readonly category: string | null;
  readonly doc: string | null;
  readonly aliases: readonly string[];
  readonly seeAlso: readonly string[];
  readonly effects: readonly EffectLabel[];
  readonly version: string;
  readonly hash: string;
  readonly source: SourceInfo;
  /** Discovery metadata; omitted (not `{}`) when empty. */
  readonly discovery?: WordDiscovery;
}

/** Header parser (WP 1.8). Throws E_HEADER. `strict` is used for public colon words, `lenient` otherwise. */
export type HeaderParseFn = (
  text: string,
  pos: SourcePos,
  mode: "strict" | "lenient",
) => StackEffect;

// ---------------------------------------------------------------------------------------------
// Instructions and compiled words (spec section 10)
// ---------------------------------------------------------------------------------------------

export type StackWord =
  | "dup"
  | "drop"
  | "swap"
  | "over"
  | "rot"
  | "-rot"
  | "nip"
  | "tuck"
  | "dup2"
  | "drop2"
  | "depth"
  | "clear";

export type CombinatorName =
  | "if"
  | "when"
  | "unless"
  | "times"
  | "each"
  | "map"
  | "mapi"
  | "filter"
  | "reduce"
  | "while"
  | "loop"
  | "try"
  | "fork";

/** Names of intrinsic words (words the compiler lowers to dedicated instructions). */
export type IntrinsicName = StackWord | CombinatorName | "call" | "." | ".s";

export type Instruction =
  | { readonly op: "lit"; readonly value: Value }
  | { readonly op: "local"; readonly slot: number }
  | { readonly op: "stack"; readonly word: StackWord }
  | { readonly op: "call"; readonly entry: FlWordEntry }
  | { readonly op: "prim"; readonly entry: PrimitiveWordEntry }
  | { readonly op: "varGet"; readonly entry: VariableWordEntry }
  | { readonly op: "varSet"; readonly entry: VariableWordEntry }
  | { readonly op: "jump"; readonly target: number }
  | { readonly op: "jumpf"; readonly target: number }
  | { readonly op: "quot"; readonly end: number }
  | { readonly op: "callq" }
  | { readonly op: "comb"; readonly name: CombinatorName }
  | { readonly op: "dmark" }
  | { readonly op: "dcheck"; readonly delta: number }
  | { readonly op: "listOpen" }
  | { readonly op: "listClose" }
  | { readonly op: "print"; readonly form: "value" | "stack" }
  | { readonly op: "ret" };

export type Opcode = Instruction["op"];

/** A compiled word: a flat instruction array with parallel source positions. */
export interface CompiledWord {
  /** Qualified name, or `<console>` for console code. */
  readonly qname: string;
  readonly effect: StackEffect;
  /** Names of the locals, in slot order. */
  readonly localNames: readonly string[];
  /** For each local slot, the index of the input that supplies it. */
  readonly namedInputs: readonly number[];
  /** Indices of the anonymous inputs (they stay on the stack), ascending. */
  readonly anonInputs: readonly number[];
  readonly nlocals: number;
  readonly code: readonly Instruction[];
  /** `positions[i]` is the source position of `code[i]`. */
  readonly positions: readonly SourcePos[];
  readonly effects: readonly EffectLabel[];
  /** Distinct entries the body references, in order of first reference, excluding the word itself. Feeds `hash`. */
  readonly deps: readonly WordEntry[];
}

// ---------------------------------------------------------------------------------------------
// Dictionary (spec section 6)
// ---------------------------------------------------------------------------------------------

interface WordEntryBase {
  readonly qname: string;
  readonly name: string;
  readonly vocab: string;
  /** Mutable so that META: can attach metadata after definition. */
  meta: WordMeta;
}

export interface FlWordEntry extends WordEntryBase {
  readonly kind: "fl";
  /** Null while the word is still being compiled (for `recurse`). */
  code: CompiledWord | null;
}

export interface PrimitiveWordEntry extends WordEntryBase {
  readonly kind: "primitive";
  readonly def: PrimitiveDef;
  /** Parsed (lenient) effect of `def.effect`. */
  readonly effect: StackEffect;
}

export interface IntrinsicWordEntry extends WordEntryBase {
  readonly kind: "intrinsic";
  readonly intrinsic: IntrinsicName;
}

export interface ConstantWordEntry extends WordEntryBase {
  readonly kind: "constant";
  readonly value: Value;
}

/** Getter (`n`) or setter (`n!`) of a VARIABLE. Both share `varId`, which is `qname + "#" + k` with `k` unique per definition. */
export interface VariableWordEntry extends WordEntryBase {
  readonly kind: "variable";
  readonly role: "get" | "set";
  readonly varId: string;
  readonly initial: Value;
}

export type WordEntry =
  FlWordEntry | PrimitiveWordEntry | IntrinsicWordEntry | ConstantWordEntry | VariableWordEntry;

export interface Vocabulary {
  readonly name: string;
  /** Only `core` (and trusted loads) may be read-only. */
  readonly readonly: boolean;
  /** All words, including private ones and aliases (aliases map to the same entry). */
  readonly words: ReadonlyMap<string, WordEntry>;
}

/** Lexical scope of a source unit or console session (spec section 6.1). */
export interface Scope {
  readonly current: string;
  readonly using: readonly string[];
}

/** Read access: name resolution (spec section 6). Each method throws the ForgeError its section names. */
export interface DictionaryView {
  vocab(name: string): Vocabulary | undefined;
  vocabs(): readonly string[];
  /** Unqualified lookup: current vocabulary, then imports (E_AMBIGUOUS), then core. */
  resolve(name: string, scope: Scope): WordEntry;
  /** `vocab:word` lookup. `from` is the current vocabulary, used for privacy. */
  resolveQualified(vocab: string, name: string, from: string): WordEntry;
}

/** A staged set of changes; nothing is visible to the committed dictionary until `commit`. */
export interface DictionaryTxn extends DictionaryView {
  ensureVocab(name: string): Vocabulary;
  /**
   * Stage a definition. Throws E_REDEFINED when `name` was already defined *within this transaction*
   * (unit mode); with `allowRedefine` (console mode) that is permitted. Throws E_READONLY for `core`
   * unless `trusted`. Returns the entry that was replaced in the committed or staged dictionary
   * (so the caller can emit W_REDEFINED), or undefined.
   */
  define(
    entry: WordEntry,
    opts?: { readonly trusted?: boolean; readonly allowRedefine?: boolean },
  ): WordEntry | undefined;
  /** Adds an alias name in the same vocabulary for an entry. Throws E_REDEFINED on a collision. */
  alias(entry: WordEntry, aliasName: string): void;
  /** Stage a metadata edit (META:). Applied to the entry only on commit; discarded on rollback. */
  stageMeta(entry: WordEntry, meta: WordMeta): void;
  commit(): void;
  rollback(): void;
}

export interface Dictionary extends DictionaryView {
  begin(): DictionaryTxn;
}

// ---------------------------------------------------------------------------------------------
// Primitives (spec sections 4.4 and 5.11; PLAN 3.5)
// ---------------------------------------------------------------------------------------------

/**
 * The part of the standard AbortSignal that FL uses (declared structurally because this package
 * does not depend on the DOM or Node typings). A real AbortSignal satisfies it.
 */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export interface PrimitiveContext {
  readonly signal: AbortSignalLike | undefined;
  /** The limits in force for this run. */
  readonly limits: Readonly<Limits>;
  /** Scope of the executing segment (used by introspection primitives such as `help`). */
  readonly scope: Scope;
}

export interface PrimitiveDef {
  readonly vocab: string;
  readonly name: string;
  /** A stack-effect header, e.g. `( str alphabet:str -- bytes )`, parsed in lenient mode. */
  readonly effect: string;
  /**
   * Receives plain JS payloads (tagged Values for `any`/`number` slots) followed by a
   * PrimitiveContext. Returns undefined (0 outputs), the result (1 output) or an array of
   * results (2 or more outputs), or a Promise of any of these.
   */
  fn(...args: unknown[]): unknown;
  readonly effects?: readonly EffectLabel[];
  readonly doc?: string;
  readonly category?: string;
  readonly version?: string;
}

/** The registry parses primitive effects with the header parser, which is injected (WP 1.7 gets it from WP 1.8). */
export type CreatePrimitiveRegistryFn = (parseHeader: HeaderParseFn) => PrimitiveRegistry;

export interface PrimitiveRegistry {
  /** Throws if the vocabulary/name pair is already registered or the effect does not parse. */
  define(def: PrimitiveDef): void;
  get(vocab: string, name: string): PrimitiveDef | undefined;
  list(vocab?: string): readonly PrimitiveDef[];
}

// ---------------------------------------------------------------------------------------------
// Limits (spec section 10.8)
// ---------------------------------------------------------------------------------------------

export interface Limits {
  readonly maxSteps: number;
  readonly maxDataDepth: number;
  readonly maxReturnDepth: number;
  readonly maxValueBytes: number;
  readonly maxTotalBytes: number;
  readonly maxIntBits: number;
  readonly maxMillis: number;
  readonly maxOutputBytes: number;
  readonly maxSourceChars: number;
  readonly maxRegexLength: number;
  readonly maxTraceEntries: number;
}

export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({
  maxSteps: 10_000_000,
  maxDataDepth: 100_000,
  maxReturnDepth: 10_000,
  maxValueBytes: 64 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
  maxIntBits: 65_536,
  maxMillis: 30_000,
  maxOutputBytes: 1_048_576,
  maxSourceChars: 1_048_576,
  maxRegexLength: 1024,
  maxTraceEntries: 10_000,
});

// ---------------------------------------------------------------------------------------------
// Running (spec sections 9 and 10)
// ---------------------------------------------------------------------------------------------

/** Breakpoint at an instruction; `ip` omitted means on entry to the word. */
export interface Breakpoint {
  readonly word: string;
  readonly ip?: number;
}

export interface StepEvent {
  readonly step: number;
  /** Qualified name of the executing word, or `<console>`. */
  readonly word: string;
  readonly ip: number;
  readonly op: Opcode;
  readonly pos: SourcePos | null;
  /** Live read-only view of the data stack; copy it if you keep it. */
  readonly stack: readonly Value[];
  readonly returnDepth: number;
  readonly breakpoint: boolean;
}

/** A hook may return "stop" to end the run with E_ABORTED. It may be async (that is how a UI pauses a run). */
export type StepHook = (event: StepEvent) => void | "stop" | Promise<void | "stop">;

/** Variable store, keyed by variable id. Pass the same map to several runs to persist variables. */
export type VarStore = Map<string, Value>;

export interface RunOptions {
  readonly signal?: AbortSignalLike;
  /** Cross-thread abort flag: a nonzero element 0 aborts the run. */
  readonly abortFlag?: Int32Array;
  readonly limits?: Partial<Limits>;
  readonly onStep?: StepHook;
  /** Call `onStep` before every instruction (otherwise only at breakpoints). */
  readonly stepAll?: boolean;
  readonly breakpoints?: readonly Breakpoint[];
  /** Initial data stack, deepest first. */
  readonly stack?: readonly Value[];
  readonly vars?: VarStore;
  /** Record a trace entry per instruction. */
  readonly trace?: boolean;
  /** Effect labels that must not run (E_FORBIDDEN). */
  readonly deny?: readonly EffectLabel[];
  /** Override the session scope for this run. */
  readonly scope?: Scope;
  /** Yield to the event loop every this many steps. Default 131072; 0 disables. */
  readonly yieldEvery?: number;
}

export interface CoercionRecord {
  readonly step: number;
  /** Qualified name of the word whose input was coerced. */
  readonly word: string;
  /** Input slot index. */
  readonly slot: number;
  readonly name: string | null;
  readonly from: Tag;
  readonly to: Tag;
}

export interface TraceEntry {
  readonly step: number;
  readonly word: string;
  readonly ip: number;
  readonly op: Opcode;
  readonly depth: number;
  /** Shallow copy of the top (at most 16) values. */
  readonly stack: readonly Value[];
}

interface RunResultBase {
  /** Final data stack (at the point of failure when not ok), deepest first. */
  readonly stack: readonly Value[];
  readonly output: string;
  readonly steps: number;
  readonly elapsedMs: number;
  readonly coercions: readonly CoercionRecord[];
  /** Sorted union of the effect labels of the primitives actually called during the run. */
  readonly effects: readonly EffectLabel[];
  readonly trace?: readonly TraceEntry[];
  readonly traceTruncated?: boolean;
}

export type RunResult =
  | (RunResultBase & { readonly ok: true })
  | (RunResultBase & { readonly ok: false; readonly error: ForgeErrorShape });

// ---------------------------------------------------------------------------------------------
// Loading and the runtime facade
// ---------------------------------------------------------------------------------------------

export interface LoadOptions {
  /** Name of the unit, recorded in `WordMeta.source.unit`. */
  readonly unit?: string;
  /** Permit PRIMITIVE and writes to `core`. Default false. */
  readonly trusted?: boolean;
  /** Starting scope; default `{ current: "user", using: [] }`. */
  readonly scope?: Scope;
}

export interface Diagnostic {
  readonly code: "W_REDEFINED" | "W_SHADOW";
  readonly message: string;
  readonly qname: string;
  readonly pos: SourcePos | null;
}

export interface LoadResult {
  /** Qualified names defined by the unit, in order (aliases included). */
  readonly defined: readonly string[];
  readonly warnings: readonly Diagnostic[];
  /** Scope at the end of the unit. */
  readonly scope: Scope;
}

export interface RuntimeOptions {
  /** Extra primitives to register (bound by `PRIMITIVE`, or by name for `core`). */
  readonly primitives?: readonly PrimitiveDef[];
  /** Override limits for every run of this runtime. */
  readonly limits?: Partial<Limits>;
}

/** The public runtime facade (runtime.ts). */
export interface ForgeRuntime {
  readonly dictionary: Dictionary;
  readonly registry: PrimitiveRegistry;
  /** Compile a source unit (definitions only). Synchronous and atomic; throws a ForgeError. */
  load(source: string, opts?: LoadOptions): LoadResult;
  /** Console mode: compile the input, register its definitions, run its code. Never rejects for language errors. */
  run(source: string, opts?: RunOptions): Promise<RunResult>;
  /** Run one word with `args` as the initial stack (deepest first). */
  call(name: string, args?: readonly Value[], opts?: RunOptions): Promise<RunResult>;
  /** Resolve a name (qualified or not) in `scope` (default: the session scope). Throws like spec section 6. */
  lookup(name: string, scope?: Scope): WordEntry;
  meta(name: string, scope?: Scope): WordMeta;
  currentVocab(): string;
  setCurrentVocab(name: string): void;
  getScope(): Scope;
  setUsing(names: readonly string[]): void;
}

export type CreateRuntimeFn = (options?: RuntimeOptions) => ForgeRuntime;

// ---------------------------------------------------------------------------------------------
// Module contracts shared between work packages
// ---------------------------------------------------------------------------------------------

/** Synchronous SHA-256 (sha256.ts). Strings are UTF-8 encoded. Returns lowercase hex. */
export type Sha256Fn = (data: Uint8Array | string) => string;

/** One executable run of console tokens, compiled as an anonymous word `<console>`, with its scope. */
export interface ConsoleSegment {
  readonly code: CompiledWord;
  /** The scope in effect where the segment appears in the input. */
  readonly scope: Scope;
}

export interface CompileContext {
  readonly mode: "unit" | "console";
  readonly dictionary: Dictionary;
  readonly registry: PrimitiveRegistry;
  readonly parseHeader: HeaderParseFn;
  readonly sha256: Sha256Fn;
  /** Starting scope. */
  readonly scope: Scope;
  /** Source unit name for `WordMeta.source.unit`. */
  readonly unit: string | null;
  readonly trusted: boolean;
  readonly limits: Readonly<Limits>;
}

/** Result of compiling; nothing is visible in the dictionary until `txn.commit()`. */
export interface CompileResult {
  readonly txn: DictionaryTxn;
  /** Qualified names defined, in order (aliases included). */
  readonly defined: readonly string[];
  readonly warnings: readonly Diagnostic[];
  /** Scope at the end of the input. */
  readonly scope: Scope;
  /** Executable segments (always empty in unit mode). */
  readonly segments: readonly ConsoleSegment[];
}

/**
 * Compiler entry point (compiler.ts). `source` is the text the tokens came from (for verbatim
 * `source.text`). Throws a ForgeError at the first error (the caller then rolls back the txn).
 */
export type CompileFn = (
  tokens: readonly Token[],
  source: string,
  ctx: CompileContext,
) => CompileResult;

/**
 * VM entry point (vm.ts). Executes the segments in order on one data stack and never rejects for
 * language errors. `opts.limits` is merged over DEFAULT_LIMITS by the caller.
 */
export type VmRunFn = (
  segments: readonly ConsoleSegment[],
  opts?: RunOptions,
) => Promise<RunResult>;

/** Constructors for tagged values (values.ts). `int` normalises (safe range -> number, -0 -> 0). */
export interface ValueConstructors {
  int(n: number | bigint): Value;
  num(n: number): Value;
  str(s: string): Value;
  bytes(b: Uint8Array): Value;
  bool(b: boolean): Value;
  list(items: readonly Value[]): Value;
  record(entries: Iterable<readonly [string, Value]>): Value;
}

/** Normal form of an integer: a `number` iff safe, else `bigint`; `-0` becomes `0`. */
export type NormaliseIntFn = (n: number | bigint) => number | bigint;

/** Apply the coercion table (spec 4.2) of one value to a declared runtime type. Throws E_TYPE / E_COERCE. */
export type CoerceFn = (value: Value, to: ParamType) => Value;

/** Validate a coerced value against a slot's constraint, options, charset and regex rules. Throws E_PARAM_INVALID. */
export type ValidateFn = (value: Value, slot: StackSlot, limits: Readonly<Limits>) => void;

/** Display form (`.` of the top value) and repr form (inside containers, `.s`); secret values render `<redacted>`. */
export type DisplayFn = (value: Value) => string;
export type ReprFn = (value: Value) => string;

/** Structural equality of spec 3.1 (`=`). */
export type ValuesEqualFn = (a: Value, b: Value) => boolean;

/** Size of a value in bytes for the value and total limits (spec 10.8). */
export type SizeOfFn = (value: Value) => number;

/** The helpers values.ts exports. */
export interface ValueHelpers extends ValueConstructors {
  normaliseInt: NormaliseIntFn;
  coerce: CoerceFn;
  validate: ValidateFn;
  display: DisplayFn;
  repr: ReprFn;
  equals: ValuesEqualFn;
  sizeOf: SizeOfFn;
}
