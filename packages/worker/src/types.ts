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
 * Bake API type contracts, Phase 2. See docs/RECIPES.md (the spec) section 8 for the meaning of
 * everything here.
 *
 * This file declares TYPES ONLY, plus constants. It contains no implementation logic. It does not use
 * DOM or Node types: the package builds against ES2022 only, like the other packages.
 *
 * Module map (file in packages/worker/src -> RECIPES.md section -> work package):
 *   render.ts                 8.3   Value -> OutputValue                           WP 2.4
 *   core.ts                   8.2   createBakerCore: the engine                    WP 2.4
 *   inprocess.ts              8.2   createInProcessBaker (hardKill = false)        WP 2.4
 *   protocol.ts               8.4   message guards and validation                 WP 2.4
 *   port.ts                   8.4   attachBakerCore(port, core): the worker side   WP 2.4
 *   client.ts                 8.7   createBakerClient                              WP 2.4
 *   host-web.ts, host-node.ts 8.4   WorkerHost for Web Workers / worker_threads    WP 2.4
 *   worker-web.ts, worker-node.ts   worker entry modules                           WP 2.4
 *   vectors.ts                9     runOpVectors                                   WP 2.5
 */
import type { EffectLabel, EncodingName, ErrorCode, Limits, Tag, Value } from "@forge/lang";
import type { LoadBundleFn } from "@forge/ops";
import type { PinPolicy, RecipeIssue } from "@forge/recipe";

// ---------------------------------------------------------------------------------------------
// Constants (RECIPES.md section 8)
// ---------------------------------------------------------------------------------------------

/** Version of the message protocol. */
export const PROTOCOL_VERSION = 1 as const;

/**
 * Limits for a bake with `trust: "untrusted"` (the default). Any field a caller overrides can only be
 * made smaller. Fields not listed keep `DEFAULT_LIMITS`.
 */
export const UNTRUSTED_LIMITS: Readonly<Partial<Limits>> = Object.freeze({
  maxSteps: 5_000_000,
  maxDataDepth: 10_000,
  maxValueBytes: 16 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxIntBits: 16_384,
  maxMillis: 10_000,
});

/** Timing of the watchdog in `BakerClient`. */
export const WATCHDOG_DEFAULTS = Object.freeze({
  /** Milliseconds after `cancel()` before the worker is terminated. */
  cancelGraceMs: 1_000,
  /** Milliseconds past the bake's time limit before the worker is terminated. */
  deadlineGraceMs: 1_000,
});

/** Bounds on how an output value is rendered (RECIPES.md section 8.3). */
export const RENDER_LIMITS = Object.freeze({
  /** Items rendered per list, entries per record. */
  maxItems: 1_000,
  /** Nesting depth of lists and records. */
  maxDepth: 6,
  /** Bytes values larger than this get `text: null` (no UTF-8 view is built). */
  maxTextBytes: 16 * 1024 * 1024,
  /** Characters kept of an `other` repr. */
  maxReprChars: 200,
});

/** Minimum interval between `progress` events of one bake. */
export const PROGRESS_INTERVAL_MS = 50;

// ---------------------------------------------------------------------------------------------
// Output values (RECIPES.md section 8.3)
// ---------------------------------------------------------------------------------------------

/**
 * A final value rendered for display. Structured-clone-safe. A `bytes` output carries its bytes;
 * the UI chooses a hex, text or hex-dump view.
 */
export type OutputValue =
  | {
      readonly kind: "bytes";
      readonly bytes: Uint8Array;
      /** The bytes as strict UTF-8 text, or null when they are not well-formed UTF-8 (or too large, `RENDER_LIMITS`). */
      readonly text: string | null;
    }
  | { readonly kind: "str"; readonly text: string }
  /** Decimal text, so that big integers are exact. */
  | { readonly kind: "int"; readonly text: string }
  | { readonly kind: "num"; readonly value: number }
  | { readonly kind: "bool"; readonly value: boolean }
  | {
      readonly kind: "list";
      readonly items: readonly OutputValue[];
      /** Length of the list; larger than `items.length` when truncated. */
      readonly total: number;
    }
  | {
      readonly kind: "record";
      readonly entries: readonly { readonly key: string; readonly value: OutputValue }[];
      readonly total: number;
    }
  /** `quot`, `file`, and values below `RENDER_LIMITS.maxDepth`: the repr, cut to `maxReprChars`. */
  | { readonly kind: "other"; readonly tag: Tag; readonly repr: string };

// ---------------------------------------------------------------------------------------------
// Results (RECIPES.md section 8.2)
// ---------------------------------------------------------------------------------------------

/** Time spent in one recipe step, summed over every time it ran (a fork child runs once per piece). */
export interface StepReport {
  /** JSON pointer of the step. */
  readonly path: string;
  /** Inclusive wall-clock milliseconds, children included. */
  readonly ms: number;
  /** Number of times the step started. */
  readonly runs: number;
}

