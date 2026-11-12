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
import { describe, expect, test } from "vitest";
import { ForgeError } from "./errors.js";
import { parseHeader } from "./meta.js";
import { definePrimitive } from "./primitives.js";
import { createRuntime } from "./runtime.js";
import type {
  AbortSignalLike,
  CompiledWord,
  ConsoleSegment,
  FlWordEntry,
  Instruction,
  PrimitiveDef,
  RunOptions,
  RunResult,
  StackEffect,
  StepEvent,
  Value,
} from "./types.js";
import { bool, int, repr, str } from "./values.js";
import { runVm } from "./vm.js";

// The package builds against ES2022 only; these are the host globals the tests use.
declare function setTimeout(callback: () => void, ms: number): unknown;
declare const performance: { now(): number };
declare class AbortController {
  readonly signal: AbortSignalLike;
  abort(): void;
}

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const FIXTURES: PrimitiveDef[] = [
  definePrimitive(
    "fx",
    "add-async",
    "( a:int b:int -- int )",
    async (a: unknown, b: unknown) => {
      await sleep(0);
      return (a as number) + (b as number);
    },
    { effects: ["+async"] },
  ),
  definePrimitive(
    "fx",
    "sleep",
    "( ms:int -- )",
    async (ms: unknown) => {
      await sleep(ms as number);
    },
    { effects: ["+async"] },
  ),
  definePrimitive("fx", "hang", "( -- )", () => new Promise<void>(() => undefined), {
    effects: ["+async"],
  }),
  definePrimitive("fx", "now", "( -- int )", () => 42, { effects: ["+time"] }),
  definePrimitive("fx", "roll", "( -- int )", () => 4, { effects: ["+random"] }),
  definePrimitive("fx", "throw", "( -- )", () => {
    throw new Error("kaput");
  }),
  definePrimitive("fx", "throw-str", "( -- )", () => {
    throw "plain string";
  }),
  definePrimitive("fx", "bad-result", "( -- int )", () => "x"),
  definePrimitive("fx", "bad-int", "( -- int )", () => 1.5),
  definePrimitive("fx", "small-big", "( -- int )", () => 5n),
  definePrimitive("fx", "reject", "( -- )", () => Promise.reject(new Error("nope")), {
    effects: ["+async"],
  }),
  definePrimitive("fx", "reject-forge", "( -- )", () =>
    Promise.reject(new ForgeError({ code: "E_RANGE", message: "from a promise" })),
  ),
  definePrimitive("fx", "detail", "( -- )", () => {
    throw new ForgeError({
      code: "E_RANGE",
      message: "odd detail",
      detail: {
        s: "text",
        i: 3,
        f: 1.5,
        b: true,
        big: 10n,
        nan: Number.NaN,
        names: ["a", "b"],
        mixed: [1, "x"],
        value: int(7),
        secret: { tag: "bytes", v: new Uint8Array([1]), secret: true },
        obj: { a: 1 },
        nothing: null,
      },
    });
  }),
  definePrimitive("fx", "pair", "( -- int int )", () => [1, 2]),
  definePrimitive("fx", "raw", "( n:int -- str )", (n: unknown) => {
    // lone surrogates cannot be written in FL source
    return ["\ud800", "\ud83da", "\udc00"][n as number];
  }),
  definePrimitive("fx", "drain", "( a:int b:int -- )", () => undefined),
];

function runtime(extra: PrimitiveDef[] = []) {
  return createRuntime({ primitives: [...FIXTURES, ...extra] });
}

async function run(src: string, opts: RunOptions = {}, rt = runtime()): Promise<RunResult> {
  return rt.run(src, opts);
}

function failure(r: RunResult): ForgeError {
  if (r.ok) throw new Error(`expected a failure, got stack ${showStack(r.stack)}`);
  return r.error as ForgeError;
}

const showStack = (st: readonly Value[]): string =>
  `<${st.length}>` + st.map((v) => " " + repr(v)).join("");

async function out(src: string, opts: RunOptions = {}, rt = runtime()): Promise<string> {
  const r = await rt.run(src, opts);
  if (!r.ok) throw r.error;
  return r.output;
}

async function stackOf(src: string, opts: RunOptions = {}, rt = runtime()): Promise<string> {
  const r = await rt.run(src, opts);
  if (!r.ok) throw r.error;
  return showStack(r.stack);
}

async function codeOf(src: string, opts: RunOptions = {}, rt = runtime()): Promise<string> {
  return failure(await rt.run(src, opts)).code;
}

const POS = { offset: 0, line: 1, col: 1 };

function effectOf(text: string): StackEffect {
  return parseHeader(text, POS, "lenient");
}

function word(code: Instruction[], effect = "-- .."): CompiledWord {
  return {
    qname: "<console>",
    effect: effectOf(effect),
    localNames: [],
    namedInputs: [],
    anonInputs: [],
    nlocals: 0,
    code,
    positions: code.map(() => POS),
    effects: [],
    deps: [],
  };
}

function seg(code: Instruction[], effect = "-- .."): ConsoleSegment {
  return { code: word(code, effect), scope: { current: "user", using: [] } };
}

// ---------------------------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------------------------

describe("literals, stack words and printing", () => {
  test("lit pushes literals of every kind", async () => {
    expect(await stackOf('1 2.5 "s" true #[ 0a ] { 1 }')).toBe('<6> 1 2.5 "s" true #[ 0a ] { 1 }');
  });

  test.each([
    ["1 2 dup", "<3> 1 2 2"],
    ["1 2 drop", "<1> 1"],
    ["1 2 swap", "<2> 2 1"],
    ["1 2 over", "<3> 1 2 1"],
    ["1 2 3 rot", "<3> 2 3 1"],
    ["1 2 3 -rot", "<3> 3 1 2"],
    ["1 2 nip", "<1> 2"],
    ["1 2 tuck", "<3> 2 1 2"],
    ["1 2 dup2", "<4> 1 2 1 2"],
    ["1 2 3 drop2", "<1> 1"],
    ["5 6 depth", "<3> 5 6 2"],
    ["5 6 clear", "<0>"],
  ])("stack word: %s", async (src, expected) => {
    expect(await stackOf(src)).toBe(expected);
  });

  test.each([
    ["drop", 1],
    ["dup", 1],
    ["nip", 2],
    ["swap", 2],
    ["over", 2],
    ["tuck", 2],
    ["dup2", 2],
    ["drop2", 2],
    ["rot", 3],
    ["-rot", 3],
  ])("%s underflows below the floor", async (name, needed) => {
    const empty = failure(await run(`${name}`));
    expect(empty.code).toBe("E_STACK_UNDERFLOW");
    expect(empty.detail).toEqual({ needed, available: 0 });
    if (needed > 1) {
      const short = failure(await run(`${"1 ".repeat(needed - 1)}${name}`));
      expect(short.detail).toEqual({ needed, available: needed - 1 });
    }
  });

  test("`.` prints the display form, `.s` the whole stack with the 80 code point cut", async () => {
    expect(await out('"hi" . 3 . { "a" 1 } .')).toBe('hi\n3\n{ "a" 1 }\n');
    expect(await out('1 "a" .s')).toBe('<2> 1 "a"\n');
    expect(await out(".s")).toBe("<0>\n");
    const long = await out('"' + "x".repeat(100) + '" .s');
    expect(long).toBe(`<1> "${"x".repeat(76)}...\n`);
  });

  test("`.` on an empty stack underflows", async () => {
    expect(await codeOf(".")).toBe("E_STACK_UNDERFLOW");
  });

  test("`.s` ignores the floor but `.` respects it", async () => {
    const rt = runtime();
    rt.load(": peek ( -- ) .s ; : bad ( -- ) . ;");
    expect(await out("1 2 peek", {}, rt)).toBe("<2> 1 2\n");
    const e = failure(await rt.run("1 bad"));
    expect(e.code).toBe("E_STACK_UNDERFLOW");
    expect(e.word).toBe("user:bad");
  });
});

describe("control instructions", () => {
  test("jump, jumpf and lowered if/when/unless", async () => {
    expect(await out('true [ "a" . ] [ "b" . ] if false [ "c" . ] [ "d" . ] if')).toBe("a\nd\n");
    expect(await out('true [ "w" . ] when false [ "w2" . ] when')).toBe("w\n");
    expect(await out('true [ "u" . ] unless false [ "u2" . ] unless')).toBe("u2\n");
  });

  test("a non-bool condition is E_TYPE", async () => {
    const e = failure(await run("1 [ ] when"));
    expect(e.code).toBe("E_TYPE");
    expect(e.detail).toMatchObject({ expected: "bool", actual: "int", where: "condition" });
    expect(await codeOf('"x" [ ] [ ] if')).toBe("E_TYPE");
    expect(await codeOf("0 [ ] unless")).toBe("E_TYPE");
  });

  test("jumpf on an empty frame underflows", async () => {
    expect(await codeOf("[ ] when")).toBe("E_STACK_UNDERFLOW");
  });

  test("callq and call", async () => {
    expect(await stackOf("[ 1 2 + ] call")).toBe("<1> 3");
    expect(await codeOf("1 call")).toBe("E_TYPE");
    expect(await codeOf("call")).toBe("E_STACK_UNDERFLOW");
  });

  test("quotations nest and see the stack", async () => {
    expect(await stackOf("1 [ 2 [ 3 ] call ] call")).toBe("<3> 1 2 3");
  });
});

describe("variables and constants", () => {
  test("varGet and varSet, per-run stores and a shared store", async () => {
    const rt = runtime();
    rt.load("5 VARIABLE counter 9 CONSTANT nine");
    expect(await stackOf("counter nine", {}, rt)).toBe("<2> 5 9");
    expect(await stackOf("7 counter! counter", {}, rt)).toBe("<1> 7");
    expect(await stackOf("counter", {}, rt)).toBe("<1> 5");
    const vars = new Map<string, Value>();
    await rt.run("8 counter!", { vars });
    expect(await stackOf("counter", { vars }, rt)).toBe("<1> 8");
    expect(vars.size).toBe(1);
  });

  test("a variable keeps its tag; no coercion", async () => {
    const rt = runtime();
    rt.load('0 VARIABLE n "a" VARIABLE s');
    const e = failure(await rt.run('"x" n!'));
    expect(e.code).toBe("E_TYPE");
    expect(e.detail).toMatchObject({ expected: "int", actual: "str" });
    expect(await codeOf("1.5 n!", {}, rt)).toBe("E_TYPE");
    expect(await codeOf("n!", {}, rt)).toBe("E_STACK_UNDERFLOW");
    expect(await stackOf('"b" s! s', {}, rt)).toBe('<1> "b"');
  });
});

