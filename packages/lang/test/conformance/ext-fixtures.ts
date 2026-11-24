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
 * The fixtures of docs/LANGUAGE-0.3.md section 17.0: the kinds `fx-pair`, `fx-other` and `fx-big`, the
 * literal tags `pair` and `big`, and the primitives `fx:pair`, `fx:pair-a`, `fx:other`, `fx:big`,
 * `fx:charge`, `fx:spin` and `fx:media-op`.
 *
 * Most of these need features that do not exist yet (`ext` values, tagged literals, `charge`,
 * `+media`), so this file declares them as plain data and never imports `ext.ts`:
 *
 * - the kinds and tags are described by `ExtKindFixture` and `LiteralTagFixture`, which have the shape
 *   of sections 4.2 and 6.3, and `registerExtFixtures(api)` hands them to the registry functions of
 *   `ext.ts` (injected, so it can be tested with a stand-in) once per process;
 * - the primitives are built with `definePrimitive`, which does not validate, and `run.ts` keeps the
 *   ones the runtime under test accepts (it probes each with `createRuntime`).
 */
import { ForgeError } from "../../src/errors.js";
import { definePrimitive } from "../../src/primitives.js";
import type { PrimitiveDef, Value } from "../../src/types.js";

/** An `ext` Value (LANGUAGE-0.3.md section 4.1). `types.ts` does not have the variant until X1. */
export interface ExtValue {
  readonly tag: "ext";
  readonly kind: string;
  readonly v: unknown;
}

/** A Value of any tag, including `ext`, as a method sees its operands. */
export type AnyValue = Value | ExtValue;

/** Builds an `ext` Value. Registration passes the real `ext()` of `ext.ts`; the default is a plain object. */
export type MakeExt = (kind: string, payload: unknown) => ExtValue;

export const plainExt: MakeExt = (kind, payload) => ({ tag: "ext", kind, v: payload });

/** The part of `ExtKind` (section 4.2) that the fixtures use. */
export interface ExtKindFixture {
  readonly kind: string;
  equals(a: unknown, b: unknown): boolean;
  sizeOf(p: unknown): number;
  toText(p: unknown, max: number): string;
  fromText?(text: string): unknown;
  readonly methods?: Readonly<
    Record<string, (args: readonly AnyValue[], ctx: unknown) => AnyValue | undefined>
  >;
}

/** The argument of `registerLiteralTag` (section 6.3). */
export interface LiteralTagFixture {
  readonly tag: string;
  readonly kind: string;
  parse(text: string): unknown;
}

/** The registry functions of `ext.ts` that `registerExtFixtures` calls. */
export interface ExtRegistryApi {
  registerExtKind(k: ExtKindFixture): void;
  registerLiteralTag(t: LiteralTagFixture): void;
  /** The `ext(kind, payload)` builder, when the module has one. */
  ext?: MakeExt;
}

export interface PairPayload {
  readonly a: number;
  readonly b: number;
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : max <= 3 ? text.slice(0, max) : text.slice(0, max - 3) + "...";
}

function coerceError(text: string, offset: number): ForgeError {
  return new ForgeError({
    code: "E_COERCE",
    message: `not a pair: ${JSON.stringify(text)}`,
    detail: { offset },
  });
}

/**
 * `fromText` of `fx-pair`: `^-?\d+,-?\d+$`, two safe integers. `detail.offset` is the index of the
 * first character that does not fit; a text that ends too early reports its length, and an integer
 * beyond 2^53 reports the offset where that integer starts.
 */
export function parsePair(text: string): PairPayload {
  let i = 0;
  const number = (): number => {
    const start = i;
    if (text[i] === "-") i++;
    const digits = i;
    while (i < text.length && text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 57) i++;
    if (i === digits) throw coerceError(text, i);
    const n = Number(text.slice(start, i));
    if (!Number.isSafeInteger(n)) throw coerceError(text, start);
    return n;
  };
  const a = number();
  if (text[i] !== ",") throw coerceError(text, i);
  i++;
  const b = number();
  if (i !== text.length) throw coerceError(text, i);
  return { a, b };
}

