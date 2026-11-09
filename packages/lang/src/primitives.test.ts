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
import {
  callPrimitive,
  createPrimitiveRegistry,
  definePrimitive,
  primitiveEffect,
} from "./primitives.js";
import type {
  HeaderParseFn,
  PrimitiveContext,
  PrimitiveDef,
  PrimitiveRegistry,
  Value,
} from "./types.js";
import { DEFAULT_LIMITS } from "./types.js";
import { bool, bytes, int, list, num, record, str } from "./values.js";

const ctx: PrimitiveContext = {
  signal: undefined,
  limits: DEFAULT_LIMITS,
  scope: { current: "user", using: [] },
};

function fresh(): PrimitiveRegistry {
  return createPrimitiveRegistry(parseHeader);
}

/** Registers a primitive in a fresh registry and returns the registered definition. */
function reg(effect: string, fn: PrimitiveDef["fn"], name = "p"): PrimitiveDef {
  const registry = fresh();
  const def = definePrimitive("t", name, effect, fn);
  registry.define(def);
  return def;
}

function sync(def: PrimitiveDef, args: Value[], c: PrimitiveContext = ctx): Value[] {
  const out = callPrimitive(def, args, c);
  if (out instanceof Promise) throw new Error("unexpected promise");
  return out;
}

function failure(def: PrimitiveDef, args: Value[], c: PrimitiveContext = ctx): ForgeError {
  try {
    sync(def, args, c);
  } catch (e) {
    if (e instanceof ForgeError) return e;
    throw e;
  }
  throw new Error("did not fail");
}

async function asyncFailure(def: PrimitiveDef, args: Value[]): Promise<ForgeError> {
  try {
    await callPrimitive(def, args, ctx);
  } catch (e) {
    if (e instanceof ForgeError) return e;
    throw e;
  }
  throw new Error("did not fail");
}

describe("definePrimitive", () => {
  test("builds a frozen definition with the options", () => {
    const fn = (): number => 1;
    const def = definePrimitive("v", "w", "( -- int )", fn, {
      effects: ["+time"],
      doc: "d",
      category: "c",
      version: "2",
    });
    expect(def).toEqual({
      vocab: "v",
      name: "w",
      effect: "( -- int )",
      fn,
      effects: ["+time"],
      doc: "d",
      category: "c",
      version: "2",
    });
    expect(Object.isFrozen(def)).toBe(true);
    expect(Object.keys(definePrimitive("v", "w", "( -- int )", fn))).toEqual([
      "vocab",
      "name",
      "effect",
      "fn",
    ]);
  });
});

