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
 * The primitive registry and the primitive call boundary (spec sections 4.4, 5.11 and 10.5).
 *
 * `createPrimitiveRegistry` validates definitions eagerly. `callPrimitive` is what the VM uses at
 * the `prim` instruction: it converts tagged values to plain payloads, calls `fn`, awaits a promise
 * if one is returned and converts the results back. Coercing and validating the inputs against the
 * declared slots is the VM's job and has already happened by the time `callPrimitive` runs.
 */
import { ForgeError, isForgeError } from "./errors.js";
import { isReservedWord, isVocabName, isWordName } from "./meta.js";
import type {
  CreatePrimitiveRegistryFn,
  EffectLabel,
  HeaderParseFn,
  PrimitiveContext,
  PrimitiveDef,
  PrimitiveRegistry,
  StackEffect,
  StackSlot,
  Tag,
  Value,
} from "./types.js";
import { normaliseInt, num, runtimeTypeOf } from "./values.js";

const EFFECT_LABELS: readonly string[] = ["+async", "+random", "+time"];
const TAGS: ReadonlySet<string> = new Set<Tag>([
  "bytes",
  "str",
  "int",
  "num",
  "bool",
  "list",
  "quot",
  "record",
  "file",
]);

/** Parsed effects of every registered definition, keyed by the definition object. */
const parsedEffects = new WeakMap<PrimitiveDef, StackEffect>();

/** The parsed (lenient) stack effect of a registered primitive, or undefined if it was never registered. */
export function primitiveEffect(def: PrimitiveDef): StackEffect | undefined {
  return parsedEffects.get(def);
}

/** Optional parts of a primitive definition. */
export interface PrimitiveOptions {
  readonly effects?: readonly EffectLabel[];
  readonly doc?: string;
  readonly category?: string;
  readonly version?: string;
}

/**
 * Builds a `PrimitiveDef`: `definePrimitive("hash", "md5", "( bytes -- bytes )", fn, { doc })`.
 * Nothing is validated until the definition is passed to `registry.define`.
 */
export function definePrimitive(
  vocab: string,
  name: string,
  effect: string,
  fn: PrimitiveDef["fn"],
  options: PrimitiveOptions = {},
): PrimitiveDef {
  return Object.freeze({ vocab, name, effect, fn, ...options });
}

function badName(message: string, name: string): ForgeError {
  return new ForgeError({ code: "E_NAME", message, detail: { name } });
}

function badEffect(message: string, item: string): ForgeError {
  return new ForgeError({ code: "E_HEADER", message, detail: { item } });
}

function validateDef(def: PrimitiveDef, parseHeader: HeaderParseFn): StackEffect {
  const qname = `${String(def.vocab)}:${String(def.name)}`;
  if (typeof def.vocab !== "string" || !isVocabName(def.vocab)) {
    throw badName(`invalid vocabulary name '${String(def.vocab)}'`, String(def.vocab));
  }
  if (typeof def.name !== "string" || !isWordName(def.name) || isReservedWord(def.name)) {
    throw badName(`invalid primitive name '${String(def.name)}'`, String(def.name));
  }
  if (typeof def.fn !== "function")
    throw new TypeError(`primitive ${qname}: fn must be a function`);
  for (const label of def.effects ?? []) {
    if (!EFFECT_LABELS.includes(label)) {
      throw new TypeError(`primitive ${qname}: unknown effect label '${String(label)}'`);
    }
  }
  for (const key of ["doc", "category", "version"] as const) {
    const x = def[key];
    if (x !== undefined && typeof x !== "string") {
      throw new TypeError(`primitive ${qname}: ${key} must be a string`);
    }
  }
  const raw: unknown = def.effect;
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text.startsWith("(") || !text.endsWith(")")) {
    throw badEffect(`primitive ${qname}: effect must be written ( ... -- ... )`, text);
  }
  const lead = (raw as string).length - (raw as string).trimStart().length;
  const effect = parseHeader(
    text.slice(1, -1),
    { offset: lead + 1, line: 1, col: lead + 2 },
    "lenient",
  );
  if (effect.unchecked || effect.variadicInput) {
    throw badEffect(`primitive ${qname}: a primitive must have a fixed arity`, text);
  }
  return effect;
}

/**
 * Creates a registry. Definitions are validated by `define`: names (`E_NAME`), `fn` and effect
 * labels (`TypeError`), and the effect string, which is parsed in lenient mode with the injected
 * header parser (`E_HEADER`) and must have a fixed arity. A duplicate is `E_REDEFINED`.
 * `list()` returns definitions in registration order.
 */
