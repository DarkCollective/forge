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
 * Extension values (LANGUAGE-0.3.md section 4): the kind registry, the `ext` builder, the literal-tag
 * registry (the reader and compiler side of tagged literals is X4's) and `kindConformance`, the test
 * every kind ships.
 *
 * The registries are process-wide, in module scope. Registration is idempotent and the last one wins,
 * so a module that two entry points evaluate registers twice without error. Only TypeScript can
 * register a kind: FL source cannot, so untrusted code cannot invent one (D8).
 *
 * This file imports only types, so that `values.ts` can read the registry without a cycle.
 */
import type { PrimitiveContext, Value } from "./types.js";
import { DEFAULT_LIMITS } from "./types.js";

/** The words a kind can give methods for (LANGUAGE-0.3.md section 5.3). */
export type GenericWord =
  | "+"
  | "-"
  | "*"
  | "/"
  | "pow"
  | "min"
  | "max"
  | "fpow"
  | "atan2"
  | "neg"
  | "abs"
  | "sqrt"
  | "ln"
  | "log2"
  | "log10"
  | "exp"
  | "sin"
  | "cos"
  | "tan"
  | "asin"
  | "acos"
  | "atan"
  | "sinh"
  | "cosh"
  | "tanh"
  | "floor"
  | "ceil"
  | "round"
  | "compare"
  | "len"
  | "nth"
  | "cat"
  | "slice"
  | "rev";

/**
 * The methods of a kind. `args` are the operands, deepest first. A method returns a `Value`, or
 * `undefined` to decline. Declared here so that kinds can carry methods; dispatch is work package L10.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- `P` keeps the shape of LANGUAGE-0.3.md section 5.3
export type ExtMethods<P = unknown> = Partial<
  Record<GenericWord, (args: readonly Value[], ctx: PrimitiveContext) => Value | undefined>
>;

/** What a kind provides (LANGUAGE-0.3.md section 4.2). `P` is the payload type. */
export interface ExtKind<P = unknown> {
  /** Lower-kebab-case name, `/^[a-z][a-z0-9-]{0,63}$/`, as written in `ext{kind}`. */
  readonly kind: string;
  equals(a: P, b: P): boolean;
  /**
   * Bytes the payload holds: O(1), a conservative upper bound (at least the bytes held), cached by the
   * kind (payloads are immutable) and stable across calls. The VM charges `16 + sizeOf(payload)`.
   */
  sizeOf(p: P): number;
  /** The text form, at most `max` UTF-16 code units, a cut text ending in `...`. */
  toText(p: P, max: number): string;
  /** Pure, deterministic and linear. Throws `E_COERCE` (`detail.offset`: UTF-16 offset of the first bad character). */
  fromText?(text: string): P;
  /** The form inside a container and in `.s`; the default is `<ext KIND TEXT>`. */
  repr?(p: P, max: number): string;
  /** A structured-clone-safe summary for a viewer (X2); not used by the VM. */
  view?(p: P, o: { readonly maxRows: number }): unknown;
  /** Default true; false for a mutable kind (LANGUAGE-0.3.md section 10). */
  readonly storable?: boolean;
  readonly methods?: ExtMethods<P>;
}

const KIND_RE = /^[a-z][a-z0-9-]{0,63}$/;
const TAG_RE = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * Kind names the language owns: `null` (section 7) and `array` (section 10). `registerExtKind`
 * refuses them, so a pack cannot take them over; the language registers them itself.
 */
export const CORE_EXT_KINDS: readonly string[] = Object.freeze(["null", "array"]);

/**
 * Every name that is reserved for a kind (LANGUAGE-0.3.md section 4.2): the two the language owns,
 * `table` (`@forge/ops`), `relation` and `relix-expr` (the Relix pack) and `rat` (the symbolic pack).
 * A pack manifest refuses a pack that claims one of them for a kind it does not own (P1).
 */
export const RESERVED_EXT_KINDS: readonly string[] = Object.freeze([
  "null",
  "array",
  "table",
  "relation",
  "relix-expr",
  "rat",
]);

const kinds = new Map<string, ExtKind>();

function validateKind(k: ExtKind): void {
  if (typeof k !== "object" || k === null)
    throw new TypeError("registerExtKind: a kind is required");
  if (typeof k.kind !== "string" || !KIND_RE.test(k.kind)) {
    throw new TypeError(`registerExtKind: invalid ext kind name '${String(k.kind)}'`);
  }
  for (const f of ["equals", "sizeOf", "toText"] as const) {
    if (typeof k[f] !== "function") {
      throw new TypeError(`registerExtKind: kind '${k.kind}' needs a function '${f}'`);
    }
  }
}

/**
 * Registers a kind. Idempotent by name; a later registration of the same name replaces the earlier
 * one (last wins). Throws a `TypeError` (a programmer error, not a `ForgeError`) for a bad name, a
 * missing `equals`, `sizeOf` or `toText`, or a name the language owns (`CORE_EXT_KINDS`).
 */
export function registerExtKind<P>(k: ExtKind<P>): void {
  validateKind(k as ExtKind);
  if (CORE_EXT_KINDS.includes(k.kind)) {
    throw new TypeError(`registerExtKind: the kind name '${k.kind}' is reserved by the language`);
  }
  kinds.set(k.kind, k as ExtKind);
}

/** The language's own registration (module load); not exported from the package. */
function registerCoreKind<P>(k: ExtKind<P>): void {
  validateKind(k as ExtKind);
  kinds.set(k.kind, k as ExtKind);
}

export function getExtKind(name: string): ExtKind | undefined {
  return kinds.get(name);
}

export function listExtKinds(): readonly string[] {
  return [...kinds.keys()];
}

/** Builds an `ext` Value. The kind must be registered (a `TypeError` otherwise: only a kind makes values). */
export function ext(kind: string, payload: unknown): Value {
  if (!kinds.has(kind)) throw new TypeError(`ext: the kind '${kind}' is not registered`);
  return { tag: "ext", kind, v: payload };
}

// ---------------------------------------------------------------------------------------------
// Text forms (section 4.6)
// ---------------------------------------------------------------------------------------------

/** The largest text form the language itself ever asks a kind for when it has no limits at hand. */
const TEXT_CAP = Math.floor(DEFAULT_LIMITS.maxValueBytes / 2);

function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 3) return text.slice(0, Math.max(0, max));
  let end = max - 3;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--; // do not leave half a pair
  return text.slice(0, end) + "...";
}