describe("createPrimitiveRegistry", () => {
  test("define, get and list", () => {
    const registry = fresh();
    const a = definePrimitive("one", "a", "( -- int )", () => 1);
    const b = definePrimitive("two", "b", "( int -- int )", (n: number) => n);
    const c = definePrimitive("one", "c", "( -- )", () => undefined);
    registry.define(a);
    registry.define(b);
    registry.define(c);
    expect(registry.get("one", "a")).toBe(a);
    expect(registry.get("two", "b")).toBe(b);
    expect(registry.get("one", "b")).toBeUndefined();
    expect(registry.get("nope", "a")).toBeUndefined();
    expect(registry.list("one")).toEqual([a, c]);
    expect(registry.list("nope")).toEqual([]);
    expect(registry.list()).toEqual([a, c, b]);
    expect(fresh().list()).toEqual([]);
  });

  test("the effect is parsed in lenient mode by the injected parser", () => {
    const seen: { text: string; mode: string; col: number }[] = [];
    const spy: HeaderParseFn = (text, pos, mode) => {
      seen.push({ text, mode, col: pos.col });
      return parseHeader(text, pos, mode);
    };
    const registry = createPrimitiveRegistry(spy);
    registry.define(definePrimitive("t", "x", "  ( a b -- c )  ", () => 0));
    expect(seen).toEqual([{ text: " a b -- c ", mode: "lenient", col: 4 }]);
    const def = registry.get("t", "x") as PrimitiveDef;
    expect(primitiveEffect(def)?.text).toBe("( a b -- c )");
    expect(primitiveEffect(def)?.inputs).toHaveLength(2);
  });

  test("lenient headers allow bare items anywhere", () => {
    expect(() =>
      fresh().define(definePrimitive("t", "x", "( str n:int[1..5] -- list )", () => [])),
    ).not.toThrow();
    expect(() =>
      fresh().define(definePrimitive("t", "x", "( a:str b -- c )", () => [])),
    ).not.toThrow();
  });

  test("primitiveEffect is undefined for an unregistered definition", () => {
    expect(primitiveEffect(definePrimitive("t", "x", "( -- )", () => undefined))).toBeUndefined();
  });

  test("a duplicate is E_REDEFINED, even with a different effect", () => {
    const registry = fresh();
    registry.define(definePrimitive("t", "x", "( -- )", () => undefined));
    const e = (() => {
      try {
        registry.define(definePrimitive("t", "x", "( -- int )", () => 1));
      } catch (err) {
        return err as ForgeError;
      }
      throw new Error("no throw");
    })();
    expect(e.code).toBe("E_REDEFINED");
    expect(e.detail).toEqual({ name: "t:x" });
    registry.define(definePrimitive("u", "x", "( -- )", () => undefined)); // another vocabulary is fine
    expect(registry.list()).toHaveLength(2);
  });

  test("bad names are E_NAME", () => {
    const bad = (vocab: string, name: string): string => {
      try {
        fresh().define(definePrimitive(vocab, name, "( -- )", () => undefined));
      } catch (e) {
        return (e as ForgeError).code;
      }
      return "none";
    };
    expect(bad("", "x")).toBe("E_NAME");
    expect(bad("1bad", "x")).toBe("E_NAME");
    expect(bad("has:colon", "x")).toBe("E_NAME");
    expect(bad("t", "")).toBe("E_NAME");
    expect(bad("t", "a:b")).toBe("E_NAME");
    expect(bad("t", "true")).toBe("E_NAME");
    expect(bad("t", "PRIMITIVE")).toBe("E_NAME");
    expect(bad("t", "has space")).toBe("E_NAME");
    expect(bad("t", "ok-name")).toBe("none");
    expect(bad("t", "_private")).toBe("none");
    expect(() =>
      fresh().define({
        vocab: 5,
        name: "x",
        effect: "( -- )",
        fn: () => 0,
      } as unknown as PrimitiveDef),
    ).toThrowError(/invalid vocabulary/);
    expect(() =>
      fresh().define({
        vocab: "t",
        name: 5,
        effect: "( -- )",
        fn: () => 0,
      } as unknown as PrimitiveDef),
    ).toThrowError(/invalid primitive name/);
  });

  test("bad effects are E_HEADER", () => {
    const code = (effect: unknown): string => {
      try {
        fresh().define({ vocab: "t", name: "x", effect, fn: () => 0 } as unknown as PrimitiveDef);
      } catch (e) {
        return (e as ForgeError).code;
      }
      return "none";
    };
    expect(code("int -- int")).toBe("E_HEADER");
    expect(code("( int -- int")).toBe("E_HEADER");
    expect(code("")).toBe("E_HEADER");
    expect(code(42)).toBe("E_HEADER");
    expect(code("( int )")).toBe("E_HEADER"); // no --
    expect(code("( bogus:wat -- int )")).toBe("E_HEADER");
    expect(code("( a:int a:int -- int )")).toBe("E_HEADER");
    expect(code("( int -- .. )")).toBe("E_HEADER"); // unchecked output
    expect(code("( .. int -- int )")).toBe("E_HEADER"); // variadic input
    expect(code("( int -- int )")).toBe("none");
  });

  test("fn and labels are checked (programmer errors throw TypeError)", () => {
    const def = (extra: Record<string, unknown>): PrimitiveDef =>
      ({ vocab: "t", name: "x", effect: "( -- )", fn: () => undefined, ...extra }) as PrimitiveDef;
    expect(() => fresh().define(def({ fn: "nope" }))).toThrowError(TypeError);
    expect(() => fresh().define(def({ effects: ["+bogus"] }))).toThrowError(/unknown effect label/);
    expect(() => fresh().define(def({ doc: 5 }))).toThrowError(/doc must be a string/);
    expect(() => fresh().define(def({ category: 5 }))).toThrowError(/category/);
    expect(() => fresh().define(def({ version: 5 }))).toThrowError(/version/);
    expect(() => fresh().define(def({ effects: ["+async", "+random", "+time"] }))).not.toThrow();
  });

  test("a rejected definition leaves the registry unchanged", () => {
    const registry = fresh();
    expect(() => registry.define(definePrimitive("t", "x", "bad", () => 0))).toThrow();
    expect(registry.get("t", "x")).toBeUndefined();
    expect(registry.list()).toEqual([]);
  });
});

