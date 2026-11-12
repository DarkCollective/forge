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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { listWords } from "./dictionary.js";
import { ForgeError } from "./errors.js";
import { definePrimitive } from "./primitives.js";
import { createRuntime } from "./runtime.js";
import type { ForgeRuntime, PrimitiveDef, RunOptions, RunResult, Value } from "./types.js";
import {
  CORE_INTRINSIC_WORDS,
  CORE_INTRINSIC_WORDS_V02,
  CORE_PRIMITIVES,
  CORE_PRIMITIVES_V02,
  CORE_RUNTIME_WORDS,
} from "./vocab/core.js";
import { PRELUDE_WORDS } from "./vocab/prelude.js";
import { bytes, int, repr, str } from "./values.js";

declare const performance: { now(): number };

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------

const spec = readFileSync(
  fileURLToPath(import.meta.url).replace(/\/packages\/lang\/src\/[^/]*$/, "") + "/docs/LANGUAGE.md",
  "utf8",
);

/** The `classical` unit of spec 15.1, extracted from the specification itself. */
const U_ROT = /```forth U-rot\n([\s\S]*?)```/.exec(spec)?.[1] as string;

const fixtures: PrimitiveDef[] = [
  definePrimitive("fx", "now", "( -- int )", () => 42, { effects: ["+time"] }),
  definePrimitive("fx", "twice", "( n:int -- int )", (n: unknown) => (n as number) * 2),
];

function make(): ForgeRuntime {
  return createRuntime({ primitives: fixtures });
}

function failure(r: RunResult): ForgeError {
  if (r.ok) throw new Error("expected a failure");
  return r.error as ForgeError;
}

const showStack = (st: readonly Value[]): string =>
  `<${st.length}>` + st.map((v) => " " + repr(v)).join("");

async function out(rt: ForgeRuntime, src: string, opts: RunOptions = {}): Promise<string> {
  const r = await rt.run(src, opts);
  if (!r.ok) throw r.error;
  return r.output;
}

// ---------------------------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------------------------

describe("createRuntime", () => {
  test("a fresh runtime has an empty user vocabulary and a complete core", () => {
    const rt = createRuntime();
    expect(rt.dictionary.vocabs()).toEqual(["core", "user"]);
    expect(listWords(rt.dictionary, "user")).toEqual([]);
    const core = listWords(rt.dictionary, "core");
    // 102 words of the v0.1 table + 21 primitives of FL 0.2 (has-key? sort, 17 maths and str>num,
    // fail-coerce fail-range) + 20 prelude words + the intrinsic `exit` (WP 6.7) + 11 intrinsics of WP 6.8.
    expect(core).toHaveLength(155);
    const expected = new Set([
      ...CORE_INTRINSIC_WORDS,
      ...CORE_PRIMITIVES.map((d) => d.name),
      ...CORE_PRIMITIVES_V02.map((d) => d.name),
      ...CORE_RUNTIME_WORDS,
      ...PRELUDE_WORDS,
      ...CORE_INTRINSIC_WORDS_V02,
      "exit",
    ]);
    expect(new Set(core)).toEqual(expected);
    expect(rt.getScope()).toEqual({ current: "user", using: [] });
    expect(rt.currentVocab()).toBe("user");
  });

  test("core words have the kinds the spec table names", () => {
    const rt = createRuntime();
    const kinds = (names: readonly string[]): string[] =>
      names.map((n) => rt.lookup(`core:${n}`).kind);
    expect(new Set(kinds(CORE_INTRINSIC_WORDS))).toEqual(new Set(["intrinsic"]));
    expect(new Set(kinds(CORE_RUNTIME_WORDS))).toEqual(new Set(["primitive"]));
    expect(rt.lookup("+").kind).toBe("primitive");
  });

  test("primitives from the options are bound under their vocabulary; registry-only ones are not", () => {
    const rt = make();
    expect(rt.lookup("fx:now").kind).toBe("primitive");
    expect(rt.registry.get("fx", "now")).toBeDefined();
    rt.registry.define(definePrimitive("fz", "thrice", "( n:int -- int )", (n: unknown) => n));
    expect(() => rt.lookup("fz:thrice")).toThrow(ForgeError);
    expect(rt.registry.get("fz", "thrice")).toBeDefined();
  });

  test("a primitive for core is bound into core", async () => {
    const rt = createRuntime({
      primitives: [definePrimitive("core", "forty-two", "( -- int )", () => 42)],
    });
    expect(await out(rt, "forty-two .")).toBe("42\n");
    expect(rt.lookup("core:forty-two").kind).toBe("primitive");
  });

  test("registering a primitive twice fails", () => {
    expect(() =>
      createRuntime({
        primitives: [definePrimitive("core", "+", "( -- int )", () => 1)],
      }),
    ).toThrow(ForgeError);
  });

  test("runtime-wide limits apply and can be overridden per run", async () => {
    const rt = createRuntime({ limits: { maxSteps: 4 } });
    expect(failure(await rt.run("1 2 3 4 5 6")).code).toBe("E_LIMIT_STEPS");
    expect((await rt.run("1 2 3 4 5 6", { limits: { maxSteps: 100 } })).ok).toBe(true);
  });

  test("separate runtimes do not share definitions", () => {
    const a = createRuntime();
    const b = createRuntime();
    a.load(": only-a ( -- int ) 1 ;");
    expect(() => b.lookup("only-a")).toThrow(ForgeError);
  });
});

