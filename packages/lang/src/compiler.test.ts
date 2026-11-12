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
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import {
  INTRINSIC_NAMES,
  compile,
  createIntrinsicEntries,
  createIntrinsicEntry,
  createPrimitiveEntry,
} from "./compiler.js";
import { createDictionary } from "./dictionary.js";
import { ForgeError } from "./errors.js";
import { WORD_META_SCHEMA, computeHash, parseHeader } from "./meta.js";
import { read } from "./reader.js";
import { sha256 } from "./sha256.js";
import { DEFAULT_LIMITS } from "./types.js";
import type {
  CompileContext,
  CompileResult,
  CompiledWord,
  Dictionary,
  DictionaryTxn,
  FlWordEntry,
  Instruction,
  PrimitiveDef,
  PrimitiveRegistry,
  Scope,
  Token,
  Value,
  WordEntry,
  WordMeta,
} from "./types.js";
import { bool, bytes, int, num, str } from "./values.js";
import { CORE_INTRINSIC_WORDS } from "./vocab/core.js";

// ---------------------------------------------------------------------------------------------
// Harness: a dictionary with hand-made `core` and `fx` entries
// ---------------------------------------------------------------------------------------------

const ajv = new Ajv2020({ strict: true, allErrors: true });
const validateSchema = ajv.compile(WORD_META_SCHEMA);

function expectValidMeta(meta: WordMeta): void {
  const json = JSON.parse(JSON.stringify(meta)) as unknown;
  expect(validateSchema(json), ajv.errorsText(validateSchema.errors)).toBe(true);
}

const noop = (): void => undefined;

function def(
  vocab: string,
  name: string,
  effect: string,
  extra: Partial<PrimitiveDef> = {},
): PrimitiveDef {
  return { vocab, name, effect, fn: noop, ...extra };
}

const CORE_PRIMS: PrimitiveDef[] = [
  def("core", "+", "( a b -- c )"),
  def("core", "-", "( a b -- c )"),
  def("core", "*", "( a b -- c )"),
  def("core", "<", "( a b -- bool )"),
  def("core", ">", "( a b -- bool )"),
  def("core", ">=", "( a b -- bool )"),
  def("core", "<=", "( a b -- bool )"),
  def("core", "=", "( a b -- bool )"),
  def("core", "and", "( bool bool -- bool )"),
  def("core", "mod", "( a:int b:int -- int )"),
  def("core", "len", "( any -- int )"),
];

const FX_PRIMS: PrimitiveDef[] = [
  def("fx", "now", "( -- int )", { effects: ["+time"] }),
  def("fx", "add-async", "( a:int b:int -- int )", { effects: ["+async"] }),
  def("fx", "sleep", "( ms:int -- )", { effects: ["+async"] }),
  def("fx", "roll", "( -- int )", { effects: ["+random"], doc: "random", category: "fx" }),
];

const UNBOUND: PrimitiveDef = def("fz", "twice", "( n:int -- int )");

function makeRegistry(): PrimitiveRegistry {
  const m = new Map<string, PrimitiveDef>();
  return {
    define(d) {
      m.set(`${d.vocab}:${d.name}`, d);
    },
    get(vocab, name) {
      return m.get(`${vocab}:${name}`);
    },
    list(vocab) {
      return [...m.values()].filter((d) => vocab === undefined || d.vocab === vocab);
    },
  };
}

class Env {
  readonly dictionary: Dictionary;
  readonly registry = makeRegistry();
  /** Every transaction handed out, in order. */
  readonly txns: DictionaryTxn[] = [];