describe("list literals", () => {
  test("listOpen and listClose collect values above the mark", async () => {
    expect(await stackOf("9 { 1 2 + 3 } { } { { 1 } }")).toBe("<4> 9 { 3 3 } { } { { 1 } }");
  });

  test("a list body that pops below its mark underflows", async () => {
    const e = failure(await run("1 { drop }"));
    expect(e.code).toBe("E_STACK_UNDERFLOW");
  });

  test("list literals are metered", async () => {
    expect(await codeOf("{ 1 2 3 }", { limits: { maxValueBytes: 40 } })).toBe("E_LIMIT_VALUE");
  });
});

describe("dmark and dcheck (lowered loops)", () => {
  test("a lowered while checks the condition and body depths", async () => {
    expect(await codeOf("[ true true ] [ ] while")).toBe("E_EFFECT");
    expect(await codeOf("[ true ] [ 1 ] while")).toBe("E_EFFECT");
    expect(await codeOf("[ 1 ] [ ] while")).toBe("E_TYPE");
    expect(await codeOf("[ ] loop")).toBe("E_EFFECT");
    const e = failure(await run("[ 1 true ] loop"));
    expect(e.code).toBe("E_EFFECT");
    expect(e.detail).toEqual({ expected: 1, actual: 2 });
  });
});

// ---------------------------------------------------------------------------------------------
// Combinators
// ---------------------------------------------------------------------------------------------

// Hides a quotation literal from the compiler's lowering (`swap swap` sits between it and the
// combinator), forcing the intrinsic path.
const NL = "swap swap";
// The same for a single quotation.
const NL1 = "dup drop";

describe("if, when, unless (intrinsic path)", () => {
  test("select a quotation", async () => {
    expect(await out(`true [ "a" . ] [ "b" . ] ${NL} if false [ "a" . ] [ "b" . ] ${NL} if`)).toBe(
      "a\nb\n",
    );
    expect(await out(`true [ "w" . ] ${NL} when false [ "w" . ] ${NL} when`)).toBe("w\n");
    expect(await out(`false [ "u" . ] ${NL} unless true [ "u" . ] ${NL} unless`)).toBe("u\n");
  });

  test("errors", async () => {
    expect(await codeOf(`1 [ ] [ ] ${NL} if`)).toBe("E_TYPE");
    expect(await codeOf(`true 1 [ ] ${NL} if`)).toBe("E_TYPE");
    expect(await codeOf(`true [ ] 1 if`)).toBe("E_TYPE");
    expect(await codeOf(`[ ] [ ] ${NL} if`)).toBe("E_STACK_UNDERFLOW");
    expect(await codeOf(`1 [ ] ${NL} when`)).toBe("E_TYPE");
    expect(await codeOf(`true 5 when`)).toBe("E_TYPE");
    expect(await codeOf(`[ ] ${NL1} when`)).toBe("E_STACK_UNDERFLOW");
    expect(await codeOf(`true [ ] ${NL} unless 1 [ ] ${NL} unless`)).toBe("E_TYPE");
  });
});

describe("times", () => {
  test("repeats, including zero times", async () => {
    expect(await out('3 [ "x" . ] times')).toBe("x\nx\nx\n");
    expect(await out('0 [ "x" . ] times')).toBe("");
  });

  test("errors", async () => {
    expect(await codeOf("-1 [ ] times")).toBe("E_RANGE");
    expect(await codeOf("-100000000000000000000 [ ] times")).toBe("E_RANGE");
    expect(await codeOf('"a" [ ] times')).toBe("E_TYPE");
    expect(await codeOf("3 5 times")).toBe("E_TYPE");
    expect(await codeOf("[ ] times")).toBe("E_STACK_UNDERFLOW");
    const e = failure(await run("3 [ 1 ] times"));
    expect(e.code).toBe("E_EFFECT");
    expect(e.detail).toEqual({ expected: 0, actual: 1 });
    expect(await codeOf("3 [ drop ] times")).toBe("E_STACK_UNDERFLOW");
    expect(await codeOf("1 3 [ drop ] times")).toBe("E_EFFECT");
  });

  test("a huge count runs into the step limit", async () => {
    expect(await codeOf("100000000000000000000 [ ] times", { limits: { maxSteps: 1000 } })).toBe(
      "E_LIMIT_STEPS",
    );
  });
});

describe("each, map, mapi, filter, reduce", () => {
  test("over lists", async () => {
    expect(await stackOf("{ 1 2 3 } [ 2 * ] map")).toBe("<1> { 2 4 6 }");
    expect(await stackOf("{ 5 6 } [ + ] mapi")).toBe("<1> { 5 7 }");
    expect(await stackOf("{ 1 2 3 4 } [ 2 mod 0 = ] filter")).toBe("<1> { 2 4 }");
    expect(await stackOf("{ 1 2 3 } 10 [ + ] reduce")).toBe("<1> 16");
    expect(await stackOf("0 { 1 2 3 } [ + ] each")).toBe("<1> 6");
    expect(await stackOf('{ 1 "a" } [ ] map')).toBe('<1> { 1 "a" }');
  });

  test("over bytes", async () => {
    expect(await stackOf("#[ 01 02 ] [ 1 + ] map")).toBe("<1> #[ 02 03 ]");
    expect(await stackOf("#[ 05 05 ] [ + ] mapi")).toBe("<1> #[ 05 06 ]");
    expect(await stackOf("#[ 01 02 03 ] [ 1 band 1 = ] filter")).toBe("<1> #[ 01 03 ]");
    expect(await stackOf("#[ 01 02 ] 0 [ + ] reduce")).toBe("<1> 3");
    expect(await stackOf("0 #[ 01 02 ] [ + ] each")).toBe("<1> 3");
  });

  test("over strings (elements are code points)", async () => {
    expect(await stackOf('"ab" [ 1 + ] map')).toBe('<1> "bc"');
    expect(await stackOf('"€a" [ drop 65 ] map')).toBe('<1> "AA"');
    expect(await stackOf('"a1b2" [ 97 >= ] filter')).toBe('<1> "ab"');
    expect(await stackOf('"ab" 0 [ + ] reduce')).toBe("<1> 195");
    expect(await stackOf('"ab" [ + ] mapi')).toBe('<1> "ac"');
    expect(await stackOf('0 "😀" [ + ] each')).toBe("<1> 128512");
  });

  test("empty sequences", async () => {
    expect(await stackOf("{ } [ 1 ] map")).toBe("<1> { }");
    expect(await stackOf("#[ ] [ ] map")).toBe("<1> #[ ]");
    expect(await stackOf('"" [ ] filter')).toBe('<1> ""');
    expect(await stackOf("{ } 7 [ + ] reduce")).toBe("<1> 7");
    expect(await stackOf("{ } [ drop ] each")).toBe("<0>");
  });

  test("each cannot leave extra values or eat the stack", async () => {
    expect(await codeOf("{ 1 } [ dup ] each")).toBe("E_EFFECT");
    expect(await codeOf("5 { 1 } [ drop drop ] each")).toBe("E_EFFECT");
    expect(await codeOf("{ 1 } [ ] each")).toBe("E_EFFECT");
  });

  test("map and mapi need exactly one result", async () => {
    expect(await codeOf("{ 1 } [ drop ] map")).toBe("E_EFFECT");
    expect(await codeOf("{ 1 } [ dup ] map")).toBe("E_EFFECT");
    expect(await codeOf("{ 1 } [ drop drop ] mapi")).toBe("E_EFFECT");
  });

  test("map result checks for bytes and str", async () => {
    expect(await codeOf('#[ 01 ] [ drop "x" ] map')).toBe("E_TYPE");
    expect(await codeOf("#[ 01 ] [ 256 + ] map")).toBe("E_RANGE");
    expect(await codeOf("#[ 01 ] [ drop -1 ] map")).toBe("E_RANGE");
    expect(await codeOf("#[ 01 ] [ drop 100000000000000000000 ] map")).toBe("E_RANGE");
    expect(await codeOf('"a" [ drop true ] map')).toBe("E_TYPE");
    expect(await codeOf('"a" [ drop 55296 ] map')).toBe("E_RANGE");
    expect(await codeOf('"a" [ drop 1114112 ] map')).toBe("E_RANGE");
    expect(await codeOf('"a" [ drop -5 ] map')).toBe("E_RANGE");
  });

  test("filter needs a bool", async () => {
    expect(await codeOf("{ 1 } [ ] filter")).toBe("E_TYPE");
    expect(await codeOf("{ 1 } [ drop ] filter")).toBe("E_EFFECT");
  });

  test("reduce keeps acc and element order and checks depth", async () => {
    expect(await stackOf("{ 1 2 3 } { } [ append ] reduce")).toBe("<1> { 1 2 3 }");
    expect(await codeOf("{ 1 } 0 [ drop drop ] reduce")).toBe("E_EFFECT");
  });

  test("operand errors", async () => {
    expect(await codeOf("5 [ ] map")).toBe("E_TYPE");
    expect(await codeOf("true [ ] each")).toBe("E_TYPE");
    expect(await codeOf("{ } 5 map")).toBe("E_TYPE");
    expect(await codeOf("[ ] map")).toBe("E_STACK_UNDERFLOW");
    expect(await codeOf("{ } [ ] reduce")).toBe("E_STACK_UNDERFLOW");
    expect(await codeOf("5 0 [ ] reduce")).toBe("E_TYPE");
  });

  test("map output is metered", async () => {
    expect(
      await codeOf('{ 1 2 3 } [ drop "aaaaaaaaaa" ] map', { limits: { maxValueBytes: 60 } }),
    ).toBe("E_LIMIT_VALUE");
    expect(await codeOf("#[ 01 02 03 04 ] [ ] map", { limits: { maxValueBytes: 3 } })).toBe(
      "E_LIMIT_VALUE",
    );
  });

  test("each iteration costs one extra step", async () => {
    const plain = await run("{ 1 2 3 } [ drop ] each");
    // listOpen, 3 lits, listClose, quot, comb, then 3 x (drop + ret + iteration), final ret
    expect(plain.steps).toBe(1 + 3 + 1 + 1 + 1 + 3 * 3 + 1);
  });
});

