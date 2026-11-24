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
 * The `ext` value (LANGUAGE-0.3.md section 4): the registry, equality, text forms, size, coercion,
 * the primitive boundary and the limits, plus the `kindConformance` test every kind ships. The
 * conformance blocks C401 to C428 and C458 to C461 run in test/conformance; this file covers what a
 * block cannot say, and the blocks that need a feature outside X1 (C427, C456, C457).
 */
import { describe, expect, test } from "vitest";
import { ForgeError } from "./errors.js";
import {
  CORE_EXT_KINDS,
  RESERVED_EXT_KINDS,
  ext,
  extRepr,
  extText,
  getExtKind,
  getLiteralTag,
  kindConformance,
  listExtKinds,
  listLiteralTags,
  nullValue,
  registerExtKind,
  registerLiteralTag,
} from "./ext.js";
import type { ExtKind } from "./ext.js";
import { definePrimitive } from "./primitives.js";
import { createRuntime } from "./runtime.js";
import { DEFAULT_LIMITS } from "./types.js";
import type { Limits, PrimitiveDef, RunResult, Value } from "./types.js";
import {
  coerce,
  coerceTracked,
  display,
  equals,
  int,
  list,
  record,
  repr,
  reprShort,
  sizeOf,
  str,
  validate,
} from "./values.js";

interface Pt {
  readonly x: number;
  readonly y: number;
}

/** Cuts a text the way `toText` must: at most `max` code units, a cut text ending in `...`. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  return max <= 3 ? text.slice(0, max) : text.slice(0, max - 3) + "...";
}

/** A kind with every optional member, so each path of the helpers is reached. */
const pt: ExtKind<Pt> = {
  kind: "ext-t-pt",
  equals: (a, b) => a.x === b.x && a.y === b.y,
  sizeOf: () => 16,
  toText: (p, max) => cut(`${p.x},${p.y}`, max),
  fromText: (text) => {
    const m = /^(-?\d+),(-?\d+)$/.exec(text);
    if (m === null) {
      throw new ForgeError({ code: "E_COERCE", message: "not a point", detail: { offset: 0 } });
    }
    return { x: Number(m[1]), y: Number(m[2]) };
  },
};

/** A kind with no `fromText`, a `repr` of its own and a payload whose size is its number. */
const blob: ExtKind<number> = {
  kind: "ext-t-blob",
  equals: (a, b) => a === b,
  sizeOf: (n) => n,
  toText: (n, max) => cut(`blob(${n})`, max),
  repr: (n) => `<blob of ${n}>`,
};

/** A kind with no `repr`, a one-byte payload and a long text form. */
const wide: ExtKind<number> = {
  kind: "ext-t-wide",
  equals: (a, b) => a === b,
  sizeOf: () => 1,
  toText: (_n, max) => cut("x".repeat(100), max),
};

/** A kind whose `fromText` throws something that is not a ForgeError. */
const rough: ExtKind<string> = {
  kind: "ext-t-rough",
  equals: (a, b) => a === b,
  sizeOf: () => 1,
  toText: (s) => s,
  fromText: () => {
    throw new Error("rough text");
  },
};

registerExtKind(pt);
registerExtKind(blob);
registerExtKind(rough);
registerExtKind(wide);

const P = (x: number, y: number): Value => ext("ext-t-pt", { x, y });
const B = (n: number): Value => ext("ext-t-blob", n);

const prims: readonly PrimitiveDef[] = [
  definePrimitive("t", "pt", "( x:int y:int -- ext{ext-t-pt} )", (x, y) => ({
    x: Number(x),
    y: Number(y),
  })),
  definePrimitive("t", "pt-x", "( p:ext{ext-t-pt} -- int )", (p) => (p as Pt).x),
  // No guard of its own: only the VM meter stands between a caller and a huge value.
  definePrimitive("t", "blob", "( n:int -- ext{ext-t-blob} )", (n) => Number(n)),
  definePrimitive("t", "wide", "( -- ext{ext-t-wide} )", () => 0),
  // `any` in and out: sees and returns whole Values.
  definePrimitive("t", "id", "( v:any -- any )", (v) => v),
  definePrimitive("t", "forge-unregistered", "( -- any )", () => ({
    tag: "ext",
    kind: "ext-t-nosuch",
    v: {},
  })),
  definePrimitive("t", "wrong-slot", "( -- ext{ext-t-nosuch} )", () => ({})),
  definePrimitive("t", "undef", "( -- ext{ext-t-pt} )", () => undefined),
  definePrimitive("t", "tag-of", "( v:any -- str )", (v) => {
    const x = v as { tag: string; kind?: string };
    return x.tag === "ext" ? `${x.tag}:${x.kind}` : x.tag;
  }),
];