describe("callPrimitive: arguments", () => {
  test("typed slots receive plain payloads, any and number receive tagged values, ctx comes last", () => {
    const seen: unknown[][] = [];
    const quot = { tag: "quot", v: { code: {}, start: 0, env: [] } } as unknown as Value;
    const file = {
      tag: "file",
      v: { name: "f", type: "t/x", bytes: new Uint8Array([1]) },
    } as Value;
    const def = reg(
      "( b:bytes s:str i:int n:num t:bool l:list q:quot r:record f:file a:any m:number c:choice{x|y} g:key o:charset -- )",
      (...args: unknown[]) => {
        seen.push(args);
      },
    );
    const b = new Uint8Array([9]);
    const items = [int(1)];
    const map = new Map<string, Value>([["k", int(2)]]);
    const anyVal = str("any");
    const numVal = int(5);
    const out = sync(def, [
      bytes(b),
      str("s"),
      int(2n ** 70n),
      num(1.5),
      bool(true),
      list(items),
      quot,
      { tag: "record", v: map },
      file,
      anyVal,
      numVal,
      str("x"),
      bytes(new Uint8Array([7])),
      str("abc"),
    ]);
    expect(out).toEqual([]);
    const args = seen[0] as unknown[];
    expect(args).toHaveLength(15);
    expect(args[0]).toBe(b);
    expect(args[1]).toBe("s");
    expect(args[2]).toBe(2n ** 70n);
    expect(args[3]).toBe(1.5);
    expect(args[4]).toBe(true);
    expect(args[5]).toBe(items);
    expect(args[6]).toBe((quot as { v: unknown }).v);
    expect(args[7]).toBe(map);
    expect(args[8]).toBe((file as { v: unknown }).v);
    expect(args[9]).toBe(anyVal);
    expect(args[10]).toBe(numVal);
    expect(args[11]).toBe("x");
    expect(args[12]).toEqual(new Uint8Array([7]));
    expect(args[13]).toBe("abc");
    expect(args[14]).toBe(ctx);
  });

  test("the argument count is checked", () => {
    const def = reg("( int -- int )", (n: number) => n);
    expect(failure(def, []).code).toBe("E_INTERNAL");
    expect(failure(def, [int(1), int(2)]).code).toBe("E_INTERNAL");
  });

  test("an unregistered definition is E_INTERNAL", () => {
    const def = definePrimitive("t", "loose", "( -- )", () => undefined);
    expect(failure(def, []).code).toBe("E_INTERNAL");
  });
});