export const createPrimitiveRegistry: CreatePrimitiveRegistryFn = (
  parseHeader,
): PrimitiveRegistry => {
  const vocabs = new Map<string, Map<string, PrimitiveDef>>();
  return {
    define(def) {
      const effect = validateDef(def, parseHeader);
      const words = vocabs.get(def.vocab) ?? new Map<string, PrimitiveDef>();
      if (words.has(def.name)) {
        throw new ForgeError({
          code: "E_REDEFINED",
          message: `primitive '${def.vocab}:${def.name}' is already registered`,
          detail: { name: `${def.vocab}:${def.name}` },
        });
      }
      words.set(def.name, def);
      vocabs.set(def.vocab, words);
      parsedEffects.set(def, effect);
    },
    get(vocab, name) {
      return vocabs.get(vocab)?.get(name);
    },
    list(vocab) {
      if (vocab !== undefined) return [...(vocabs.get(vocab)?.values() ?? [])];
      return [...vocabs.values()].flatMap((words) => [...words.values()]);
    },
  };
};

// ---------------------------------------------------------------------------------------------
// The call boundary
// ---------------------------------------------------------------------------------------------

function isThenable(x: unknown): x is PromiseLike<unknown> {
  return (
    (typeof x === "object" || typeof x === "function") &&
    x !== null &&
    typeof (x as { then?: unknown }).then === "function"
  );
}

function qnameOf(def: PrimitiveDef): string {
  return `${def.vocab}:${def.name}`;
}

/** Fills in `word`/`vocab` of a ForgeError that lacks them; wraps anything else in E_PRIMITIVE. */
function annotate(e: unknown, def: PrimitiveDef): ForgeError {
  if (isForgeError(e)) {
    if (e instanceof ForgeError && e.word === null) {
      return e.with({ word: qnameOf(def), vocab: def.vocab });
    }
    return e as ForgeError;
  }
  return new ForgeError({
    code: "E_PRIMITIVE",
    message: e instanceof Error ? e.message : String(e),
    word: qnameOf(def),
    vocab: def.vocab,
    cause: e,
  });
}

function jsKind(x: unknown): string {
  if (x === null) return "null";
  if (Array.isArray(x)) return "array";
  if (x instanceof Uint8Array) return "Uint8Array";
  if (x instanceof Map) return "Map";
  return typeof x;
}

function badResult(def: PrimitiveDef, expected: string, actual: unknown, index: number) {
  return new ForgeError({
    code: "E_TYPE",
    message: `${qnameOf(def)}: result ${index} should be ${expected}, got ${jsKind(actual)}`,
    word: qnameOf(def),
    vocab: def.vocab,
    detail: { expected, actual: jsKind(actual), where: "result", index },
  });
}

function isValueLike(x: unknown): x is Value {
  return (
    typeof x === "object" &&
    x !== null &&
    TAGS.has((x as { tag?: unknown }).tag as string) &&
    "v" in x
  );
}

/** One-level check of a tagged value: known tag, int in normal form, num finite. */
function checkValue(
  def: PrimitiveDef,
  x: unknown,
  index: number,
  maxIntBits: number,
  argPayloads: readonly unknown[],
): Value {
  if (!isValueLike(x)) throw badResult(def, "a tagged value", x, index);
  const aliased = argPayloads.includes(x);
  switch (x.tag) {
    case "int": {
      const v: unknown = x.v;
      if (typeof v !== "bigint" && !(typeof v === "number" && Number.isInteger(v))) {
        throw badResult(def, "an integer", v, index);
      }
      const n = normaliseInt(v, maxIntBits);
      return n === v && !aliased ? x : { tag: "int", v: n };
    }
    case "num":
      if (typeof x.v !== "number") throw badResult(def, "a number", x.v, index);
      num(x.v); // E_RANGE when not finite
      return aliased ? { tag: "num", v: x.v } : x;
    case "bytes":
      if (!(x.v instanceof Uint8Array)) throw badResult(def, "a Uint8Array", x.v, index);
      return aliased || argPayloads.includes(x.v) ? { tag: "bytes", v: x.v.slice() } : x;
    default:
      return aliased ? ({ ...x } as Value) : x;
  }
}