describe("while and loop (intrinsic path)", () => {
  test("repeat while the condition holds", async () => {
    expect(await stackOf(`0 [ dup 3 < ] [ 1 + ] ${NL} while`)).toBe("<1> 3");
    expect(await stackOf(`0 [ 1 + dup 5 < ] ${NL1} loop`)).toBe("<1> 5");
    expect(await stackOf(`5 [ dup 3 < ] [ 1 + ] ${NL} while`)).toBe("<1> 5");
  });

  test("depth and type checks", async () => {
    expect(await codeOf(`[ true true ] [ ] ${NL} while`)).toBe("E_EFFECT");
    expect(await codeOf(`[ 1 ] [ ] ${NL} while`)).toBe("E_TYPE");
    expect(await codeOf(`[ true ] [ 1 ] ${NL} while`)).toBe("E_EFFECT");
    expect(await codeOf(`[ ] [ ] ${NL} while`)).toBe("E_EFFECT");
    expect(await codeOf(`[ ] ${NL1} loop`)).toBe("E_EFFECT");
    expect(await codeOf(`[ 1 ] ${NL1} loop`)).toBe("E_TYPE");
    expect(await codeOf(`[ ] while`)).toBe("E_STACK_UNDERFLOW");
    expect(await codeOf(`loop`)).toBe("E_STACK_UNDERFLOW");
    expect(await codeOf(`1 [ ] while`)).toBe("E_TYPE");
    expect(await codeOf(`[ ] 1 while`)).toBe("E_TYPE");
    expect(await codeOf(`1 loop`)).toBe("E_TYPE");
  });

  test("an unbounded intrinsic loop hits the step limit with the exact step", async () => {
    const e = failure(await run(`[ true ] ${NL1} loop`, { limits: { maxSteps: 100 } }));
    expect(e.code).toBe("E_LIMIT_STEPS");
    expect(e.step).toBe(101);
    expect(e.detail).toEqual({ limit: 100, value: 101 });
  });
});

describe("try", () => {
  test("a body that completes skips the handler; the snapshot is restored on error", async () => {
    expect(await stackOf("[ 7 ] [ drop 0 ] try")).toBe("<1> 7");
    expect(await stackOf('1 2 [ 3 4 "x" fail ] [ drop ] try')).toBe("<2> 1 2");
    expect(await stackOf('1 [ 2 "x" fail ] [ "message" get ] try')).toBe('<2> 1 "x"');
  });

  test("the error record", async () => {
    expect(await out('[ 1 0 div ] [ "code" get . ] try')).toBe("E_DIV_ZERO\n");
    expect(await out('[ "boom" fail ] [ "message" get . ] try')).toBe("boom\n");
    expect(await out('[ "boom" fail ] [ "word" get . ] try')).toBe("core:fail\n");
    expect(await out('[ "boom" fail ] [ "vocab" get . ] try')).toBe("core\n");
    expect(await out('[ drop ] [ "detail" get "needed" get . ] try')).toBe("1\n");
    expect(await out('[ drop ] [ "detail" get "available" get . ] try')).toBe("0\n");
  });

  test("word and vocab of a user word, and of console code", async () => {
    const rt = runtime();
    rt.load(": f ( -- ) drop ;");
    expect(await out('[ f ] [ "word" get . ] try', {}, rt)).toBe("user:f\n");
    expect(await out('[ f ] [ "vocab" get . ] try', {}, rt)).toBe("user\n");
    expect(await out('[ drop ] [ "word" get . ] try', {}, rt)).toBe("<console>\n");
    expect(await out('[ drop ] [ "vocab" get . ] try', {}, rt)).toBe("user\n");
  });

  test("detail values keep their tags; anything else becomes its repr", async () => {
    const r = await run('[ fx:detail ] [ "detail" get ] try');
    if (!r.ok) throw r.error;
    const rec = r.stack[0] as Extract<Value, { tag: "record" }>;
    const get = (k: string): string => repr(rec.v.get(k) as Value);
    expect(get("s")).toBe('"text"');
    expect(get("i")).toBe("3");
    expect(get("f")).toBe("1.5");
    expect(get("b")).toBe("true");
    expect(get("big")).toBe("10");
    expect(get("nan")).toBe('"NaN"');
    expect(get("names")).toBe('{ "a" "b" }');
    expect(get("mixed")).toBe('"[1, x]"');
    expect(get("value")).toBe('"7"');
    expect(get("secret")).toBe('"\\"<redacted>\\""');
    expect(get("obj")).toBe('"[object Object]"');
    expect(get("nothing")).toBe('"null"');
  });

  test("the handler is not protected; an outer try catches it", async () => {
    expect(await codeOf('[ 1 0 div ] [ drop "x" fail ] try')).toBe("E_USER");
    expect(await out('[ [ 1 0 div ] [ drop "x" fail ] try ] [ "code" get . ] try')).toBe(
      "E_USER\n",
    );
  });

  test("catchable codes are caught", async () => {
    const cases: [string, string][] = [
      ["1 0 div", "E_DIV_ZERO"],
      ['"a" 1 +', "E_TYPE"],
      ["drop", "E_STACK_UNDERFLOW"],
      ["{ 1 } 5 nth", "E_RANGE"],
      ['"x" fail', "E_USER"],
      ["fx:throw", "E_PRIMITIVE"],
      ["fx:reject", "E_PRIMITIVE"],
      ["fx:reject-forge", "E_RANGE"],
      ["fx:bad-result", "E_TYPE"],
      ["[ 1 ] 3 swap times", "E_EFFECT"],
      ['"x" str>int', "E_COERCE"],
      ["3 [ 1 ] times", "E_EFFECT"],
    ];
    for (const [body, code] of cases) {
      expect(await out(`[ ${body} ] [ "code" get . ] try`)).toBe(`${code}\n`);
    }
  });

  test("a rejected promise that is not a ForgeError is E_PRIMITIVE with a cause", async () => {
    const e = failure(await run("fx:reject"));
    expect(e.code).toBe("E_PRIMITIVE");
    expect(e.message).toBe("nope");
    expect(e.cause).toBeInstanceOf(Error);
    const s = failure(await run("fx:throw-str"));
    expect(s.code).toBe("E_PRIMITIVE");
    expect(s.message).toBe("plain string");
  });

  test("uncatchable codes propagate straight out", async () => {
    // E_LIMIT_*
    expect(await codeOf("[ [ true ] loop ] [ drop ] try", { limits: { maxSteps: 500 } })).toBe(
      "E_LIMIT_STEPS",
    );
    const grower = runtime();
    grower.load(": grow ( -- .. ) 1 recurse ;");
    expect(await codeOf("[ grow ] [ drop ] try", { limits: { maxDataDepth: 50 } }, grower)).toBe(
      "E_LIMIT_STACK",
    );
    expect(
      await codeOf('[ "abcdefgh" 10 [ dup cat ] times ] [ drop ] try', {
        limits: { maxValueBytes: 100 },
      }),
    ).toBe("E_LIMIT_VALUE");
    expect(
      await codeOf('[ "abcdefgh" 10 [ dup cat ] times ] [ drop ] try', {
        limits: { maxTotalBytes: 100 },
      }),
    ).toBe("E_LIMIT_TOTAL");
    expect(
      await codeOf('[ "hello world" . ] [ drop ] try', { limits: { maxOutputBytes: 5 } }),
    ).toBe("E_LIMIT_OUTPUT");
    // E_FORBIDDEN
    expect(await codeOf("[ fx:now ] [ drop ] try", { deny: ["+time"] })).toBe("E_FORBIDDEN");
    // E_ABORTED (hook stop) and E_INTERNAL (hook failure)
    expect(await codeOf("[ 1 drop ] [ drop ] try", { stepAll: true, onStep: () => "stop" })).toBe(
      "E_ABORTED",
    );
    expect(
      await codeOf("[ 1 drop ] [ drop ] try", {
        stepAll: true,
        onStep: () => {
          throw new Error("hook broke");
        },
      }),
    ).toBe("E_INTERNAL");
  });

  test("unbounded recursion inside a try is E_LIMIT_RETURN, not caught", async () => {
    const rt = runtime();
    rt.load(": r ( -- .. ) recurse ;");
    expect(await codeOf("[ r ] [ drop ] try", {}, rt)).toBe("E_LIMIT_RETURN");
  });

  test("operand errors", async () => {
    expect(await codeOf("[ ] try")).toBe("E_STACK_UNDERFLOW");
    expect(await codeOf("1 [ ] try")).toBe("E_TYPE");
    expect(await codeOf("[ ] 1 try")).toBe("E_TYPE");
  });

  test("return stack exhaustion when entering a try", async () => {
    expect(await codeOf("[ ] [ ] try", { limits: { maxReturnDepth: 2 } })).toBe("E_LIMIT_RETURN");
    expect(await stackOf("[ 1 ] [ ] try", { limits: { maxReturnDepth: 3 } })).toBe("<1> 1");
  });

  test("try inside a word restores that word's stack only", async () => {
    const rt = runtime();
    rt.load(": safe ( a:int b:int -- int ) [ a b div ] [ drop 0 ] try ;");
    expect(await stackOf("10 2 safe 10 0 safe", {}, rt)).toBe("<2> 5 0");
  });

  test("a try body cannot pop below the stack at try entry", async () => {
    expect(await stackOf("1 [ drop ] [ drop ] try")).toBe("<1> 1");
    const r = await run("1 [ drop ] [ ] try");
    if (!r.ok) throw r.error;
    expect(r.stack.map((v) => v.tag)).toEqual(["int", "record"]);
  });
});