/** An implicit data conversion at the data input of an op step. */
export interface BakeCoercion {
  /** JSON pointer of the step whose op's data input was converted (by VM step ordering), or null if the step log was truncated. */
  readonly path: string | null;
  /** Qualified op name. */
  readonly op: string;
  readonly from: Tag;
  readonly to: Tag;
}

export type BakeErrorCode =
  | ErrorCode
  /** The recipe did not validate; `issues` has the details. */
  | "E_RECIPE_INVALID"
  /** `bake` before a successful `init`. */
  | "E_NOT_READY"
  /** An untrusted recipe needs a hard-kill host (regex) and this baker has none. */
  | "E_UNSAFE_HOST"
  /** A malformed message, or a message for the wrong bake. */
  | "E_PROTOCOL";

export interface BakeError {
  readonly code: BakeErrorCode;
  /** Plain text. */
  readonly message: string;
  /** JSON pointer of the recipe step that failed, or null (validation errors, setup errors, unattributable errors). */
  readonly path: string | null;
  /** Qualified name of the innermost FL word, if any. */
  readonly word: string | null;
  /** `ForgeError.detail` as JSON-safe text values; never contains secrets. */
  readonly detail: Readonly<Record<string, unknown>>;
  /** For `E_RECIPE_INVALID`. */
  readonly issues?: readonly RecipeIssue[];
  /** True when the worker had to be terminated to stop the bake. */
  readonly terminated?: boolean;
}

export interface BakeStats {
  readonly elapsedMs: number;
  /** VM steps executed (`RunResult.steps`). */
  readonly vmSteps: number;
  readonly effects: readonly EffectLabel[];
}

interface BakeResultBase {
  /** The `id` of the bake (assigned by the client or the core). */
  readonly id: number;
  readonly steps: readonly StepReport[];
  readonly coercions: readonly BakeCoercion[];
  /** True when the VM's coercion record hit `maxTraceEntries` (so `coercions` may be incomplete). */
  readonly coercionsTruncated: boolean;
  /** Validation warnings (pin mismatches and so on). */
  readonly warnings: readonly RecipeIssue[];
  readonly stats: BakeStats;
}

export type BakeResult =
  | (BakeResultBase & { readonly ok: true; readonly output: OutputValue })
  | (BakeResultBase & {
      readonly ok: false;
      readonly error: BakeError;
      /** The value on top of the stack when the bake failed, if there was one. */
      readonly partial?: OutputValue;
    });

// ---------------------------------------------------------------------------------------------
// Options and events (RECIPES.md sections 8.2, 8.5, 8.6)
// ---------------------------------------------------------------------------------------------

export type Trust = "trusted" | "untrusted";

export interface DebugOptions {
  /** Pause before the first step. Breakpoints are honoured whenever `debug` is present. */
  readonly startPaused?: boolean;
}

export type BakeEvent =
  | {
      readonly type: "progress";
      readonly id: number;
      /** Path of the step that started most recently, or null before the first step. */
      readonly path: string | null;
      /** Top-level steps finished so far. */
      readonly done: number;
      /** Top-level steps that will run (enabled, not comments). */
      readonly total: number;
      readonly vmSteps: number;
      readonly elapsedMs: number;
    }
  | {
      readonly type: "paused";
      readonly id: number;
      /** The step about to run. */
      readonly path: string;
      readonly reason: "start" | "breakpoint" | "step";
      /** The value about to enter the step (the top of the stack). */
      readonly data: OutputValue;
    }
  | { readonly type: "resumed"; readonly id: number };

export interface BakeOptions {
  /** Default `"untrusted"`. */
  readonly trust?: Trust;
  /** Merged over the limits of `trust`. Untrusted bakes can only lower limits. */
  readonly limits?: Partial<Limits>;
  /** Default `"warn"`. */
  readonly pins?: PinPolicy;
  readonly debug?: DebugOptions;
  readonly onEvent?: (event: BakeEvent) => void;
  /**
   * For hosts: a shared flag the VM polls (element 0 nonzero aborts the bake). The worker side of the
   * protocol sets it from `ClientMessage.abort`; callers of a `Baker` never need it.
   */
  readonly abortFlag?: Int32Array;
}

/** `BakeOptions` as sent over a message port (no functions, no typed arrays: the flag travels as `bake.abort`). */
export type SerialBakeOptions = Omit<BakeOptions, "onEvent" | "abortFlag">;

// ---------------------------------------------------------------------------------------------
// The Baker interface (RECIPES.md section 8.2)
// ---------------------------------------------------------------------------------------------

/** A user FL source unit to load after the built-in vocabularies. Loaded untrusted. */
export interface UnitSource {
  readonly name: string;
  readonly source: string;
}