/**
 * The text form of an `ext` value, at most `max` code units (the kind is asked for `max`; the result
 * is cut again if the kind did not). A kind that is not registered gives `<ext KIND>`.
 */
export function extText(kind: string, payload: unknown, max: number = TEXT_CAP): string {
  const k = kinds.get(kind);
  if (k === undefined) return cutText(`<ext ${kind}>`, max);
  const want = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : TEXT_CAP;
  return cutText(k.toText(payload, want), want);
}

/**
 * The repr of an `ext` value (section 4.6): the kind's own `repr` when it has one, else
 * `<ext KIND TEXT>`; `<ext KIND>` for an unregistered kind. `max` bounds the text part.
 */
export function extRepr(kind: string, payload: unknown, max: number = TEXT_CAP): string {
  const k = kinds.get(kind);
  if (k === undefined) return `<ext ${kind}>`;
  const want = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : TEXT_CAP;
  if (k.repr !== undefined) return cutText(k.repr(payload, want), want);
  return `<ext ${kind} ${cutText(k.toText(payload, want), want)}>`;
}

// ---------------------------------------------------------------------------------------------
// Literal tags (section 6.3). The registry only: the reader and compiler are work package X4.
// ---------------------------------------------------------------------------------------------

/** A registered tag of a tagged literal, `tag"text"`. `parse` returns the payload of `kind`. */
export interface LiteralTag {
  readonly tag: string;
  readonly kind: string;
  parse(text: string): unknown;
}

const literalTags = new Map<string, LiteralTag>();

/** Registers a literal tag. Process-wide, idempotent, last wins (as kinds). */
export function registerLiteralTag(t: LiteralTag): void {
  if (typeof t !== "object" || t === null || typeof t.tag !== "string" || !TAG_RE.test(t.tag)) {
    throw new TypeError(`registerLiteralTag: invalid tag '${String((t as LiteralTag)?.tag)}'`);
  }
  if (typeof t.kind !== "string" || !KIND_RE.test(t.kind)) {
    throw new TypeError(`registerLiteralTag: invalid kind name '${String(t.kind)}'`);
  }
  if (typeof t.parse !== "function") {
    throw new TypeError(`registerLiteralTag: tag '${t.tag}' needs a function 'parse'`);
  }
  literalTags.set(t.tag, t);
}

export function getLiteralTag(tag: string): LiteralTag | undefined {
  return literalTags.get(tag);
}

export function listLiteralTags(): readonly string[] {
  return [...literalTags.keys()];
}

// ---------------------------------------------------------------------------------------------
// The kind `null` (section 7.2)
// ---------------------------------------------------------------------------------------------

/** The one payload of every `null`: a frozen object. */
export const NULL_PAYLOAD: object = Object.freeze({});

registerCoreKind<object>({
  kind: "null",
  equals: () => true,
  sizeOf: () => 0,
  toText: (_p, max) => cutText("null", max),
  repr: (_p, max) => cutText("null", max),
});