// ---------------------------------------------------------------------------------------------
// load
// ---------------------------------------------------------------------------------------------

describe("load", () => {
  test("registers definitions and reports them", () => {
    const rt = createRuntime();
    const r = rt.load(": a ( -- int ) 1 ;\n: b ( -- int ) 2 ;\n3 CONSTANT c", { unit: "demo" });
    expect(r.defined).toEqual(["user:a", "user:b", "user:c"]);
    expect(r.warnings).toEqual([]);
    expect(r.scope).toEqual({ current: "user", using: [] });
    expect(rt.meta("a").source.unit).toBe("demo");
    expect(rt.meta("a").source.text).toBe(": a ( -- int ) 1 ;");
  });

  test("is atomic: an error registers nothing", () => {
    const rt = createRuntime();
    expect(() => rt.load(": a ( -- int ) 1 ;\n: b ( -- int ) nosuch ;")).toThrow(
      expect.objectContaining({ code: "E_UNDEFINED" }),
    );
    expect(() => rt.lookup("a")).toThrow(ForgeError);
    expect(rt.dictionary.vocabs()).toEqual(["core", "user"]);
  });

  test("a read error is thrown as a ForgeError", () => {
    const rt = createRuntime();
    expect(() => rt.load('"unterminated')).toThrow(expect.objectContaining({ code: "E_LEX" }));
    expect(() => rt.load("1 2 3", { scope: undefined })).toThrow(
      expect.objectContaining({ code: "E_TOPLEVEL" }),
    );
  });

  test("the source length limit comes from the runtime's limits", () => {
    const rt = createRuntime({ limits: { maxSourceChars: 10 } });
    expect(() => rt.load(": a ( -- int ) 1 ;")).toThrow(
      expect.objectContaining({ code: "E_LIMIT_SOURCE" }),
    );
  });

  test("redefinition and shadowing warnings", () => {
    const rt = createRuntime();
    rt.load(": f ( -- int ) 1 ;");
    const r = rt.load(": f ( -- int ) 2 ; : g ( len:int -- int ) len ;");
    expect(r.warnings.map((w) => w.code)).toEqual(["W_REDEFINED", "W_SHADOW"]);
    expect(r.warnings[0]?.qname).toBe("user:f");
  });

  test("trusted loads may bind registered primitives and write to core", async () => {
    const rt = make();
    rt.registry.define(definePrimitive("fz", "twice", "( n:int -- int )", (n: unknown) => n));
    expect(() => rt.load("IN: fz\nPRIMITIVE twice")).toThrow(
      expect.objectContaining({ code: "E_UNTRUSTED" }),
    );
    rt.load("IN: fz\nPRIMITIVE twice", { trusted: true });
    expect(rt.lookup("fz:twice").kind).toBe("primitive");
    rt.load("IN: core\n: my-core ( -- int ) 7 ;", { trusted: true });
    expect(await out(rt, "my-core .")).toBe("7\n");
    expect(() => rt.load("IN: core\n: other ( -- int ) 7 ;")).toThrow(
      expect.objectContaining({ code: "E_READONLY" }),
    );
  });

  test("a unit starts from the given scope and does not touch the session", () => {
    const rt = createRuntime();
    rt.load("IN: lib : helper ( -- int ) 5 ;");
    const r = rt.load(": use ( -- int ) helper ;", { scope: { current: "app", using: ["lib"] } });
    expect(r.defined).toEqual(["app:use"]);
    expect(r.scope).toEqual({ current: "app", using: ["lib"] });
    expect(rt.getScope()).toEqual({ current: "user", using: [] });
  });
});