export interface BakerInit {
  /** Built-in vocabularies to load (their dependencies come with them). Default `"all"`. The baker always adds `recipe` and its dependencies. */
  readonly vocabs?: readonly string[] | "all";
  readonly units?: readonly UnitSource[];
}

export interface InitInfo {
  readonly protocol: typeof PROTOCOL_VERSION;
  /** `Catalogue.version` of the runtime the baker built. */
  readonly catalogueVersion: string;
  /** The full set loaded, including `recipe` and the dependencies pulled in. */
  readonly vocabs: readonly string[];
}

/** One bake at a time; a new `bake` first cancels the active one. */
export interface Baker {
  /** True when `cancel` can always stop a bake, even inside one long synchronous primitive (a terminable worker). */
  readonly hardKill: boolean;
  init(init?: BakerInit): Promise<InitInfo>;
  /** Never rejects for recipe or language errors. `recipe` is untrusted JSON. */
  bake(recipe: unknown, input: Uint8Array, options?: BakeOptions): Promise<BakeResult>;
  /** While paused: run to the start of the next step, in execution order, children included. */
  step(): Promise<void>;
  /** While paused: run to the next breakpoint or the end. */
  continue(): Promise<void>;
  /** End the active bake with `E_ABORTED`. Resolves when it has ended (with the watchdog's help if needed). */
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}

export interface BakerCoreOptions {
  /**
   * REQUIRED: the vocabulary loader. `worker-web.ts` passes `loadBundleVite` (`@forge/ops/vite`), `worker-node.ts` and
   * Node tests pass `loadBundleNode` (`@forge/ops/node`); tests may wrap either to add fixture vocabularies.
   */
  readonly loadBundle: LoadBundleFn;
  /**
   * True when whatever runs this core can terminate it, so that an untrusted bake of a recipe that needs a hard
   * kill may proceed (`E_UNSAFE_HOST` otherwise, RECIPES.md section 8.2 step 3). Default false. The worker
   * entries set it: their host (`BakerClient`) owns the watchdog.
   */
  readonly hardKill?: boolean;
}

export type CreateBakerCoreFn = (options?: BakerCoreOptions) => Baker;

// ---------------------------------------------------------------------------------------------
// Message protocol (RECIPES.md section 8.4)
// ---------------------------------------------------------------------------------------------

export type ClientMessage =
  | {
      readonly type: "init";
      readonly reqId: number;
      readonly protocol: typeof PROTOCOL_VERSION;
      readonly init: BakerInit;
    }
  | {
      readonly type: "bake";
      readonly id: number;
      readonly recipe: unknown;
      /** Transferred: the worker owns this buffer. */
      readonly input: ArrayBuffer;
      readonly options: SerialBakeOptions;
      /** A `SharedArrayBuffer` of 4 bytes, present only when the page is cross-origin isolated. Element 0 nonzero means cancel. */
      readonly abort?: SharedArrayBuffer;
    }
  | { readonly type: "step"; readonly id: number }
  | { readonly type: "continue"; readonly id: number }
  | { readonly type: "cancel"; readonly id: number }
  | { readonly type: "dispose" };

export type WorkerMessage =
  | { readonly type: "ready"; readonly reqId: number; readonly info: InitInfo }
  | { readonly type: "init-error"; readonly reqId: number; readonly error: BakeError }
  | { readonly type: "event"; readonly id: number; readonly event: BakeEvent }
  /** `result.output` bytes (and `partial` bytes) are in a buffer that is transferred. */
  | { readonly type: "result"; readonly id: number; readonly result: BakeResult }
  | { readonly type: "fatal"; readonly message: string };

/** A two-way message channel as the worker side sees it. A `MessagePort`, a `DedicatedWorkerGlobalScope` and a `worker_threads` port all fit through a thin adapter. */
export interface WorkerPort {
  postMessage(message: WorkerMessage, transfer?: ArrayBuffer[]): void;
  onMessage(handler: (message: ClientMessage) => void): void;
}

/** The client side of a worker: a `Worker`, or a `worker_threads` `Worker`, behind a thin adapter. */
export interface WorkerHost {
  postMessage(message: ClientMessage, transfer?: ArrayBuffer[]): void;
  onMessage(handler: (message: WorkerMessage) => void): void;
  /** A script error or an unexpected exit of the worker. */
  onError(handler: (error: { readonly message: string }) => void): void;
  /** Stop the worker immediately and for good. */
  terminate(): void;
}

export type HostFactory = () => WorkerHost;

/** `attachBakerCore(port, core)`: run the message loop of a worker on top of a core. */
export type AttachBakerCoreFn = (port: WorkerPort, core: Baker) => void;

// ---------------------------------------------------------------------------------------------
// The main-thread client (RECIPES.md section 8.7)
// ---------------------------------------------------------------------------------------------