describe("fork", () => {
  test("splits, maps and joins str data", async () => {
    expect(await stackOf('"a,b,c" "," "-" [ upper ] fork')).toBe('<1> "A-B-C"');
    expect(await stackOf('"a,b" ", " "+" [ ] fork')).toBe('<1> "a,b"');
    expect(await stackOf('"a, b, c" ", " "+" [ ] fork')).toBe('<1> "a+b+c"');
  });

  test("bytes data", async () => {
    expect(await stackOf('#[ 61 2c 62 ] "," "-" [ ] fork')).toBe("<1> #[ 61 2d 62 ]");
    expect(await stackOf("#[ 61 2c 62 ] #[ 2c ] #[ ] [ ] fork")).toBe("<1> #[ 61 62 ]");
    expect(await stackOf('#[ 01 01 01 ] #[ 01 01 ] "!" [ ] fork')).toBe("<1> #[ 21 01 ]");
  });

  test("empty data, trailing separators and overlapping separators", async () => {
    expect(await stackOf('"" "," "-" [ ] fork len')).toBe("<1> 0");
    expect(await stackOf('"a," "," "-" [ ] fork')).toBe('<1> "a-"');
    expect(await stackOf('"aaa" "aa" "-" [ ] fork')).toBe('<1> "-a"');
    expect(await stackOf('"" "," "-" [ "x" cat ] fork')).toBe('<1> "x"');
    expect(await stackOf('#[ ] "," "-" [ ] fork')).toBe("<1> #[ ]");
  });

  test("separator, joiner and results are coerced to the data's tag", async () => {
    expect(await stackOf('"a,b" "," "-" [ str>bytes ] fork')).toBe('<1> "a-b"');
    expect(await stackOf('"a,b" #[ 2c ] #[ 2d ] [ ] fork')).toBe('<1> "a-b"');
    expect(await stackOf('#[ 61 2c 62 ] "," "-" [ bytes>str ] fork')).toBe("<1> #[ 61 2d 62 ]");
  });

  test("errors", async () => {
    expect(await codeOf('"a" "" "-" [ ] fork')).toBe("E_RANGE");
    expect(await codeOf('"a" #[ ] "-" [ ] fork')).toBe("E_RANGE");
    expect(await codeOf('5 "," "-" [ ] fork')).toBe("E_TYPE");
    expect(await codeOf('"a" 5 "-" [ ] fork')).toBe("E_TYPE");
    expect(await codeOf('"a" "," 5 [ ] fork')).toBe("E_TYPE");
    expect(await codeOf('"a" "," "-" 5 fork')).toBe("E_TYPE");
    expect(await codeOf('"a" #[ ff ] "-" [ ] fork')).toBe("E_COERCE");
    expect(await codeOf('"a,b" "," "-" [ drop 5 ] fork')).toBe("E_TYPE");
    expect(await codeOf('"a,b" "," "-" [ drop #[ ff ] ] fork')).toBe("E_COERCE");
    expect(await codeOf('"a,b" "," "-" [ drop ] fork')).toBe("E_EFFECT");
    expect(await codeOf('"a" "," "-" fork')).toBe("E_STACK_UNDERFLOW");
  });

  test("the result is metered", async () => {
    expect(
      await codeOf('"a,b,c,d,e,f" "," "----------" [ ] fork', { limits: { maxValueBytes: 30 } }),
    ).toBe("E_LIMIT_VALUE");
    expect(
      await codeOf('#[ 61 2c 62 ] "," "-------------" [ ] fork', { limits: { maxValueBytes: 10 } }),
    ).toBe("E_LIMIT_VALUE");
  });
});

// ---------------------------------------------------------------------------------------------
// Words: entry and exit, floor, closures
// ---------------------------------------------------------------------------------------------

describe("word entry", () => {
  test("named inputs are consumed into locals, anonymous inputs stay (coerced)", async () => {
    const rt = runtime();
    rt.load(`
      : hyp ( a:int b:int -- int ) a a * b b * + ;
      : scale ( int k:int -- int ) k * ;
      : _mix ( x:int bytes y:int -- bytes ) x y + drop ;
      : same ( str -- str ) ;
    `);
    expect(await stackOf("3 4 hyp 6 7 scale", {}, rt)).toBe("<2> 25 42");
    expect(await stackOf('1 "A" 2 _mix', {}, rt)).toBe("<1> #[ 41 ]");
    expect(await stackOf('"x" same', {}, rt)).toBe('<1> "x"');
  });

  test("coercions are recorded with the callee, slot and step", async () => {
    const rt = runtime();
    rt.load(": f ( bytes n:int -- int ) drop n ;");
    const r = await rt.run('"hi" 2.0 f');
    if (!r.ok) throw r.error;
    expect(r.coercions).toEqual([
      { step: 3, word: "user:f", slot: 0, name: null, from: "str", to: "bytes" },
      { step: 3, word: "user:f", slot: 1, name: "n", from: "num", to: "int" },
    ]);
    expect(showStack(r.stack)).toBe("<1> 2");
  });

  test("the callee is the word of an entry error, with the caller's ip and position", async () => {
    const rt = runtime();
    rt.load(": f ( n:int[0..5] -- int ) n ;");
    const e = failure(await rt.run("1 2 drop\n  9 f"));
    expect(e.code).toBe("E_PARAM_INVALID");
    expect(e.word).toBe("user:f");
    expect(e.vocab).toBe("user");
    expect(e.detail).toMatchObject({ param: "n", constraint: "[0..5]", value: "9" });
    expect(e.ip).toBe(4);
    expect(e.pos).toMatchObject({ line: 2, col: 5 });
    expect(e.frames[0]).toEqual({ word: "<console>", ip: 4 });
  });

  test("precedence: slot by slot, deepest first", async () => {
    const rt = runtime();
    rt.load(": f ( a:int[0..5] b:int -- int ) a b + ;");
    // slot 0 violates its constraint; slot 1 has a type error: slot 0 wins
    expect(await codeOf('9 "x" f', {}, rt)).toBe("E_PARAM_INVALID");
    expect(await codeOf('1 "x" f', {}, rt)).toBe("E_TYPE");
    expect(await codeOf("1 2.5 f", {}, rt)).toBe("E_COERCE");
  });

  test("underflow of the whole input list comes first", async () => {
    const rt = runtime();
    rt.load(": f ( a:int b:int -- int ) a b + ;");
    const e = failure(await rt.run("1 f"));
    expect(e.code).toBe("E_STACK_UNDERFLOW");
    expect(e.word).toBe("user:f");
    expect(e.detail).toEqual({ needed: 2, available: 1 });
  });

  test("the underflow check is relative to the caller's floor", async () => {
    const rt = runtime();
    rt.load(": g ( a:int b:int -- int ) a b + ; : h ( -- int ) 1 g ;");
    const e = failure(await rt.run("5 h"));
    expect(e.code).toBe("E_STACK_UNDERFLOW");
    expect(e.word).toBe("user:g");
    expect(e.detail).toEqual({ needed: 2, available: 1 });
  });

  test("a primitive input underflow names the primitive", async () => {
    const e = failure(await run("1 +"));
    expect(e.code).toBe("E_STACK_UNDERFLOW");
    expect(e.word).toBe("core:+");
    expect(e.vocab).toBe("core");
    expect(e.detail).toEqual({ needed: 2, available: 1 });
  });

  test("an uncompiled word is an internal error", async () => {
    const entry = { qname: "user:ghost", code: null } as unknown as FlWordEntry;
    const r = await runVm([seg([{ op: "call", entry }, { op: "ret" }])]);
    expect(failure(r).code).toBe("E_INTERNAL");
  });
});

describe("word exit", () => {
  test("depth check then output tag check", async () => {
    const rt = runtime();
    rt.load(`
      : none ( int -- int ) drop ;
      : two ( -- int ) 1 2 ;
      : lie ( -- int ) "x" ;
      : lie2 ( -- str int ) 1 "x" ;
      : both ( -- int ) "x" "y" ;
      : num ( -- number ) 1.5 ;
      : any1 ( -- any ) "x" ;
    `);
    const none = failure(await rt.run("5 none"));
    expect(none.code).toBe("E_EFFECT");
    expect(none.detail).toEqual({ expected: 1, actual: 0 });
    expect(none.word).toBe("user:none");
    expect(failure(await rt.run("two")).detail).toEqual({ expected: 1, actual: 2 });
    const lie = failure(await rt.run("lie"));
    expect(lie.code).toBe("E_TYPE");
    expect(lie.detail).toMatchObject({ expected: "int", actual: "str", where: "output" });
    expect(await codeOf("lie2", {}, rt)).toBe("E_TYPE");
    // a depth error wins over a tag error
    expect(await codeOf("both", {}, rt)).toBe("E_EFFECT");
    expect(await stackOf("num any1", {}, rt)).toBe('<2> 1.5 "x"');
  });

  test("unchecked output (-- ..) skips the depth check", async () => {
    const rt = runtime();
    rt.load(": spill ( -- .. ) 1 2 3 ; : apply ( q:quot -- .. ) q call ;");
    expect(await stackOf("spill", {}, rt)).toBe("<3> 1 2 3");
    expect(await stackOf("[ 4 5 ] apply", {}, rt)).toBe("<2> 4 5");
  });

  test("hand-built: unchecked outputs are tag-checked only when that many values exist", async () => {
    const eff: StackEffect = {
      inputs: [],
      outputs: [{ name: null, type: "int" }],
      unchecked: true,
      variadicInput: false,
      text: "( -- int .. )",
    };
    const callee = (code: Instruction[]): FlWordEntry =>
      ({
        qname: "user:u",
        vocab: "user",
        kind: "fl",
        code: { ...word(code), qname: "user:u", effect: eff },
      }) as unknown as FlWordEntry;
    const one: Instruction = { op: "lit", value: str("x") };
    const bad = await runVm([
      seg([{ op: "call", entry: callee([one, { op: "ret" }]) }, { op: "ret" }]),
    ]);
    expect(failure(bad).code).toBe("E_TYPE");
    const none = await runVm([
      seg([{ op: "call", entry: callee([{ op: "ret" }]) }, { op: "ret" }]),
    ]);
    expect(none.ok).toBe(true);
  });

  test("recursion and bigint results", async () => {
    const rt = runtime();
    rt.load(": fact ( n:int -- int ) n 2 < [ 1 ] [ n n 1 - recurse * ] if ;");
    expect(await stackOf("25 fact", {}, rt)).toBe("<1> 15511210043330985984000000");
  });
});