  constructor() {
    const inner = createDictionary();
    const txns = this.txns;
    this.dictionary = new Proxy(inner, {
      get(target, prop, receiver) {
        if (prop === "begin") {
          return () => {
            const t = target.begin();
            txns.push(t);
            return t;
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
    const t = inner.begin();
    for (const e of createIntrinsicEntries()) t.define(e, { trusted: true });
    for (const d of [...CORE_PRIMS, ...FX_PRIMS]) {
      this.registry.define(d);
      t.define(createPrimitiveEntry(d), { trusted: true });
    }
    this.registry.define(UNBOUND);
    t.commit();
  }

  ctx(mode: "unit" | "console", o: Partial<CompileContext> = {}): CompileContext {
    return {
      mode,
      dictionary: this.dictionary,
      registry: this.registry,
      parseHeader,
      sha256,
      scope: { current: "user", using: [] },
      unit: null,
      trusted: false,
      limits: DEFAULT_LIMITS,
      ...o,
    };
  }

  compile(
    source: string,
    mode: "unit" | "console" = "unit",
    o: Partial<CompileContext> = {},
  ): CompileResult {
    return compile(read(source), source, this.ctx(mode, o));
  }

  /** Compile and commit. */
  load(source: string, o: Partial<CompileContext> = {}): CompileResult {
    const r = this.compile(source, "unit", o);
    r.txn.commit();
    return r;
  }

  /** Console compile and commit. */
  run(source: string, o: Partial<CompileContext> = {}): CompileResult {
    const r = this.compile(source, "console", o);
    r.txn.commit();
    return r;
  }

  entry(qname: string): WordEntry {
    const [vocab, name] = qname.split(":") as [string, string];
    return this.dictionary.resolveQualified(vocab, name, vocab);
  }

  fl(qname: string): FlWordEntry {
    const e = this.entry(qname);
    if (e.kind !== "fl") throw new Error(`${qname} is not an FL word`);
    return e;
  }

  code(qname: string): CompiledWord {
    const c = this.fl(qname).code;
    if (c === null) throw new Error(`${qname} has no code`);
    return c;
  }
}

function fails(env: Env, src: string, mode: "unit" | "console" = "unit", o = {}): ForgeError {
  try {
    env.compile(src, mode, o);
  } catch (e) {
    expect(e).toBeInstanceOf(ForgeError);
    return e as ForgeError;
  }
  throw new Error(`expected a compile error for: ${src}`);
}

function at(e: ForgeError, line: number, col: number): void {
  expect(e.pos).toMatchObject({ line, col });
}

/** One short string per instruction, for readable expectations. */
function ops(code: CompiledWord | readonly Instruction[]): string[] {
  const list = Array.isArray(code) ? (code as readonly Instruction[]) : (code as CompiledWord).code;
  return list.map((i) => {
    switch (i.op) {
      case "lit":
        return `lit ${i.value.tag === "str" ? JSON.stringify(i.value.v) : String(i.value.v)}`;
      case "local":
        return `local ${i.slot}`;
      case "stack":
        return `stack ${i.word}`;
      case "call":
      case "prim":
      case "varGet":
      case "varSet":
        return `${i.op} ${i.entry.qname}`;
      case "jump":
      case "jumpf":
        return `${i.op} ${i.target}`;
      case "quot":
        return `quot ${i.end}${i.own === true ? " own" : ""}`;
      case "bind":
        return `bind ${i.slot}`;
      case "exit":
        return `exit ${i.marks}`;
      case "comb":
        return `comb ${i.name}`;
      case "dcheck":
        return `dcheck ${i.delta}`;
      case "print":
        return `print ${i.form}`;
      default:
        return i.op;
    }
  });
}

// ---------------------------------------------------------------------------------------------
// A tiny interpreter for the instructions the compiler emits (not the real VM; WP 1.6)
// ---------------------------------------------------------------------------------------------

const PRIM_IMPL: Record<string, (...a: number[]) => Value | undefined> = {
  "+": (a, b) => int(a + b),
  "-": (a, b) => int(a - b),
  "*": (a, b) => int(a * b),
  "<": (a, b) => bool(a < b),
  ">": (a, b) => bool(a > b),
  ">=": (a, b) => bool(a >= b),
  "<=": (a, b) => bool(a <= b),
  "=": (a, b) => bool(a === b),
  and: (a, b) => bool(Boolean(a) && Boolean(b)),
  mod: (a, b) => int(((a % b) + b) % b),
};

function effectError(expected: number, actual: number): ForgeError {
  return new ForgeError({
    code: "E_EFFECT",
    message: "depth",
    detail: { expected, actual },
  });
}

function stackWord(word: string, s: Value[]): void {
  const top = (n: number): Value => s[s.length - n] as Value;
  switch (word) {
    case "dup":
      s.push(top(1));
      return;
    case "drop":
      s.pop();
      return;
    case "swap": {
      const b = s.pop() as Value;
      const a = s.pop() as Value;
      s.push(b, a);
      return;
    }
    case "over":
      s.push(top(2));
      return;
    case "dup2":
      s.push(top(2), top(1));
      return;
    case "drop2":
      s.length -= 2;
      return;
    default:
      throw new Error(`stack word ${word} not implemented`);
  }
}

function exec(code: CompiledWord, ip: number, s: Value[], locals: readonly Value[]): void {
  const marks: number[] = [];
  const callq = (q: Value): void => {
    if (q.tag !== "quot") throw new Error("not a quotation");
    exec(q.v.code, q.v.start, s, q.v.env);
  };
  const truth = (): boolean => {
    const b = s.pop() as Value;
    if (b.tag !== "bool") throw new ForgeError({ code: "E_TYPE", message: "not a bool" });
    return b.v;
  };
  for (;;) {
    const ins = code.code[ip++] as Instruction;
    switch (ins.op) {
      case "lit":
        s.push(ins.value);
        break;
      case "local":
        s.push(locals[ins.slot] as Value);
        break;
      case "stack":
        stackWord(ins.word, s);
        break;
      case "prim": {
        const n = ins.entry.effect.inputs.length;
        const args = s.splice(s.length - n, n).map((v) => v.v as number);
        const r = (PRIM_IMPL[ins.entry.name] as (...a: number[]) => Value | undefined)(...args);
        if (r !== undefined) s.push(r);
        break;
      }
      case "call": {
        const callee = ins.entry.code as CompiledWord;
        const n = callee.effect.inputs.length;
        const args = s.splice(s.length - n, n);
        for (const i of callee.anonInputs) s.push(args[i] as Value);
        exec(
          callee,
          0,
          s,
          callee.namedInputs.map((i) => args[i] as Value),
        );
        break;
      }
      case "quot":
        s.push({ tag: "quot", v: { code, start: ip, env: locals } });
        ip = ins.end;
        break;
      case "callq":
        callq(s.pop() as Value);
        break;
      case "comb":
        switch (ins.name) {
          case "if": {
            const no = s.pop() as Value;
            const yes = s.pop() as Value;
            callq(truth() ? yes : no);
            break;
          }
          case "when":
          case "unless": {
            const q = s.pop() as Value;
            if (truth() === (ins.name === "when")) callq(q);
            break;
          }
          case "while": {
            const body = s.pop() as Value;
            const cond = s.pop() as Value;
            for (;;) {
              const d = s.length;
              callq(cond);
              if (s.length !== d + 1) throw effectError(d + 1, s.length);
              if (!truth()) break;
              callq(body);
              if (s.length !== d) throw effectError(d, s.length);
            }
            break;
          }
          case "loop": {
            const q = s.pop() as Value;
            for (;;) {
              const d = s.length;
              callq(q);
              if (s.length !== d + 1) throw effectError(d + 1, s.length);
              if (!truth()) break;
            }
            break;
          }
          default:
            throw new Error(`combinator ${ins.name} not implemented`);
        }
        break;
      case "listOpen":
        marks.push(s.length);
        break;
      case "listClose": {
        const m = marks.pop() as number;
        s.push({ tag: "list", v: s.splice(m, s.length - m) });
        break;
      }
      case "jump":
        ip = ins.target;
        break;
      case "jumpf":
        if (!truth()) ip = ins.target;
        break;
      case "dmark":
        marks.push(s.length);
        break;
      case "dcheck": {
        const m = marks.pop() as number;
        if (s.length !== m + ins.delta) throw effectError(m + ins.delta, s.length);
        break;
      }
      case "ret":
        return;
      default:
        throw new Error(`instruction ${ins.op} not implemented`);
    }
  }
}

/** Calls an FL word the way the VM's entry sequence does, returning the final stack. */
function callWord(env: Env, qname: string, ...args: Value[]): Value[] {
  const w = env.code(qname);
  const stack = [...args];
  const n = w.effect.inputs.length;
  const inputs = stack.splice(stack.length - n, n);
  for (const i of w.anonInputs) stack.push(inputs[i] as Value);
  exec(
    w,
    0,
    stack,
    w.namedInputs.map((i) => inputs[i] as Value),
  );
  return stack;
}

/** Calls a quotation value (the `callq` of the interpreter) on the given stack. */
function callQuot(q: Value, stack: Value[]): Value[] {
  if (q.tag !== "quot") throw new Error("quot expected");
  exec(q.v.code, q.v.start, stack, q.v.env);
  return stack;
}

const ints = (...ns: number[]): Value[] => ns.map((n) => int(n));
const plain = (vs: Value[]): unknown[] => vs.map((v) => v.v);

// ---------------------------------------------------------------------------------------------
// Instruction output
// ---------------------------------------------------------------------------------------------

describe("instruction output", () => {
  test("a simple word: body, then ret at the semicolon, positions in parallel", () => {
    const env = new Env();
    const r = env.load(": inc ( int -- int ) 1 + ;");
    expect(r.defined).toEqual(["user:inc"]);
    const w = env.code("user:inc");
    expect(ops(w)).toEqual(["lit 1", "prim core:+", "ret"]);
    expect(w.positions).toHaveLength(w.code.length);
    expect(w.positions[0]).toEqual({ offset: 21, line: 1, col: 22 });
    expect(w.positions[1]).toEqual({ offset: 23, line: 1, col: 24 });
    expect(w.positions[2]).toEqual({ offset: 25, line: 1, col: 26 });
    expect(w.qname).toBe("user:inc");
    expect(w.effect.text).toBe("( int -- int )");
    expect(w.nlocals).toBe(0);
    expect(w.anonInputs).toEqual([0]);
    expect(w.namedInputs).toEqual([]);
    expect(w.effects).toEqual([]);
    expect(env.fl("user:inc").code).toBe(w);
  });

  test("an empty body is just ret", () => {
    const env = new Env();
    env.load(": ident ( str -- str ) ;");
    expect(ops(env.code("user:ident"))).toEqual(["ret"]);
  });

  test("every literal kind", () => {
    const env = new Env();
    env.load(
      ": lits ( -- .. ) 7 0x10 -3 1.5 \"s\" 'a' #[ ff 00 ] true false 123456789012345678901 ;",
    );
    const vals = env
      .code("user:lits")
      .code.filter((i): i is Extract<Instruction, { op: "lit" }> => i.op === "lit")
      .map((i) => i.value);
    expect(vals).toEqual([
      int(7),
      int(16),
      int(-3),
      num(1.5),
      str("s"),
      int(97),
      bytes(new Uint8Array([0xff, 0])),
      bool(true),
      bool(false),
      int(123456789012345678901n),
    ]);
  });

  test("stack words, print words and call lower to dedicated instructions", () => {
    const env = new Env();
    env.load(": t ( -- .. ) dup drop swap over rot -rot nip tuck depth clear . .s call ;");
    expect(ops(env.code("user:t"))).toEqual([
      "stack dup",
      "stack drop",
      "stack swap",
      "stack over",
      "stack rot",
      "stack -rot",
      "stack nip",
      "stack tuck",
      "stack depth",
      "stack clear",
      "print value",
      "print stack",
      "callq",
      "ret",
    ]);
  });

  test("non-literal combinators use comb", () => {
    const env = new Env();
    env.load(
      ": t ( q:quot -- .. ) q 3 swap times q each q map q mapi q filter q 0 q reduce q try q q q fork q q if q q while q when q unless q loop ;",
    );
    const names = env
      .code("user:t")
      .code.filter((i): i is Extract<Instruction, { op: "comb" }> => i.op === "comb")
      .map((i) => i.name);
    expect(names).toEqual([
      "times",
      "each",
      "map",
      "mapi",
      "filter",
      "reduce",
      "try",
      "fork",
      "if",
      "while",
      "when",
      "unless",
      "loop",
    ]);
  });

  test("calls, primitives, constants and variables are bound early", () => {
    const env = new Env();
    env.load(`
      42 CONSTANT answer
      0 VARIABLE counter
      : callee ( int -- int ) ;
      : t ( -- .. ) answer counter 5 counter! callee fx:now fx:now ;
    `);
    const w = env.code("user:t");
    expect(ops(w)).toEqual([
      "lit 42",
      "varGet user:counter",
      "lit 5",
      "varSet user:counter!",
      "call user:callee",
      "prim fx:now",
      "prim fx:now",
      "ret",
    ]);
    const call = w.code[4] as Extract<Instruction, { op: "call" }>;
    expect(call.entry).toBe(env.entry("user:callee"));
    const get = w.code[1] as Extract<Instruction, { op: "varGet" }>;
    const set = w.code[3] as Extract<Instruction, { op: "varSet" }>;
    expect(get.entry.varId).toBe(set.entry.varId);
    expect(get.entry.role).toBe("get");
    expect(set.entry.role).toBe("set");
    expect(w.deps.map((d) => d.qname)).toEqual([
      "user:answer",
      "user:counter",
      "user:counter!",
      "user:callee",
      "fx:now",
    ]);
  });

  test("quotations: quot with end, body, ret", () => {
    const env = new Env();
    env.load(": q ( -- quot ) [ 1 [ 2 ] drop ] ;");
    const w = env.code("user:q");
    expect(ops(w)).toEqual([
      "quot 7",
      "lit 1",
      "quot 5",
      "lit 2",
      "ret",
      "stack drop",
      "ret",
      "ret",
    ]);
    // The inner ret sits at the inner `]`, the outer one at the outer `]`.
    const src = ": q ( -- quot ) [ 1 [ 2 ] drop ] ;";
    expect(w.positions[4]).toMatchObject({ offset: src.indexOf("]") });
    expect(w.positions[6]).toMatchObject({ offset: src.lastIndexOf("]") });
  });

  test("list literals", () => {
    const env = new Env();
    env.load(": l ( -- list ) { 1 { 2 } } ;");
    expect(ops(env.code("user:l"))).toEqual([
      "listOpen",
      "lit 1",
      "listOpen",
      "lit 2",
      "listClose",
      "listClose",
      "ret",
    ]);
  });

  test("locals, anonymous inputs and closures", () => {
    const env = new Env();
    env.load(`
      : scale ( int k:int -- int ) k * ;
      : hyp2 ( a:int b:int -- int ) a a * b b * + ;
      : adder ( n:int -- quot ) [ n + ] ;
      : nest ( a:int b:int -- quot ) [ [ a b + ] call ] ;
      : _mixed ( x:int str y:int -- str ) y x + drop ;
      : _lbl ( a b -- c ) a b + ;
    `);
    const scale = env.code("user:scale");
    expect(ops(scale)).toEqual(["local 0", "prim core:*", "ret"]);
    expect(scale.localNames).toEqual(["k"]);
    expect(scale.namedInputs).toEqual([1]);
    expect(scale.anonInputs).toEqual([0]);
    expect(scale.nlocals).toBe(1);
    expect(ops(env.code("user:hyp2"))).toEqual([
      "local 0",
      "local 0",
      "prim core:*",
      "local 1",
      "local 1",
      "prim core:*",
      "prim core:+",
      "ret",
    ]);
    expect(ops(env.code("user:adder"))).toEqual(["quot 4", "local 0", "prim core:+", "ret", "ret"]);
    expect(ops(env.code("user:nest"))).toEqual([
      "quot 8",
      "quot 6",
      "local 0",
      "local 1",
      "prim core:+",
      "ret",
      "callq",
      "ret",
      "ret",
    ]);
    const mixed = env.code("user:_mixed");
    expect(mixed.localNames).toEqual(["x", "y"]);
    expect(mixed.namedInputs).toEqual([0, 2]);
    expect(mixed.anonInputs).toEqual([1]);
    const lbl = env.code("user:_lbl");
    expect(lbl.localNames).toEqual(["a", "b"]);
    expect(lbl.anonInputs).toEqual([]);
    // Executing with the tiny interpreter: closures capture the creating call's locals.
    expect(plain(callWord(env, "user:scale", ...ints(6, 7)))).toEqual([42]);
    const [q1] = callWord(env, "user:adder", int(1)) as [Value];
    const [q2] = callWord(env, "user:adder", int(2)) as [Value];
    expect(plain(callQuot(q1, ints(10)))).toEqual([11]);
    expect(plain(callQuot(q2, ints(10)))).toEqual([12]);
    const [nested] = callWord(env, "user:nest", ...ints(3, 4)) as [Value];
    expect(plain(callQuot(nested, []))).toEqual([7]);
  });

  test("a local shadows words, including the word's own name and core", () => {
    const env = new Env();
    const r = env.load(": f ( dup:int -- int ) dup ;");
    expect(ops(env.code("user:f"))).toEqual(["local 0", "ret"]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]?.code).toBe("W_SHADOW");
  });

  test("recurse compiles to a call of the word itself and is not a dependency", () => {
    const env = new Env();
    env.load(": fact ( n:int -- int ) n 2 < [ 1 ] [ n n 1 - recurse * ] if ;");
    const w = env.code("user:fact");
    const self = w.code.find((i) => i.op === "call") as Extract<Instruction, { op: "call" }>;
    expect(self.entry).toBe(env.fl("user:fact"));
    expect(w.deps.map((d) => d.qname)).toEqual(["core:<", "core:-", "core:*", "core:if"]);
    expect(plain(callWord(env, "user:fact", int(5)))).toEqual([120]);
    expect(plain(callWord(env, "user:fact", int(1)))).toEqual([1]);
  });

  test("resolution: current vocabulary, imports, core and qualified names", () => {
    const env = new Env();
    env.load("IN: lib : _p ( -- int ) 1 ; : pub ( -- int ) 2 ; IN: app : _p ( -- int ) 3 ;");
    env.load(`
      IN: app
      USING: lib ;
      : t ( -- .. ) _p pub lib:pub app:_p core:dup dup ;
    `);
    const calls = env
      .code("app:t")
      .code.filter((i): i is Extract<Instruction, { op: "call" }> => i.op === "call");
    expect(calls.map((c) => c.entry.qname)).toEqual(["app:_p", "lib:pub", "lib:pub", "app:_p"]);
    expect(ops(env.code("app:t")).slice(4)).toEqual(["stack dup", "stack dup", "ret"]);
  });

  test("a word named like a core word wins inside its vocabulary (shadowing)", () => {
    const env = new Env();
    env.load("IN: demo : dup ( int -- int int ) 99 ; : t ( -- .. ) dup core:dup ;");
    expect(ops(env.code("demo:t"))).toEqual(["call demo:dup", "stack dup", "ret"]);
  });

  test("redefinition keeps old references (early binding)", () => {
    const env = new Env();
    env.load(": f ( -- int ) 1 ; : g ( -- int ) f ;");
    const oldF = env.entry("user:f");
    const r = env.load(": f ( -- int ) 2 ;");
    expect(r.warnings.map((w) => w.code)).toEqual(["W_REDEFINED"]);
    expect(r.warnings[0]).toMatchObject({ qname: "user:f", pos: { line: 1, col: 3 } });
    const g = env.code("user:g").code[0] as Extract<Instruction, { op: "call" }>;
    expect(g.entry).toBe(oldF);
    expect(env.entry("user:f")).not.toBe(oldF);
  });

  test("deps are distinct and in order of first reference", () => {
    const env = new Env();
    env.load(": a ( -- int ) 1 ; : b ( -- int ) 2 ; : c ( -- .. ) b a b a dup dup ;");
    expect(env.code("user:c").deps.map((d) => d.qname)).toEqual(["user:b", "user:a", "core:dup"]);
  });

  test("source text and meta source info are verbatim, comments kept", () => {
    const env = new Env();
    const src = '\\ lead\nIN: v\n  : f ( int -- int ) ( c ) "d" doc 1 + ; \\ trail\n';
    env.load(src, { unit: "u.fth" });
    const m = env.entry("v:f").meta;
    expect(m.source.unit).toBe("u.fth");
    expect(m.source.text).toBe(': f ( int -- int ) ( c ) "d" doc 1 + ;');
    expect(m.source.pos).toEqual({ offset: src.indexOf(": f"), line: 3, col: 3 });
    expect(m.doc).toBe("d");
  });
});

// ---------------------------------------------------------------------------------------------
// Lowering
// ---------------------------------------------------------------------------------------------

describe("lowering of literal-quotation combinators", () => {
  test("if", () => {
    const env = new Env();
    env.load(": f ( b:bool -- int ) b [ 1 ] [ 2 ] if ;");
    expect(ops(env.code("user:f"))).toEqual([
      "local 0",
      "jumpf 4",
      "lit 1",
      "jump 5",
      "lit 2",
      "ret",
    ]);
  });

  test("when and unless", () => {
    const env = new Env();
    env.load(`
      : w ( b:bool -- .. ) b [ 1 ] when ;
      : u ( b:bool -- .. ) b [ 1 ] unless ;
    `);
    expect(ops(env.code("user:w"))).toEqual(["local 0", "jumpf 3", "lit 1", "ret"]);
    expect(ops(env.code("user:u"))).toEqual(["local 0", "jumpf 3", "jump 4", "lit 1", "ret"]);
  });

  test("while and loop carry dmark and dcheck", () => {
    const env = new Env();
    env.load(`
      : w ( -- .. ) [ true ] [ 1 drop ] while ;
      : l ( -- .. ) [ true ] loop ;
    `);
    expect(ops(env.code("user:w"))).toEqual([
      "dmark",
      "lit true",
      "dcheck 1",
      "jumpf 9",
      "dmark",
      "lit 1",
      "stack drop",
      "dcheck 0",
      "jump 0",
      "ret",
    ]);
    expect(ops(env.code("user:l"))).toEqual([
      "dmark",
      "lit true",
      "dcheck 1",
      "jumpf 5",
      "jump 0",
      "ret",
    ]);
  });

  test("jump targets are absolute and positions follow the combinator word", () => {
    const env = new Env();
    env.load(": f ( b:bool -- int ) b [ 1 ] [ 2 ] if ;");
    const w = env.code("user:f");
    // jumpf and jump are positioned at the `if` token.
    const col = ": f ( b:bool -- int ) b [ 1 ] [ 2 ] if ;".indexOf("if") + 1;
    expect(w.positions[1]).toMatchObject({ line: 1, col });
    expect(w.positions[3]).toMatchObject({ line: 1, col });
  });

  test("non-literal arguments and user words named like combinators are not lowered", () => {
    const env = new Env();
    env.load(`
      : a ( b:bool q:quot -- .. ) b [ 1 ] q if ;
      : b ( b:bool q:quot -- .. ) b q [ 1 ] if ;
      : c ( q:quot -- .. ) q [ 1 ] [ 2 ] [ 3 ] if ;
      IN: other
      : if ( q1:quot q2:quot -- .. ) ;
      : t ( -- .. ) [ 1 ] [ 2 ] if ;
    `);
    expect(ops(env.code("user:a"))).toContain("comb if");
    expect(ops(env.code("user:b"))).toContain("comb if");
    // `[ 1 ] [ 2 ] [ 3 ] if` lowers the last two only; the first stays a quotation.
    expect(ops(env.code("user:c"))).toEqual([
      "local 0",
      "quot 4",
      "lit 1",
      "ret",
      "jumpf 7",
      "lit 2",
      "jump 8",
      "lit 3",
      "ret",
    ]);
    expect(ops(env.code("other:t"))).toEqual([
      "quot 3",
      "lit 1",
      "ret",
      "quot 6",
      "lit 2",
      "ret",
      "call other:if",
      "ret",
    ]);
  });

  test("a quotation before `when` after another quotation: only the nearer pair lowers", () => {
    const env = new Env();
    env.load(": f ( b:bool -- .. ) b [ 1 ] [ 2 ] when ;");
    expect(ops(env.code("user:f"))).toEqual([
      "local 0",
      "quot 4",
      "lit 1",
      "ret",
      "jumpf 6",
      "lit 2",
      "ret",
    ]);
  });

  test("lowered branches may contain quotations, lists, locals and nested lowering", () => {
    const env = new Env();
    env.load(`
      : f ( n:int -- .. )
        n 0 <
        [ { n } ]
        [ n 10 < [ [ n ] ] [ n 100 < [ n 1 + ] when ] if ]
        if ;
    `);
    expect(ops(env.code("user:f")).filter((o) => o.startsWith("comb"))).toEqual([]);
    const out = (n: number): unknown => {
      const s = callWord(env, "user:f", int(n));
      const top = s[s.length - 1] as Value;
      return top.tag === "list" ? top.v.map((x) => x.v) : top.tag === "quot" ? "quot" : top.v;
    };
    expect(out(-1)).toEqual([-1]);
    expect(out(5)).toBe("quot");
    expect(out(50)).toBe(51);
  });

  describe("lowered and unlowered code are observably identical", () => {
    // `swap swap` (or `dup drop`) between the quotations and the combinator is a no-op that stops
    // the compiler from seeing literal quotation arguments, giving the intrinsic path.
    const env = new Env();
    env.load(`
      : if-l ( n:int -- .. ) n 3 < [ n 10 + ] [ n 20 + ] if ;
      : if-u ( n:int -- .. ) n 3 < [ n 10 + ] [ n 20 + ] swap swap if ;
      : when-l ( n:int -- .. ) n 3 < [ n 100 + ] when ;
      : when-u ( n:int -- .. ) n 3 < [ n 100 + ] dup drop when ;
      : unless-l ( n:int -- .. ) n 3 < [ n 100 + ] unless ;
      : unless-u ( n:int -- .. ) n 3 < [ n 100 + ] dup drop unless ;
      : while-l ( n:int -- .. ) 0 n [ dup 0 > ] [ 1 - swap 1 + swap ] while drop ;
      : while-u ( n:int -- .. ) 0 n [ dup 0 > ] [ 1 - swap 1 + swap ] swap swap while drop ;
      : loop-l ( n:int -- .. ) 0 [ 1 + dup n < ] loop ;
      : loop-u ( n:int -- .. ) 0 [ 1 + dup n < ] dup drop loop ;
      : while-bad-l ( n:int -- .. ) [ true ] [ 1 ] while ;
      : while-bad-u ( n:int -- .. ) [ true ] [ 1 ] swap swap while ;
      : while-bad2-l ( n:int -- .. ) [ true true ] [ ] while ;
      : while-bad2-u ( n:int -- .. ) [ true true ] [ ] swap swap while ;
      : loop-bad-l ( n:int -- .. ) [ true true ] loop ;
      : loop-bad-u ( n:int -- .. ) [ true true ] dup drop loop ;
      : nested-l ( n:int -- .. ) n 0 > [ n 5 > [ 1 ] [ 2 ] if ] [ 3 ] if ;
      : nested-u ( n:int -- .. ) n 0 > [ n 5 > [ 1 ] [ 2 ] swap swap if ] [ 3 ] swap swap if ;
    `);

    const result = (word: string, n: number): unknown => {
      try {
        return plain(callWord(env, word, int(n)));
      } catch (e) {
        if (e instanceof ForgeError) return `${e.code}:${JSON.stringify(e.detail)}`;
        throw e;
      }
    };

    test.each([
      ["if", [0, 3, 7]],
      ["when", [0, 3, 7]],
      ["unless", [0, 3, 7]],
      ["while", [0, 1, 6]],
      ["loop", [1, 4, 9]],
      ["nested", [-1, 3, 9]],
    ] as const)("%s", (name, inputs) => {
      for (const n of inputs) {
        expect(result(`user:${name}-l`, n)).toEqual(result(`user:${name}-u`, n));
      }
    });

    test("expected results", () => {
      expect(result("user:if-l", 1)).toEqual([11]);
      expect(result("user:if-l", 5)).toEqual([25]);
      expect(result("user:when-l", 1)).toEqual([101]);
      expect(result("user:when-l", 9)).toEqual([]);
      expect(result("user:unless-l", 9)).toEqual([109]);
      expect(result("user:while-l", 6)).toEqual([6]);
      expect(result("user:loop-l", 4)).toEqual([4]);
      expect(result("user:nested-l", 9)).toEqual([1]);
      expect(result("user:nested-l", 3)).toEqual([2]);
      expect(result("user:nested-l", -1)).toEqual([3]);
    });

    test("depth violations raise E_EFFECT in both forms, with the same detail", () => {
      for (const w of ["while-bad", "while-bad2", "loop-bad"]) {
        const l = result(`user:${w}-l`, 0);
        expect(l).toMatch(/^E_EFFECT:/);
        expect(l).toEqual(result(`user:${w}-u`, 0));
      }
    });

    test("unlowered forms really use comb", () => {
      for (const w of ["if", "when", "unless", "while", "loop", "nested"]) {
        expect(ops(env.code(`user:${w}-u`))).toContain(`comb ${w === "nested" ? "if" : w}`);
        expect(ops(env.code(`user:${w}-l`)).filter((o) => o.startsWith("comb"))).toEqual([]);
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The Gate 1 example (spec 15.1)
// ---------------------------------------------------------------------------------------------

const U_ROT = `IN: classical

: _rot-code ( code:int amount:int -- int )
  code 65 >= code 90 <= and
  [ code 65 - amount + 26 mod 65 + ]
  [ code 97 >= code 122 <= and
    [ code 97 - amount + 26 mod 97 + ]
    [ code ]
    if ]
  if ;

: rot ( bytes amount:int[0..25]=13 -- bytes )
  "Rotate each ASCII letter by a fixed amount; other bytes pass through." doc
  "Classical ciphers" category
  [ amount _rot-code ] map ;

META: rot
  param amount "Shift (13 = ROT13)" ;
  alias rot13 ;
  see-also classical:atbash ;
;
`;

describe("classical:rot (U-rot)", () => {
  test("compiles, and the metadata equals the spec record apart from the hash", () => {
    const env = new Env();
    const r = env.load(U_ROT);
    expect(r.defined).toEqual(["classical:_rot-code", "classical:rot", "classical:rot13"]);
    expect(r.warnings).toEqual([]);
    const meta = env.entry("classical:rot").meta;
    expect(meta.hash).toMatch(/^[0-9a-f]{64}$/);
    const { hash, source, ...rest } = meta;
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rest).toEqual({
      name: "rot",
      vocab: "classical",
      qname: "classical:rot",
      kind: "fl",
      exported: true,
      op: true,
      effect: {
        inputs: [
          { name: null, type: "bytes" },
          {
            name: "amount",
            type: "int",
            constraint: { min: 0, max: 25 },
            default: 13,
            doc: "Shift (13 = ROT13)",
          },
        ],
        outputs: [{ name: null, type: "bytes" }],
        unchecked: false,
        variadicInput: false,
        text: "( bytes amount:int[0..25]=13 -- bytes )",
      },
      params: [
        {
          name: "amount",
          type: "int",
          index: 1,
          required: false,
          constraint: { min: 0, max: 25 },
          default: 13,
          doc: "Shift (13 = ROT13)",
        },
      ],
      category: "Classical ciphers",
      doc: "Rotate each ASCII letter by a fixed amount; other bytes pass through.",
      aliases: ["rot13"],
      seeAlso: ["classical:atbash"],
      effects: [],
      version: "1",
    });
    // The spec abridges `source.text`; the real record carries the verbatim definition.
    expect(source.unit).toBeNull();
    expect(source.text?.startsWith(": rot ( bytes amount:int[0..25]=13 -- bytes )")).toBe(true);
    expect(source.text?.endsWith("[ amount _rot-code ] map ;")).toBe(true);
    expect(source.pos).toEqual({
      offset: U_ROT.indexOf(": rot"),
      line: U_ROT.slice(0, U_ROT.indexOf(": rot")).split("\n").length,
      col: 1,
    });
    expectValidMeta(meta);
    expectValidMeta(env.entry("classical:_rot-code").meta);
  });

  test("code: bytes input stays anonymous, amount is local 0, nested ifs are lowered", () => {
    const env = new Env();
    env.load(U_ROT);
    const rot = env.code("classical:rot");
    expect(ops(rot)).toEqual([
      "quot 4",
      "local 0",
      "call classical:_rot-code",
      "ret",
      "comb map",
      "ret",
    ]);
    expect(rot.localNames).toEqual(["amount"]);
    expect(rot.anonInputs).toEqual([0]);
    expect(rot.namedInputs).toEqual([1]);
    const helper = env.code("classical:_rot-code");
    expect(helper.localNames).toEqual(["code", "amount"]);
    expect(ops(helper).filter((o) => o.startsWith("comb") || o.startsWith("quot"))).toEqual([]);
    expect(ops(helper).filter((o) => o.startsWith("jump"))).toHaveLength(4);
    // Behaviour through the interpreter: rotate 'A' by 13 and 'a' by 1, pass '1' through.
    const code = (c: number, amount: number): unknown =>
      plain(callWord(env, "classical:_rot-code", ...ints(c, amount)));
    expect(code(65, 13)).toEqual([78]);
    expect(code(97, 1)).toEqual([98]);
    expect(code(49, 5)).toEqual([49]);
  });

  test("the alias is the same entry and shares its hash; help-relevant fields", () => {
    const env = new Env();
    env.load(U_ROT);
    expect(env.entry("classical:rot13")).toBe(env.entry("classical:rot"));
  });

  test("hash is deterministic and covers the callee", () => {
    const a = new Env();
    const b = new Env();
    a.load(U_ROT);
    b.load(U_ROT);
    expect(a.entry("classical:rot").meta.hash).toBe(b.entry("classical:rot").meta.hash);
    const c = new Env();
    c.load(U_ROT.replace("26 mod 65 +", "26 mod 66 +"));
    expect(c.entry("classical:rot").meta.hash).not.toBe(a.entry("classical:rot").meta.hash);
  });
});

// ---------------------------------------------------------------------------------------------
// Errors and diagnostics
// ---------------------------------------------------------------------------------------------

describe("E_TOPLEVEL", () => {
  test("code in a unit is reported at the first token that is not part of a form", () => {
    const env = new Env();
    const e = fails(env, ": ok ( -- int ) 1 ;\n1 2 +");
    expect(e.code).toBe("E_TOPLEVEL");
    at(e, 2, 1);
  });

  test("3 4 + CONSTANT x is E_TOPLEVEL at the 3", () => {
    const e = fails(new Env(), "3 4 + CONSTANT x");
    expect(e.code).toBe("E_TOPLEVEL");
    at(e, 1, 1);
  });

  test.each(["foo", "core:dup", "[ 1 ]", "{ 1 }", "recurse", '"s"'])("%s", (src) => {
    expect(fails(new Env(), src).code).toBe("E_TOPLEVEL");
  });
});

describe("E_SYNTAX", () => {
  test.each([
    ["stray semicolon in a unit", ";", "unit"],
    ["stray ] in a unit", "]", "unit"],
    ["stray } in a unit", "}", "unit"],
    ["VOCAB in a unit", "VOCAB demo", "unit"],
    ["nested definition", ": f ( -- ) : g ( -- ) ; ;", "unit"],
    ["missing ; at eof", ": f ( -- ) 1", "unit"],
    ["missing ] at eof", ": f ( -- ) [ 1", "unit"],
    ["missing } at eof", ": f ( -- ) { 1", "unit"],
    ["; inside a quotation", ": f ( -- ) [ 1 ; ] ;", "unit"],
    ["mismatched closer", ": f ( -- ) [ 1 } ;", "unit"],
    ["stray ] in a body", ": f ( -- ) ] ;", "unit"],
    ["IN: with no operand", "IN:", "unit"],
    ["USING: with no semicolon", "USING: core", "unit"],
    ["CONSTANT with no literal", "CONSTANT x", "unit"],
    ["VARIABLE with no literal", "VARIABLE x", "console"],
    ["colon with no name", ":", "unit"],
    ["CONSTANT with no name", "1 CONSTANT", "unit"],
    ["META: with no name", "META: ;", "unit"],
    ["META: with a literal name", "META: 3", "unit"],
    ["META: with a reserved name", "META: IN:", "unit"],
    ["IN: keyword in a body", ": f ( -- ) IN: ;", "unit"],
    ["CONSTANT keyword in a body", ": f ( -- ) CONSTANT ;", "unit"],
    ["recurse at the console", "recurse", "console"],
    ["3 4 + CONSTANT at the console", "3 4 + CONSTANT seven", "console"],
    ["stray ; at the console", "1 ;", "console"],
    ["stray ] at the console", "]", "console"],
    ["unterminated quotation at the console", "[ 1", "console"],
    ["PRIMITIVE with no name", "PRIMITIVE", "console"],
  ])("%s", (_title, src, mode) => {
    const env = new Env();
    const e = fails(env, src, mode as "unit" | "console", { trusted: true });
    expect(e.code).toBe("E_SYNTAX");
    expect(e.pos).not.toBeNull();
    expect(e.stackSnapshot).toEqual([]);
  });

  test("positions: missing ; is reported at end of input, stray tokens at themselves", () => {
    const env = new Env();
    at(fails(env, ": f ( -- )\n  1"), 2, 4);
    at(fails(env, ": f ( -- ) ] ;"), 1, 12);
    at(fails(env, ": f ( -- ) [ 1 } ;"), 1, 16);
  });

  test("the word being compiled is recorded", () => {
    const e = fails(new Env(), ": f ( -- ) [ 1");
    expect(e.word).toBe("user:f");
    expect(e.detail).toMatchObject({ expected: "']'" });
  });

  test("nesting deeper than the bound is an error, not a stack overflow", () => {
    const env = new Env();
    const deep = `: f ( -- ) ${"[ ".repeat(300)}${"] ".repeat(300)};`;
    const e = fails(env, deep);
    expect(e.code).toBe("E_SYNTAX");
    expect(fails(env, `: f ( -- ) ${"{ ".repeat(300)}`).code).toBe("E_SYNTAX");
    expect(() => env.compile(`: f ( -- ) ${"[ ".repeat(200)}${"] ".repeat(200)};`)).not.toThrow();
  });
});

describe("E_NAME", () => {
  test.each([
    [": true ( -- int ) 1 ;", 1, 3],
    [": recurse ( -- int ) 1 ;", 1, 3],
    [": a:b ( -- int ) 1 ;", 1, 3],
    [": 5 ( -- int ) 1 ;", 1, 3],
    ["3 CONSTANT recurse", 1, 12],
    ["3 CONSTANT a:b", 1, 12],
    ["3 CONSTANT true", 1, 12],
    ["3 VARIABLE ;", 1, 12],
    ["IN: bad.name", 1, 5],
    ["IN: true", 1, 5],
    ["IN: a:b", 1, 5],
    ["USING: core bad.name ;", 1, 13],
    ["VARIABLE", 0, 0],
  ])("%s", (src, line, col) => {
    const env = new Env();
    if (line === 0) {
      expect(fails(env, "1 VARIABLE 2").code).toBe("E_NAME");
      return;
    }
    const e = fails(env, src);
    expect(e.code).toBe("E_NAME");
    at(e, line, col);
    expect(e.detail).toHaveProperty("name");
  });

  test("a name longer than 128 code points, and a setter name that would be", () => {
    const env = new Env();
    // The reader caps names at 128 code points itself; a hand-made token gets there.
    const long = read(": a ( -- ) ;");
    const tokens = [long[0], { ...long[1], text: "a".repeat(129) }, ...long.slice(2)] as Token[];
    expect(() => compile(tokens, ": a ( -- ) ;", env.ctx("unit"))).toThrow(/not a valid word name/);
    expect(env.compile(`: ${"a".repeat(128)} ( -- ) ;`).defined).toHaveLength(1);
    const e = fails(env, `1 VARIABLE ${"a".repeat(128)}`);
    expect(e.code).toBe("E_NAME");
    expect(e.detail).toMatchObject({ name: `${"a".repeat(128)}!` });
  });
});

describe("E_HEADER", () => {
  test("a missing header is reported at the token after the name", () => {
    const e = fails(new Env(), ": f 1 ;");
    expect(e.code).toBe("E_HEADER");
    at(e, 1, 5);
    expect(e.word).toBe("user:f");
  });

  test("a missing header at end of input", () => {
    expect(fails(new Env(), ": f").code).toBe("E_HEADER");
  });

  test.each([
    ": f ( int p:wat -- int ) ;",
    ": f ( int p:int[5..1] -- int ) ;",
    ": f ( int p:choice{a|b}=c -- int ) ;",
    ": f ( int int -- int ) + ;",
  ])("%s", (src) => {
    const e = fails(new Env(), src);
    expect(e.code).toBe("E_HEADER");
    expect(e.word).toBe("user:f");
  });

  test("private words use the lenient header mode, public words the strict one", () => {
    const env = new Env();
    expect(env.compile(": _f ( int int -- int ) + ;").defined).toEqual(["user:_f"]);
    expect(fails(env, ": f ( int int -- int ) + ;").code).toBe("E_HEADER");
    expect(env.compile(": _g ( .. -- ) ;").defined).toEqual(["user:_g"]);
  });
});

describe("resolution errors", () => {
  test("E_UNDEFINED: unknown word, forward reference, own name", () => {
    const env = new Env();
    const e = fails(env, ": a ( -- int )\n  nosuch ;");
    expect(e.code).toBe("E_UNDEFINED");
    at(e, 2, 3);
    expect(e.word).toBe("user:a");
    expect(e.detail).toMatchObject({ name: "nosuch" });
    const f = fails(env, ": a ( -- int ) b ; : b ( -- int ) 1 ;");
    expect(f.detail).toMatchObject({ name: "b" });
    expect(fails(env, ": f ( -- int ) f ;").code).toBe("E_UNDEFINED");
    expect(fails(env, "nosuch", "console").word).toBe("<console>");
  });

  test("E_UNDEFINED and E_NO_VOCAB for qualified names", () => {
    const env = new Env();
    expect(fails(env, ": a ( -- int ) core:nosuch ;").code).toBe("E_UNDEFINED");
    const e = fails(env, ": a ( -- int ) nosuch:word ;");
    expect(e.code).toBe("E_NO_VOCAB");
    at(e, 1, 16);
  });

  test("E_AMBIGUOUS lists candidates in USING: order", () => {
    const env = new Env();
    env.load('IN: alpha : greet ( -- str ) "alpha" ; IN: beta : greet ( -- str ) "beta" ;');
    const e = fails(env, "USING: alpha beta ; greet", "console");
    expect(e.code).toBe("E_AMBIGUOUS");
    expect(e.detail).toMatchObject({ name: "greet", candidates: ["alpha:greet", "beta:greet"] });
    // A qualified name resolves it.
    const r = env.compile("USING: alpha beta ; alpha:greet beta:greet", "console");
    expect(r.segments).toHaveLength(1);
    // A local with an ambiguous name still shadows (and warns).
    const w = env.compile("USING: alpha beta ; : f ( greet:int -- int ) greet ;");
    expect(w.warnings.map((x) => x.code)).toEqual(["W_SHADOW"]);
  });

  test("E_PRIVATE from another vocabulary, fine from the owning one", () => {
    const env = new Env();
    env.load("IN: one : _hidden ( -- int ) 1 ;");
    const e = fails(env, "IN: two : peek ( -- int ) one:_hidden ;");
    expect(e.code).toBe("E_PRIVATE");
    at(e, 1, 27);
    expect(() => env.compile("IN: one : peek ( -- int ) one:_hidden ;")).not.toThrow();
    // Private words are not found through USING:
    expect(fails(env, "USING: one ; : peek ( -- int ) _hidden ;").code).toBe("E_UNDEFINED");
  });

  test("USING: needs existing vocabularies; core is accepted and ignored; repeats are ignored", () => {
    const env = new Env();
    env.load("IN: alpha : a ( -- int ) 1 ;");
    const e = fails(env, "USING: alpha nosuch ;");
    expect(e.code).toBe("E_NO_VOCAB");
    at(e, 1, 14);
    const r = env.compile("USING: alpha core alpha ; USING: ; USING: alpha ;");
    expect(r.scope).toEqual({ current: "user", using: ["alpha"] });
  });

  test("a vocabulary created earlier in the same unit can be imported", () => {
    const env = new Env();
    const r = env.compile("IN: a IN: b USING: a ;");
    expect(r.scope).toEqual({ current: "b", using: ["a"] });
  });
});

describe("redefinition, read-only and untrusted", () => {
  test("E_REDEFINED within a unit, reported at the second name", () => {
    const e = fails(new Env(), ": f ( -- int ) 1 ;\n: f ( -- int ) 2 ;");
    expect(e.code).toBe("E_REDEFINED");
    at(e, 2, 3);
    expect(e.word).toBe("user:f");
  });

  test("E_REDEFINED for constants, variables and the setter", () => {
    const env = new Env();
    expect(fails(env, "1 CONSTANT a 2 CONSTANT a").code).toBe("E_REDEFINED");
    expect(fails(env, "1 VARIABLE a 2 CONSTANT a").code).toBe("E_REDEFINED");
    expect(fails(env, "1 VARIABLE a : a! ( int -- ) drop ;").code).toBe("E_REDEFINED");
    expect(fails(env, ": a ( -- ) ; 1 VARIABLE a").code).toBe("E_REDEFINED");
  });

  test("across units redefinition is allowed with W_REDEFINED; the same name elsewhere is not", () => {
    const env = new Env();
    env.load(": f ( -- int ) 1 ;");
    const r = env.compile(": f ( -- int ) 2 ; IN: other : f ( -- int ) 3 ; : dup ( -- int ) 1 ;");
    expect(r.warnings.map((w) => w.qname)).toEqual(["user:f"]);
  });

  test("at the console redefinition within one input is allowed", () => {
    const env = new Env();
    const r = env.compile(
      ": f ( -- int ) 1 ; f : f ( -- int ) 2 ; f 1 CONSTANT c 2 CONSTANT c",
      "console",
    );
    expect(r.warnings.map((w) => w.code)).toEqual(["W_REDEFINED", "W_REDEFINED"]);
    expect(r.segments).toHaveLength(2);
    const first = r.segments[0]?.code.code[0] as Extract<Instruction, { op: "call" }>;
    const second = r.segments[1]?.code.code[0] as Extract<Instruction, { op: "call" }>;
    expect(first.entry).not.toBe(second.entry);
    expect(first.entry.code).not.toBeNull();
    r.txn.rollback();
  });

  test("IN: core is E_READONLY unless trusted; definitions into core likewise", () => {
    const env = new Env();
    const e = fails(env, "IN: core\n: x ( -- int ) 1 ;");
    expect(e.code).toBe("E_READONLY");
    at(e, 1, 5);
    const d = fails(env, ": x ( -- int ) 1 ;", "unit", { scope: { current: "core", using: [] } });
    expect(d.code).toBe("E_READONLY");
    at(d, 1, 3);
    const c = fails(env, "1 CONSTANT x", "unit", { scope: { current: "core", using: [] } });
    expect(c.code).toBe("E_READONLY");
    const t = env.compile("IN: core : x ( -- int ) 1 ; 1 CONSTANT y", "unit", { trusted: true });
    expect(t.defined).toEqual(["core:x", "core:y"]);
    t.txn.rollback();
  });

  test("META: on a core word needs a trusted load", () => {
    const env = new Env();
    const scope = { current: "core", using: [] };
    const e = fails(env, 'META: + doc "x" ; ;', "unit", { scope });
    expect(e.code).toBe("E_READONLY");
    const t = env.compile('META: + doc "x" ; ;', "unit", { scope, trusted: true });
    t.txn.commit();
    expect(env.entry("core:+").meta.doc).toBe("x");
  });

  test("PRIMITIVE: untrusted first, then unregistered, then redefined", () => {
    const env = new Env();
    // Checked before the registry is consulted: even a registered name learns nothing.
    expect(fails(env, "IN: fz PRIMITIVE twice").code).toBe("E_UNTRUSTED");
    expect(fails(env, "IN: fz PRIMITIVE nosuch").code).toBe("E_UNTRUSTED");
    expect(fails(env, "PRIMITIVE", "unit").code).toBe("E_UNTRUSTED");
    const none = fails(env, "IN: fz\nPRIMITIVE nosuch", "unit", { trusted: true });
    expect(none.code).toBe("E_NO_PRIMITIVE");
    at(none, 2, 11);
    expect(none.detail).toMatchObject({ name: "nosuch", vocab: "fz" });
    const dup = fails(env, "IN: fz PRIMITIVE twice PRIMITIVE twice", "unit", { trusted: true });
    expect(dup.code).toBe("E_REDEFINED");
    // Unregistered beats redefined.
    expect(
      fails(env, "IN: fz PRIMITIVE twice PRIMITIVE nosuch", "unit", { trusted: true }).code,
    ).toBe("E_NO_PRIMITIVE");
  });

  test("a trusted unit binds a registered, unbound primitive", () => {
    const env = new Env();
    const r = env.load("IN: fz PRIMITIVE twice : t ( -- int ) 4 twice ;", { trusted: true });
    expect(r.defined).toEqual(["fz:twice", "fz:t"]);
    const e = env.entry("fz:twice");
    expect(e.kind).toBe("primitive");
    expect(e.meta.effect.text).toBe("( n:int -- int )");
    expect(ops(env.code("fz:t"))).toEqual(["lit 4", "prim fz:twice", "ret"]);
    expectValidMeta(e.meta);
  });
});

describe("META: discovery clauses", () => {
  test("use-when and link are stored; a second block adds links and cannot reset use-when", () => {
    const env = new Env();
    env.load(`
      : f ( int -- int ) ;
      META: f use-when "Reach for it." ; link "https://a.example/1" "One" ; ;
      META: f link "https://a.example/2" ; ;
    `);
    const m = env.entry("user:f").meta;
    expect(m.discovery).toStrictEqual({
      useWhen: "Reach for it.",
      links: [
        { url: "https://a.example/1", label: "One" },
        { url: "https://a.example/2", label: null },
      ],
    });
    expectValidMeta(m);
    expect(fails(env, 'META: f use-when "again" ; ;').code).toBe("E_META");
    expect(fails(env, 'META: f link "https://a.example/2" ; ;').code).toBe("E_META");
  });

  test("a word without the clauses has no discovery member", () => {
    const env = new Env();
    env.load(': f ( int -- int ) ; META: f doc "d" ; ;');
    expect("discovery" in env.entry("user:f").meta).toBe(false);
  });

  test("inverse is checked at the end of the unit, with the clause position", () => {
    const env = new Env();
    const e = fails(env, ": a ( int -- int ) ;\nMETA: a\n  inverse nosuch ;\n;");
    expect(e).toMatchObject({ code: "E_META", word: "user:a" });
    expect(e.detail).toStrictEqual({ clause: "inverse", name: "user:nosuch" });
    at(e, 3, 3);
    // a private target is not acceptable
    expect(
      fails(env, ": a ( int -- int ) ; : _p ( int -- int ) ; META: a inverse _p ; ;").code,
    ).toBe("E_META");
    // a failed unit leaves nothing behind
    expect(env.dictionary.vocab("user")?.words.has("a") ?? false).toBe(false);
  });

  test("inverse: forward reference, alias resolved to canonical, self, earlier unit", () => {
    const env = new Env();
    env.load(`
      : a ( int -- int ) ;
      META: a inverse b ; ;
      : b ( int -- int ) ;
      : flip ( int -- int ) ;
      META: flip alias flop ; inverse flop ; ;
    `);
    expect(env.entry("user:a").meta.discovery?.inverse).toBe("user:b");
    expect(env.entry("user:flip").meta.discovery?.inverse).toBe("user:flip");
    // the target may be committed already
    env.load("META: b inverse a ; ;");
    expect(env.entry("user:b").meta.discovery?.inverse).toBe("user:a");
    // and an alias committed earlier still resolves to the canonical name
    env.load(": c ( int -- int ) ; META: c inverse flop ; ;");
    expect(env.entry("user:c").meta.discovery?.inverse).toBe("user:flip");
    // console mode: checked before commit
    expect(fails(env, "META: c inverse zzz ; ;", "console").code).toBe("E_META");
    expect(env.entry("user:c").meta.discovery?.inverse).toBe("user:flip");
  });

  test("inverse in another vocabulary is E_META at the clause", () => {
    const env = new Env();
    env.load("IN: other : b ( int -- int ) ;");
    const e = fails(env, "IN: user : a ( int -- int ) ; META: a inverse other:b ; ;");
    expect(e.code).toBe("E_META");
    expect(e.detail.clause).toBe("inverse");
  });

  test("helper: op false, still public and callable; META: on a later block keeps it", () => {
    const env = new Env();
    env.load(`
      IN: lib
      : twice ( int -- int ) 2 * ;
      META: twice helper ; ;
      META: twice doc "later" ; ;
      : plain ( int -- int ) ;
    `);
    const m = env.entry("lib:twice").meta;
    expect(m).toMatchObject({ op: false, exported: true, doc: "later" });
    expect("discovery" in m).toBe(false);
    expect(env.entry("lib:plain").meta.op).toBe(true);
    expect(fails(env, "META: twice helper x ; ;").code).toBe("E_META");
  });

  test("checks is reserved", () => {
    const env = new Env();
    const e = fails(env, ": f ( int -- int ) ; META: f checks input utf8 ; ;");
    expect(e.code).toBe("E_META");
    expect(e.message).toContain("`checks` is reserved for a later release");
  });
});

describe("META:", () => {
  test("E_META for an undefined word, a private word, bad clauses", () => {
    const env = new Env();
    const u = fails(env, "META: nosuch\n;");
    expect(u.code).toBe("E_META");
    at(u, 1, 7);
    expect(fails(env, ": _p ( -- ) ; META: _p ;").code).toBe("E_META");
    const base = ": f ( int p:int -- int ) ;\nMETA: f\n";
    expect(fails(env, `${base}  bogus x ;\n;`).code).toBe("E_META");
    expect(fails(env, `${base}  param nope "x" ;\n;`).code).toBe("E_META");
    expect(fails(env, `${base}  doc "a" ; doc "b" ;\n;`).code).toBe("E_META");
    expect(fails(env, `${base}  doc 3 ;\n;`).code).toBe("E_META");
    expect(fails(env, `${base}  doc ;\n;`).code).toBe("E_META");
    expect(fails(env, `${base}  "x" ;\n;`).code).toBe("E_META");
    expect(fails(env, `${base}  param p "a" ; param p "b" ;\n;`).code).toBe("E_META");
    expect(fails(env, `${base}  see-also "x" ;\n;`).code).toBe("E_META");
    const e = fails(env, `${base}  doc 3 ;\n;`);
    expect(e.word).toBe("user:f");
    at(e, 3, 7);
  });

  test("a clause that is never closed, and a block that is never closed", () => {
    const env = new Env();
    const base = ": f ( int -- int ) ;\nMETA: f\n";
    expect(fails(env, `${base}  doc "x"`).code).toBe("E_SYNTAX");
    expect(fails(env, `${base}  doc "x" ;`).code).toBe("E_SYNTAX");
    expect(fails(env, ": f ( int -- int ) ; META: f").code).toBe("E_SYNTAX");
    expect(fails(env, "META: f").code).toBe("E_META");
  });

  test("a leading declaration plus META: doc is E_META (C98)", () => {
    expect(fails(new Env(), ': f ( int -- int ) "one" doc ; META: f doc "two" ; ;').code).toBe(
      "E_META",
    );
    expect(fails(new Env(), ': f ( int -- int ) "one" doc "two" doc ;').code).toBe("E_META");
    expect(fails(new Env(), ': f ( int -- int ) "one" category "two" category ;').code).toBe(
      "E_META",
    );
  });

  test("a string followed by doc after the first body item is not a declaration", () => {
    const e = fails(new Env(), ': f ( int -- int ) 1 drop "x" doc ;');
    expect(e.code).toBe("E_UNDEFINED");
    expect(e.detail).toMatchObject({ name: "doc" });
  });

  test("alias errors: reserved, invalid, collisions", () => {
    const env = new Env();
    env.load(": taken ( -- ) ;");
    const base = ": f ( int -- int ) ;\nMETA: f\n";
    expect(fails(env, `${base}  alias true ;\n;`).code).toBe("E_NAME");
    expect(fails(env, `${base}  alias a:b ;\n;`).code).toBe("E_NAME");
    expect(fails(env, `${base}  alias 3 ;\n;`).code).toBe("E_NAME");
    expect(fails(env, `${base}  alias IN: ;\n;`).code).toBe("E_NAME");
    expect(fails(env, `${base}  alias f ;\n;`).code).toBe("E_REDEFINED");
    expect(fails(env, `${base}  alias taken ;\n;`).code).toBe("E_REDEFINED");
    // Repeating an alias inside one block is harmless.
    expect(env.compile(`${base}  alias x ;\n  alias x ;\n;`).defined).toEqual(["user:f", "user:x"]);
    expect(fails(env, `${base}  alias ;\n;`).code).toBe("E_META");
    expect(fails(env, ": g ( -- ) ; : x ( -- ) ; META: g alias x ; ;").code).toBe("E_REDEFINED");
  });

  test("clauses accumulate across blocks; aliases are bound and listed", () => {
    const env = new Env();
    const r = env.load(`
      : f ( int p:int[1..5]=2 q:str="x" -- int ) ;
      META: f
        doc "Document" ;
        param p "the p" ;
        alias ff fff ;
        see-also g user:h ;
      ;
      META: f
        category "Cat" ;
        version "2" ;
        param q "the q" ;
        alias ffff ;
        see-also g core:dup ;
      ;
    `);
    expect(r.defined).toEqual(["user:f", "user:ff", "user:fff", "user:ffff"]);
    const m = env.entry("user:f").meta;
    expect(m).toMatchObject({
      doc: "Document",
      category: "Cat",
      version: "2",
      aliases: ["ff", "fff", "ffff"],
      seeAlso: ["user:g", "user:h", "core:dup"],
    });
    expect(m.params.map((p) => p.doc)).toEqual(["the p", "the q"]);
    expect(m.effect.inputs.map((s) => s.doc)).toEqual([undefined, "the p", "the q"]);
    expect(env.entry("user:ffff")).toBe(env.entry("user:f"));
    expectValidMeta(m);
  });

  test("a second block cannot reset a field or re-document a parameter", () => {
    const env = new Env();
    const base = ': f ( int p:int -- int ) "d" doc ; META: f param p "a" ; ;\n';
    expect(fails(env, `${base}META: f doc "again" ; ;`).code).toBe("E_META");
    expect(fails(env, `${base}META: f param p "again" ; ;`).code).toBe("E_META");
    expect(fails(env, `${base}META: f version "2" ; ; META: f version "3" ; ;`).code).toBe(
      "E_META",
    );
    expect(fails(env, `${base}META: f alias x ; ; META: f alias x ; ;`).code).toBe("E_REDEFINED");
  });

  test("META: on a word from an earlier unit is staged, applied on commit, hash unchanged", () => {
    const env = new Env();
    env.load(": f ( int p:int -- int ) ;");
    const entry = env.entry("user:f");
    const before = entry.meta;
    const r = env.compile(`META: f doc "late" ; param p "pd" ; alias g ; ;`);
    expect(r.defined).toEqual(["user:g"]);
    // Nothing changes until commit.
    expect(entry.meta).toBe(before);
    expect(env.dictionary.vocab("user")?.words.has("g")).toBe(false);
    r.txn.commit();
    expect(entry.meta.doc).toBe("late");
    expect(entry.meta.aliases).toEqual(["g"]);
    expect(entry.meta.params[0]?.doc).toBe("pd");
    expect(entry.meta.hash).toBe(before.hash);
    expect(entry.meta.source).toEqual(before.source);
    // And a later unit sees the committed state: doc cannot be set twice, p cannot be re-documented.
    expect(fails(env, 'META: f doc "x" ; ;').code).toBe("E_META");
    expect(fails(env, 'META: f param p "x" ; ;').code).toBe("E_META");
    expect(fails(env, "META: f alias g ; ;").code).toBe("E_REDEFINED");
    // An alias name can address the entry too.
    const r2 = env.compile('META: g category "c" ; ;');
    r2.txn.commit();
    expect(entry.meta.category).toBe("c");
    expect(entry.meta.aliases).toEqual(["g"]);
  });

  test("META: for constants, variables and primitives", () => {
    const env = new Env();
    env.load('1 CONSTANT c 2 VARIABLE v META: c doc "const" ; alias cc ; ; META: v! doc "set" ; ;');
    expect(env.entry("user:c").meta.doc).toBe("const");
    expect(env.entry("user:cc")).toBe(env.entry("user:c"));
    expect(env.entry("user:v!").meta.doc).toBe("set");
    // A primitive that already has doc and category cannot have them set again.
    const scope = { current: "fx", using: [] };
    const t = env.compile('META: now doc "x" ; alias current-time ; ;', "unit", { scope });
    expect(t.defined).toEqual(["fx:current-time"]);
    t.txn.commit();
    expect(env.entry("fx:now").meta).toMatchObject({ doc: "x", aliases: ["current-time"] });
    expect(env.entry("fx:current-time")).toBe(env.entry("fx:now"));
    expect(fails(env, 'META: roll doc "again" ; ;', "unit", { scope }).code).toBe("E_META");
  });

  test("a failing META: leaves no trace", () => {
    const env = new Env();
    env.load(": f ( int -- int ) ;");
    expect(() => env.compile("META: f alias ok ; ; META: f bogus ; ;")).toThrow(ForgeError);
    expect(env.dictionary.vocab("user")?.words.has("ok")).toBe(false);
  });
});

describe("W_SHADOW and W_REDEFINED", () => {
  test("a local that shadows a visible word warns at its header item", () => {
    const env = new Env();
    const r = env.compile(": f ( int len:int  x:int -- int ) len ;");
    expect(r.warnings).toEqual([
      {
        code: "W_SHADOW",
        message: expect.stringContaining("len"),
        qname: "user:f",
        pos: { offset: 10, line: 1, col: 11 },
      },
    ]);
  });

  test("positions survive multi-line headers, string defaults and CR / CRLF breaks", () => {
    const env = new Env();
    const lf = env.compile(': f ( a:int\n   s:str=" ) -- "\n  len:int\n  -- int ) len ;');
    expect(lf.warnings.map((w) => w.pos)).toEqual([{ offset: 32, line: 3, col: 3 }]);
    const crlf = env.compile(': f ( a:int\r\n   s:str="\\" len"\r\n len:int -- int ) len ;');
    expect(crlf.warnings.map((w) => [w.pos?.line, w.pos?.col])).toEqual([[3, 2]]);
    const cr = env.compile(": f ( a:int\r len:int -- int ) len ;");
    expect(cr.warnings.map((w) => [w.pos?.line, w.pos?.col])).toEqual([[2, 2]]);
    const brackets = env.compile(": f ( x:int[1..2] len:choice{a|b} -- int ) len ;");
    expect(brackets.warnings.map((w) => w.pos?.col)).toEqual([19]);
  });

  test("escaped brackets in a pattern do not confuse header item positions", () => {
    const r = new Env().compile(": f ( x:str[/\\[a/] len:int -- int ) len ;");
    expect(r.warnings.map((w) => w.pos?.col)).toEqual([20]);
  });

  test("when the header items cannot be matched to the inputs the header position is used", () => {
    const env = new Env();
    const src = ": f ( x ) len ;";
    const effect = parseHeader("len:int a:int -- int", { offset: 0, line: 1, col: 1 }, "lenient");
    const r = compile(read(src), src, env.ctx("unit", { parseHeader: () => effect }));
    expect(r.warnings.map((w) => w.pos)).toEqual([{ offset: 4, line: 1, col: 5 }]);
    r.txn.rollback();
  });

  test("a local named like a private word of the current vocabulary or an import", () => {
    const env = new Env();
    env.load("IN: lib : pub ( -- int ) 1 ; : _priv ( -- int ) 1 ;");
    const r = env.compile("IN: lib : f ( pub:int -- int ) pub ;");
    expect(r.warnings.map((w) => w.code)).toEqual(["W_SHADOW"]);
    const q = env.compile("USING: lib ; : f ( pub:int -- int ) pub ;");
    expect(q.warnings.map((w) => w.code)).toEqual(["W_SHADOW"]);
    // Parameter names are lower-case words, so a private word (`_x`) can never be shadowed.
  });

  test("no warning when the name is free", () => {
    expect(new Env().compile(": f ( nothing:int -- int ) nothing ;").warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Console
// ---------------------------------------------------------------------------------------------

describe("console mode", () => {
  test("segments between forms, each recording the scope where it appears", () => {
    const env = new Env();
    env.load('IN: lib : who ( -- str ) "lib" ;');
    const r = env.compile(
      "1 2 IN: lib who USING: lib ; who : x ( -- int ) 7 ; x IN: user 3 dup",
      "console",
    );
    expect(r.segments.map((s) => s.scope)).toEqual([
      { current: "user", using: [] },
      { current: "lib", using: [] },
      { current: "lib", using: ["lib"] },
      { current: "lib", using: ["lib"] },
      { current: "user", using: ["lib"] },
    ]);
    expect(r.segments.map((s) => ops(s.code))).toEqual([
      ["lit 1", "lit 2", "ret"],
      ["call lib:who", "ret"],
      ["call lib:who", "ret"],
      ["call lib:x", "ret"],
      ["lit 3", "stack dup", "ret"],
    ]);
    expect(r.scope).toEqual({ current: "user", using: ["lib"] });
    expect(r.defined).toEqual(["lib:x"]);
    r.txn.rollback();
  });

  test("a segment is an anonymous word: no inputs, unchecked output, no locals", () => {
    const env = new Env();
    const r = env.compile("5 [ dup * ] call", "console");
    const seg = r.segments[0]?.code as CompiledWord;
    expect(seg.qname).toBe("<console>");
    expect(seg.effect).toMatchObject({
      inputs: [],
      outputs: [],
      unchecked: true,
      text: "( -- .. )",
    });
    expect(seg.nlocals).toBe(0);
    expect(seg.localNames).toEqual([]);
    expect(seg.deps.map((d) => d.qname)).toEqual(["core:dup", "core:*", "core:call"]);
    expect(ops(seg)).toEqual(
      ["lit 5", "quot 6", "stack dup", "prim core:*", "ret", "callq", "ret"].map((x, i) =>
        i === 1 ? "quot 5" : x,
      ),
    );
    // The final ret sits at the end of the last token.
    expect(seg.positions[seg.positions.length - 1]).toEqual({ offset: 16, line: 1, col: 17 });
    r.txn.rollback();
  });

  test("definitions are visible to later segments only (sequential, early binding)", () => {
    const env = new Env();
    expect(fails(env, "f : f ( -- int ) 1 ;", "console").code).toBe("E_UNDEFINED");
    const r = env.compile(": f ( -- int ) 1 ; f : g ( -- int ) f ; g", "console");
    expect(r.segments).toHaveLength(2);
    r.txn.rollback();
  });

  test("VOCAB, IN: and a vocabulary created on the fly", () => {
    const env = new Env();
    const r = env.compile("VOCAB demo : x ( -- int ) 7 ; x demo:x", "console");
    expect(r.defined).toEqual(["demo:x"]);
    expect(r.scope.current).toBe("demo");
    expect(r.segments[0]?.scope.current).toBe("demo");
    expect(ops(r.segments[0]?.code as CompiledWord)).toEqual(["call demo:x", "call demo:x", "ret"]);
    r.txn.commit();
    expect(env.dictionary.vocab("demo")).toBeDefined();
  });

  test("CONSTANT and VARIABLE at the console", () => {
    const env = new Env();
    const r = env.compile("3 CONSTANT three three 0 VARIABLE n n 1 n!", "console");
    expect(r.defined).toEqual(["user:three", "user:n", "user:n!"]);
    expect(r.segments.map((s) => ops(s.code))).toEqual([
      ["lit 3", "ret"],
      ["varGet user:n", "lit 1", "varSet user:n!", "ret"],
    ]);
    r.txn.rollback();
  });

  test("empty input and only forms produce no segments; a unit never does", () => {
    const env = new Env();
    expect(env.compile("", "console").segments).toEqual([]);
    expect(env.compile("IN: a IN: b", "console").segments).toEqual([]);
    expect(env.compile(": f ( -- ) ;", "unit").segments).toEqual([]);
  });

  test("a compile error rolls everything back, including scope changes", () => {
    const env = new Env();
    const start: Scope = { current: "user", using: [] };
    const e = fails(env, "IN: demo : x ( -- int ) 1 ; nosuch", "console", { scope: start });
    expect(e.code).toBe("E_UNDEFINED");
    expect(start).toEqual({ current: "user", using: [] });
    expect(env.dictionary.vocab("demo")).toBeUndefined();
    const t = env.txns[env.txns.length - 1] as DictionaryTxn;
    expect(() => t.commit()).toThrow(ForgeError);
  });

  test("the starting scope is not mutated by IN: and USING:", () => {
    const env = new Env();
    env.load("IN: alpha : a ( -- int ) 1 ;");
    const start: Scope = { current: "user", using: [] };
    const r = env.compile("IN: alpha USING: alpha ;", "console", { scope: start });
    expect(start).toEqual({ current: "user", using: [] });
    expect(r.scope).toEqual({ current: "alpha", using: ["alpha"] });
    r.txn.rollback();
  });
});

// ---------------------------------------------------------------------------------------------
// Atomicity
// ---------------------------------------------------------------------------------------------

describe("atomicity", () => {
  test("a failing unit rolls back its transaction and defines nothing (C85)", () => {
    const env = new Env();
    const e = fails(env, ": ok ( -- int ) 1 ;\n: broken ( -- int ) nosuch ;");
    expect(e.code).toBe("E_UNDEFINED");
    expect(env.dictionary.vocab("user")).toBeUndefined();
    const t = env.txns[env.txns.length - 1] as DictionaryTxn;
    expect(() => t.commit()).toThrow(/already committed or rolled back/);
  });

  test("a successful compile is invisible until the caller commits", () => {
    const env = new Env();
    const r = env.compile(': ok ( -- int ) 1 ; 5 CONSTANT five META: ok doc "d" ; ;');
    expect(env.dictionary.vocab("user")).toBeUndefined();
    r.txn.commit();
    expect(env.entry("user:ok").meta.doc).toBe("d");
    expect(env.entry("user:five").kind).toBe("constant");
  });

  test("a rolled-back META: edit and alias are discarded", () => {
    const env = new Env();
    env.load(": f ( int -- int ) ;");
    const r = env.compile('META: f doc "x" ; alias g ; ;');
    r.txn.rollback();
    expect(env.entry("user:f").meta.doc).toBeNull();
    expect(env.dictionary.vocab("user")?.words.has("g")).toBe(false);
  });

  test("non-ForgeError failures also roll back and propagate", () => {
    const env = new Env();
    const ctx = env.ctx("unit", {
      parseHeader: () => {
        throw new TypeError("boom");
      },
    });
    const src = ": f ( -- ) ;";
    expect(() => compile(read(src), src, ctx)).toThrow(TypeError);
    expect(() => (env.txns[env.txns.length - 1] as DictionaryTxn).commit()).toThrow(ForgeError);
  });
});

// ---------------------------------------------------------------------------------------------
// CONSTANT and VARIABLE
// ---------------------------------------------------------------------------------------------

describe("CONSTANT and VARIABLE", () => {
  test("entries, effects, source text and hashes", () => {
    const env = new Env();
    const r = env.load(
      "256 CONSTANT block-size  \"s\" CONSTANT label 'a' CONSTANT letter 1.5 CONSTANT pi #[ 01 ] CONSTANT b true CONSTANT yes",
    );
    expect(r.defined).toHaveLength(6);
    const types = ["block-size", "label", "letter", "pi", "b", "yes"].map((n) => {
      const e = env.entry(`user:${n}`);
      expect(e.kind).toBe("constant");
      expectValidMeta(e.meta);
      return e.meta.effect.text;
    });
    expect(types).toEqual([
      "( -- int )",
      "( -- str )",
      "( -- int )",
      "( -- num )",
      "( -- bytes )",
      "( -- bool )",
    ]);
    const c = env.entry("user:block-size");
    expect(c.meta.source.text).toBe("256 CONSTANT block-size");
    expect(c.meta.source.pos).toEqual({ offset: 0, line: 1, col: 1 });
    expect(c.meta.hash).toBe(sha256("256 CONSTANT block-size\n"));
    expect(c.meta.op).toBe(false);
    expect(c.kind === "constant" && c.value).toEqual(int(256));
    const letter = env.entry("user:letter");
    expect(letter.kind === "constant" && letter.value).toEqual(int(97));
  });

  test("source text keeps the author's spacing", () => {
    const env = new Env();
    env.load("0   VARIABLE   counter");
    expect(env.entry("user:counter").meta.source.text).toBe("0   VARIABLE   counter");
  });

  test("a variable defines a getter and a setter sharing a variable id", () => {
    const env = new Env();
    const r = env.load("0 VARIABLE counter");
    expect(r.defined).toEqual(["user:counter", "user:counter!"]);
    const g = env.entry("user:counter");
    const s = env.entry("user:counter!");
    if (g.kind !== "variable" || s.kind !== "variable") throw new Error("variables expected");
    expect(g.role).toBe("get");
    expect(s.role).toBe("set");
    expect(g.varId).toMatch(/^user:counter#\d+$/);
    expect(s.varId).toBe(g.varId);
    expect(g.initial).toEqual(int(0));
    expect(g.meta.effect.text).toBe("( -- int )");
    expect(s.meta.effect.text).toBe("( int -- )");
    expect(s.meta.hash).toBe(g.meta.hash);
    expect(s.meta.source.text).toBe("0 VARIABLE counter");
    expectValidMeta(g.meta);
    expectValidMeta(s.meta);
  });

  test("every VARIABLE definition gets its own variable id", () => {
    const env = new Env();
    env.load("0 VARIABLE v");
    const first = env.entry("user:v");
    env.load("0 VARIABLE v");
    const second = env.entry("user:v");
    expect(first).not.toBe(second);
    expect(first.kind === "variable" && second.kind === "variable" && first.varId).not.toBe(
      second.kind === "variable" && second.varId,
    );
  });

  test("name hygiene: reserved names and an existing name in another vocabulary are fine", () => {
    const env = new Env();
    expect(env.compile("1 CONSTANT dup").warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Hash and effect labels
// ---------------------------------------------------------------------------------------------

describe("hash (spec 12.4)", () => {
  test("a word's hash covers its callees (C169)", () => {
    const env = new Env();
    env.load("IN: v1 : base ( -- int ) 1 ; : top ( -- int ) base ;");
    env.load("IN: v2 : base ( -- int ) 2 ; : top ( -- int ) base ;");
    expect(env.entry("v1:top").meta.hash).not.toBe(env.entry("v2:top").meta.hash);
    // The dependency line carries the callee's qualified name, so even identical text differs.
    env.load("IN: v3 : base ( -- int ) 1 ; : top ( -- int ) base ;");
    expect(env.entry("v3:top").meta.hash).not.toBe(env.entry("v1:top").meta.hash);
  });

  test("the hash is SHA-256 of own text, a newline and the sorted dependency lines", () => {
    const env = new Env();
    env.load(": a ( -- int ) 1 ;\n7 CONSTANT k\n: b ( int -- int ) k a + dup drop ;");
    const b = env.entry("user:b");
    const lines = ["core:+", "core:dup", "core:drop", "user:a", "user:k"].map((q) => {
      return `${q} ${env.entry(q).meta.hash}`;
    });
    expect(b.meta.hash).toBe(sha256(`${b.meta.source.text}\n${lines.sort().join("\n")}`));
    // A leaf hashes ownText + "\n".
    const a = env.entry("user:a");
    expect(a.meta.hash).toBe(sha256(": a ( -- int ) 1 ;\n"));
    // computeHash agrees.
    expect(computeHash(": a ( -- int ) 1 ;", [])).toBe(a.meta.hash);
  });

  test("the hash is transitive through intermediate words", () => {
    const env = new Env();
    env.load(": a ( -- int ) 1 ; : b ( -- int ) a ; : c ( -- int ) b ;");
    const before = env.entry("user:c").meta.hash;
    const env2 = new Env();
    env2.load(": a ( -- int ) 2 ; : b ( -- int ) a ; : c ( -- int ) b ;");
    expect(env2.entry("user:c").meta.hash).not.toBe(before);
  });

  test("recurse does not make a word depend on itself; constants and variables are covered", () => {
    const env = new Env();
    env.load(": r ( n:int -- int ) n recurse ;");
    expect(env.entry("user:r").meta.hash).toBe(sha256(": r ( n:int -- int ) n recurse ;\n"));
    const a = new Env();
    a.load("1 CONSTANT k : f ( -- int ) k ;");
    const b = new Env();
    b.load("2 CONSTANT k : f ( -- int ) k ;");
    expect(a.entry("user:f").meta.hash).not.toBe(b.entry("user:f").meta.hash);
  });

  test("lowering and META: do not change a hash", () => {
    const env = new Env();
    env.load(": f ( b:bool -- int ) b [ 1 ] [ 2 ] if ;");
    const h = env.entry("user:f").meta.hash;
    const r = env.compile('META: f doc "x" ; alias g ; ;');
    r.txn.commit();
    expect(env.entry("user:f").meta.hash).toBe(h);
  });

  test("intrinsics and primitives hash their name, effect and version", () => {
    const dup = createIntrinsicEntry("dup");
    expect(dup.meta.hash).toBe(sha256("intrinsic core:dup ( a -- a a ) 1\n"));
    const now = createPrimitiveEntry(FX_PRIMS[0] as PrimitiveDef);
    expect(now.meta.hash).toBe(sha256("primitive fx:now ( -- int ) 1\n"));
    const versioned = createPrimitiveEntry({ ...(FX_PRIMS[0] as PrimitiveDef), version: "3" });
    expect(versioned.meta.hash).toBe(sha256("primitive fx:now ( -- int ) 3\n"));
  });
});

describe("effect labels", () => {
  test("a word that calls a labelled primitive carries its label (C113)", () => {
    const env = new Env();
    env.load(": stamp ( -- int ) fx:now ;");
    expect(env.entry("user:stamp").meta.effects).toEqual(["+time"]);
    expect(env.code("user:stamp").effects).toEqual(["+time"]);
  });

  test("labels are transitive, include quotations, and are sorted and deduplicated", () => {
    const env = new Env();
    env.load(`
      : stamp ( -- int ) fx:now ;
      : mid ( -- .. ) [ stamp ] call fx:roll ;
      : top ( -- .. ) [ [ mid ] call ] call 1 2 fx:add-async fx:now ;
      : pure ( -- int ) 1 ;
      : caller ( -- int ) pure ;
    `);
    expect(env.entry("user:mid").meta.effects).toEqual(["+random", "+time"]);
    expect(env.entry("user:top").meta.effects).toEqual(["+async", "+random", "+time"]);
    expect(env.entry("user:pure").meta.effects).toEqual([]);
    expect(env.entry("user:caller").meta.effects).toEqual([]);
  });

  test("labels of a primitive's definition count even when its meta lacks them", () => {
    const env = new Env();
    const e = env.entry("fx:now");
    if (e.kind !== "primitive") throw new Error("primitive expected");
    e.meta = { ...e.meta, effects: [] };
    env.load(": t ( -- int ) fx:now ;");
    expect(env.entry("user:t").meta.effects).toEqual(["+time"]);
  });

  test("console segments carry labels too", () => {
    const env = new Env();
    const r = env.compile("fx:now fx:roll", "console");
    expect(r.segments[0]?.code.effects).toEqual(["+random", "+time"]);
    r.txn.rollback();
  });
});

// ---------------------------------------------------------------------------------------------
// Entry helpers
// ---------------------------------------------------------------------------------------------

describe("intrinsic and primitive entry helpers", () => {
  test("one entry per intrinsic name, with valid metadata", () => {
    expect(INTRINSIC_NAMES).toHaveLength(40);
    // the intrinsics of the table of docs/LANGUAGE.md section 13 (vocab/core.test.ts parses it)
    expect([...INTRINSIC_NAMES].sort()).toEqual([...CORE_INTRINSIC_WORDS].sort());
    const entries = createIntrinsicEntries();
    expect(entries.map((e) => e.intrinsic)).toEqual([...INTRINSIC_NAMES]);
    for (const e of entries) {
      expect(e.kind).toBe("intrinsic");
      expect(e.qname).toBe(`core:${e.name}`);
      expect(e.meta.kind).toBe("intrinsic");
      expect(e.meta.op).toBe(false);
      expect(e.meta.doc).toBeTruthy();
      expect(e.meta.source).toEqual({ unit: null, text: null, pos: null });
      expectValidMeta(e.meta);
    }
    const text = (n: string): string => entries.find((e) => e.name === n)?.meta.effect.text ?? "";
    expect(text("dup")).toBe("( a -- a a )");
    expect(text("clear")).toBe("( .. -- )");
    expect(text(".s")).toBe("( .. -- .. )");
    expect(text("if")).toBe("( bool quot quot -- .. )");
    expect(text("reduce")).toBe("( any init quot -- acc )");
    expect(text("times")).toBe("( n:int quot -- )");
    expect(text("depth")).toBe("( -- int )");
  });

  test("options: vocabulary, injected parser and hasher", () => {
    let parsed = 0;
    let hashed = 0;
    const e = createIntrinsicEntry("swap", {
      vocab: "mycore",
      parseHeader: (t, p, m) => {
        parsed++;
        return parseHeader(t, p, m);
      },
      sha256: (d) => {
        hashed++;
        return sha256(d);
      },
    });
    expect(e.qname).toBe("mycore:swap");
    expect(e.meta.qname).toBe("mycore:swap");
    expect([parsed, hashed]).toEqual([1, 1]);
    const p = createPrimitiveEntry(FX_PRIMS[0] as PrimitiveDef, {
      parseHeader: (t, pos, m) => {
        parsed++;
        return parseHeader(t, pos, m);
      },
      sha256: (d) => {
        hashed++;
        return sha256(d);
      },
    });
    expect([parsed, hashed]).toEqual([2, 2]);
    expect(p.qname).toBe("fx:now");
  });

  test("a primitive entry takes its metadata from the definition; parentheses are optional", () => {
    const withParens = createPrimitiveEntry(FX_PRIMS[3] as PrimitiveDef);
    expect(withParens.meta).toMatchObject({
      kind: "primitive",
      doc: "random",
      category: "fx",
      effects: ["+random"],
      version: "1",
      op: false,
    });
    expect(withParens.effect.text).toBe("( -- int )");
    const bare = createPrimitiveEntry(def("p", "q", "a:int -- int", { version: "2" }));
    expect(bare.effect.text).toBe("( a:int -- int )");
    expect(bare.meta.version).toBe("2");
    expect(bare.meta.op).toBe(true);
    expectValidMeta(bare.meta);
    expectValidMeta(withParens.meta);
  });
});

// ---------------------------------------------------------------------------------------------
// Odds and ends
// ---------------------------------------------------------------------------------------------

describe("token streams", () => {
  test("a token list without eof is accepted", () => {
    const env = new Env();
    const tokens = read(": f ( -- int ) 1 ;");
    const r = compile(tokens.slice(0, -1), ": f ( -- int ) 1 ;", env.ctx("unit"));
    expect(r.defined).toEqual(["user:f"]);
    r.txn.rollback();
    const empty = compile([], "", env.ctx("console"));
    expect(empty.segments).toEqual([]);
    empty.txn.rollback();
  });

  test("a stray header token", () => {
    const env = new Env();
    const toks = read(": f ( -- ) ;");
    const header = toks.find((t) => t.kind === "header") as Token;
    const eof = toks[toks.length - 1] as Token;
    const top = (() => {
      try {
        compile([header, eof], "", env.ctx("unit"));
      } catch (e) {
        return e as ForgeError;
      }
      throw new Error("expected an error");
    })();
    expect(top.code).toBe("E_SYNTAX");
    const body = [toks[0], toks[1], header, header, toks[3], eof] as Token[];
    const inBody = (() => {
      try {
        compile(body, ": f ( -- ) ( -- ) ;", env.ctx("unit"));
      } catch (e) {
        return e as ForgeError;
      }
      throw new Error("expected an error");
    })();
    expect(inBody.code).toBe("E_SYNTAX");
    expect(inBody.word).toBe("user:f");
  });
});

describe("the compiled word shape", () => {
  test("every word ends with ret and has parallel positions, including after quotations", () => {
    const env = new Env();
    env.load(U_ROT);
    for (const q of ["classical:rot", "classical:_rot-code"]) {
      const w = env.code(q);
      expect(w.code[w.code.length - 1]?.op).toBe("ret");
      expect(w.positions).toHaveLength(w.code.length);
    }
  });

  test("quot ends point just past the quotation's ret", () => {
    const env = new Env();
    env.load(": f ( -- .. ) [ 1 ] [ 2 [ 3 ] ] ;");
    const w = env.code("user:f");
    w.code.forEach((ins, i) => {
      if (ins.op === "quot") expect(w.code[ins.end - 1]?.op).toBe("ret");
      if (ins.op === "quot") expect(ins.end).toBeGreaterThan(i + 1);
    });
  });

  test("jump targets land inside the code", () => {
    const env = new Env();
    env.load(U_ROT);
    const w = env.code("classical:_rot-code");
    for (const ins of w.code) {
      if (ins.op === "jump" || ins.op === "jumpf") {
        expect(ins.target).toBeGreaterThan(0);
        expect(ins.target).toBeLessThan(w.code.length);
      }
    }
  });

  test("a trusted unit can use a Dictionary built elsewhere (no global state)", () => {
    const a = new Env();
    const b = new Env();
    a.load(": f ( -- int ) 1 ;");
    expect(b.dictionary.vocab("user")).toBeUndefined();
    expect(b.compile(": f ( -- int ) 1 ;").warnings).toEqual([]);
  });

  test("value payload types in literals are shared immutable values", () => {
    const env = new Env();
    env.load(': s ( -- str ) "x" ;');
    const lit = env.code("user:s").code[0] as Extract<Instruction, { op: "lit" }>;
    expect(lit.value).toEqual(str("x"));
  });

  test("dictionary hooks: WordEntry identity for aliases in deps", () => {
    const env = new Env();
    env.load(": f ( -- int ) 1 ; META: f alias g ; ; : h ( -- int ) g ;");
    expect(env.code("user:h").deps).toEqual([env.entry("user:f")]);
    expect((env.code("user:h").code[0] as Extract<Instruction, { op: "call" }>).entry).toBe(
      env.entry("user:f"),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Mid-body locals `:>` and `exit` (LANGUAGE-0.2.md sections 8 and 11.5)
// ---------------------------------------------------------------------------------------------

describe(":> mid-body locals", () => {
  test("a bound slot follows the header locals; nlocals and localNames include it", () => {
    const env = new Env();
    env.load(": f ( a:int -- int ) a 1 + :> b b b * ;");
    const w = env.code("user:f");
    expect(w.localNames).toEqual(["a", "b"]);
    expect(w.namedInputs).toEqual([0]);
    expect(w.nlocals).toBe(2);
    expect(ops(w)).toEqual([
      "local 0",
      "lit 1",
      "prim core:+",
      "bind 1",
      "local 1",
      "local 1",
      "prim core:*",
      "ret",
    ]);
  });

  test("an anonymous input and a bound local: slots start at 0", () => {
    const env = new Env();
    env.load(": f ( int -- int ) :> x x ;");
    const w = env.code("user:f");
    expect(w.localNames).toEqual(["x"]);
    expect(w.namedInputs).toEqual([]);
    expect(w.anonInputs).toEqual([0]);
    expect(w.nlocals).toBe(1);
  });

  test("the upper value is bound first; every :> gets a fresh slot", () => {
    const env = new Env();
    env.load(": f ( -- int ) 1 2 :> b :> a a b ;");
    const w = env.code("user:f");
    expect(w.localNames).toEqual(["b", "a"]);
    expect(ops(w)).toEqual(["lit 1", "lit 2", "bind 0", "bind 1", "local 1", "local 0", "ret"]);
  });

  test("sibling scopes reuse a name but never a slot", () => {
    const env = new Env();
    env.load(": f ( -- int ) 1 [ :> x x ] call 2 [ :> x x ] call + ;");
    const w = env.code("user:f");
    expect(w.localNames).toEqual(["x", "x"]);
    expect(w.nlocals).toBe(2);
    expect(ops(w).filter((o) => o.startsWith("bind"))).toEqual(["bind 0", "bind 1"]);
  });

  test("the name ends with its innermost enclosing body", () => {
    const env = new Env();
    expect(fails(env, ": h ( int -- int ) [ :> y y ] call y ;").code).toBe("E_UNDEFINED");
    // A name bound in the word body stays visible in later quotations.
    env.load(": g ( int -- int ) :> y [ y ] call ;");
    // A name bound in a lowered branch is scoped to that branch.
    expect(fails(env, ": k ( b:bool -- int ) b [ 1 :> z ] when z ;").code).toBe("E_UNDEFINED");
    // After the scope, the name resolves to a word again.
    const r = env.compile(
      ": m ( int -- int ) [ :> len len ] call drop 1 ; : n ( any -- int ) len ;",
    );
    r.txn.rollback();
  });

  test("only a quotation that binds directly (or in a part lowered into it) is own", () => {
    const env = new Env();
    env.load(`
      : plain ( -- ) [ 1 drop ] drop ;
      : own1 ( -- ) [ :> i [ i ] ] drop ;
      : own2 ( -- ) [ [ :> j ] when ] drop ;
      : inner ( -- ) [ 1 [ :> k ] map ] drop ;
    `);
    const quots = (q: string): string[] => ops(env.code(q)).filter((o) => o.startsWith("quot"));
    // Words and quotations that do not bind keep the plain instruction, with no extra key.
    for (const ins of env.code("user:plain").code) {
      if (ins.op === "quot") expect(Object.keys(ins)).toEqual(["op", "end"]);
    }
    expect(quots("user:plain")).toEqual(["quot 4"]);
    expect(quots("user:own1")).toEqual(["quot 6 own", "quot 5"]);
    // The `when` branch is lowered into the quotation, so the quotation binds.
    expect(quots("user:own2")[0]).toMatch(/ own$/);
    // `map`'s quotation binds; the outer one only contains it.
    const inner = quots("user:inner");
    expect(inner[0]).not.toMatch(/ own$/);
    expect(inner[1]).toMatch(/ own$/);
  });

  test("while and loop are not lowered when a quotation they run binds a local", () => {
    const env = new Env();
    env.load(`
      : lowered ( -- ) [ true ] [ 1 drop ] while [ true ] loop ;
      : w1 ( -- ) [ true ] [ 1 :> x ] while ;
      : w2 ( -- ) [ 1 :> x true ] [ 1 drop ] while ;
      : l1 ( -- ) [ 1 :> x true ] loop ;
      : l2 ( -- ) [ true [ 1 :> x ] when ] loop ;
      : ok ( -- ) [ true ] [ 1 [ :> x ] map drop ] while ;
      : cond ( b:bool -- ) b [ 1 :> x ] when b [ 1 :> y ] [ 2 :> z ] if ;
    `);
    const has = (q: string, op: string): boolean => ops(env.code(q)).includes(op);
    expect(has("user:lowered", "dmark")).toBe(true);
    for (const q of ["user:w1", "user:w2", "user:l1", "user:l2"]) {
      expect(has(q, "dmark")).toBe(false);
      expect(ops(env.code(q)).some((o) => o === "comb while" || o === "comb loop")).toBe(true);
    }
    expect(ops(env.code("user:w1")).filter((o) => o.endsWith(" own"))).toHaveLength(1);
    // A binding in a nested quotation of another combinator is that quotation's own business.
    expect(has("user:ok", "dmark")).toBe(true);
    // if, when and unless stay lowered.
    expect(ops(env.code("user:cond")).some((o) => o.startsWith("quot"))).toBe(false);
  });

  test("a deep nest of while loops compiles in linear time (the lowering decision is cached)", () => {
    const env = new Env();
    let body = "1 drop";
    for (let i = 0; i < 200; i++) body = `[ true ] [ ${body} ] while`;
    const t = performance.now();
    env.load(`: deep ( -- ) ${body} ;`);
    expect(performance.now() - t).toBeLessThan(2000);
  });

  test("errors", () => {
    const env = new Env();
    // Outside a definition (console), and inside a list literal at any depth.
    expect(fails(env, "1 :> x x", "console").code).toBe("E_SYNTAX");
    expect(fails(env, ": f ( -- list ) 1 { :> x x } ;").code).toBe("E_SYNTAX");
    expect(fails(env, ": f ( -- list ) 1 { [ :> x x ] call } ;").code).toBe("E_SYNTAX");
    // A quotation inside a console segment cannot bind either.
    expect(fails(env, "1 [ :> x x ] call", "console").code).toBe("E_SYNTAX");
    // Names: reserved words and non-words.
    for (const bad of ["recurse", "VARIABLE", ";", "IN:", ":>"]) {
      expect(fails(env, `: f ( int -- int ) :> ${bad} ;`).code, bad).toBe("E_NAME");
    }
    for (const bad of ["5", '"s"', "a:b", "[", "true", "0xff"]) {
      expect(fails(env, `: f ( int -- int ) :> ${bad} 1 ;`).code, bad).toBe("E_SYNTAX");
    }
    expect(fails(env, ": f ( int -- int ) :>").code).toBe("E_SYNTAX");
  });

  test("redefinition of a visible local is E_REDEFINED with the name; the error points at the name", () => {
    const env = new Env();
    const e1 = fails(env, ": f ( a:int -- int ) 1 :> a a ;");
    expect(e1.code).toBe("E_REDEFINED");
    expect(e1.detail).toMatchObject({ name: "a" });
    at(e1, 1, 27);
    expect(fails(env, ": f ( -- int ) 1 :> a 2 :> a a ;").code).toBe("E_REDEFINED");
    // A nested quotation sees the outer binding, so it cannot rebind it.
    expect(fails(env, ": f ( -- int ) 1 :> a [ 2 :> a a ] call ;").code).toBe("E_REDEFINED");
    // Once the inner scope has closed, the name is free again.
    env.compile(": f ( -- int ) [ 1 :> a a ] call 2 :> a a + ;").txn.rollback();
  });

  test("a bound name that hides a word emits W_SHADOW at the name; a plain name does not", () => {
    const env = new Env();
    const r = env.compile(": f ( int -- int ) :> len len ;");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatchObject({ code: "W_SHADOW", qname: "user:f" });
    expect(r.warnings[0]?.pos).toMatchObject({ line: 1, col: 23 });
    r.txn.rollback();
    const q = env.compile(": f ( int -- int ) :> total total ;");
    expect(q.warnings).toEqual([]);
    q.txn.rollback();
  });

  test("a failed compile leaves nothing behind", () => {
    const env = new Env();
    fails(env, ": f ( -- int ) 1 :> x ; : g ( -- int ) [ :> y ] y ;");
    expect(env.dictionary.vocab("user")?.words.has("f") ?? false).toBe(false);
  });

  test("the hash covers the :> text", () => {
    const env = new Env();
    env.load(": a ( int -- int ) :> x x ; : b ( int -- int ) :> y y ;");
    expect(env.entry("user:a").meta.source.text).toContain(":> x");
    expect(env.entry("user:a").meta.hash).not.toBe(env.entry("user:b").meta.hash);
  });
});

describe("code of words without :> or exit is unchanged", () => {
  // The whole-bundle comparison against the base was a one-off check (WP 6.7 report); this pins
  // the properties it relies on: no new instruction, no new key, nlocals equal to the header locals.
  test("every lowering shape and nesting compiles to the instruction forms of v0.1", () => {
    const env = new Env();
    env.load(`
      : a ( x:int y:bool -- int )
        y [ x ] [ x 1 + ] if y [ 1 drop ] when y [ 2 drop ] unless
        [ true ] [ [ true ] loop ] while [ [ 1 [ x ] call drop ] map ] drop
        { x [ x ] call } drop x ;
      : b ( n:int -- int ) n 0 = [ 1 ] [ n 1 - recurse ] if ;
    `);
    const allowed: Record<string, readonly string[]> = {
      lit: ["op", "value"],
      local: ["op", "slot"],
      stack: ["op", "word"],
      call: ["op", "entry"],
      prim: ["op", "entry"],
      varGet: ["op", "entry"],
      varSet: ["op", "entry"],
      jump: ["op", "target"],
      jumpf: ["op", "target"],
      quot: ["op", "end"],
      callq: ["op"],
      comb: ["op", "name"],
      dmark: ["op"],
      dcheck: ["op", "delta"],
      listOpen: ["op"],
      listClose: ["op"],
      print: ["op", "form"],
      ret: ["op"],
    };
    for (const q of ["user:a", "user:b"]) {
      const w = env.code(q);
      expect(w.nlocals).toBe(w.namedInputs.length);
      expect(w.localNames).toHaveLength(w.namedInputs.length);
      for (const ins of w.code) expect(Object.keys(ins), ins.op).toEqual(allowed[ins.op]);
    }
  });
});

describe("exit", () => {
  test("in the word body it compiles to exit 0", () => {
    const env = new Env();
    env.load(': f ( -- str ) "a" exit ;');
    expect(ops(env.code("user:f"))).toEqual(['lit "a"', "exit 0", "ret"]);
  });

  test("inside lowered if, when and unless it stays a jump with no marks", () => {
    const env = new Env();
    env.load(`
      : f ( b:bool -- int ) b [ 1 exit ] when b [ 2 exit ] unless b [ 3 exit ] [ 4 exit ] if 5 ;
    `);
    const exits = ops(env.code("user:f")).filter((o) => o.startsWith("exit"));
    expect(exits).toEqual(["exit 0", "exit 0", "exit 0", "exit 0"]);
  });

  test("inside lowered while and loop it carries the number of open dmark frames", () => {
    const env = new Env();
    env.load(`
      : f ( -- int ) 0 [ true ] [ exit ] while ;
      : g ( -- int ) 0 [ exit true ] [ 1 drop ] while ;
      : h ( -- int ) 0 [ [ exit ] when true ] loop ;
      : n ( -- int ) 0 [ true ] [ [ true ] [ [ true ] when exit ] while exit ] while ;
      : e ( b:bool -- int ) 0 [ b ] [ b [ exit ] [ 1 drop ] if ] while ;
    `);
    const exits = (q: string): string[] => ops(env.code(q)).filter((o) => o.startsWith("exit"));
    expect(exits("user:f")).toEqual(["exit 1"]);
    expect(exits("user:g")).toEqual(["exit 1"]);
    expect(exits("user:h")).toEqual(["exit 1"]);
    expect(exits("user:n")).toEqual(["exit 2", "exit 1"]);
    expect(exits("user:e")).toEqual(["exit 1"]);
  });

  test("is E_SYNTAX at the exit token in any other quotation", () => {
    const env = new Env();
    const e = fails(env, ": f ( list -- ) [ drop exit ] each ;");
    expect(e.code).toBe("E_SYNTAX");
    at(e, 1, 24);
    expect(e.word).toBe("user:f");
    for (const src of [
      ": f ( list -- list ) [ exit ] map ;",
      ": f ( -- ) [ exit ] [ 1 drop ] try ;",
      ": f ( -- ) [ exit ] drop ;",
      ": f ( -- ) [ exit ] call ;",
      // A lowered quotation inside a quotation that is not lowered is still not the word body.
      ": f ( list -- list ) [ dup [ exit ] when ] map ;",
      ": f ( -- ) [ true ] [ [ exit ] each ] while ;",
      // In a list literal, even when the surrounding quotation would be lowered.
      ": f ( -- list ) 1 { exit } ;",
      ": f ( b:bool -- list ) b [ { exit } drop ] when 1 ;",
      ": f ( b:bool -- list ) 1 { b [ exit ] when } ;",
      // The branches of while and loop are lowered only when they do not bind.
      ": f ( -- ) [ true ] [ 1 :> x exit ] while ;",
      ": f ( -- ) [ 1 :> x exit true ] loop ;",
    ]) {
      expect(fails(env, src).code, src).toBe("E_SYNTAX");
    }
  });

  test("is E_SYNTAX in console code", () => {
    const env = new Env();
    expect(fails(env, "1 exit", "console").code).toBe("E_SYNTAX");
    expect(fails(env, "true [ exit ] when", "console").code).toBe("E_SYNTAX");
  });

  test("a vocabulary's own exit shadows the core word", () => {
    const env = new Env();
    env.load(': exit ( -- str ) "mine" ; : f ( -- str ) [ exit ] call ;');
    expect(ops(env.code("user:f"))).toContain("call user:exit");
    expect(ops(env.code("user:f"))).not.toContain("exit 0");
  });
});