describe("callPrimitive: results", () => {
  test("zero, one and several outputs", () => {
    expect(
      sync(
        reg("( -- )", () => undefined),
        [],
      ),
    ).toEqual([]);
    expect(
      sync(
        reg("( -- int )", () => 7),
        [],
      ),
    ).toEqual([int(7)]);
    expect(
      sync(
        reg("( -- int str bool )", () => [1, "a", true]),
        [],
      ),
    ).toEqual([int(1), str("a"), bool(true)]);
  });

  test("zero outputs must return undefined; several outputs an array of exactly k", () => {
    const e0 = failure(
      reg("( -- )", () => 1),
      [],
    );
    expect(e0.code).toBe("E_TYPE");
    expect(e0.detail).toMatchObject({ where: "result" });
    expect(
      failure(
        reg("( -- int int )", () => 1),
        [],
      ).detail,
    ).toMatchObject({ where: "result" });
    expect(
      failure(
        reg("( -- int int )", () => [1]),
        [],
      ).code,
    ).toBe("E_TYPE");
    expect(
      failure(
        reg("( -- int int )", () => [1, 2, 3]),
        [],
      ).code,
    ).toBe("E_TYPE");
    expect(
      failure(
        reg("( -- int )", () => undefined),
        [],
      ).code,
    ).toBe("E_TYPE");
  });

  test("ints are normalised and checked (C160)", () => {
    expect(
      sync(
        reg("( -- int )", () => 5n),
        [],
      )[0],
    ).toEqual({ tag: "int", v: 5 });
    expect(
      typeof sync(
        reg("( -- int )", () => 2n ** 60n),
        [],
      )[0]?.v,
    ).toBe("bigint");
    expect(
      sync(
        reg("( -- int )", () => 2 ** 60),
        [],
      )[0],
    ).toEqual({ tag: "int", v: 2n ** 60n });
    expect(
      Object.is(
        sync(
          reg("( -- int )", () => -0),
          [],
        )[0]?.v,
        0,
      ),
    ).toBe(true);
    for (const bad of [1.5, NaN, Infinity, "x", true, null, undefined]) {
      const e = failure(
        reg("( -- int )", () => bad),
        [],
      );
      expect(e.code, String(bad)).toBe("E_TYPE");
      expect(e.detail).toMatchObject({ where: "result", expected: "an integer" });
    }
    const big = failure(
      reg("( -- int )", () => 2n ** 100n),
      [],
      {
        ...ctx,
        limits: { ...DEFAULT_LIMITS, maxIntBits: 64 },
      },
    );
    expect(big.code).toBe("E_LIMIT_VALUE");
  });

  test("nums must be finite numbers", () => {
    expect(
      sync(
        reg("( -- num )", () => 1.5),
        [],
      ),
    ).toEqual([num(1.5)]);
    expect(
      sync(
        reg("( -- num )", () => 3),
        [],
      ),
    ).toEqual([num(3)]);
    expect(
      failure(
        reg("( -- num )", () => Infinity),
        [],
      ).code,
    ).toBe("E_RANGE");
    expect(
      failure(
        reg("( -- num )", () => NaN),
        [],
      ).code,
    ).toBe("E_RANGE");
    expect(
      failure(
        reg("( -- num )", () => "x"),
        [],
      ).code,
    ).toBe("E_TYPE");
    expect(
      failure(
        reg("( -- num )", () => 1n),
        [],
      ).code,
    ).toBe("E_TYPE");
  });

  test("str, bool and bytes results", () => {
    expect(
      sync(
        reg("( -- str )", () => "hi"),
        [],
      ),
    ).toEqual([str("hi")]);
    expect(
      failure(
        reg("( -- str )", () => 1),
        [],
      ).code,
    ).toBe("E_TYPE");
    expect(
      sync(
        reg("( -- bool )", () => false),
        [],
      ),
    ).toEqual([bool(false)]);
    expect(
      failure(
        reg("( -- bool )", () => 0),
        [],
      ).code,
    ).toBe("E_TYPE");
    expect(
      sync(
        reg("( -- bytes )", () => new Uint8Array([1, 2])),
        [],
      ),
    ).toEqual([bytes(new Uint8Array([1, 2]))]);
    expect(
      failure(
        reg("( -- bytes )", () => [1, 2]),
        [],
      ).code,
    ).toBe("E_TYPE");
    expect(
      failure(
        reg("( -- bytes )", () => "ab"),
        [],
      ).detail,
    ).toMatchObject({ actual: "string" });
  });

  test("list results hold tagged values, normalised one level deep", () => {
    expect(
      sync(
        reg("( -- list )", () => [int(1), str("a")]),
        [],
      ),
    ).toEqual([list([int(1), str("a")])]);
    expect(
      sync(
        reg("( -- list )", () => []),
        [],
      ),
    ).toEqual([list([])]);
    const out = sync(
      reg("( -- list )", () => [{ tag: "int", v: 3n }]),
      [],
    )[0];
    expect(out).toEqual(list([int(3)]));
    expect(
      failure(
        reg("( -- list )", () => "x"),
        [],
      ).code,
    ).toBe("E_TYPE");
    expect(
      failure(
        reg("( -- list )", () => [1]),
        [],
      ).code,
    ).toBe("E_TYPE");
    expect(
      failure(
        reg("( -- list )", () => [{ tag: "bogus", v: 1 }]),
        [],
      ).code,
    ).toBe("E_TYPE");
    expect(
      failure(
        reg("( -- list )", () => [null]),
        [],
      ).code,
    ).toBe("E_TYPE");
    expect(
      failure(
        reg("( -- list )", () => [{ tag: "int", v: 1.5 }]),
        [],
      ).code,
    ).toBe("E_TYPE");
  });

  test("record results are maps of tagged values", () => {
    const m = new Map([["a", int(1)]]);
    expect(
      sync(
        reg("( -- record )", () => m),
        [],
      ),
    ).toEqual([record([["a", int(1)]])]);
    expect(
      failure(
        reg("( -- record )", () => ({})),
        [],
      ).code,
    ).toBe("E_TYPE");
    expect(
      failure(
        reg("( -- record )", () => new Map([[1, int(1)]])),
        [],
      ).code,
    ).toBe("E_TYPE");
    expect(
      failure(
        reg("( -- record )", () => new Map([["a", 1]])),
        [],
      ).code,
    ).toBe("E_TYPE");
  });

  test("quot and file results", () => {
    const q = { code: {}, start: 0, env: [] };
    expect(
      sync(
        reg("( -- quot )", () => q),
        [],
      )[0],
    ).toEqual({ tag: "quot", v: q });
    expect(
      failure(
        reg("( -- quot )", () => 1),
        [],
      ).code,
    ).toBe("E_TYPE");
    expect(
      failure(
        reg("( -- quot )", () => null),
        [],
      ).code,
    ).toBe("E_TYPE");
    const f = { name: "n", type: "t", bytes: new Uint8Array() };
    expect(
      sync(
        reg("( -- file )", () => f),
        [],
      )[0],
    ).toEqual({ tag: "file", v: f });
    for (const bad of [
      null,
      1,
      { name: 1, type: "t", bytes: new Uint8Array() },
      { name: "n", type: 1, bytes: new Uint8Array() },
      { name: "n", type: "t", bytes: [] },
    ]) {
      expect(
        failure(
          reg("( -- file )", () => bad),
          [],
        ).code,
      ).toBe("E_TYPE");
    }
  });

  test("any and number slots return tagged values", () => {
    expect(
      sync(
        reg("( -- any )", () => str("a")),
        [],
      ),
    ).toEqual([str("a")]);
    expect(
      sync(
        reg("( -- number )", () => int(1)),
        [],
      ),
    ).toEqual([int(1)]);
    expect(
      sync(
        reg("( -- number )", () => num(1.5)),
        [],
      ),
    ).toEqual([num(1.5)]);
    expect(
      sync(
        reg("( -- any )", () => ({ tag: "int", v: 5n })),
        [],
      )[0],
    ).toEqual({ tag: "int", v: 5 });
    expect(
      failure(
        reg("( -- any )", () => 5),
        [],
      ).code,
    ).toBe("E_TYPE");
    expect(
      failure(
        reg("( -- any )", () => ({ tag: "int", v: "x" })),
        [],
      ).code,
    ).toBe("E_TYPE");
    expect(
      failure(
        reg("( -- any )", () => ({ tag: "int", v: 1.5 })),
        [],
      ).code,
    ).toBe("E_TYPE");
    expect(
      failure(
        reg("( -- any )", () => ({ tag: "num", v: "x" })),
        [],
      ).code,
    ).toBe("E_TYPE");
    expect(
      failure(
        reg("( -- any )", () => ({ tag: "num", v: Infinity })),
        [],
      ).code,
    ).toBe("E_RANGE");
    expect(
      failure(
        reg("( -- any )", () => ({ tag: "bytes", v: [1] })),
        [],
      ).code,
    ).toBe("E_TYPE");
    expect(
      failure(
        reg("( -- number )", () => str("a")),
        [],
      ).code,
    ).toBe("E_TYPE");
    expect(
      failure(
        reg("( -- number )", () => 1),
        [],
      ).code,
    ).toBe("E_TYPE");
    expect(
      failure(
        reg("( -- any )", () => int(2n ** 100n)),
        [],
        {
          ...ctx,
          limits: { ...DEFAULT_LIMITS, maxIntBits: 64 },
        },
      ).code,
    ).toBe("E_LIMIT_VALUE");
  });

  test("errors name the primitive", () => {
    const e = failure(
      reg("( -- int )", () => "x", "named"),
      [],
    );
    expect(e.word).toBe("t:named");
    expect(e.vocab).toBe("t");
  });
});