// ---------------------------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------------------------

describe("run (console mode)", () => {
  test("definitions and code in one input, in order", async () => {
    const rt = createRuntime();
    expect(await out(rt, ": f ( -- int ) 1 ; f . : f ( -- int ) 2 ; f .")).toBe("1\n2\n");
    expect(await out(rt, "f .")).toBe("2\n");
  });

  test("a runtime error does not undo the definitions", async () => {
    const rt = createRuntime();
    const r = await rt.run(": f ( -- int ) 1 ; 1 0 div");
    expect(failure(r).code).toBe("E_DIV_ZERO");
    expect(await out(rt, "f .")).toBe("1\n");
  });

  test("a compile error returns a failed result and rolls everything back", async () => {
    const rt = createRuntime();
    const r = await rt.run(': g ( -- int ) 1 ; "never" . nosuch', { stack: [int(7)] });
    const e = failure(r);
    expect(e.code).toBe("E_UNDEFINED");
    expect(r.steps).toBe(0);
    expect(r.output).toBe("");
    expect(showStack(r.stack)).toBe("<1> 7");
    expect(r.coercions).toEqual([]);
    expect(r.effects).toEqual([]);
    expect(failure(await rt.run("g")).code).toBe("E_UNDEFINED");
  });

  test("a non-string source is a programmer error", async () => {
    const rt = createRuntime();
    await expect(rt.run(undefined as unknown as string)).rejects.toThrow(TypeError);
  });

  test("read errors are failed results too", async () => {
    const rt = createRuntime();
    expect(failure(await rt.run('"open')).code).toBe("E_LEX");
    const lim = createRuntime({ limits: { maxSourceChars: 3 } });
    expect(failure(await lim.run("1 2 3 4")).code).toBe("E_LIMIT_SOURCE");
  });

  test("a failed compile leaves the session scope unchanged", async () => {
    const rt = createRuntime();
    await rt.run("IN: demo nosuch");
    expect(rt.currentVocab()).toBe("user");
    expect(await out(rt, "current-vocab .")).toBe("user\n");
  });

  test("the session scope persists between runs", async () => {
    const rt = createRuntime();
    rt.load(U_ROT);
    await rt.run("IN: demo : x ( -- int ) 1 ;");
    expect(rt.currentVocab()).toBe("demo");
    expect(await out(rt, "x .")).toBe("1\n");
    await rt.run("USING: classical ;");
    expect(rt.getScope()).toEqual({ current: "demo", using: ["classical"] });
    expect(await out(rt, '"abc" 1 rot13 bytes>str .')).toBe("bcd\n");
    await rt.run("IN: user");
    expect(await out(rt, "current-vocab .")).toBe("user\n");
  });

  test("VOCAB sets the session's current vocabulary", async () => {
    const rt = createRuntime();
    await rt.run("VOCAB scratch");
    expect(rt.currentVocab()).toBe("scratch");
    expect(rt.dictionary.vocab("scratch")).toBeDefined();
  });

  test("an explicit scope applies to the run only", async () => {
    const rt = createRuntime();
    const o = await out(rt, "current-vocab .", { scope: { current: "other", using: [] } });
    expect(o).toBe("other\n");
    expect(rt.currentVocab()).toBe("user");
    await rt.run("IN: kept", { scope: { current: "user", using: [] } });
    expect(rt.currentVocab()).toBe("user");
  });

  test("the stack threads between runs", async () => {
    const rt = createRuntime();
    const a = await rt.run("1 2");
    const b = await rt.run("+ .s", { stack: a.stack });
    expect(b.output).toBe("<1> 3\n");
    expect(showStack(b.stack)).toBe("<1> 3");
  });

  test("each run has a fresh variable store unless one is passed", async () => {
    const rt = createRuntime();
    rt.load("0 VARIABLE n");
    await rt.run("5 n!");
    expect(await out(rt, "n .")).toBe("0\n");
    const vars = new Map<string, Value>();
    await rt.run("5 n!", { vars });
    expect(await out(rt, "n .", { vars })).toBe("5\n");
  });

  test("segments see the definitions that precede them in the input", async () => {
    const rt = createRuntime();
    expect(await out(rt, ": f ( -- int ) 1 ; f . : f ( -- int ) 2 ; f .")).toBe("1\n2\n");
  });

  test("errors in later segments keep the output of earlier ones", async () => {
    const rt = createRuntime();
    const r = await rt.run('"a" . : f ( -- int ) 1 ; "b" . 1 0 div "c" .');
    expect(failure(r).code).toBe("E_DIV_ZERO");
    expect(r.output).toBe("a\nb\n");
  });
});