describe("the frame floor", () => {
  test("a word cannot pop below its own frame", async () => {
    const rt = runtime();
    rt.load(": eat ( -- ) drop ; : inner ( -- ) clear ; : count ( -- int ) depth ;");
    const e = failure(await rt.run("1 eat"));
    expect(e.code).toBe("E_STACK_UNDERFLOW");
    expect(e.word).toBe("user:eat");
    expect(await stackOf("5 6 count 1 2 inner", {}, rt)).toBe("<5> 5 6 0 1 2");
  });

  test("depth and clear are floor-relative; .s is not", async () => {
    const rt = runtime();
    rt.load(": f ( int -- int int ) depth ; : g ( -- ) 7 8 clear ; : p ( -- ) .s ;");
    expect(await stackOf("5 6 f", {}, rt)).toBe("<3> 5 6 1");
    expect(await stackOf("1 2 g", {}, rt)).toBe("<2> 1 2");
    expect(await out("1 2 p", {}, rt)).toBe("<2> 1 2\n");
  });

  test("a quotation runs above the floor of its word", async () => {
    const rt = runtime();
    rt.load(": f ( -- int ) [ depth ] call ; : g ( int -- int int ) [ depth ] call ;");
    expect(await stackOf("9 f", {}, rt)).toBe("<2> 9 0");
    expect(await stackOf("9 g", {}, rt)).toBe("<2> 9 1");
  });

  test("a try body sets a floor at the stack depth of try entry", async () => {
    expect(await out("1 2 [ depth . ] [ ] try")).toBe("0\n");
    expect(await out("1 2 [ 3 depth . drop ] [ ] try")).toBe("1\n");
    expect(await stackOf("1 2 [ clear 9 ] [ ] try")).toBe("<3> 1 2 9");
    // the handler has the same floor
    expect(await stackOf('1 [ "x" fail ] [ drop clear 5 ] try')).toBe("<2> 1 5");
    expect(await codeOf('1 [ "x" fail ] [ drop drop ] try')).toBe("E_STACK_UNDERFLOW");
  });

  test("a word called inside a try has its own floor, restored on return", async () => {
    const rt = runtime();
    rt.load(": f ( -- int ) depth ;");
    expect(await stackOf("1 [ 2 f 3 depth ] [ ] try", {}, rt)).toBe("<5> 1 2 0 3 3");
  });

  test("list literals can collect values from below their mark only by underflowing", async () => {
    expect(await codeOf("1 2 { drop drop }")).toBe("E_STACK_UNDERFLOW");
  });
});

describe("closures", () => {
  test("a quotation captures its word's locals and outlives it", async () => {
    const rt = runtime();
    rt.load(`
      : adder ( n:int -- quot ) [ n + ] ;
      : nest ( a:int b:int -- quot ) [ [ a b + ] call ] ;
    `);
    expect(await stackOf("5 10 adder call", {}, rt)).toBe("<1> 15");
    expect(await stackOf("3 4 nest call", {}, rt)).toBe("<1> 7");
    expect(await stackOf("1 adder 2 adder 10 swap call", {}, rt)).toBe("<2> <quot> 12");
  });

  test("each call of a word gets a fresh locals array", async () => {
    const rt = runtime();
    rt.load(": mk ( n:int -- quot ) [ n ] ;");
    expect(await stackOf("1 mk 2 mk swap call swap call", {}, rt)).toBe("<2> 1 2");
  });

  test("closures stored in lists and invoked from combinators", async () => {
    const rt = runtime();
    rt.load(": mk ( n:int -- quot ) [ n * ] ;");
    expect(await stackOf("{ 1 2 3 } 10 mk map", {}, rt)).toBe("<1> { 10 20 30 }");
    expect(await stackOf("{ } 2 mk append 3 mk append [ 5 swap call ] map", {}, rt)).toBe(
      "<1> { 10 15 }",
    );
  });

  test("a quotation created inside a quotation sees the same locals", async () => {
    const rt = runtime();
    rt.load(": f ( a:int -- int ) [ [ a ] call ] call ;");
    expect(await stackOf("7 f", {}, rt)).toBe("<1> 7");
  });

  test("console quotations have an empty environment", async () => {
    expect(await stackOf("5 [ dup * ] call")).toBe("<1> 25");
  });
});

// ---------------------------------------------------------------------------------------------
// Error enrichment
// ---------------------------------------------------------------------------------------------

describe("error context", () => {
  test("word, vocab, step, ip, pos, frames and snapshot", async () => {
    const rt = runtime();
    rt.load(": inner ( -- ) 1 0 div ;\n: outer ( -- ) inner ;");
    const e = failure(await rt.run("7 outer"));
    expect(e.code).toBe("E_DIV_ZERO");
    expect(e.word).toBe("core:div");
    expect(e.vocab).toBe("core");
    expect(e.step).toBeGreaterThan(0);
    expect(e.frames.map((f) => f.word)).toEqual(["user:inner", "user:outer", "<console>"]);
    expect(e.frames[0]?.ip).toBe(2);
    expect(e.frames[1]?.ip).toBe(0);
    expect(e.ip).toBe(2);
    expect(e.pos).toMatchObject({ line: 1, col: 20 });
    expect(e.stackSnapshot.map(repr)).toEqual(["7", "1", "0"]);
  });

  test("code inside a quotation reports the word that contains it", async () => {
    const rt = runtime();
    rt.load(": f ( -- ) [ drop ] call ;");
    const e = failure(await rt.run("f"));
    expect(e.word).toBe("user:f");
    expect(e.frames.map((f) => f.word)).toEqual(["user:f", "user:f", "<console>"]);
  });

  test("the snapshot is the top 16 values and the frames are all of them up to 64", async () => {
    const rt = runtime();
    rt.load(": d ( n:int -- ) n 0 > [ n 1 - recurse ] [ 0 0 div ] if ;");
    const e = failure(await rt.run("1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 20 d"));
    expect(e.stackSnapshot).toHaveLength(16);
    expect(e.frames).toHaveLength(22);
    expect(e.framesSkipped).toBe(0);
  });

  test("a 200-deep error keeps the innermost 32 and outermost 32 frames", async () => {
    const rt = runtime();
    rt.load(": d ( n:int -- ) n 0 > [ n 1 - recurse ] [ 0 0 div ] if ;");
    const e = failure(await rt.run("200 d"));
    expect(e.frames).toHaveLength(64);
    expect(e.framesSkipped).toBeGreaterThan(0);
    expect(e.frames[0]?.word).toBe("user:d");
    expect(e.frames[63]?.word).toBe("<console>");
    expect(e.toJSON().framesSkipped).toBe(e.framesSkipped);
  });

  test("the outermost word frame survives a deep error", async () => {
    const rt = runtime();
    rt.load(": d ( n:int -- ) n 0 > [ n 1 - recurse ] [ 0 0 div ] if ;");
    rt.load(": main ( -- ) 150 d ;");
    const e = failure(await rt.run("main"));
    expect(e.framesSkipped).toBeGreaterThan(0);
    expect(e.frames.some((f) => f.word === "user:main")).toBe(true);
  });

  test("a non-ForgeError thrown by a hook is E_INTERNAL with a cause", async () => {
    const e = failure(
      await run("1", {
        stepAll: true,
        onStep: () => {
          throw new TypeError("oops");
        },
      }),
    );
    expect(e.code).toBe("E_INTERNAL");
    expect(e.cause).toBeInstanceOf(TypeError);
    expect(e.message).toContain("oops");
  });

  test("a hook that throws a non-Error value", async () => {
    const e = failure(
      await run("1", {
        stepAll: true,
        onStep: () => {
          throw "bare";
        },
      }),
    );
    expect(e.code).toBe("E_INTERNAL");
    expect(e.message).toContain("bare");
  });

  test("an error before any frame exists (oversized initial stack)", async () => {
    const r = await run("", {
      stack: [int(1), int(2), int(3)],
      limits: { maxDataDepth: 2 },
    });
    const e = failure(r);
    expect(e.code).toBe("E_LIMIT_STACK");
    expect(e.word).toBeNull();
    expect(e.step).toBe(0);
    expect(r.stack).toHaveLength(3);
  });

  test("a zero return-depth limit fails at the first frame", async () => {
    expect(await codeOf("1", { limits: { maxReturnDepth: 0 } })).toBe("E_LIMIT_RETURN");
  });
});

// ---------------------------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------------------------

describe("primitives", () => {
  test("async results are awaited", async () => {
    expect(await stackOf("2 3 fx:add-async")).toBe("<1> 5");
    expect(await out("2 3 fx:add-async fx:now + .")).toBe("47\n");
  });

  test("multiple results", async () => {
    expect(await stackOf("fx:pair")).toBe("<2> 1 2");
    expect(await stackOf("1 2 fx:drain")).toBe("<0>");
  });

  test("results are normalised and checked", async () => {
    expect(await stackOf("fx:small-big 5 =")).toBe("<1> true");
    const e = failure(await run("fx:bad-result"));
    expect(e.code).toBe("E_TYPE");
    expect(e.detail).toMatchObject({ where: "result" });
    expect(await codeOf("fx:bad-int")).toBe("E_TYPE");
  });

  test("errors keep the primitive as their word", async () => {
    const e = failure(await run("fx:throw"));
    expect(e.code).toBe("E_PRIMITIVE");
    expect(e.word).toBe("fx:throw");
    expect(e.vocab).toBe("fx");
  });

  test("the primitive context carries the run's limits and the segment's scope", async () => {
    let seen: { maxSteps: number; scope: string } | null = null;
    const probe = definePrimitive("fx", "probe", "( -- )", (ctx: unknown) => {
      const c = ctx as { limits: { maxSteps: number }; scope: { current: string } };
      seen = { maxSteps: c.limits.maxSteps, scope: c.scope.current };
    });
    const rt = runtime([probe]);
    await rt.run("IN: demo fx:probe", { limits: { maxSteps: 77 } });
    expect(seen).toEqual({ maxSteps: 77, scope: "demo" });
  });

  test("the value limit is checked on every result", async () => {
    expect(await codeOf('"abcd" dup cat', { limits: { maxValueBytes: 10 } })).toBe("E_LIMIT_VALUE");
  });

  test("the data stack limit applies to primitive results", async () => {
    expect(await codeOf("fx:pair", { limits: { maxDataDepth: 1 } })).toBe("E_LIMIT_STACK");
  });
});