describe("callPrimitive: purity", () => {
  test("a bytes result that is an argument is copied", () => {
    const input = new Uint8Array([1, 2, 3]);
    const out = sync(
      reg("( bytes -- bytes )", (b: Uint8Array) => b),
      [bytes(input)],
    )[0] as { v: Uint8Array };
    expect(out.v).toEqual(input);
    expect(out.v).not.toBe(input);
  });

  test("a tagged result that is an argument is copied", () => {
    const num1 = num(2.5);
    const str1 = str("s");
    const int1 = int(4);
    const bytes1 = bytes(new Uint8Array([5]));
    const identity = reg("( any -- any )", (a: Value) => a);
    for (const v of [num1, str1, int1, bytes1]) {
      const out = sync(identity, [v])[0] as Value;
      expect(out).toEqual(v);
      expect(out).not.toBe(v);
      if (typeof out.v === "object") expect(out.v).not.toBe(v.v);
    }
    // the payload of an any argument is aliased too
    const payload = reg("( any -- any )", (a: Value) => ({
      tag: "bytes",
      v: (a as { v: Uint8Array }).v,
    }));
    const out = sync(payload, [bytes1])[0] as { v: Uint8Array };
    expect(out.v).toEqual(new Uint8Array([5]));
    expect(out.v).not.toBe(bytes1.v);
    // in a list, the argument arrays are not copied (values are immutable)
    const items = [int(1)];
    const out2 = sync(
      reg("( list -- list )", (l: readonly Value[]) => [...l]),
      [list(items)],
    )[0] as { v: readonly Value[] };
    expect(out2.v).not.toBe(items);
  });

  test("an unaliased result is passed through as is", () => {
    const made = bytes(new Uint8Array([1]));
    expect(
      sync(
        reg("( -- any )", () => made),
        [],
      )[0],
    ).toBe(made);
    const arr = new Uint8Array([1]);
    expect(
      (
        sync(
          reg("( -- bytes )", () => arr),
          [],
        )[0] as { v: Uint8Array }
      ).v,
    ).toBe(arr);
  });
});