function intOf(v: AnyValue | undefined): number | undefined {
  if (v === undefined || v.tag !== "int") return undefined;
  const n = Number(v.v);
  return Number.isSafeInteger(n) ? n : undefined;
}

function pairOf(v: AnyValue | undefined): PairPayload | undefined {
  return v !== undefined && v.tag === "ext" && v.kind === "fx-pair"
    ? (v.v as PairPayload)
    : undefined;
}

function safe(n: number): number {
  if (!Number.isSafeInteger(n)) {
    throw new ForgeError({ code: "E_RANGE", message: "fx-pair component beyond 2^53", detail: {} });
  }
  return n;
}

/** The kind `fx-pair` (section 17.0). */
export function pairKind(mk: MakeExt = plainExt): ExtKindFixture {
  const make = (a: number, b: number): ExtValue => mk("fx-pair", { a: safe(a), b: safe(b) });
  return {
    kind: "fx-pair",
    equals: (x, y) =>
      (x as PairPayload).a === (y as PairPayload).a &&
      (x as PairPayload).b === (y as PairPayload).b,
    sizeOf: () => 16,
    toText: (p, max) => cut(`${(p as PairPayload).a},${(p as PairPayload).b}`, max),
    fromText: parsePair,
    methods: {
      "+": ([x, y]) => {
        const px = pairOf(x);
        const py = pairOf(y);
        if (px !== undefined && py !== undefined) return make(px.a + py.a, px.b + py.b);
        const ix = intOf(x);
        const iy = intOf(y);
        if (px !== undefined && iy !== undefined) return make(px.a + iy, px.b + iy);
        if (ix !== undefined && py !== undefined) return make(py.a + ix, py.b + ix);
        return undefined;
      },
      "*": ([x, y]) => {
        const px = pairOf(x);
        const py = pairOf(y);
        const ix = intOf(x);
        const iy = intOf(y);
        if (px !== undefined && iy !== undefined) return make(px.a * iy, px.b * iy);
        if (ix !== undefined && py !== undefined) return make(py.a * ix, py.b * ix);
        return undefined; // pair * pair declines
      },
      neg: ([x]) => {
        const px = pairOf(x);
        return px === undefined ? undefined : make(-px.a, -px.b);
      },
      compare: ([x, y]) => {
        const px = pairOf(x);
        const py = pairOf(y);
        if (px === undefined || py === undefined) return undefined;
        const d = px.a !== py.a ? Math.sign(px.a - py.a) : Math.sign(px.b - py.b);
        return { tag: "int", v: d };
      },
      len: ([x]) => (pairOf(x) === undefined ? undefined : { tag: "int", v: 2 }),
      nth: ([x, i]) => {
        const px = pairOf(x);
        if (px === undefined) return undefined;
        const n = intOf(i);
        if (n === 0) return { tag: "int", v: px.a };
        if (n === 1) return { tag: "int", v: px.b };
        throw new ForgeError({
          code: "E_RANGE",
          message: "fx-pair index must be 0 or 1",
          detail: {},
        });
      },
    },
  };
}

/** The kind `fx-other` (section 17.0): no methods, no `fromText`. */
export function otherKind(): ExtKindFixture {
  return { kind: "fx-other", equals: () => true, sizeOf: () => 16, toText: () => "o" };
}

/** The kind `fx-big` (section 17.0): the payload is an integer `n`, and `sizeOf` is `n`. */
export function bigKind(): ExtKindFixture {
  return {
    kind: "fx-big",
    equals: (a, b) => a === b,
    sizeOf: (p) => p as number,
    toText: () => "big",
  };
}

/** The kinds, in registration order. */
export function extKinds(mk: MakeExt = plainExt): readonly ExtKindFixture[] {
  return [pairKind(mk), otherKind(), bigKind()];
}