// ---------------------------------------------------------------------------------------------
// call
// ---------------------------------------------------------------------------------------------

describe("call", () => {
  test("runs a word with the arguments as the initial stack", async () => {
    const rt = make();
    rt.load(": scale ( int k:int -- int ) k * ;");
    const r = await rt.call("scale", [int(6), int(7)]);
    if (!r.ok) throw r.error;
    expect(showStack(r.stack)).toBe("<1> 42");
    const q = await rt.call("core:dup", [str("x")]);
    expect(showStack(q.stack)).toBe('<2> "x" "x"');
    expect(showStack((await rt.call("+", [int(1), int(2)])).stack)).toBe("<1> 3");
    expect(showStack((await rt.call("fx:now")).stack)).toBe("<1> 42");
  });

  test("works for constants and variables too", async () => {
    const rt = createRuntime();
    rt.load("9 CONSTANT nine 4 VARIABLE v");
    expect(showStack((await rt.call("nine")).stack)).toBe("<1> 9");
    expect(showStack((await rt.call("v")).stack)).toBe("<1> 4");
    expect(showStack((await rt.call("v!", [int(1)])).stack)).toBe("<0>");
  });

  test("language errors are failed results, never rejections", async () => {
    const rt = createRuntime();
    const missing = await rt.call("nosuch", [int(1)]);
    expect(failure(missing).code).toBe("E_UNDEFINED");
    expect(showStack(missing.stack)).toBe("<1> 1");
    const under = await rt.call("dup");
    expect(failure(under).code).toBe("E_STACK_UNDERFLOW");
    expect(failure(await rt.call(":")).code).toBe("E_SYNTAX");
  });

  test("honours options", async () => {
    const rt = createRuntime();
    rt.load("IN: lib : helper ( -- int ) 5 ;");
    const r = await rt.call("helper", [], { scope: { current: "lib", using: [] } });
    expect(showStack(r.stack)).toBe("<1> 5");
    const limited = await rt.call("dup", [int(1)], { limits: { maxSteps: 1 } });
    expect(failure(limited).code).toBe("E_LIMIT_STEPS");
    const ignored = await rt.call("dup", [int(1)], { stack: [int(9), int(9), int(9)] });
    expect(showStack(ignored.stack)).toBe("<2> 1 1");
  });

  test("a call does not define anything", async () => {
    const rt = createRuntime();
    await rt.call("dup", [int(1)]);
    expect(rt.dictionary.vocabs()).toEqual(["core", "user"]);
  });

  test("bad arguments are programmer errors", async () => {
    const rt = createRuntime();
    await expect(rt.call(5 as unknown as string)).rejects.toThrow(TypeError);
    await expect(rt.call("dup", "x" as unknown as Value[])).rejects.toThrow(TypeError);
    await expect(rt.call("1 2")).rejects.toThrow(TypeError);
    await expect(rt.call("")).rejects.toThrow(TypeError);
    await expect(rt.call("two words")).rejects.toThrow(TypeError);
    await expect(rt.call('"open')).rejects.toThrow(TypeError);
    await expect(rt.call("[")).rejects.toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------------------------
// lookup, meta, scope
// ---------------------------------------------------------------------------------------------

describe("lookup, meta and the session scope", () => {
  test("lookup resolves qualified and unqualified names in the session or a given scope", () => {
    const rt = createRuntime();
    rt.load("IN: one : _hidden ( -- int ) 1 ; : shown ( -- int ) 2 ;");
    expect(rt.lookup("dup").qname).toBe("core:dup");
    expect(rt.lookup("core:dup").qname).toBe("core:dup");
    expect(rt.lookup("one:shown").qname).toBe("one:shown");
    expect(() => rt.lookup("shown")).toThrow(expect.objectContaining({ code: "E_UNDEFINED" }));
    expect(rt.lookup("shown", { current: "one", using: [] }).qname).toBe("one:shown");
    expect(rt.lookup("shown", { current: "user", using: ["one"] }).qname).toBe("one:shown");
    expect(() => rt.lookup("one:_hidden")).toThrow(expect.objectContaining({ code: "E_PRIVATE" }));
    expect(rt.lookup("one:_hidden", { current: "one", using: [] }).qname).toBe("one:_hidden");
    expect(() => rt.lookup("nosuch:x")).toThrow(expect.objectContaining({ code: "E_NO_VOCAB" }));
    expect(() => rt.lookup("one:nosuch")).toThrow(expect.objectContaining({ code: "E_UNDEFINED" }));
  });

  test("meta returns the word's metadata", () => {
    const rt = createRuntime();
    rt.load(U_ROT);
    const m = rt.meta("classical:rot");
    expect(m.effect.text).toBe("( bytes amount:int[0..25]=13 -- bytes )");
    expect(m.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rt.meta("rot").qname).toBe("core:rot");
    expect(rt.meta("rot", { current: "classical", using: [] }).qname).toBe("classical:rot");
  });

  test("setCurrentVocab creates the vocabulary and validates the name", () => {
    const rt = createRuntime();
    rt.setCurrentVocab("fresh");
    expect(rt.currentVocab()).toBe("fresh");
    expect(rt.dictionary.vocab("fresh")).toBeDefined();
    rt.setCurrentVocab("fresh");
    expect(() => rt.setCurrentVocab("bad.name")).toThrow(
      expect.objectContaining({ code: "E_NAME" }),
    );
    expect(() => rt.setCurrentVocab("core")).toThrow(
      expect.objectContaining({ code: "E_READONLY" }),
    );
    expect(rt.currentVocab()).toBe("fresh");
  });

  test("setUsing sets the imports and validates them", () => {
    const rt = createRuntime();
    rt.load("IN: one : a ( -- int ) 1 ; IN: two : b ( -- int ) 2 ;");
    rt.setUsing(["one", "two"]);
    expect(rt.getScope()).toEqual({ current: "user", using: ["one", "two"] });
    expect(rt.lookup("b").qname).toBe("two:b");
    expect(() => rt.setUsing(["nosuch"])).toThrow(expect.objectContaining({ code: "E_NO_VOCAB" }));
    expect(() => rt.setUsing(["bad name"])).toThrow(expect.objectContaining({ code: "E_NAME" }));
    expect(rt.getScope().using).toEqual(["one", "two"]);
    rt.setUsing([]);
    expect(rt.getScope().using).toEqual([]);
  });

  test("getScope returns a copy", () => {
    const rt = createRuntime();
    const s = rt.getScope();
    (s.using as string[]).push("x");
    expect(rt.getScope().using).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// help, see, words, vocabs, current-vocab
// ---------------------------------------------------------------------------------------------

describe("runtime-supplied words", () => {
  test("help and see for each kind of word", async () => {
    const rt = make();
    rt.load(U_ROT);
    rt.load(": twice ( int -- int ) 2 * ; 3 CONSTANT three 0 VARIABLE n");
    expect(await out(rt, '"dup" help .')).toBe("core:dup  ( a -- a a )\nduplicate the top\n\n");
    expect(await out(rt, '"dup" see .')).toBe("\\ intrinsic core:dup ( a -- a a )\n\n");
    expect(await out(rt, '"+" see .')).toBe("\\ primitive core:+ ( number number -- number )\n\n");
    expect(await out(rt, '"twice" see .')).toBe(": twice ( int -- int ) 2 * ;\n\n");
    expect(await out(rt, '"three" see .')).toBe("3 CONSTANT three\n\n");
    expect(await out(rt, '"n" see .')).toBe("0 VARIABLE n\n\n");
    expect(await out(rt, '"classical:rot" help "\\n" split .')).toBe(
      '{ "classical:rot  ( bytes amount:int[0..25]=13 -- bytes )" "Rotate each ASCII letter by a fixed amount; other bytes pass through." "category: Classical ciphers" "aliases: rot13" "see also: classical:atbash" "parameters:" "  amount:int[0..25]=13  -- Shift (13 = ROT13)" "" }\n',
    );
    expect(await out(rt, '"fx:now" help .')).toContain("effects: +time");
  });

  test("names are resolved in the scope of the executing segment", async () => {
    const rt = make();
    rt.load(U_ROT);
    expect(await out(rt, 'IN: classical "rot" help "\\n" split 0 nth .')).toBe(
      "classical:rot  ( bytes amount:int[0..25]=13 -- bytes )\n",
    );
    expect(await out(rt, 'IN: user "rot" help "\\n" split 0 nth .')).toBe(
      "core:rot  ( a b c -- b c a )\n",
    );
  });

  test("errors", async () => {
    const rt = createRuntime();
    expect(failure(await rt.run('"nosuch" help')).code).toBe("E_UNDEFINED");
    expect(failure(await rt.run('"nosuch:x" see')).code).toBe("E_NO_VOCAB");
    expect(failure(await rt.run('"core:nosuch" help')).code).toBe("E_UNDEFINED");
    expect(failure(await rt.run("1 help")).code).toBe("E_TYPE");
  });

  test("words and vocabs", async () => {
    const rt = createRuntime();
    rt.load(
      "IN: zed : _private ( -- int ) 1 ; : b ( -- int ) 1 ; : a ( -- int ) 2 ; : 😀 ( -- int ) 1 ; : ｚ ( -- int ) 1 ;",
    );
    expect(await out(rt, '"zed" words .')).toBe('{ "a" "b" "ｚ" "😀" }\n');
    expect(await out(rt, "vocabs .")).toBe('{ "core" "user" "zed" }\n');
    expect(await out(rt, '"core" words len .')).toBe("155\n");
    expect(await out(rt, '"user" words .')).toBe("{ }\n");
    expect(failure(await rt.run('"nosuch" words')).code).toBe("E_NO_VOCAB");
  });

  test("current-vocab follows the segment's scope", async () => {
    const rt = createRuntime();
    expect(await out(rt, "current-vocab . IN: demo current-vocab . IN: user current-vocab .")).toBe(
      "user\ndemo\nuser\n",
    );
  });
});

// ---------------------------------------------------------------------------------------------
// The worked examples of spec section 15
// ---------------------------------------------------------------------------------------------

describe("spec 15 worked examples", () => {
  test("15.1 classical:rot", async () => {
    const rt = createRuntime();
    rt.load(U_ROT);
    expect(await out(rt, '"Hello, World!" 13 classical:rot bytes>str .')).toBe("Uryyb, Jbeyq!\n");
    expect(await out(rt, '"Uryyb, Jbeyq!" 13 classical:rot bytes>str .')).toBe("Hello, World!\n");
    expect(await out(rt, '"xyz" 3 classical:rot bytes>str .')).toBe("abc\n");
  });

  test("15.1 the str is coerced at the boundary and recorded", async () => {
    const rt = createRuntime();
    rt.load(U_ROT);
    const r = await rt.run('"Hello" 13 classical:rot bytes>str .');
    if (!r.ok) throw r.error;
    expect(r.output).toBe("Uryyb\n");
    expect(r.coercions).toEqual([
      { step: 3, word: "classical:rot", slot: 0, name: null, from: "str", to: "bytes" },
    ]);
  });

  test("15.1 amount 26 is E_PARAM_INVALID before any body instruction runs", async () => {
    const rt = createRuntime();
    rt.load(U_ROT);
    const r = await rt.run('"Hello" 26 classical:rot');
    const e = failure(r);
    expect(e.code).toBe("E_PARAM_INVALID");
    expect(e.word).toBe("classical:rot");
    expect(e.vocab).toBe("classical");
    expect(e.detail).toEqual({ param: "amount", constraint: "[0..25]", value: "26" });
    // lit, lit, call: nothing of the body ran
    expect(r.steps).toBe(3);
    expect(e.step).toBe(3);
    expect(e.ip).toBe(2);
    expect(showStack(r.stack)).toBe("<2> #[ 48 65 6c 6c 6f ] 26");
  });

  test("15.1 binary input passes through untouched", async () => {
    const rt = createRuntime();
    rt.load(U_ROT);
    const r = await rt.run("#[ ff 41 ] 1 classical:rot .");
    if (!r.ok) throw r.error;
    expect(r.output).toBe("#[ ff 42 ]\n");
    expect(r.coercions).toEqual([]);
  });

  test("15.1 call with a bytes argument stack", async () => {
    const rt = createRuntime();
    rt.load(U_ROT);
    const r = await rt.call("classical:rot", [bytes(new Uint8Array([0x61])), int(1)]);
    if (!r.ok) throw r.error;
    expect(showStack(r.stack)).toBe("<1> #[ 62 ]");
  });

  test("15.2 locals", async () => {
    const rt = createRuntime();
    rt.load(": hyp2 ( a:int b:int -- int ) a a * b b * + ; : scale ( int k:int -- int ) k * ;");
    expect(await out(rt, "3 4 hyp2 . 6 7 scale .")).toBe("25\n42\n");
  });

  test("15.3 ambiguity is a compile error and nothing runs", async () => {
    const rt = createRuntime();
    rt.load('IN: alpha : greet ( -- str ) "alpha" ;');
    rt.load('IN: beta : greet ( -- str ) "beta" ;');
    const r = await rt.run('"never printed" .\nUSING: alpha beta ;\ngreet .');
    const e = failure(r);
    expect(e.code).toBe("E_AMBIGUOUS");
    expect(e.detail).toEqual({ name: "greet", candidates: ["alpha:greet", "beta:greet"] });
    expect(r.output).toBe("");
    expect(r.steps).toBe(0);
    expect(await out(rt, "alpha:greet .")).toBe("alpha\n");
  });

  test("15.4 shadowing", async () => {
    const rt = createRuntime();
    rt.load("IN: demo\n: dup ( int -- int int ) 99 ;");
    const show = async (src: string): Promise<string> => out(rt, `${src} .s clear`);
    expect(await show("IN: demo 5 dup")).toBe("<2> 5 99\n");
    expect(await show("IN: user 5 dup")).toBe("<2> 5 5\n");
    expect(await show("5 demo:dup")).toBe("<2> 5 99\n");
    expect(await show("5 core:dup")).toBe("<2> 5 5\n");
  });

  test("15.5 the limit error", async () => {
    const rt = createRuntime();
    rt.load(": spin ( -- ) [ true ] loop ;");
    const r = await rt.run("spin", { limits: { maxSteps: 1000 } });
    const e = failure(r);
    expect(e.code).toBe("E_LIMIT_STEPS");
    expect(e.word).toBe("user:spin");
    expect(e.step).toBe(1001);
    expect(e.detail).toEqual({ limit: 1000, value: 1001 });
    // not even try can catch it
    const caught = await rt.run("[ spin ] [ drop ] try", { limits: { maxSteps: 1000 } });
    expect(failure(caught).code).toBe("E_LIMIT_STEPS");
  });
});

// ---------------------------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------------------------

describe("performance", () => {
  test("a million simple steps run fast, including yields", async () => {
    const rt = createRuntime();
    // lit, prim, stack, prim, lit/jump bookkeeping: nine instructions per iteration
    const src = "0 [ 1 + dup 111112 < ] loop drop";
    await rt.run(src); // warm up the compiler caches and the JIT
    const t = performance.now();
    const r = await rt.run(src, { limits: { maxSteps: 1e9 } });
    const ms = performance.now() - t;
    if (!r.ok) throw r.error;
    expect(r.steps).toBeGreaterThanOrEqual(1_000_000);
    // The target is 200 ms (spec 10.4); the bound is lenient so that CI does not flake.
    expect(ms).toBeLessThan(1000);
  });
});