export interface BakerClientOptions {
  /** Creates a fresh worker; called again after the watchdog terminated one. */
  readonly host: HostFactory;
  /** Default `WATCHDOG_DEFAULTS.cancelGraceMs`. */
  readonly cancelGraceMs?: number;
  /** Default `WATCHDOG_DEFAULTS.deadlineGraceMs`. */
  readonly deadlineGraceMs?: number;
  /** Use a `SharedArrayBuffer` abort flag when available. Default true. */
  readonly sharedAbort?: boolean;
}

/** A `Baker` backed by a worker. `hardKill` is true. */
export interface BakerClient extends Baker {
  readonly hardKill: true;
}

export type CreateBakerClientFn = (options: BakerClientOptions) => BakerClient;

// ---------------------------------------------------------------------------------------------
// Op test vectors (RECIPES.md section 9)
// ---------------------------------------------------------------------------------------------

export interface VectorEncoded {
  readonly value: string;
  readonly enc: EncodingName;
}

export type VectorParamValue = number | string | boolean | VectorEncoded;

export type VectorExpect =
  /** The output, as bytes (a `str` output is UTF-8 encoded), equals these bytes. */
  | VectorEncoded
  /** A bake failure. Parameter constraint violations are caught by the recipe validator first, so they are `E_RECIPE_INVALID`. */
  | { readonly error: BakeErrorCode }
  /** The output rendered as JSON: bool, int, num, str as themselves; list as array; record as object; bytes as `{"$bytes": "<hex>"}`. */
  | { readonly json: unknown };

/** One line of `packages/ops/vocab/<vocab>.test.json`. */
export interface OpTestVector {
  readonly name?: string;
  /** Where the expected value comes from (standard, RFC section, hand-computed). */
  readonly ref?: string;
  readonly op: string;
  /** Parameters by name; omitted ones take the op's defaults. */
  readonly params: Readonly<Record<string, VectorParamValue>>;
  readonly input: VectorEncoded;
  readonly expect: VectorExpect;
}

export interface VectorFailure {
  readonly file: string;
  readonly index: number;
  readonly name: string;
  readonly message: string;
}

export interface VectorReport {
  readonly total: number;
  readonly passed: number;
  readonly failures: readonly VectorFailure[];
  /** Catalogue ops with no vector at all. */
  readonly uncovered: readonly string[];
}

// ---------------------------------------------------------------------------------------------
// Functions of the package (RECIPES.md section 11.5)
// ---------------------------------------------------------------------------------------------

/** `effectiveLimits(trust, limits?)` in `limits.ts`: the one place limits are merged (RECIPES.md section 8.6). */
export type EffectiveLimitsFn = (trust: Trust, limits?: Partial<Limits>) => Limits;

/** `renderValue(value)` in `render.ts`. */
export type RenderValueFn = (value: Value) => OutputValue;

/** `outputToJson(output)` in `render.ts`: the vector JSON rendering (RECIPES.md section 9.1). */
export type OutputToJsonFn = (output: OutputValue) => unknown;

/** `stripTimings(result)` in `render.ts`: zero `elapsedMs`, every `steps[i].ms` and the `id`, for comparing results across hosts. */
export type StripTimingsFn = (result: BakeResult) => BakeResult;

/** `createBakerCore(options)` and `createInProcessBaker(options)`: the same engine; `hardKill` is false. */
export type CreateInProcessBakerFn = (options: BakerCoreOptions) => Baker;

/** The part of a `Worker` that `createWebWorkerHost` uses. */
export interface WebWorkerLike {
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
  terminate(): void;
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
  addEventListener(type: "error", listener: (event: { readonly message?: string }) => void): void;
}

export type CreateWebWorkerHostFn = (create: () => WebWorkerLike) => WorkerHost;

export interface NodeWorkerHostOptions {
  /** Test hook: module URLs whose `primitives` export is appended to the bundle in the worker. */
  readonly extraPrimitiveModules?: readonly string[];
}

export type CreateNodeWorkerHostFn = (options?: NodeWorkerHostOptions) => WorkerHost;

/** Message shape guards in `protocol.ts`. */
export type IsClientMessageFn = (value: unknown) => value is ClientMessage;
export type IsWorkerMessageFn = (value: unknown) => value is WorkerMessage;

export interface RunOpVectorsOptions {
  readonly baker: Baker;
  readonly catalogue: {
    readonly version: string;
    readonly ops: readonly { readonly qname: string; readonly aliases: readonly string[] }[];
  };
  /** Parsed `<vocab>.test.json` files by file name. */
  readonly files: Readonly<Record<string, readonly OpTestVector[]>>;
}

export type RunOpVectorsFn = (options: RunOpVectorsOptions) => Promise<VectorReport>;