/** The literal tags `pair` and `big` (section 17.0). */
export function literalTags(): readonly LiteralTagFixture[] {
  return [
    { tag: "pair", kind: "fx-pair", parse: parsePair },
    {
      tag: "big",
      kind: "fx-big",
      parse: (text) => {
        if (!/^\d+$/.test(text)) throw coerceError(text, Math.max(0, text.search(/\D/)));
        return Number(text);
      },
    },
  ];
}

const registered = new WeakSet<object>();

/**
 * Registers the kinds and tags with `api` (the exports of `ext.ts`), once per process and per module
 * instance. Registration is idempotent and the last one wins (section 4.2), so a second call would be
 * harmless; the guard only avoids the work. Returns true when it registered.
 */
export function registerExtFixtures(api: ExtRegistryApi): boolean {
  if (registered.has(api)) return false;
  registered.add(api);
  for (const k of extKinds(api.ext ?? plainExt)) api.registerExtKind(k);
  for (const t of literalTags()) api.registerLiteralTag(t);
  return true;
}

/** `ext` operands reach a primitive as the payload or as the Value; both are accepted (X1 decides). */
function payloadOf(x: unknown): unknown {
  return typeof x === "object" && x !== null && (x as { tag?: unknown }).tag === "ext"
    ? (x as ExtValue).v
    : x;
}

/** The qualified names of the primitives of section 17.0, in table order. */
export const EXT_PRIMITIVE_NAMES = [
  "fx:pair",
  "fx:pair-a",
  "fx:other",
  "fx:big",
  "fx:charge",
  "fx:spin",
  "fx:media-op",
] as const;

/** The context argument of a primitive, as far as the fixtures use it. */
interface ChargeContext {
  charge?: (n: number) => void;
}

/**
 * The primitives of section 17.0, all in vocabulary `fx`. A runtime that lacks the feature a
 * primitive needs rejects it when it is registered (a header `ext{fx-pair}`, the label `+media`) or
 * fails when it runs (no `ctx.charge`); `run.ts` handles both, and none of them loops forever
 * without `charge`.
 */
export function extPrimitives(mk: MakeExt = plainExt): readonly PrimitiveDef[] {
  const needCharge = (ctx: unknown, qname: string): ((n: number) => void) => {
    const c = (ctx as ChargeContext | undefined)?.charge;
    if (typeof c !== "function") throw new Error(`${qname} needs PrimitiveContext.charge (L8)`);
    return c;
  };
  return [
    definePrimitive(
      "fx",
      "pair",
      "( a:int b:int -- ext{fx-pair} )",
      (a, b) => mk("fx-pair", { a: Number(a), b: Number(b) }),
      { doc: "Builds an fx-pair (conformance fixture)." },
    ),
    definePrimitive(
      "fx",
      "pair-a",
      "( p:ext{fx-pair} -- int )",
      (p) => (payloadOf(p) as PairPayload).a,
      { doc: "The first component of an fx-pair (conformance fixture)." },
    ),
    definePrimitive("fx", "other", "( -- ext{fx-other} )", () => mk("fx-other", {}), {
      doc: "An fx-other value (conformance fixture).",
    }),
    definePrimitive("fx", "big", "( n:int -- ext{fx-big} )", (n) => mk("fx-big", Number(n)), {
      doc: "An fx-big of size n (conformance fixture).",
    }),
    definePrimitive(
      "fx",
      "charge",
      "( n:int -- )",
      (n, ctx) => {
        needCharge(ctx, "fx:charge")(Number(n));
      },
      { doc: "Charges n steps once (conformance fixture)." },
    ),
    definePrimitive(
      "fx",
      "spin",
      "( -- )",
      (ctx) => {
        const charge = needCharge(ctx, "fx:spin");
        for (;;) charge(0);
      },
      {
        doc: "Loops forever calling charge(0), so that only a limit stops it (conformance fixture).",
      },
    ),
    definePrimitive("fx", "media-op", "( -- int )", () => 1, {
      // `+media` is not an EffectLabel until L8; a runtime without it rejects the primitive.
      effects: ["+media"] as never,
      doc: "Returns 1 and carries the label +media (conformance fixture).",
    }),
  ];
}