describe("effects and deny", () => {
  test("RunResult.effects is the sorted union of labels actually called", async () => {
    const r = await run("fx:roll fx:now + drop 1 2 fx:add-async drop");
    if (!r.ok) throw r.error;
    expect(r.effects).toEqual(["+async", "+random", "+time"]);
    const none = await run("[ fx:now ] drop 1");
    if (!none.ok) throw none.error;
    expect(none.effects).toEqual([]);
  });

  test("denied labels raise E_FORBIDDEN naming the primitive", async () => {
    const e = failure(await run("fx:now", { deny: ["+time"] }));
    expect(e.code).toBe("E_FORBIDDEN");
    expect(e.word).toBe("fx:now");
    expect(e.detail).toEqual({ effect: "+time" });
    expect(await stackOf("fx:now", { deny: ["+random"] })).toBe("<1> 42");
    expect(await stackOf("1 2 +", { deny: ["+time"] })).toBe("<1> 3");
    expect(await codeOf("1 2 fx:add-async", { deny: ["+async"] })).toBe("E_FORBIDDEN");
    const none = await run("fx:now", { deny: [] });
    expect(none.ok).toBe(true);
  });

  test("a denied primitive does not count as called", async () => {
    const r = await run("fx:now", { deny: ["+time"] });
    expect(r.effects).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------------------------

describe("resource limits", () => {
  test("steps: counted before the instruction, with the exact step", async () => {
    const rt = runtime();
    rt.load(": spin ( -- ) [ true ] loop ;");
    const e = failure(await rt.run("spin", { limits: { maxSteps: 1000 } }));
    expect(e.code).toBe("E_LIMIT_STEPS");
    expect(e.word).toBe("user:spin");
    expect(e.step).toBe(1001);
    expect(e.detail).toEqual({ limit: 1000, value: 1001 });
  });

  test("steps: a run of exactly maxSteps succeeds", async () => {
    const r = await run("1 2 +", { limits: { maxSteps: 4 } });
    expect(r.ok).toBe(true);
    expect(r.steps).toBe(4);
    expect(await codeOf("1 2 +", { limits: { maxSteps: 3 } })).toBe("E_LIMIT_STEPS");
  });

  test("data stack depth", async () => {
    const rt = runtime();
    rt.load(": grow ( -- .. ) 1 recurse ; : f ( n:int -- int ) n ;");
    expect(await codeOf("grow", { limits: { maxDataDepth: 100 } }, rt)).toBe("E_LIMIT_STACK");
    const lim = (n: number) => ({ limits: { maxDataDepth: n } });
    expect(await codeOf("1 2 3", lim(2))).toBe("E_LIMIT_STACK");
    expect(await codeOf("1 dup dup", lim(2))).toBe("E_LIMIT_STACK");
    expect(await codeOf("1 2 over over", lim(3))).toBe("E_LIMIT_STACK");
    expect(await codeOf("1 2 depth", lim(2))).toBe("E_LIMIT_STACK");
    expect(await codeOf("1 2 tuck", lim(2))).toBe("E_LIMIT_STACK");
    expect(await codeOf("1 2 dup2", lim(3))).toBe("E_LIMIT_STACK");
    expect(await codeOf("1 f 2", lim(1), rt)).toBe("E_LIMIT_STACK");
    expect(await codeOf("{ }", lim(0))).toBe("E_LIMIT_STACK");
    expect(await codeOf("fx:pair", lim(1))).toBe("E_LIMIT_STACK");
    expect(await codeOf("#[ 01 ] [ ] map 1", lim(1))).toBe("E_LIMIT_STACK");
    const vars = runtime();
    vars.load("1 VARIABLE v : get ( -- int ) v ;");
    expect(await codeOf("1 get", lim(1), vars)).toBe("E_LIMIT_STACK");
    vars.load(": loc ( a:int -- int int ) a a ;");
    expect(await codeOf("1 loc", lim(1), vars)).toBe("E_LIMIT_STACK");
  });

  test("return stack depth counts calls, quotations, loops, try and list frames", async () => {
    const rt = runtime();
    rt.load(": down ( n:int -- ) n 0 > [ n 1 - recurse ] when ;");
    expect(await codeOf("1000000 down", {}, rt)).toBe("E_LIMIT_RETURN");
    expect(await stackOf("100 down 1", { limits: { maxReturnDepth: 200 } }, rt)).toBe("<1> 1");
    const lim = (n: number) => ({ limits: { maxReturnDepth: n } });
    expect(await codeOf("[ [ [ 1 ] call ] call ] call", lim(3))).toBe("E_LIMIT_RETURN");
    expect(await codeOf("{ { { 1 } } }", lim(3))).toBe("E_LIMIT_RETURN");
    expect(await codeOf("{ 1 } [ ] each", lim(2))).toBe("E_LIMIT_RETURN");
    expect(await codeOf("#[ 01 ] [ ] each", lim(1))).toBe("E_LIMIT_RETURN");
    expect(await codeOf(`true [ ] [ ] ${NL} if`, lim(1))).toBe("E_LIMIT_RETURN");
    expect(await codeOf("[ true ] loop", lim(1))).toBe("E_LIMIT_RETURN");
    expect(await codeOf("[ ] [ ] swap swap while", lim(2))).toBe("E_LIMIT_RETURN");
  });

  test("value and total byte limits", async () => {
    expect(
      await codeOf('"abcdefgh" 10 [ dup cat ] times', { limits: { maxValueBytes: 1000 } }),
    ).toBe("E_LIMIT_VALUE");
    expect(
      await codeOf('"abcdefgh" 10 [ dup cat ] times', { limits: { maxTotalBytes: 100 } }),
    ).toBe("E_LIMIT_TOTAL");
    const e = failure(
      await run('"abcdefgh" 10 [ dup cat ] times', { limits: { maxTotalBytes: 100 } }),
    );
    expect(e.detail).toEqual({ limit: 100, value: 224 });
  });

  test("metering sizes per tag", async () => {
    // int 8, num 8, bool 1, bytes length, str 2/char; the total accumulates across results
    const r = await run("1 1 + 1.5 1.5 + true true and #[ 01 02 ] #[ 03 ] cat", {
      limits: { maxTotalBytes: 8 + 8 + 1 + 3 },
    });
    expect(r.ok).toBe(true);
    expect(await codeOf("1 1 +", { limits: { maxTotalBytes: 7 } })).toBe("E_LIMIT_TOTAL");
    expect(await codeOf("1.5 1.5 +", { limits: { maxTotalBytes: 7 } })).toBe("E_LIMIT_TOTAL");
    expect(await codeOf("true not", { limits: { maxTotalBytes: 0 } })).toBe("E_LIMIT_TOTAL");
    expect(await codeOf('"ab" "c" cat', { limits: { maxTotalBytes: 5 } })).toBe("E_LIMIT_TOTAL");
    expect(await codeOf("#[ 01 ] #[ 02 ] cat", { limits: { maxTotalBytes: 1 } })).toBe(
      "E_LIMIT_TOTAL",
    );
    // bigint ints are sized by their bit length, lists by element
    expect(await codeOf("2 100 pow", { limits: { maxTotalBytes: 12 } })).toBe("E_LIMIT_TOTAL");
    expect(await codeOf("{ 1 2 } { 3 } cat", { limits: { maxValueBytes: 20 } })).toBe(
      "E_LIMIT_VALUE",
    );
  });

  test("maxIntBits is enforced by the primitives through the context", async () => {
    expect(await codeOf("2 200 pow", { limits: { maxIntBits: 100 } })).toBe("E_LIMIT_VALUE");
  });

  test("output limit counts UTF-8 bytes and drops the offending write", async () => {
    const r = await run('"héllo" . "€" . "😀" . "x" .', { limits: { maxOutputBytes: 17 } });
    expect(failure(r).code).toBe("E_LIMIT_OUTPUT");
    expect(r.output).toBe("héllo\n€\n😀\n");
    const ok = await run('"héllo" . "€" . "😀" .', { limits: { maxOutputBytes: 16 } });
    expect(ok.ok).toBe(true);
  });

  test("lone surrogates count as three bytes of output", async () => {
    const lim = (n: number) => ({ limits: { maxOutputBytes: n } });
    // a high surrogate at the end, a high surrogate before a non-surrogate, a low surrogate
    expect((await run("0 fx:raw .", lim(4))).ok).toBe(true);
    expect(await codeOf("0 fx:raw .", lim(3))).toBe("E_LIMIT_OUTPUT");
    expect((await run("1 fx:raw .", lim(5))).ok).toBe(true);
    expect(await codeOf("1 fx:raw .", lim(4))).toBe("E_LIMIT_OUTPUT");
    expect((await run("2 fx:raw .", lim(4))).ok).toBe(true);
    expect(await codeOf("2 fx:raw .", lim(3))).toBe("E_LIMIT_OUTPUT");
  });

  test("the error carries limit and value", async () => {
    const e = failure(await run('"hello world" .', { limits: { maxOutputBytes: 10 } }));
    expect(e.detail).toEqual({ limit: 10, value: 12 });
  });
});

// ---------------------------------------------------------------------------------------------
// Cancellation and time
// ---------------------------------------------------------------------------------------------

describe("cancellation and time", () => {
  test("an already aborted signal stops the run before the first instruction", async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await run("1 2 +", { signal: ac.signal });
    expect(failure(r).code).toBe("E_ABORTED");
    expect(r.steps).toBe(0);
  });

  test("an already set abort flag stops the run", async () => {
    const flag = new Int32Array(1);
    flag[0] = 1;
    const r = await run("1", { abortFlag: flag });
    expect(failure(r).code).toBe("E_ABORTED");
    flag[0] = 0;
    expect((await run("1", { abortFlag: flag })).ok).toBe(true);
  });

  test("the signal is polled every 1024 steps", async () => {
    const polls: number[] = [];
    let aborted = false;
    const signal: AbortSignalLike = {
      get aborted() {
        polls.push(1);
        return aborted;
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    // 0 + 1 + 1 + ... in a counted loop: a few thousand steps
    const r = await run("0 [ 1 + dup 400 < ] loop", { signal });
    expect(r.ok).toBe(true);
    expect(polls.length).toBe(1 + Math.floor(r.steps / 1024));
    aborted = true;
    polls.length = 0;
    const r2 = await run("0 [ 1 + dup 4000 < ] loop", { signal });
    expect(failure(r2).code).toBe("E_ABORTED");
  });

  test("abort during a synchronous loop is seen at a yield or poll", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 20);
    const r = await run("[ true ] loop", {
      signal: ac.signal,
      limits: { maxSteps: 1e12, maxMillis: 60_000 },
    });
    expect(failure(r).code).toBe("E_ABORTED");
  });

  test("the abort flag set from a timer is seen at the next poll", async () => {
    const flag = new Int32Array(1);
    setTimeout(() => {
      flag[0] = 1;
    }, 20);
    const r = await run("[ true ] loop", {
      abortFlag: flag,
      limits: { maxSteps: 1e12, maxMillis: 60_000 },
      yieldEvery: 4096,
    });
    expect(failure(r).code).toBe("E_ABORTED");
  });

  test("wall-clock limit", async () => {
    const r = await run("[ true ] loop", { limits: { maxMillis: 30, maxSteps: 1e12 } });
    const e = failure(r);
    expect(e.code).toBe("E_LIMIT_TIME");
    expect(e.detail.limit).toBe(30);
    expect(typeof e.detail.value).toBe("number");
  });

  test("an abort signal wins against an async primitive", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 20);
    const t = performance.now();
    const r = await run("60000 fx:sleep", { signal: ac.signal });
    expect(failure(r).code).toBe("E_ABORTED");
    expect(performance.now() - t).toBeLessThan(5000);
    expect(r.effects).toEqual(["+async"]);
  });

  test("the deadline wins against an async primitive", async () => {
    const t = performance.now();
    const r = await run("fx:hang", { limits: { maxMillis: 30 } });
    expect(failure(r).code).toBe("E_LIMIT_TIME");
    expect(performance.now() - t).toBeLessThan(5000);
  });

  test("a primitive that finishes in time is unaffected by the race", async () => {
    const ac = new AbortController();
    expect(await stackOf("1 fx:sleep 2 3 fx:add-async", { signal: ac.signal })).toBe("<1> 5");
  });

  test("a rejected promise loses nothing: the error is raised once", async () => {
    const r = await run("fx:reject", { limits: { maxMillis: 5000 } });
    expect(failure(r).code).toBe("E_PRIMITIVE");
  });

  test("yieldEvery lets timers run during a long run; zero disables yielding", async () => {
    for (const [yieldEvery, expected] of [
      [50_000, true],
      [0, false],
    ] as const) {
      let fired = false;
      setTimeout(() => {
        fired = true;
      }, 1);
      const probe = definePrimitive("fx", "fired", "( -- bool )", () => fired);
      const r = await run(
        "0 [ 1 + dup 60000 < ] loop drop fx:fired",
        {
          yieldEvery,
          limits: { maxSteps: 1e9 },
        },
        runtime([probe]),
      );
      if (!r.ok) throw r.error;
      expect(showStack(r.stack)).toBe(`<1> ${String(expected)}`);
      await sleep(5);
    }
  });

  test("abort listeners are added per awaited call and removed after it", async () => {
    let added = 0;
    let removed = 0;
    const signal: AbortSignalLike = {
      aborted: false,
      addEventListener: () => {
        added++;
      },
      removeEventListener: () => {
        removed++;
      },
    };
    await run("1 fx:sleep 1 fx:sleep", { signal });
    expect([added, removed]).toEqual([2, 2]);
    await run("1 2 +", { signal });
    expect([added, removed]).toEqual([2, 2]);
  });

  test("a signal already aborted when a paused hook starts waiting stops the run", async () => {
    const ac = new AbortController();
    const r = await run("1 2 +", {
      signal: ac.signal,
      stepAll: true,
      onStep: () => {
        ac.abort();
        return new Promise<void>(() => undefined);
      },
    });
    expect(failure(r).code).toBe("E_ABORTED");
  });
});

// ---------------------------------------------------------------------------------------------
// Hooks, breakpoints and trace
// ---------------------------------------------------------------------------------------------

describe("hooks, breakpoints and trace", () => {
  test("stepAll calls the hook before every instruction", async () => {
    const events: StepEvent[] = [];
    const seen: string[] = [];
    const r = await run("1 2 +", {
      stepAll: true,
      onStep: (e) => {
        events.push({ ...e, stack: e.stack.slice() });
        seen.push(`${e.step}:${e.word}:${e.ip}:${e.op}:${e.stack.length}:${e.returnDepth}`);
      },
    });
    expect(r.ok).toBe(true);
    expect(seen).toEqual([
      "1:<console>:0:lit:0:1",
      "2:<console>:1:lit:1:1",
      "3:<console>:2:prim:2:1",
      "4:<console>:3:ret:1:1",
    ]);
    expect(events[0]?.pos).toMatchObject({ line: 1, col: 1 });
    expect(events[0]?.breakpoint).toBe(false);
  });

  test("no hook without stepAll or breakpoints", async () => {
    let n = 0;
    await run("1 2 +", {
      onStep: () => {
        n++;
      },
    });
    expect(n).toBe(0);
    await run("1 2 +", {
      breakpoints: [{ word: "nosuch:word" }],
      onStep: () => {
        n++;
      },
    });
    expect(n).toBe(0);
  });

  test("breakpoints at an ip and on word entry; quotations belong to their word", async () => {
    const rt = runtime();
    rt.load(": f ( int -- int ) 1 + ; : g ( -- ) [ 1 drop ] call ;");
    const hits: string[] = [];
    const r = await rt.run("1 f drop g", {
      breakpoints: [{ word: "user:f" }, { word: "user:f", ip: 1 }, { word: "user:g", ip: 1 }],
      onStep: (e) => {
        if (e.breakpoint) hits.push(`${e.word} ${e.ip} ${e.op}`);
      },
    });
    expect(r.ok).toBe(true);
    expect(hits).toEqual(["user:f 0 lit", "user:f 1 prim", "user:g 1 lit"]);
  });

  test("a hook may be async (pausing) and may stop the run", async () => {
    let paused = 0;
    const r = await run("1 2 +", {
      stepAll: true,
      onStep: async () => {
        paused++;
        await sleep(1);
      },
    });
    expect(r.ok).toBe(true);
    expect(paused).toBe(4);
    const stopped = await run("1 2 +", {
      stepAll: true,
      onStep: async (e) => {
        await sleep(0);
        return e.step === 2 ? "stop" : undefined;
      },
    });
    const e = failure(stopped);
    expect(e.code).toBe("E_ABORTED");
    expect(e.message).toBe("stopped by hook");
  });

  test("time paused in a hook is not charged to the wall clock", async () => {
    const r = await run("1 2 +", {
      limits: { maxMillis: 40 },
      yieldEvery: 1,
      stepAll: true,
      onStep: async (e) => {
        if (e.step === 1) await sleep(80);
      },
    });
    expect(r.ok).toBe(true);
  });

  test("abort wins while a hook is paused", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 10);
    const r = await run("1 2 +", {
      signal: ac.signal,
      stepAll: true,
      onStep: () => new Promise<void>(() => undefined),
    });
    expect(failure(r).code).toBe("E_ABORTED");
  });

  test("a rejecting async hook is an internal error", async () => {
    const r = await run("1", {
      stepAll: true,
      onStep: () => Promise.reject(new Error("pause failed")),
    });
    expect(failure(r).code).toBe("E_INTERNAL");
  });

  test("the hook sees a live view of the stack", async () => {
    const tops: string[] = [];
    await run("1 2 +", {
      stepAll: true,
      onStep: (e) => {
        tops.push(e.stack.length === 0 ? "-" : repr(e.stack[e.stack.length - 1] as Value));
      },
    });
    expect(tops).toEqual(["-", "1", "2", "3"]);
  });

  test("trace records every instruction with a shallow copy of the top 16 values", async () => {
    const r = await run("1 2 + .", { trace: true });
    if (!r.ok) throw r.error;
    expect(r.trace?.map((t) => `${t.step}:${t.ip}:${t.op}:${t.depth}`)).toEqual([
      "1:0:lit:0",
      "2:1:lit:1",
      "3:2:prim:2",
      "4:3:print:1",
      "5:4:ret:0",
    ]);
    expect(r.trace?.[2]?.stack.map(repr)).toEqual(["1", "2"]);
    expect(r.traceTruncated).toBeUndefined();
    const deep = await run("1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 +", { trace: true });
    if (!deep.ok) throw deep.error;
    expect(deep.trace?.[18]?.stack).toHaveLength(16);
  });

  test("the trace is bounded by maxTraceEntries", async () => {
    const r = await run("1 2 + .", { trace: true, limits: { maxTraceEntries: 2 } });
    if (!r.ok) throw r.error;
    expect(r.trace).toHaveLength(2);
    expect(r.traceTruncated).toBe(true);
    const off = await run("1 2 +");
    expect(off.trace).toBeUndefined();
  });

  test("coercion records are bounded too", async () => {
    const rt = runtime();
    rt.load(": f ( bytes -- bytes ) ;");
    const r = await rt.run('"a" f "b" f "c" f', { limits: { maxTraceEntries: 2 } });
    if (!r.ok) throw r.error;
    expect(r.coercions).toHaveLength(2);
    expect(r.traceTruncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------------------------

describe("redaction of key-typed values", () => {
  const keyed = (): ReturnType<typeof runtime> => {
    const r = runtime();
    r.load(`
      : usekey ( bytes k:key{hex}[4] -- bytes ) k bxor ;
      : leak ( k:key{hex} -- ) k .s drop k . ;
      : hold ( k:key{hex} -- int ) k 1 0 div ;
      : wrap ( k:key{hex} -- list ) { k } ;
      : boom ( k:key{hex} -- ) wrap 1 0 div ;
      : reveal ( k:key{hex} -- str ) k bytes>hex ;
      : other ( a:int[0..5] k:key{hex} -- int ) a ;
    `);
    return r;
  };

  test("a failed entry reports <redacted> as the value and in the snapshot", async () => {
    const e = failure(await keyed().run('"data" #[ 01 02 ] usekey'));
    expect(e.code).toBe("E_PARAM_INVALID");
    expect(e.detail).toMatchObject({ param: "k", value: "<redacted>" });
    // the data slot was coerced before the key slot failed
    expect(e.stackSnapshot.map(repr)).toEqual(["#[ 64 61 74 61 ]", '"<redacted>"']);
    expect(JSON.stringify(e.toJSON())).not.toContain("01 02");
  });

  test("the key slot is redacted even when another slot fails", async () => {
    const e = failure(await keyed().run("9 #[ aa bb ] other"));
    expect(e.code).toBe("E_PARAM_INVALID");
    expect(e.stackSnapshot.map(repr)).toEqual(["9", '"<redacted>"']);
  });

  test(".s and . print <redacted>", async () => {
    expect(await out("#[ aa bb ] leak", {}, keyed())).toBe("<1> <redacted>\n<redacted>\n");
  });

  test("traces never contain the key bytes", async () => {
    const res = await keyed().run('"abcd" #[ 01 01 01 01 ] usekey bytes>hex .', { trace: true });
    if (!res.ok) throw res.error;
    expect(res.output).toBe("60636265\n");
    // inside the word that binds the key (before that, the key is an ordinary literal)
    const inside = res.trace?.filter((t) => t.word === "user:usekey") ?? [];
    expect(inside.length).toBeGreaterThan(0);
    const all = inside.flatMap((t) => t.stack.map(repr));
    expect(all.join(" ")).not.toContain("01 01 01 01");
    expect(all).toContain('"<redacted>"');
  });

  test("a later error with the secret still on the stack redacts it", async () => {
    const e = failure(await keyed().run("#[ aa bb ] hold"));
    expect(e.code).toBe("E_DIV_ZERO");
    const shown = e.stackSnapshot.map(repr).join(" ");
    expect(shown).not.toContain("aa bb");
    expect(shown).toContain("<redacted>");
  });

  test("a secret nested in a list is redacted", async () => {
    const e = failure(await keyed().run("#[ aa bb ] boom"));
    expect(e.stackSnapshot.map(repr).join(" ")).not.toContain("aa bb");
  });

  test("it is a safety net, not a boundary: words can still read the bytes", async () => {
    expect(await stackOf("#[ aa bb ] reveal", {}, keyed())).toBe('<1> "aabb"');
  });
});

// ---------------------------------------------------------------------------------------------
// Internal invariants (hand-built code, not reachable from compiled source)
// ---------------------------------------------------------------------------------------------

describe("internal invariants", () => {
  test("running off the end of the code", async () => {
    const r = await runVm([seg([{ op: "lit", value: int(1) }])]);
    expect(failure(r).code).toBe("E_INTERNAL");
  });

  test("dcheck without dmark, listClose without listOpen", async () => {
    expect(failure(await runVm([seg([{ op: "dcheck", delta: 0 }])])).code).toBe("E_INTERNAL");
    expect(failure(await runVm([seg([{ op: "listClose" }])])).code).toBe("E_INTERNAL");
    expect(failure(await runVm([seg([{ op: "dmark" }, { op: "listClose" }])])).code).toBe(
      "E_INTERNAL",
    );
  });

  test("ret with a bookkeeping frame still on the return stack", async () => {
    const r = await runVm([seg([{ op: "dmark" }, { op: "ret" }])]);
    expect(failure(r).code).toBe("E_INTERNAL");
  });

  test("segments run in order on one stack, and a failing segment stops the run", async () => {
    const a = seg([{ op: "lit", value: int(1) }, { op: "ret" }]);
    const b = seg([{ op: "lit", value: int(2) }, { op: "ret" }]);
    const bad = seg([{ op: "stack", word: "drop2" }, { op: "ret" }]);
    const r = await runVm([a, b]);
    expect(showStack(r.stack)).toBe("<2> 1 2");
    const stopped = await runVm([a, bad, b]);
    expect(failure(stopped).code).toBe("E_STACK_UNDERFLOW");
    expect(showStack(stopped.stack)).toBe("<1> 1");
  });

  test("no segments: the initial stack comes back", async () => {
    const r = await runVm([], { stack: [int(4), str("x")] });
    expect(showStack(r.stack)).toBe('<2> 4 "x"');
    expect(r.steps).toBe(0);
  });

  test("the caller's stack option is copied, not mutated", async () => {
    const initial = [int(1)];
    await runVm([seg([{ op: "stack", word: "dup" }, { op: "ret" }])], { stack: initial });
    expect(initial).toHaveLength(1);
  });

  test("jumpf in hand-built code", async () => {
    const bad = await runVm([
      seg([
        { op: "lit", value: int(1) },
        { op: "jumpf", target: 0 },
      ]),
    ]);
    expect(failure(bad).code).toBe("E_TYPE");
    const taken = await runVm([
      seg([
        { op: "lit", value: bool(false) },
        { op: "jumpf", target: 3 },
        { op: "lit", value: int(1) },
        { op: "ret" },
      ]),
    ]);
    expect(taken.ok).toBe(true);
    expect(taken.stack).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Mid-body locals `:>` and `exit` (LANGUAGE-0.2.md sections 8 and 11.5)
// ---------------------------------------------------------------------------------------------

describe(":> mid-body locals", () => {
  test("bound names read back; header locals, anonymous inputs and bound locals mix", async () => {
    expect(await out(": sq ( int -- int ) :> x x x * ; 7 sq .")).toBe("49\n");
    expect(await out(": f ( -- int ) 1 2 :> b :> a a 10 * b + ; f .")).toBe("12\n");
    // `int` in the middle stays on the stack in its place; `t` is bound after the header locals.
    expect(await out(": _f ( a:int int b:int -- int int ) :> t a b + t ; 1 10 100 _f . .")).toBe(
      "10\n101\n",
    );
  });

  test("each call has its own locals, also under recursion", async () => {
    const src = ": fact ( n:int -- int ) n 2 < [ 1 ] [ n 1 - recurse :> r n r * ] if ; 6 fact .";
    expect(await out(src)).toBe("720\n");
  });

  test("bind is one step and pops like any word", async () => {
    const rt = runtime();
    await rt.run(": f ( int -- int ) :> x x ; : g ( a:int -- int ) a ;");
    const f = await rt.run("5 f");
    const g = await rt.run("5 g");
    if (!f.ok || !g.ok) throw new Error("run failed");
    expect(f.steps - g.steps).toBe(1);
    expect(await codeOf(": h ( -- int ) :> x x ; h", {}, rt)).toBe("E_STACK_UNDERFLOW");
  });

  test("a quotation bound to a name can be called twice; the captured locals stay intact", async () => {
    const src = ": f ( -- int ) 5 :> a [ 1 :> b a b + ] :> q q call q call + ; f .";
    expect(await out(src)).toBe("12\n");
  });

  test("closures from a map body capture the locals of their own run", async () => {
    const src = `
      : mk ( n:int -- list ) 0 n range [ :> i [ i ] ] map ;
      3 mk [ call ] map .`;
    expect(await out(src)).toBe("{ 0 1 2 }\n");
  });

  test("closures from a map body that binds in a lowered branch also have their own run", async () => {
    const src = `
      : mk ( -- list ) 0 3 range [ :> i true [ i 10 * :> j [ j ] ] when ] map ;
      mk [ call ] map .`;
    expect(await out(src)).toBe("{ 0 10 20 }\n");
  });

  test("closures from a while body (not lowered) capture the locals of their own iteration", async () => {
    const src = `
      : mk ( -- list ) { } 0 [ dup 3 < ] [ :> n :> acc acc [ n ] append n 1 + ] while drop ;
      mk [ call ] map .`;
    expect(await out(src)).toBe("{ 0 1 2 }\n");
  });

  test("closures from a loop body (not lowered) capture the locals of their own iteration", async () => {
    const src = `
      : mk ( -- list ) { } 0 [ :> n :> acc acc [ n ] append n 1 + dup 3 < ] loop drop ;
      mk [ call ] map .`;
    expect(await out(src)).toBe("{ 0 1 2 }\n");
  });

  test("closures from a loop body that binds only in a nested lowered branch", async () => {
    const src = `
      : mk ( -- list ) { } 0 [ :> n :> acc acc true [ n 100 + :> m [ m ] ] when append n 1 + dup 3 < ] loop drop ;
      mk [ call ] map .`;
    expect(await out(src)).toBe("{ 100 101 102 }\n");
  });

  test("times, each, filter, reduce and try bodies that bind", async () => {
    expect(await out(": f ( -- ) 3 [ 1 :> x x . ] times ; f")).toBe("1\n1\n1\n");
    expect(await out(": f ( -- ) { 1 2 } [ :> x x 10 * . ] each ; f")).toBe("10\n20\n");
    expect(await out(": f ( -- list ) 0 5 range [ :> x x 2 mod 0 = ] filter ; f .")).toBe(
      "{ 0 2 4 }\n",
    );
    expect(await out(": f ( -- int ) 0 4 range 0 [ :> x :> acc acc x + ] reduce ; f .")).toBe(
      "6\n",
    );
    expect(await out(": f ( -- int ) [ 1 0 div ] [ :> e 7 :> y y ] try ; f .")).toBe("7\n");
  });

  test("a bind in a lowered if/when/unless runs once per activation", async () => {
    const src = `
      : f ( b:bool -- int ) b [ 1 :> x x ] [ 2 :> y y ] if ;
      true f . false f .`;
    expect(await out(src)).toBe("1\n2\n");
  });
});

describe("exit", () => {
  test("leaves the word at once; the caller continues", async () => {
    const src = `
      : sign ( n:int -- str ) n 0 < [ "negative" exit ] when n 0 = [ "zero" exit ] when "positive" ;
      -5 sign . 0 sign . 7 sign . "end" .`;
    expect(await out(src)).toBe("negative\nzero\npositive\nend\n");
  });

  test("runs the exit check of a normal return", async () => {
    expect(await codeOf(": f ( -- int ) 1 2 exit ; f")).toBe("E_EFFECT");
    expect(await codeOf(": f ( -- int ) exit ; f")).toBe("E_EFFECT");
    expect(await codeOf(': f ( -- int ) "x" exit ; f')).toBe("E_TYPE");
  });

  test("pops the marks of every lowered loop it leaves, at any nesting", async () => {
    const src = `
      : scan ( n:int -- int ) 0 [ true ] [ [ true ] [ 1 + dup n = [ exit ] when ] while ] while ;
      : run ( -- int ) 5000 [ 3 scan drop ] times 3 scan ;
      run .`;
    // A leaked mark would grow the return stack by one frame per call.
    expect(await out(src, { limits: { maxReturnDepth: 20, maxSteps: 1e9 } })).toBe("3\n");
  });

  test("exit from the condition of a while and from a loop body", async () => {
    expect(await out(": f ( -- int ) 0 [ 1 + dup 5 = [ exit ] when true ] [ ] while ; f .")).toBe(
      "5\n",
    );
    expect(await out(": f ( -- int ) 0 [ 1 + dup 3 = [ exit ] when true ] loop ; f .")).toBe("3\n");
  });

  test("exit inside a word called from a quotation leaves only that word", async () => {
    const src = `
      : half ( n:int -- int ) n 0 = [ 0 exit ] when n 2 div ;
      { 0 4 9 } [ half ] map .`;
    expect(await out(src)).toBe("{ 0 2 4 }\n");
  });

  test("an exit inside try's body word is not caught as an error", async () => {
    const src = ": f ( -- int ) 1 exit ; [ f ] [ drop 0 ] try .";
    expect(await out(src)).toBe("1\n");
  });
});