describe("callPrimitive: failures", () => {
  test("a thrown ForgeError is re-raised with word and vocab filled in", () => {
    const def = reg(
      "( -- )",
      () => {
        throw new ForgeError({ code: "E_RANGE", message: "out", detail: { k: 1 } });
      },
      "boom",
    );
    const e = failure(def, []);
    expect(e.code).toBe("E_RANGE");
    expect(e.message).toBe("out");
    expect(e.word).toBe("t:boom");
    expect(e.vocab).toBe("t");
    expect(e.detail).toEqual({ k: 1 });
  });

  test("a ForgeError that already names a word keeps it", () => {
    const def = reg("( -- )", () => {
      throw new ForgeError({ code: "E_USER", message: "m", word: "other:w", vocab: "other" });
    });
    expect(failure(def, []).word).toBe("other:w");
  });

  test("a foreign-realm ForgeError is passed through unchanged", () => {
    const foreign = Object.assign(new Error("alien"), { name: "ForgeError", code: "E_RANGE" });
    const def = reg("( -- )", () => {
      throw foreign;
    });
    let caught: unknown;
    try {
      callPrimitive(def, [], ctx);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(foreign);
  });

  test("any other throw is E_PRIMITIVE (C111)", () => {
    const def = reg("( -- )", () => {
      throw new Error("kaput");
    });
    const e = failure(def, []);
    expect(e.code).toBe("E_PRIMITIVE");
    expect(e.message).toBe("kaput");
    expect(e.word).toBe("t:p");
    expect(e.cause).toBeInstanceOf(Error);
    const s = failure(
      reg("( -- )", () => {
        throw "plain string";
      }),
      [],
    );
    expect(s.code).toBe("E_PRIMITIVE");
    expect(s.message).toBe("plain string");
    expect(s.cause).toBe("plain string");
  });

  test("a non-integer result is E_TYPE with where=result (C160)", () => {
    const e = failure(
      reg("( -- int )", () => 1.5),
      [],
    );
    expect(e.code).toBe("E_TYPE");
    expect(e.detail.where).toBe("result");
  });
});

describe("callPrimitive: async primitives", () => {
  test("a promise is awaited and its result converted (C109)", async () => {
    const def = reg("( a:int b:int -- int )", (a: number, b: number) =>
      Promise.resolve().then(() => a + b),
    );
    const out = callPrimitive(def, [int(2), int(3)], ctx);
    expect(out).toBeInstanceOf(Promise);
    expect(await out).toEqual([int(5)]);
    const big = reg("( -- int )", () => Promise.resolve(5n));
    expect(await callPrimitive(big, [], ctx)).toEqual([int(5)]);
    expect(
      await callPrimitive(
        reg("( -- )", () => Promise.resolve(undefined)),
        [],
        ctx,
      ),
    ).toEqual([]);
  });

  test("a thenable that is not a promise is awaited too", async () => {
    const thenable = { then: (ok: (x: unknown) => void) => ok("fine") };
    expect(
      await callPrimitive(
        reg("( -- str )", () => thenable),
        [],
        ctx,
      ),
    ).toEqual([str("fine")]);
    const fnThenable = Object.assign(() => 0, { then: (ok: (x: unknown) => void) => ok(7) });
    expect(
      await callPrimitive(
        reg("( -- int )", () => fnThenable),
        [],
        ctx,
      ),
    ).toEqual([int(7)]);
  });

  test("a rejection that is not a ForgeError is E_PRIMITIVE (C161)", async () => {
    const e = await asyncFailure(
      reg("( -- )", () => Promise.reject(new Error("nope"))),
      [],
    );
    expect(e.code).toBe("E_PRIMITIVE");
    expect(e.message).toBe("nope");
    expect(e.word).toBe("t:p");
    expect(e.cause).toBeInstanceOf(Error);
  });

  test("a ForgeError rejection is kept, with the word filled in", async () => {
    const e = await asyncFailure(
      reg("( -- )", () => Promise.reject(new ForgeError({ code: "E_RANGE", message: "late" }))),
      [],
    );
    expect(e.code).toBe("E_RANGE");
    expect(e.word).toBe("t:p");
  });

  test("a wrongly typed async result is E_TYPE", async () => {
    const e = await asyncFailure(
      reg("( -- int )", () => Promise.resolve("x")),
      [],
    );
    expect(e.code).toBe("E_TYPE");
    expect(e.detail.where).toBe("result");
  });

  test("a synchronous throw from an async-looking primitive is still synchronous", () => {
    const def = reg("( -- )", () => {
      throw new Error("early");
    });
    expect(() => callPrimitive(def, [], ctx)).toThrowError(/early/);
  });
});