function rt(limits?: Partial<Limits>) {
  return createRuntime({ primitives: prims, ...(limits === undefined ? {} : { limits }) });
}

async function go(src: string, limits?: Partial<Limits>): Promise<RunResult> {
  return rt(limits).run(src);
}

async function out(src: string, limits?: Partial<Limits>): Promise<string> {
  const r = await go(src, limits);
  if (!r.ok) throw r.error;
  return r.output;
}

async function fails(src: string, limits?: Partial<Limits>): Promise<ForgeError> {
  const r = await go(src, limits);
  if (r.ok) throw new Error(`expected a failure for ${src}`);
  return r.error as unknown as ForgeError;
}

function throwsOf(fn: () => unknown): ForgeError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ForgeError);
    return e as ForgeError;
  }
  throw new Error("did not throw");
}

// ---------------------------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------------------------

describe("the registry", () => {
  test("registers, finds and lists kinds", () => {
    expect(getExtKind("ext-t-pt")).toBe(pt);
    expect(getExtKind("ext-t-nosuch")).toBeUndefined();
    expect(listExtKinds()).toEqual(expect.arrayContaining(["null", "ext-t-pt", "ext-t-blob"]));
  });

  test("registration is idempotent and the last one wins", () => {
    const first: ExtKind<number> = { ...blob, kind: "ext-t-twice", toText: () => "first" };
    const second: ExtKind<number> = { ...blob, kind: "ext-t-twice", toText: () => "second" };
    registerExtKind(first);
    registerExtKind(first);
    expect(getExtKind("ext-t-twice")).toBe(first);
    registerExtKind(second);
    expect(getExtKind("ext-t-twice")).toBe(second);
    expect(listExtKinds().filter((k) => k === "ext-t-twice")).toHaveLength(1);
    expect(display(ext("ext-t-twice", 1))).toBe("second");
  });

  test("a module that is evaluated twice registers cleanly", async () => {
    // A second evaluation of ext.ts has its own registry: registering `null` again is not an error.
    const specifier = "./ext.js?second-evaluation";
    const second = (await import(/* @vite-ignore */ specifier)) as typeof import("./ext.js");
    expect(second.getExtKind("null")).toBeDefined();
    expect(() => second.registerExtKind(pt)).not.toThrow();
    expect(() => second.registerExtKind(pt)).not.toThrow();
  });

  test("a programmer error is a TypeError, not a ForgeError", () => {
    const bad = (k: unknown): void => registerExtKind(k as ExtKind);
    expect(() => bad({ ...pt, kind: "Pt" })).toThrow(TypeError);
    expect(() => bad({ ...pt, kind: "" })).toThrow(TypeError);
    expect(() => bad({ ...pt, kind: "a".repeat(65) })).toThrow(TypeError);
    expect(() => bad({ ...pt, kind: "1a" })).toThrow(TypeError);
    expect(() => bad({ ...pt, equals: undefined })).toThrow(TypeError);
    expect(() => bad({ ...pt, sizeOf: undefined })).toThrow(TypeError);
    expect(() => bad({ ...pt, toText: undefined })).toThrow(TypeError);
    expect(() => bad(null)).toThrow(TypeError);
    expect(() => registerExtKind({ ...pt, kind: "a".repeat(64) })).not.toThrow();
  });

  test("the names null and array are the language's", () => {
    expect(CORE_EXT_KINDS).toEqual(["null", "array"]);
    expect(RESERVED_EXT_KINDS).toEqual(
      expect.arrayContaining(["null", "array", "table", "relation", "relix-expr", "rat"]),
    );
    expect(() => registerExtKind({ ...pt, kind: "null" })).toThrow(/reserved/);
    expect(() => registerExtKind({ ...pt, kind: "array" })).toThrow(/reserved/);
    expect(getExtKind("null")).toBeDefined();
  });

  test("ext() builds a Value of a registered kind and refuses another", () => {
    expect(ext("ext-t-pt", { x: 1, y: 2 })).toEqual({
      tag: "ext",
      kind: "ext-t-pt",
      v: { x: 1, y: 2 },
    });
    expect(() => ext("ext-t-nosuch", {})).toThrow(TypeError);
  });

  test("literal tags: registered once per name, last wins", () => {
    registerLiteralTag({ tag: "ext-t-tag", kind: "ext-t-pt", parse: () => 1 });
    const second = { tag: "ext-t-tag", kind: "ext-t-pt", parse: () => 2 };
    registerLiteralTag(second);
    expect(getLiteralTag("ext-t-tag")).toBe(second);
    expect(listLiteralTags()).toContain("ext-t-tag");
    expect(getLiteralTag("ext-t-none")).toBeUndefined();
    expect(() => registerLiteralTag({ tag: "Bad", kind: "ext-t-pt", parse: () => 0 })).toThrow(
      TypeError,
    );
    expect(() => registerLiteralTag({ tag: "ok", kind: "Bad", parse: () => 0 })).toThrow(TypeError);
    expect(() =>
      registerLiteralTag({ tag: "ok", kind: "ext-t-pt", parse: undefined as never }),
    ).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------------------------
// Equality, text and size
// ---------------------------------------------------------------------------------------------

describe("equality (section 4.5)", () => {
  test("same kind compares payloads; other kinds and other tags are unequal, never an error", () => {
    expect(equals(P(1, 2), P(1, 2))).toBe(true);
    expect(equals(P(1, 2), P(1, 3))).toBe(false);
    expect(equals(P(1, 2), B(1))).toBe(false);
    expect(equals(P(1, 2), int(1))).toBe(false);
    expect(equals(int(1), P(1, 2))).toBe(false);
    expect(equals(nullValue(), nullValue())).toBe(true);
    expect(equals(nullValue(), int(0))).toBe(false);
    expect(equals(list([P(1, 2)]), list([P(1, 2)]))).toBe(true);
    expect(equals(record([["k", P(1, 2)]]), record([["k", P(1, 3)]]))).toBe(false);
  });

  test("an unregistered kind compares by identity of the payload", () => {
    const payload = {};
    const a: Value = { tag: "ext", kind: "ext-t-ghost", v: payload };
    expect(equals(a, { tag: "ext", kind: "ext-t-ghost", v: payload })).toBe(true);
    expect(equals(a, { tag: "ext", kind: "ext-t-ghost", v: {} })).toBe(false);
  });

  test("= and <> are not generic: they never dispatch to methods", async () => {
    expect(await out("1 2 t:pt 1 2 t:pt = . 1 2 t:pt 1 3 t:pt <> .")).toBe("true\ntrue\n");
  });
});

describe("text forms (section 4.6)", () => {
  test("display is toText; repr is the kind's own or <ext KIND TEXT>", () => {
    expect(display(P(1, 2))).toBe("1,2");
    expect(repr(P(1, 2))).toBe("<ext ext-t-pt 1,2>");
    expect(repr(B(5))).toBe("<blob of 5>");
    expect(display(B(5))).toBe("blob(5)");
    expect(repr(nullValue())).toBe("null");
    expect(display(nullValue())).toBe("null");
    expect(repr(list([P(1, 2), nullValue()]))).toBe("{ <ext ext-t-pt 1,2> null }");
    expect(repr(record([["k", P(1, 2)]]))).toBe('record{ "k": <ext ext-t-pt 1,2> }');
  });

  test("an unregistered kind prints <ext KIND>", () => {
    const ghost: Value = { tag: "ext", kind: "ext-t-ghost", v: 0 };
    expect(repr(ghost)).toBe("<ext ext-t-ghost>");
    expect(display(ghost)).toBe("<ext ext-t-ghost>");
    expect(extRepr("ext-t-ghost", 0)).toBe("<ext ext-t-ghost>");
    expect(extText("ext-t-ghost", 0)).toBe("<ext ext-t-ghost>");
  });

  test(".s cuts a long text to 80 code points", () => {
    const long = ext("ext-t-blob", 123456789);
    registerExtKind<number>({ ...wide, kind: "ext-t-long", toText: () => "x".repeat(500) });
    const v = ext("ext-t-long", 1);
    expect(reprShort(v)).toHaveLength(80);
    expect(reprShort(v).endsWith("...")).toBe(true);
    expect(reprShort(long)).toBe("<blob of 123456789>");
  });

  test("extText cuts a text the kind did not cut, and ends it with ...", () => {
    registerExtKind<number>({ ...wide, kind: "ext-t-lazy", toText: () => "abcdefghij" });
    expect(extText("ext-t-lazy", 0, 20)).toBe("abcdefghij");
    expect(extText("ext-t-lazy", 0, 8)).toBe("abcde...");
    expect(extText("ext-t-lazy", 0, 2)).toBe("ab");
    expect(extText("ext-t-lazy", 0, 0)).toBe("");
    expect(extRepr("ext-t-lazy", 0, 8)).toBe("<ext ext-t-lazy abcde...>"); // max bounds the text part
  });

  test("a cut never leaves half a surrogate pair", () => {
    registerExtKind<number>({ ...wide, kind: "ext-t-pair", toText: () => "ab\u{1f600}cdef" });
    expect(extText("ext-t-pair", 0, 6)).toBe("ab...");
  });

  test(".s and . through the VM", async () => {
    expect(await out("1 2 t:pt .s")).toBe("<1> <ext ext-t-pt 1,2>\n");
    expect(await out("1 2 t:pt .")).toBe("1,2\n");
    expect(await out("{ 1 2 t:pt 3 4 t:pt } .")).toBe(
      "{ <ext ext-t-pt 1,2> <ext ext-t-pt 3,4> }\n",
    );
  });
});

describe("size (section 4.7)", () => {
  test("sizeOf is 16 plus the kind's bound; a list adds 8 per element plus each element", () => {
    expect(sizeOf(P(1, 2))).toBe(16 + 16);
    expect(sizeOf(B(1000))).toBe(16 + 1000);
    expect(sizeOf(nullValue())).toBe(16);
    expect(sizeOf(list([B(100), B(200)]))).toBe(2 * 8 + (16 + 100) + (16 + 200));
    expect(sizeOf(record([["k", B(10)]]))).toBe(16 + 2 + 16 + 10);
    expect(sizeOf({ tag: "ext", kind: "ext-t-ghost", v: 0 })).toBe(16);
  });

  test("the VM meters a primitive that does not guard its own size (maxValueBytes)", async () => {
    expect((await fails("5000 t:blob", { maxValueBytes: 1000 })).code).toBe("E_LIMIT_VALUE");
    expect(await out("900 t:blob drop 1 .", { maxValueBytes: 1000 })).toBe("1\n");
    expect((await fails("985 t:blob", { maxValueBytes: 1000 })).code).toBe("E_LIMIT_VALUE");
    expect(await out("984 t:blob drop 1 .", { maxValueBytes: 1000 })).toBe("1\n");
  });

  test("the VM meters it against maxTotalBytes too, and a list of ext values", async () => {
    expect(
      (await fails("1000 t:blob drop 1000 t:blob drop 1000 t:blob drop", { maxTotalBytes: 3000 }))
        .code,
    ).toBe("E_LIMIT_TOTAL");
    expect((await fails("{ 600 t:blob 600 t:blob }", { maxValueBytes: 1000 })).code).toBe(
      "E_LIMIT_VALUE",
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Coercion and E_TYPE (section 4.4)
// ---------------------------------------------------------------------------------------------

describe("coerceTracked against ext{kind}", () => {
  const to = (v: Value, kind = "ext-t-pt", param: string | number = "p") =>
    coerceTracked(v, "ext", param, kind);

  test("a value of the kind passes with no coercion", () => {
    const v = P(1, 2);
    expect(to(v)).toEqual({ value: v, coercion: null });
  });

  test("a str goes through fromText and is recorded as str to ext", () => {
    const r = to(str("3,4"));
    expect(r.value).toEqual(P(3, 4));
    expect(r.coercion).toEqual({ from: "str", to: "ext" });
    expect(coerce(str("5,6"), "ext", "p", "ext-t-pt")).toEqual(P(5, 6));
  });

  test("a bad text is E_COERCE with the kind's own detail", () => {
    const e = throwsOf(() => to(str("nope")));
    expect(e.code).toBe("E_COERCE");
    expect(e.detail["offset"]).toBe(0);
    expect(e.message).toBe("not a point");
  });

  test("a fromText that throws anything else is wrapped in E_COERCE", () => {
    const e = throwsOf(() => to(str("x"), "ext-t-rough", "p"));
    expect(e.code).toBe("E_COERCE");
    expect(e.message).toMatch(/rough text/);
    expect(e.detail["param"]).toBe("p");
    const bare = throwsOf(() => coerceTracked(str("x"), "ext", undefined, "ext-t-rough"));
    expect(bare.detail).not.toHaveProperty("param");
  });

  test("another kind, another tag and a kind with no fromText are E_TYPE", () => {
    const wrongKind = throwsOf(() => to(B(1)));
    expect(wrongKind.code).toBe("E_TYPE");
    expect(wrongKind.detail).toMatchObject({
      expected: "ext{ext-t-pt}",
      actual: "ext{ext-t-blob}",
      param: "p",
    });
    const wrongTag = throwsOf(() => to(int(5)));
    expect(wrongTag.detail).toMatchObject({ expected: "ext{ext-t-pt}", actual: "int" });
    expect(throwsOf(() => to(str("o"), "ext-t-blob")).code).toBe("E_TYPE");
    expect(throwsOf(() => to(nullValue())).detail).toMatchObject({ actual: "ext{null}" });
  });

  test("an unregistered kind is E_TYPE with detail.kind and detail.reason", () => {
    for (const v of [str("x"), P(1, 2), int(1)]) {
      const e = throwsOf(() => to(v, "ext-t-nosuch"));
      expect(e.code).toBe("E_TYPE");
      expect(e.detail).toMatchObject({
        kind: "ext-t-nosuch",
        reason: "unregistered",
        expected: "ext{ext-t-nosuch}",
      });
    }
  });

  test("an ext slot with no kind is an internal error", () => {
    expect(throwsOf(() => coerceTracked(str("x"), "ext")).code).toBe("E_INTERNAL");
  });

  test("a typed slot other than ext refuses an ext value and names its kind", () => {
    const e = throwsOf(() => coerceTracked(P(1, 2), "str", "s"));
    expect(e.code).toBe("E_TYPE");
    expect(e.detail).toMatchObject({ expected: "str", actual: "ext{ext-t-pt}", param: "s" });
    expect(throwsOf(() => coerceTracked(P(1, 2), "number")).code).toBe("E_TYPE");
    expect(coerceTracked(P(1, 2), "any").coercion).toBeNull();
  });

  test("validate refuses a value of another kind and an ext value for a non-ext slot", () => {
    const slot = { name: "p", type: "ext", kind: "ext-t-pt" } as const;
    expect(() => validate(P(1, 2), slot, DEFAULT_LIMITS)).not.toThrow();
    expect(throwsOf(() => validate(B(1), slot, DEFAULT_LIMITS)).detail).toMatchObject({
      expected: "ext{ext-t-pt}",
      actual: "ext{ext-t-blob}",
    });
    expect(throwsOf(() => validate(P(1, 2), { name: "s", type: "str" }, DEFAULT_LIMITS)).code).toBe(
      "E_TYPE",
    );
  });
});

// ---------------------------------------------------------------------------------------------
// The VM: the primitive boundary, locals, containers
// ---------------------------------------------------------------------------------------------

describe("the primitive boundary (section 4.8)", () => {
  test("an ext{kind} slot receives the bare payload and returns the bare payload", async () => {
    const seen: unknown[] = [];
    const spy = definePrimitive("s", "spy", "( p:ext{ext-t-pt} -- ext{ext-t-pt} )", (p) => {
      seen.push(p);
      return p;
    });
    const r = await createRuntime({ primitives: [...prims, spy] }).run("3 4 t:pt s:spy t:pt-x .");
    expect(r.ok && r.output).toBe("3\n");
    expect(seen).toEqual([{ x: 3, y: 4 }]);
    const payload = { x: 1, y: 1 };
    const rr = await createRuntime({
      primitives: [definePrimitive("s", "mk", "( -- ext{ext-t-pt} )", () => payload)],
    }).run("s:mk");
    expect(rr.ok && rr.stack[0]).toEqual({ tag: "ext", kind: "ext-t-pt", v: payload });
  });

  test("an any slot sees and returns whole Values", async () => {
    expect(await out("1 2 t:pt t:id t:tag-of .")).toBe("ext:ext-t-pt\n");
    expect(await out("5 t:id t:tag-of .")).toBe("int\n");
  });

  test("an ext result of an any slot must name a registered kind", async () => {
    const e = await fails("t:forge-unregistered");
    expect(e.code).toBe("E_TYPE");
    expect(e.detail).toMatchObject({
      where: "result",
      kind: "ext-t-nosuch",
      reason: "unregistered",
    });
  });

  test("an ext{kind} output of an unregistered kind, or with no payload, is E_TYPE where result", async () => {
    const a = await fails("t:wrong-slot");
    expect(a.code).toBe("E_TYPE");
    expect(a.detail).toMatchObject({ where: "result", reason: "unregistered" });
    const b = await fails("t:undef");
    expect(b.code).toBe("E_TYPE");
    expect(b.detail["where"]).toBe("result");
  });

  test("a primitive input of another kind or tag is E_TYPE", async () => {
    expect((await fails("5 t:pt-x")).detail).toMatchObject({
      expected: "ext{ext-t-pt}",
      actual: "int",
    });
    expect((await fails("5 t:blob t:pt-x")).detail).toMatchObject({ actual: "ext{ext-t-blob}" });
    expect(await out('"7,8" t:pt-x .')).toBe("7\n");
  });
});

describe("containers, locals and collectors (section 4.9)", () => {
  test("an ext value is a list element, a record value, a local and a collected value", async () => {
    expect(await out("{ 1 2 t:pt 3 4 t:pt } 1 nth t:pt-x .")).toBe("3\n");
    expect(await out('{ { "k" 1 2 t:pt } } >record "k" get t:pt-x .')).toBe("1\n");
    expect(await out("[ 1 2 t:pt emit 3 4 t:pt emit ] collect len .")).toBe("2\n");
    expect(await out(": f ( p:ext{ext-t-pt} -- int ) p t:pt-x ; 8 9 t:pt f .")).toBe("8\n");
  });

  test("a list of ext values map and filter and compare", async () => {
    expect(await out("{ 1 2 t:pt 3 4 t:pt } [ t:pt-x ] map .")).toBe("{ 1 3 }\n");
    expect(await out("{ 1 2 t:pt 3 4 t:pt } 5 6 t:pt contains? .")).toBe("false\n");
    expect(await out("{ 1 2 t:pt 3 4 t:pt } 3 4 t:pt contains? .")).toBe("true\n");
  });

  test("a fork quotation may use an ext local but may not return one", async () => {
    expect(
      await out(
        ': f ( p:ext{ext-t-pt} -- str ) "a-b" "-" "+" [ drop p t:pt-x int>str ] fork ; 4 5 t:pt f .',
      ),
    ).toBe("4+4\n");
    const e = await fails(
      ': g ( p:ext{ext-t-pt} -- str ) "a-b" "-" "+" [ drop p ] fork ; 4 5 t:pt g',
    );
    expect(e.code).toBe("E_TYPE");
  });

  test("a word output of another kind is E_TYPE with where output", async () => {
    const e = await fails(": f ( -- ext{ext-t-pt} ) 5 t:blob ; f");
    expect(e.code).toBe("E_TYPE");
    expect(e.detail).toMatchObject({
      where: "output",
      expected: "ext{ext-t-pt}",
      actual: "ext{ext-t-blob}",
    });
    expect((await fails(": f ( -- ext{ext-t-pt} ) 5 ; f")).detail).toMatchObject({
      where: "output",
      actual: "int",
    });
  });

  test("a MEMO: word may return an ext value", async () => {
    const r = rt();
    r.load("MEMO: origin ( -- ext{ext-t-pt} ) 0 0 t:pt ;");
    const a = await r.run("origin t:pt-x . origin t:pt-x .");
    expect(a.ok && a.output).toBe("0\n0\n");
  });

  test("str to ext{kind} is recorded in RunResult.coercions", async () => {
    const r = rt();
    r.load("IN: u : f ( p:ext{ext-t-pt} -- int ) p t:pt-x ;");
    const res = await r.run('"3,4" u:f .');
    expect(res.ok && res.output).toBe("3\n");
    expect(res.coercions).toEqual([
      expect.objectContaining({ word: "u:f", slot: 0, name: "p", from: "str", to: "ext" }),
    ]);
    const bad = await r.run('"3;4" u:f');
    expect(!bad.ok && bad.error.code).toBe("E_COERCE");
  });

  test("runtime.call applies the same coercion to its arguments", async () => {
    const r = rt();
    r.load("IN: u : f ( p:ext{ext-t-pt} -- int ) p t:pt-x ;");
    const res = await r.call("u:f", [str("9,1")]);
    expect(res.ok && res.stack[0]).toEqual(int(9));
  });
});

// ---------------------------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------------------------

describe("ext-kind, ext>text, null and null?", () => {
  test("ext-kind and ext>text; type is ext for every ext value", async () => {
    expect(await out("1 2 t:pt type . 1 2 t:pt ext-kind . 1 2 t:pt ext>text .")).toBe(
      "ext\next-t-pt\n1,2\n",
    );
    expect((await fails("5 ext-kind")).code).toBe("E_TYPE");
    expect((await fails('"x" ext>text')).code).toBe("E_TYPE");
  });

  test("ext>text is cut at half of maxValueBytes code units", async () => {
    expect(await out("t:wide ext>text len .", { maxValueBytes: 40 })).toBe("20\n");
  });

  test("null: type, kind, equality, containers and null? (C457 to C459 without json>value)", async () => {
    expect(await out("null type . null ext-kind . null null? . 1 null? .")).toBe(
      "ext\nnull\ntrue\nfalse\n",
    );
    expect(await out('null null = . null 0 = . null "" = . null false = . { } { } = .')).toBe(
      "true\nfalse\nfalse\nfalse\ntrue\n",
    );
    expect(await out("{ null } len . null .s { null 1 } .")).toBe("1\n<1> null\n{ null 1 }\n");
    expect(await out(': f ( v:any -- bool ) v null? ; null f . 5 f . "" f . { } f .')).toBe(
      "true\nfalse\nfalse\nfalse\n",
    );
  });

  test("every typed slot refuses null (C460 and C461 and more)", async () => {
    for (const decl of [
      "n:int",
      "n:num",
      "n:number",
      "n:str",
      "n:bytes",
      "n:bool",
      "n:list",
      "n:record",
      "n:quot",
    ]) {
      const e = await fails(`: f ( ${decl} -- ) ; null f`);
      expect(e.code, decl).toBe("E_TYPE");
      expect(e.detail["actual"], decl).toBe("ext{null}");
    }
  });

  test("null adds no operation: arithmetic, ordering and sort refuse it", async () => {
    expect((await fails("null 1 +")).code).toBe("E_TYPE");
    expect((await fails("1 null <")).code).toBe("E_TYPE");
    expect((await fails("{ 1 null } sort")).code).toBe("E_TYPE");
    expect((await fails("null len")).code).toBe("E_TYPE");
  });

  test("a null is a collectable, storable value of size 16", async () => {
    expect(await out("[ null emit null emit ] collect len .")).toBe("2\n");
    expect(sizeOf(nullValue())).toBe(16);
    expect(await out(": origin ( -- any ) null ; origin null? .")).toBe("true\n");
  });
});

// ---------------------------------------------------------------------------------------------
// kindConformance
// ---------------------------------------------------------------------------------------------

describe("kindConformance", () => {
  test("the kinds of this file conform", () => {
    expect(
      kindConformance(pt, {
        small: { x: 1, y: 2 },
        large: { x: 9999999, y: -9999999 },
        other: { x: 0, y: 0 },
      }),
    ).toEqual([]);
    expect(
      kindConformance(blob, { small: 10, large: 10_000_000, other: 3, minBytes: (n) => n }),
    ).toEqual([]);
    const nullKind = getExtKind("null") as ExtKind;
    expect(kindConformance(nullKind, { small: {}, large: {} })).toEqual([]);
  });

  test("a kind with a text form checks the round trip", () => {
    expect(
      kindConformance(pt, { small: { x: 1, y: 2 }, large: { x: 3, y: 4 }, text: "7,8" }),
    ).toEqual([]);
    const lossy: ExtKind<Pt> = { ...pt, toText: () => "always" };
    const problems = kindConformance(lossy, { small: { x: 1, y: 2 }, large: { x: 3, y: 4 } });
    expect(problems.join("\n")).toMatch(/fromText refused its own text form/);
    const wrong: ExtKind<Pt> = { ...pt, fromText: () => ({ x: 0, y: 0 }) };
    expect(
      kindConformance(wrong, { small: { x: 1, y: 2 }, large: { x: 3, y: 4 } }).join("\n"),
    ).toMatch(/fromText\(toText\(p\)\) is not p/);
  });

  test("a sizeOf that walks the payload is not O(1)", () => {
    const walker: ExtKind<{ rows: readonly number[] }> = {
      kind: "ext-t-walker",
      equals: (a, b) => a === b,
      sizeOf: (p) => {
        let n = 0;
        for (let i = 0; i < p.rows.length; i++) n += p.rows[i] === undefined ? 0 : 8;
        return n;
      },
      toText: () => "w",
    };
    const problems = kindConformance(walker, {
      small: { rows: [1, 2] },
      large: { rows: Array.from({ length: 1000 }, (_v, i) => i) },
    });
    expect(problems.join("\n")).toMatch(/not O\(1\)/);
  });

  test("a sizeOf below the bytes held, unstable, or not an integer is reported", () => {
    const low: ExtKind<number> = { ...blob, kind: "ext-t-low", sizeOf: () => 1 };
    expect(kindConformance(low, { small: 10, large: 20, minBytes: (n) => n }).join("\n")).toMatch(
      /below the 10 bytes/,
    );
    let calls = 0;
    const unstable: ExtKind<number> = { ...blob, kind: "ext-t-unstable", sizeOf: () => ++calls };
    expect(kindConformance(unstable, { small: 1, large: 2 }).join("\n")).toMatch(/not stable/);
    const frac: ExtKind<number> = { ...blob, kind: "ext-t-frac", sizeOf: () => 1.5 };
    expect(kindConformance(frac, { small: 1, large: 2 }).join("\n")).toMatch(
      /not a non-negative integer/,
    );
    const neg: ExtKind<number> = { ...blob, kind: "ext-t-neg", sizeOf: () => -1 };
    expect(kindConformance(neg, { small: 1, large: 2 }).join("\n")).toMatch(
      /not a non-negative integer/,
    );
  });

  test("equals and toText faults are reported", () => {
    const loose: ExtKind<number> = { ...blob, kind: "ext-t-loose", equals: () => false };
    expect(kindConformance(loose, { small: 1, large: 2 }).join("\n")).toMatch(/not reflexive/);
    const same: ExtKind<number> = { ...blob, kind: "ext-t-same", equals: () => true };
    expect(kindConformance(same, { small: 1, large: 2, other: 3 }).join("\n")).toMatch(
      /two different samples are equal/,
    );
    const asym: ExtKind<number> = { ...blob, kind: "ext-t-asym", equals: (a, b) => a <= b };
    expect(kindConformance(asym, { small: 1, large: 2 }).join("\n")).toMatch(/not symmetric/);
    const long: ExtKind<number> = { ...blob, kind: "ext-t-longtext", toText: () => "x".repeat(40) };
    expect(kindConformance(long, { small: 1, large: 2 }).join("\n")).toMatch(
      /returned 40 code units/,
    );
    const uncut: ExtKind<number> = {
      ...blob,
      kind: "ext-t-uncut",
      toText: (_n, max) => "abcdefghijklmnop".slice(0, max),
    };
    expect(kindConformance(uncut, { small: 1, large: 2 }).join("\n")).toMatch(/'\.\.\.'/);
    const nonString: ExtKind<number> = {
      ...blob,
      kind: "ext-t-nonstring",
      toText: () => 5 as never,
    };
    expect(kindConformance(nonString, { small: 1, large: 2 }).join("\n")).toMatch(
      /does not return a string/,
    );
  });

  test("a payload that is a primitive is trivially O(1)", () => {
    expect(kindConformance(blob, { small: 1, large: 2 })).toEqual([]);
  });
});