/** The `null` value. */
export function nullValue(): Value {
  return { tag: "ext", kind: "null", v: NULL_PAYLOAD };
}

// ---------------------------------------------------------------------------------------------
// kindConformance (section 4.2, contract of `sizeOf`)
// ---------------------------------------------------------------------------------------------

/** Payloads for `kindConformance`. */
export interface KindSamples<P> {
  /** A small payload. */
  readonly small: P;
  /** A payload much larger than `small` (many more rows, characters or bytes). */
  readonly large: P;
  /** A payload that is not `equals` to `small`, for the equality checks. */
  readonly other?: P;
  /** The bytes a payload honestly holds; `sizeOf` must be at least this. */
  readonly minBytes?: (p: P) => number;
  /** A text form that `fromText` must accept and `toText` must give back, for a kind with `fromText`. */
  readonly text?: string;
}

/** Counts the property reads of a payload, to see that `sizeOf` does not walk it. */
function countReads(p: unknown, run: (probe: unknown) => unknown): number {
  if (typeof p !== "object" || p === null) {
    run(p);
    return 0;
  }
  let reads = 0;
  const probe = new Proxy(p as object, {
    get(target, key) {
      reads++;
      return Reflect.get(target, key, target) as unknown;
    },
  });
  run(probe);
  return reads;
}

/**
 * The conformance test of a kind (work package X1): returns the problems found, an empty list when
 * the kind conforms. `sizeOf` must be a non-negative integer, stable across calls, a conservative
 * upper bound (at least `minBytes`) and O(1) (the number of property reads of the payload is the same
 * for `large` as for `small`). `equals` must be reflexive and symmetric; `toText` must respect `max`
 * and end a cut text with `...`; a `fromText` must give back what `toText` wrote.
 */
export function kindConformance<P>(kind: ExtKind<P>, samples: KindSamples<P>): readonly string[] {
  const problems: string[] = [];
  const bad = (m: string): void => {
    problems.push(`${kind.kind}: ${m}`);
  };
  if (typeof kind.kind !== "string" || !KIND_RE.test(kind.kind)) bad("the kind name is not valid");
  const { small, large, other, minBytes, text } = samples;

  for (const [label, p] of [
    ["small", small],
    ["large", large],
  ] as const) {
    const a = kind.sizeOf(p);
    if (!Number.isSafeInteger(a) || a < 0)
      bad(`sizeOf(${label}) is not a non-negative integer: ${String(a)}`);
    const b = kind.sizeOf(p);
    kind.toText(p, 16);
    kind.equals(p, p);
    const c = kind.sizeOf(p);
    if (a !== b || b !== c) bad(`sizeOf(${label}) is not stable across calls (${a}, ${b}, ${c})`);
    if (minBytes !== undefined && a < minBytes(p)) {
      bad(`sizeOf(${label}) = ${a} is below the ${minBytes(p)} bytes the payload holds`);
    }
  }
  const readsSmall = countReads(small, (probe) => kind.sizeOf(probe as P));
  const readsLarge = countReads(large, (probe) => kind.sizeOf(probe as P));
  if (readsLarge > readsSmall) {
    bad(
      `sizeOf is not O(1): it read ${readsLarge} properties of the large payload, ${readsSmall} of the small one`,
    );
  }

  if (!kind.equals(small, small)) bad("equals is not reflexive");
  if (kind.equals(small, large) !== kind.equals(large, small)) bad("equals is not symmetric");
  if (other !== undefined) {
    if (kind.equals(small, other)) bad("equals says two different samples are equal");
    if (kind.equals(small, other) !== kind.equals(other, small)) bad("equals is not symmetric");
  }

  for (const p of [small, large]) {
    for (const max of [8, 16]) {
      const t = kind.toText(p, max);
      if (typeof t !== "string") bad("toText does not return a string");
      else if (t.length > max) bad(`toText(p, ${max}) returned ${t.length} code units`);
    }
    const full = kind.toText(p, TEXT_CAP);
    const cut = kind.toText(p, 8);
    if (full.length > 8 && typeof cut === "string" && !cut.endsWith("...")) {
      bad("toText does not end a cut text with '...'");
    }
  }

  if (kind.fromText !== undefined) {
    const t = text ?? kind.toText(small, TEXT_CAP);
    try {
      const back = kind.fromText(t);
      if (text === undefined && !kind.equals(back, small)) bad("fromText(toText(p)) is not p");
      if (kind.toText(back, TEXT_CAP) !== t) bad("toText(fromText(text)) is not the text");
    } catch (e) {
      bad(`fromText refused its own text form: ${(e as Error).message}`);
    }
  }
  return problems;
}