function toValue(
  def: PrimitiveDef,
  slot: StackSlot,
  x: unknown,
  index: number,
  ctx: PrimitiveContext,
  argPayloads: readonly unknown[],
): Value {
  const maxIntBits = ctx.limits.maxIntBits;
  const target = runtimeTypeOf(slot.type);
  if (target === "any") return checkValue(def, x, index, maxIntBits, argPayloads);
  if (target === "number") {
    const v = checkValue(def, x, index, maxIntBits, argPayloads);
    if (v.tag !== "int" && v.tag !== "num") throw badResult(def, "int or num", v.tag, index);
    return v;
  }
  switch (target) {
    case "int":
      if (typeof x !== "bigint" && !(typeof x === "number" && Number.isInteger(x))) {
        throw badResult(def, "an integer", x, index);
      }
      return { tag: "int", v: normaliseInt(x, maxIntBits) };
    case "num":
      if (typeof x !== "number") throw badResult(def, "a number", x, index);
      return num(x);
    case "str":
      if (typeof x !== "string") throw badResult(def, "a string", x, index);
      return { tag: "str", v: x };
    case "bool":
      if (typeof x !== "boolean") throw badResult(def, "a boolean", x, index);
      return { tag: "bool", v: x };
    case "bytes":
      if (!(x instanceof Uint8Array)) throw badResult(def, "a Uint8Array", x, index);
      return { tag: "bytes", v: argPayloads.includes(x) ? x.slice() : x };
    case "list": {
      if (!Array.isArray(x)) throw badResult(def, "an array of values", x, index);
      const items: Value[] = new Array<Value>(x.length);
      for (let i = 0; i < x.length; i++) {
        items[i] = checkValue(def, x[i], index, maxIntBits, argPayloads);
      }
      return { tag: "list", v: items };
    }
    case "record": {
      if (!(x instanceof Map)) throw badResult(def, "a Map", x, index);
      for (const [k, v] of x as Map<unknown, unknown>) {
        if (typeof k !== "string") throw badResult(def, "a Map with string keys", k, index);
        checkValue(def, v, index, maxIntBits, argPayloads);
      }
      return { tag: "record", v: x as Map<string, Value> };
    }
    case "quot":
      if (typeof x !== "object" || x === null) throw badResult(def, "a quotation", x, index);
      return { tag: "quot", v: x as never };
    default: {
      const f = x as { name?: unknown; type?: unknown; bytes?: unknown } | null;
      if (
        typeof f !== "object" ||
        f === null ||
        typeof f.name !== "string" ||
        typeof f.type !== "string" ||
        !(f.bytes instanceof Uint8Array)
      ) {
        throw badResult(def, "a file", x, index);
      }
      return { tag: "file", v: x as never };
    }
  }
}

function convertResult(
  def: PrimitiveDef,
  effect: StackEffect,
  r: unknown,
  ctx: PrimitiveContext,
  argPayloads: readonly unknown[],
): Value[] {
  const outs = effect.outputs;
  let items: readonly unknown[];
  if (outs.length === 0) {
    if (r !== undefined) throw badResult(def, "no result (undefined)", r, 0);
    return [];
  }
  if (outs.length === 1) {
    items = [r];
  } else {
    if (!Array.isArray(r) || r.length !== outs.length) {
      throw badResult(def, `an array of ${outs.length} results`, r, 0);
    }
    items = r;
  }
  return outs.map((slot, i) => toValue(def, slot, items[i], i, ctx, argPayloads));
}

/**
 * Calls a registered primitive: payload conversion (spec 4.4), `fn`, result conversion. Returns the
 * result values (0, 1 or k of them), directly when `fn` is synchronous and as a promise when `fn`
 * returns a thenable, so the VM can race it against abort and deadline. Callers may `await` either.
 *
 * Failures are `ForgeError`s with `word`/`vocab` set: a thrown ForgeError is re-raised, any other
 * throw or rejection is `E_PRIMITIVE`, a wrongly typed result is `E_TYPE` with
 * `detail.where = "result"`, an oversize int is `E_LIMIT_VALUE`, a non-finite num `E_RANGE`.
 * Calling with an unregistered definition, or the wrong argument count, is a caller bug
 * (`E_INTERNAL`). A `bytes` result that is the very array of an argument is copied, so the
 * "no aliases" rule (spec 10.5) holds for the machine even for a careless primitive.
 */
export function callPrimitive(
  def: PrimitiveDef,
  args: readonly Value[],
  ctx: PrimitiveContext,
): Value[] | Promise<Value[]> {
  const effect = parsedEffects.get(def);
  if (effect === undefined) {
    throw new ForgeError({
      code: "E_INTERNAL",
      message: `primitive ${qnameOf(def)} is not registered`,
    });
  }
  if (args.length !== effect.inputs.length) {
    throw new ForgeError({
      code: "E_INTERNAL",
      message: `${qnameOf(def)} takes ${effect.inputs.length} inputs, got ${args.length}`,
    });
  }
  const aliasable: unknown[] = [];
  const payloads: unknown[] = effect.inputs.map((slot, i) => {
    const arg = args[i] as Value;
    const t = runtimeTypeOf(slot.type);
    if (t === "any" || t === "number") {
      aliasable.push(arg, arg.v);
      return arg;
    }
    aliasable.push(arg.v);
    return arg.v;
  });
  let r: unknown;
  try {
    r = def.fn(...payloads, ctx);
  } catch (e) {
    throw annotate(e, def);
  }
  const convert = (x: unknown): Value[] => {
    try {
      return convertResult(def, effect, x, ctx, aliasable);
    } catch (e) {
      throw annotate(e, def);
    }
  };
  if (isThenable(r)) {
    return Promise.resolve(r).then(convert, (e: unknown) => {
      throw annotate(e, def);
    });
  }
  return convert(r);
}
