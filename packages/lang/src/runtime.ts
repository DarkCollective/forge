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

/**
 * The runtime facade (spec 10.13): a dictionary holding `user` and `core`, the primitive registry,
 * and the compile-then-run pipeline behind `load`, `run` and `call`.
 *
 * `core` is built from the compiler's intrinsic entries, the registered core primitives, and the
 * five words that need the dictionary (`help see words vocabs current-vocab`), which are defined
 * here as primitives closing over the dictionary and reading the executing segment's scope from the
 * `PrimitiveContext`.
 */
import { compile, createIntrinsicEntries, createPrimitiveEntry } from "./compiler.js";
import { createDictionary, listWords } from "./dictionary.js";
import { ForgeError } from "./errors.js";
import { isVocabName, parseHeader, renderHelp, renderSee } from "./meta.js";
import { createPrimitiveRegistry, definePrimitive } from "./primitives.js";
import { read } from "./reader.js";
import { sha256 } from "./sha256.js";
import { DEFAULT_LIMITS } from "./types.js";
import type {
  CompileResult,
  ConsoleSegment,
  ForgeRuntime,
  Limits,
  LoadOptions,
  LoadResult,
  PrimitiveContext,
  PrimitiveDef,
  RunOptions,
  RunResult,
  RuntimeOptions,
  Scope,
  Value,
  WordEntry,
  WordMeta,
} from "./types.js";
import { registerCorePrimitives } from "./vocab/core.js";
import { PRELUDE_SOURCE } from "./vocab/prelude.js";
import { runVm } from "./vm.js";

// The package builds against ES2022 only; this is the host global the facade needs.
declare const performance: { now(): number };

const USER_VOCAB = "user";

/** The `core` words that read the dictionary or the scope (spec 13.7, kind R). */
function runtimeWords(
  resolve: (name: string, scope: Scope) => WordEntry,
  dictionary: ForgeRuntime["dictionary"],
): PrimitiveDef[] {
  const strs = (names: readonly string[]): Value[] => names.map((v) => ({ tag: "str", v }));
  return [
    definePrimitive(
      "core",
      "help",
      "( str -- str )",
      (name: unknown, ctx: unknown) =>
        renderHelp(resolve(name as string, (ctx as PrimitiveContext).scope).meta),
      { doc: "metadata text for a word", category: "Introspection" },
    ),
    definePrimitive(
      "core",
      "see",
      "( str -- str )",
      (name: unknown, ctx: unknown) =>
        renderSee(resolve(name as string, (ctx as PrimitiveContext).scope).meta),
      { doc: "source or definition of a word", category: "Introspection" },
    ),
    definePrimitive(
      "core",
      "words",
      "( vocab:str -- list )",
      (vocab: unknown) => strs(listWords(dictionary, vocab as string)),
      { doc: "public word names of a vocabulary, sorted by code point", category: "Introspection" },
    ),
    definePrimitive("core", "vocabs", "( -- list )", () => strs(dictionary.vocabs()), {
      doc: "vocabulary names, sorted by code point",
      category: "Introspection",
    }),
    definePrimitive(
      "core",
      "current-vocab",
      "( -- str )",
      (ctx: unknown) => (ctx as PrimitiveContext).scope.current,
      { doc: "the current vocabulary of the executing segment", category: "Introspection" },
    ),
  ];
}

/** Creates a runtime: a fresh dictionary with `user` and `core`, plus the given primitives. */
export function createRuntime(options: RuntimeOptions = {}): ForgeRuntime {
  const dictionary = createDictionary();
  const registry = createPrimitiveRegistry(parseHeader);
  const baseLimits: Readonly<Limits> = { ...DEFAULT_LIMITS, ...options.limits };

  const resolveName = (name: string, scope: Scope): WordEntry => {
    const i = name.indexOf(":");
    return i >= 0
      ? dictionary.resolveQualified(name.slice(0, i), name.slice(i + 1), scope.current)
      : dictionary.resolve(name, scope);
  };

  // Build `core` and the user-supplied vocabularies in one trusted transaction.
  registerCorePrimitives(registry);
  const rtWords = runtimeWords(resolveName, dictionary);
  for (const def of rtWords) registry.define(def);
  for (const def of options.primitives ?? []) registry.define(def);
  const txn = dictionary.begin();
  for (const e of createIntrinsicEntries()) txn.define(e, { trusted: true });
  for (const def of registry.list()) txn.define(createPrimitiveEntry(def), { trusted: true });
  txn.ensureVocab(USER_VOCAB);
  txn.commit();

  let scope: Scope = { current: USER_VOCAB, using: [] };

  const limitsFor = (o: Partial<Limits> | undefined): Readonly<Limits> => ({
    ...baseLimits,
    ...o,
  });

  const failure = (error: ForgeError, stack: readonly Value[], started: number): RunResult => ({
    ok: false,
    error,
    stack: [...stack],
    output: "",
    steps: 0,
    elapsedMs: performance.now() - started,
    coercions: [],
    effects: [],
  });

  /** Compiles console source; a language error comes back as a failed RunResult. */
  const compileConsole = (
    source: string,
    limits: Readonly<Limits>,
    startScope: Scope,
  ): CompileResult | ForgeError => {
    try {
      const tokens = read(source, {
        maxSourceChars: limits.maxSourceChars,
        maxIntBits: limits.maxIntBits,
      });
      return compile(tokens, source, {
        mode: "console",
        dictionary,
        registry,
        parseHeader,
        sha256,
        scope: startScope,
        unit: null,
        trusted: false,
        limits,
      });
    } catch (e) {
      if (e instanceof ForgeError) return e;
      throw e;
    }
  };

  const execute = (
    segments: readonly ConsoleSegment[],
    opts: RunOptions,
    limits: Readonly<Limits>,
  ): Promise<RunResult> => runVm(segments, { ...opts, limits });

  const runtime: ForgeRuntime = {
    dictionary,
    registry,

    load(source: string, opts: LoadOptions = {}): LoadResult {
      const limits = limitsFor(undefined);
      const tokens = read(source, {
        maxSourceChars: limits.maxSourceChars,
        maxIntBits: limits.maxIntBits,
      });
      const startScope = opts.scope ?? { current: USER_VOCAB, using: [] };
      const result = compile(tokens, source, {
        mode: "unit",
        dictionary,
        registry,
        parseHeader,
        sha256,
        scope: { current: startScope.current, using: [...startScope.using] },
        unit: opts.unit ?? null,
        trusted: opts.trusted === true,
        limits,
      });
      result.txn.commit();
      return { defined: result.defined, warnings: result.warnings, scope: result.scope };
    },

    async run(source: string, opts: RunOptions = {}): Promise<RunResult> {
      const started = performance.now();
      const limits = limitsFor(opts.limits);
      const startScope = opts.scope ?? scope;
      const compiled = compileConsole(source, limits, startScope);
      if (compiled instanceof ForgeError) return failure(compiled, opts.stack ?? [], started);
      compiled.txn.commit();
      if (opts.scope === undefined) scope = compiled.scope;
      return execute(compiled.segments, opts, limits);
    },

    async call(
      name: string,
      args: readonly Value[] = [],
      opts: RunOptions = {},
    ): Promise<RunResult> {
      if (typeof name !== "string") throw new TypeError("call: name must be a string");
      if (!Array.isArray(args)) throw new TypeError("call: args must be an array of values");
      const started = performance.now();
      const limits = limitsFor(opts.limits);
      let single = false;
      try {
        const tokens = read(name);
        const first = tokens[0];
        single = tokens.length === 2 && (first?.kind === "word" || first?.kind === "qword");
      } catch {
        // an unreadable name is reported below like any other bad name
      }
      if (!single) throw new TypeError(`call: '${name}' is not a single word name`);
      const compiled = compileConsole(name, limits, opts.scope ?? scope);
      if (compiled instanceof ForgeError) return failure(compiled, args, started);
      compiled.txn.rollback();
      return execute(compiled.segments, { ...opts, stack: args }, limits);
    },

    lookup(name: string, at: Scope = scope): WordEntry {
      return resolveName(name, at);
    },

    meta(name: string, at: Scope = scope): WordMeta {
      return resolveName(name, at).meta;
    },

    currentVocab(): string {
      return scope.current;
    },

    setCurrentVocab(name: string): void {
      if (!isVocabName(name)) {
        throw new ForgeError({
          code: "E_NAME",
          message: `'${name}' is not a valid vocabulary name`,
          detail: { name },
        });
      }
      if (name === "core") {
        throw new ForgeError({
          code: "E_READONLY",
          message: "vocabulary 'core' is read-only",
          detail: { vocab: "core" },
        });
      }
      const t = dictionary.begin();
      t.ensureVocab(name);
      t.commit();
      scope = { current: name, using: scope.using };
    },

    getScope(): Scope {
      return { current: scope.current, using: [...scope.using] };
    },

    setUsing(names: readonly string[]): void {
      for (const n of names) {
        if (!isVocabName(n)) {
          throw new ForgeError({
            code: "E_NAME",
            message: `'${n}' is not a valid vocabulary name`,
            detail: { name: n },
          });
        }
        if (dictionary.vocab(n) === undefined) {
          throw new ForgeError({
            code: "E_NO_VOCAB",
            message: `no such vocabulary '${n}'`,
            detail: { vocab: n },
          });
        }
      }
      scope = { current: scope.current, using: [...names] };
    },
  };
  // The prelude (docs/LANGUAGE-0.2.md section 13): FL words of `core`, loaded as one trusted unit.
  // It is compiled under the default limits, never the caller's, so that a small `maxSourceChars`
  // or `maxIntBits` cannot stop the runtime from being built.
  const prelude = compile(
    read(PRELUDE_SOURCE, {
      maxSourceChars: DEFAULT_LIMITS.maxSourceChars,
      maxIntBits: DEFAULT_LIMITS.maxIntBits,
    }),
    PRELUDE_SOURCE,
    {
      mode: "unit",
      dictionary,
      registry,
      parseHeader,
      sha256,
      scope: { current: USER_VOCAB, using: [] },
      unit: null,
      trusted: true,
      limits: DEFAULT_LIMITS,
    },
  );
  prelude.txn.commit();
  return runtime;
}
