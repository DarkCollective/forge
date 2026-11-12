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
import { ForgeError } from "../errors.js";
import { parseHeader } from "../meta.js";
import { callPrimitive, createPrimitiveRegistry } from "../primitives.js";
import type { ErrorCode, Limits, PrimitiveContext, Value } from "../types.js";
import { createRuntime } from "../runtime.js";
import { DEFAULT_LIMITS } from "../types.js";
import { bool, bytes, int, list, num, record, repr, str } from "../values.js";
import {
  CORE_INTRINSIC_WORDS,
  CORE_PRIMITIVES,
  CORE_PRIMITIVES_V02,
  CORE_RUNTIME_WORDS,
  registerCorePrimitives,
} from "./core.js";
import { NUMERIC_PRIMITIVES } from "./numeric.js";

const registry = createPrimitiveRegistry(parseHeader);
registerCorePrimitives(registry);

const tested = new Set<string>();

function ctxOf(limits: Partial<Limits> = {}): PrimitiveContext {
  return {
    signal: undefined,
    limits: { ...DEFAULT_LIMITS, ...limits },
    scope: { current: "user", using: [] },
  };
}

// Value builders.
const I = (n: number | bigint): Value => int(n);
const N = (x: number): Value => num(x);
const S = (s: string): Value => str(s);
const B = (...xs: number[]): Value => bytes(new Uint8Array(xs));
const L = (...xs: Value[]): Value => list(xs);
const R = (...pairs: [string, Value][]): Value => record(pairs);
const T = bool(true);
const F = bool(false);

/** A snapshot of a value's content that survives mutation checks (repr plus raw bytes). */
function snapshot(v: Value): string {
  return `${v.tag}:${repr(v)}`;
}

function freezeValue(v: Value): Value {
  // Frozen lists and Value objects reject mutation (modules are strict); bytes and records are
  // checked by snapshot comparison because typed arrays and Maps cannot be frozen.
  if (v.tag === "list") Object.freeze(v.v);
  return Object.freeze({ ...v });
}

/** Calls a core primitive through callPrimitive with purity checks, returning the result values. */
function callWith(name: string, args: Value[], limits?: Partial<Limits>): Value[] {
  tested.add(name);
  const def = registry.get("core", name);
  if (def === undefined) throw new Error(`no core primitive ${name}`);
  const before = args.map(snapshot);
  const frozen = args.map(freezeValue);
  const out = callPrimitive(def, frozen, ctxOf(limits));
  if (out instanceof Promise) throw new Error("core primitives are synchronous");
  expect(args.map(snapshot), `${name} mutated an argument`).toEqual(before);
  for (const r of out) {
    for (const a of frozen) {
      expect(r, `${name} returned an argument`).not.toBe(a);
      if (typeof r.v === "object") {
        expect(r.v, `${name} returned an alias of an argument`).not.toBe(a.v);
      }
    }
  }
  return out;
}

/** The single result, as repr text. */
function run(name: string, args: Value[], limits?: Partial<Limits>): string {
  const out = callWith(name, args, limits);
  expect(out).toHaveLength(1);
  return repr(out[0] as Value);
}

function errorOf(name: string, args: Value[], limits?: Partial<Limits>): ForgeError {
  try {
    callWith(name, args, limits);
  } catch (e) {
    if (e instanceof ForgeError) return e;
    throw e;
  }
  throw new Error(`${name} did not fail`);
}

function codeOf(name: string, args: Value[], limits?: Partial<Limits>): ErrorCode {
  return errorOf(name, args, limits).code;
}

const big = (n: bigint): Value => I(n);
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

// ---------------------------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------------------------

describe("the core table", () => {
  const doc = readFileSync(
    fileURLToPath(import.meta.url).replace(/\/packages\/lang\/src\/vocab\/[^/]*$/, "") +
      "/docs/LANGUAGE.md",
    "utf8",
  );
  const section = doc.slice(doc.indexOf("## 13. The `core` vocabulary"), doc.indexOf("## 14."));
  const rows: { names: string[]; kind: string; effect: string }[] = [];
  for (const line of section.split("\n")) {
    const m = /^\| ((?:`[^`]+` ?)+)\| ([IPR]) \| `([^`]*)` \|/.exec(line);
    if (m === null) continue;
    const names = [...(m[1] as string).matchAll(/`([^`]+)`/g)].map((x) => x[1] as string);
    for (const name of names)
      rows.push({ names: [name], kind: m[2] as string, effect: m[3] as string });
  }

  test("section 13 declares 102 words: 28 intrinsic, 69 primitive, 5 runtime-supplied", () => {
    expect(rows).toHaveLength(102);
    expect(rows.filter((r) => r.kind === "I")).toHaveLength(28);
    expect(rows.filter((r) => r.kind === "P")).toHaveLength(69);
    expect(rows.filter((r) => r.kind === "R")).toHaveLength(5);
  });

  test("primitives + intrinsics + runtime-supplied words equal the table exactly", () => {
    const all = [
      ...CORE_PRIMITIVES.map((d) => d.name),
      ...CORE_INTRINSIC_WORDS,
      ...CORE_RUNTIME_WORDS,
    ];
    expect(all).toHaveLength(102);
    expect(new Set(all).size).toBe(102);
    expect([...all].sort()).toEqual(rows.map((r) => r.names[0] as string).sort());
  });

  test("each list matches the kind column of the table", () => {
    const names = (kind: string): string[] =>
      rows.filter((r) => r.kind === kind).map((r) => r.names[0] as string);
    expect(CORE_PRIMITIVES.map((d) => d.name).sort()).toEqual(names("P").sort());
    expect([...CORE_INTRINSIC_WORDS].sort()).toEqual(names("I").sort());
    expect([...CORE_RUNTIME_WORDS].sort()).toEqual(names("R").sort());
  });

  test("every primitive has the exact effect string of the table, a doc and a category", () => {
    for (const row of rows.filter((r) => r.kind === "P")) {
      const def = registry.get("core", row.names[0] as string);
      expect(def, row.names[0]).toBeDefined();
      expect(def?.effect).toBe(row.effect);
      expect(def?.doc ?? "").not.toBe("");
      expect(def?.category ?? "").not.toBe("");
      expect(def?.effects).toBeUndefined(); // v0.1 core has no labelled word (spec 10.10)
    }
  });

  test("registerCorePrimitives registers into vocabulary core, once", () => {
    // the 69 words of the v0.1 table plus the 21 primitives of FL 0.2
    expect(registry.list("core")).toHaveLength(69 + CORE_PRIMITIVES_V02.length);
    expect(CORE_PRIMITIVES_V02).toHaveLength(21);
    expect(() => registerCorePrimitives(registry)).toThrowError(/already registered/);
  });
});

// ---------------------------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------------------------

describe("+ - *", () => {
  test("int arithmetic is exact", () => {
    expect(run("+", [I(1), I(2)])).toBe("3");
    expect(run("-", [I(3), I(5)])).toBe("-2");
    expect(run("*", [I(6), I(7)])).toBe("42");
    expect(run("+", [I(MAX_SAFE), I(1)])).toBe("9007199254740992");
    expect(run("-", [I(-MAX_SAFE), I(2)])).toBe("-9007199254740993");
    expect(run("*", [I(94906267), I(94906267)])).toBe((94906267n * 94906267n).toString());
    expect(run("*", [big(2n ** 70n), big(2n ** 70n)])).toBe((2n ** 140n).toString());
  });

  test("results are normalised back to a number inside the safe range", () => {
    const [r] = callWith("-", [big(2n ** 53n), I(1)]);
    expect(r).toEqual({ tag: "int", v: MAX_SAFE });
    const [z] = callWith("*", [I(0), I(-1)]);
    expect(Object.is((z as { v: number }).v, 0)).toBe(true);
  });

  test("mixed int and num gives num", () => {
    expect(run("+", [I(1), N(2.5)])).toBe("3.5");
    expect(run("-", [N(0.5), I(1)])).toBe("-0.5");
    expect(run("*", [I(2), N(1.5)])).toBe("3.0");
    expect(run("+", [N(0.5), N(0.25)])).toBe("0.75");
  });

  test("errors", () => {
    expect(codeOf("+", [S("a"), I(1)])).toBe("E_TYPE");
    expect(codeOf("*", [I(1), L()])).toBe("E_TYPE");
    expect(errorOf("-", [I(1), S("a")]).detail).toMatchObject({ expected: "number", param: 1 });
    expect(codeOf("+", [N(1e308), N(1e308)])).toBe("E_RANGE");
    expect(codeOf("*", [N(1e200), N(1e200)])).toBe("E_RANGE");
    expect(codeOf("+", [big(2n ** 60n), N(1)])).toBe("E_COERCE");
    expect(codeOf("*", [N(1), big(2n ** 60n)])).toBe("E_COERCE");
  });

  test("results over maxIntBits are E_LIMIT_VALUE", () => {
    expect(codeOf("+", [big(2n ** 100n), big(2n ** 100n)], { maxIntBits: 100 })).toBe(
      "E_LIMIT_VALUE",
    );
    expect(run("+", [big(2n ** 99n), big(2n ** 99n - 1n)], { maxIntBits: 100 })).toBe(
      (2n ** 100n - 1n).toString(),
    );
  });
});

describe("/", () => {
  test("float division (C18)", () => {
    expect(run("/", [I(7), I(2)])).toBe("3.5");
    expect(run("/", [I(6), I(3)])).toBe("2.0");
    expect(run("/", [N(1), N(4)])).toBe("0.25");
    expect(run("/", [I(-1), N(4)])).toBe("-0.25");
  });
  test("errors", () => {
    expect(codeOf("/", [I(1), I(0)])).toBe("E_DIV_ZERO"); // C19
    expect(codeOf("/", [N(1.5), I(0)])).toBe("E_DIV_ZERO"); // C20
    expect(codeOf("/", [N(1.5), N(-0)])).toBe("E_DIV_ZERO");
    expect(codeOf("/", [N(1e308), N(1e-308)])).toBe("E_RANGE");
    expect(codeOf("/", [big(2n ** 60n), I(2)])).toBe("E_COERCE");
    expect(codeOf("/", [I(2), big(2n ** 60n)])).toBe("E_COERCE");
    expect(codeOf("/", [S("a"), I(2)])).toBe("E_TYPE");
  });
});

describe("div and mod", () => {
  test("floor semantics (C18)", () => {
    expect(run("div", [I(7), I(2)])).toBe("3");
    expect(run("div", [I(-7), I(2)])).toBe("-4");
    expect(run("div", [I(7), I(-2)])).toBe("-4");
    expect(run("div", [I(-7), I(-2)])).toBe("3");
    expect(run("div", [I(6), I(-3)])).toBe("-2");
    expect(run("div", [I(0), I(-5)])).toBe("0");
    expect(run("mod", [I(-7), I(2)])).toBe("1");
    expect(run("mod", [I(7), I(-2)])).toBe("-1");
    expect(run("mod", [I(7), I(2)])).toBe("1");
    expect(run("mod", [I(-7), I(-2)])).toBe("-1");
    expect(run("mod", [I(6), I(3)])).toBe("0");
    expect(run("mod", [I(-4), I(2)])).toBe("0");
  });
  test("never yields a negative zero", () => {
    for (const [name, a, b] of [
      ["div", 0, -5],
      ["mod", -4, 2],
      ["mod", 0, -3],
    ] as const) {
      const [r] = callWith(name, [I(a), I(b)]);
      expect(Object.is((r as { v: number }).v, 0)).toBe(true);
    }
  });
  test("exact for operands of any size (C156)", () => {
    expect(run("div", [I(9007199254740993n), I(3)])).toBe("3002399751580331");
    expect(run("div", [I(9007199254740993n), I(2)])).toBe("4503599627370496");
    expect(run("div", [I(-MAX_SAFE), I(2 ** 52 + 1)])).toBe("-2");
    expect(run("mod", [I(-MAX_SAFE), I(2 ** 52 + 1)])).toBe(String(-MAX_SAFE + 2 * (2 ** 52 + 1)));
    const a = -(3n ** 80n);
    const b = 7n ** 20n;
    const q = run("div", [big(a), big(b)]);
    const r = run("mod", [big(a), big(b)]);
    expect(BigInt(q) * b + BigInt(r)).toBe(a);
    expect(BigInt(r) >= 0n && BigInt(r) < b).toBe(true);
    expect(run("mod", [big(3n ** 80n), big(-(7n ** 20n))])).toBe(
      String((3n ** 80n % 7n ** 20n) - 7n ** 20n),
    );
  });
  test("zero divisor is E_DIV_ZERO", () => {
    expect(codeOf("div", [I(1), I(0)])).toBe("E_DIV_ZERO"); // C19
    expect(codeOf("mod", [I(1), I(0)])).toBe("E_DIV_ZERO");
    expect(codeOf("div", [big(2n ** 80n), I(0)])).toBe("E_DIV_ZERO");
  });
});

describe("pow", () => {
  test("integer power", () => {
    expect(run("pow", [I(2), I(100)])).toBe("1267650600228229401496703205376"); // C21
    expect(run("pow", [I(3), I(4)])).toBe("81");
    expect(run("pow", [I(-2), I(3)])).toBe("-8");
    expect(run("pow", [I(7), I(0)])).toBe("1");
    expect(run("pow", [I(0), I(0)])).toBe("1");
    expect(run("pow", [I(0), I(5)])).toBe("0");
    expect(run("pow", [I(1), I(2n ** 70n)])).toBe("1");
    expect(run("pow", [I(-1), I(3)])).toBe("-1");
    expect(run("pow", [I(-1), I(4)])).toBe("1");
    expect(run("pow", [I(-1), I(2n ** 70n + 1n)])).toBe("-1");
    expect(run("pow", [I(-1), I(2n ** 70n)])).toBe("1");
    expect(run("pow", [I(0), I(2n ** 70n)])).toBe("0");
  });
  test("negative exponent is E_RANGE (C22)", () => {
    expect(codeOf("pow", [I(2), I(-1)])).toBe("E_RANGE");
    expect(codeOf("pow", [I(1), I(-1)])).toBe("E_RANGE");
  });
  test("results over maxIntBits are refused before computing", () => {
    expect(codeOf("pow", [I(2), I(70000)])).toBe("E_LIMIT_VALUE");
    expect(codeOf("pow", [I(2), I(2n ** 70n)])).toBe("E_LIMIT_VALUE");
    expect(codeOf("pow", [I(-3), I(2n ** 70n)])).toBe("E_LIMIT_VALUE");
    expect(codeOf("pow", [I(2), I(64)], { maxIntBits: 64 })).toBe("E_LIMIT_VALUE");
    expect(run("pow", [I(2), I(63)], { maxIntBits: 64 })).toBe((2n ** 63n).toString());
    // below the cheap lower bound but still too large: caught after computing
    expect(codeOf("pow", [I(3), I(41)], { maxIntBits: 64 })).toBe("E_LIMIT_VALUE");
    expect(run("pow", [I(3), I(40)], { maxIntBits: 64 })).toBe((3n ** 40n).toString());
    expect(errorOf("pow", [I(2), I(70000)]).detail).toMatchObject({ limit: 65536 });
  });
});

describe("gcd invmod powmod", () => {
  test("gcd (C150)", () => {
    expect(run("gcd", [I(12), I(18)])).toBe("6");
    expect(run("gcd", [I(-12), I(18)])).toBe("6");
    expect(run("gcd", [I(12), I(-18)])).toBe("6");
    expect(run("gcd", [I(-12), I(-18)])).toBe("6");
    expect(run("gcd", [I(0), I(0)])).toBe("0");
    expect(run("gcd", [I(0), I(5)])).toBe("5");
    expect(run("gcd", [I(-7), I(0)])).toBe("7");
    expect(run("gcd", [I(17), I(5)])).toBe("1");
    expect(run("gcd", [big(2n ** 80n * 3n), big(2n ** 70n * 9n)])).toBe(
      (2n ** 70n * 3n).toString(),
    );
    expect(run("gcd", [big(-(2n ** 80n)), I(6)])).toBe("2");
    expect(run("gcd", [I(6), big(2n ** 80n)])).toBe("2");
  });
  test("invmod (C150, C151)", () => {
    expect(run("invmod", [I(3), I(11)])).toBe("4");
    expect(run("invmod", [I(-3), I(11)])).toBe("7");
    expect(run("invmod", [I(14), I(11)])).toBe("4");
    expect(run("invmod", [I(5), I(1)])).toBe("0");
    expect(run("invmod", [I(1), I(2)])).toBe("1");
    const m = 2n ** 89n - 1n;
    const inv = BigInt(run("invmod", [big(123456789012345678901234567890n), big(m)]));
    expect((inv * 123456789012345678901234567890n) % m).toBe(1n);
    expect(codeOf("invmod", [I(4), I(6)])).toBe("E_RANGE");
    expect(codeOf("invmod", [I(0), I(7)])).toBe("E_RANGE");
    expect(codeOf("invmod", [I(3), I(0)])).toBe("E_RANGE");
    expect(codeOf("invmod", [I(3), I(-5)])).toBe("E_RANGE");
  });
  test("powmod (C150)", () => {
    expect(run("powmod", [I(2), I(10), I(1000)])).toBe("24");
    expect(run("powmod", [I(4), I(13), I(497)])).toBe("445");
    expect(run("powmod", [I(5), I(0), I(7)])).toBe("1");
    expect(run("powmod", [I(5), I(3), I(1)])).toBe("0");
    expect(run("powmod", [I(0), I(0), I(1)])).toBe("0");
    expect(run("powmod", [I(-2), I(3), I(5)])).toBe("2");
    expect(run("powmod", [I(7), I(1), I(5)])).toBe("2");
    const m = 2n ** 127n - 1n;
    const e = 3n ** 60n;
    let expected = 1n;
    let b = 5n;
    for (let k = e; k > 0n; k >>= 1n) {
      if (k & 1n) expected = (expected * b) % m;
      b = (b * b) % m;
    }
    expect(run("powmod", [I(5), big(e), big(m)])).toBe(expected.toString());
    expect(codeOf("powmod", [I(2), I(-1), I(5)])).toBe("E_RANGE");
    expect(codeOf("powmod", [I(2), I(3), I(0)])).toBe("E_RANGE");
    expect(codeOf("powmod", [I(2), I(3), I(-7)])).toBe("E_RANGE");
  });
});

describe("sqrt neg abs min max", () => {
  test("sqrt (C152)", () => {
    expect(run("sqrt", [I(16)])).toBe("4.0");
    expect(run("sqrt", [I(2)])).toBe("1.4142135623730951");
    expect(run("sqrt", [N(2.25)])).toBe("1.5");
    expect(run("sqrt", [I(0)])).toBe("0.0");
    expect(codeOf("sqrt", [I(-1)])).toBe("E_RANGE");
    expect(codeOf("sqrt", [N(-0.5)])).toBe("E_RANGE");
    expect(codeOf("sqrt", [big(2n ** 60n)])).toBe("E_COERCE");
    expect(codeOf("sqrt", [S("a")])).toBe("E_TYPE");
  });
  test("neg", () => {
    expect(run("neg", [I(5)])).toBe("-5");
    expect(run("neg", [I(-5)])).toBe("5");
    expect(run("neg", [N(2.5)])).toBe("-2.5");
    expect(run("neg", [big(2n ** 60n)])).toBe((-(2n ** 60n)).toString());
    expect(run("neg", [big(-(2n ** 53n))])).toBe((2n ** 53n).toString());
    expect(run("neg", [I(-MAX_SAFE)])).toBe(String(MAX_SAFE));
    const [z] = callWith("neg", [I(0)]);
    expect(z).toEqual({ tag: "int", v: 0 });
    expect(Object.is((z as { v: number }).v, 0)).toBe(true);
    expect(codeOf("neg", [T])).toBe("E_TYPE");
  });
  test("abs", () => {
    expect(run("abs", [I(-5)])).toBe("5");
    expect(run("abs", [I(5)])).toBe("5");
    expect(run("abs", [N(-2.5)])).toBe("2.5");
    expect(run("abs", [N(2.5)])).toBe("2.5");
    expect(run("abs", [big(-(2n ** 60n))])).toBe((2n ** 60n).toString());
    expect(codeOf("abs", [S("a")])).toBe("E_TYPE");
  });
  test("min and max keep the tag; ties keep the deeper operand", () => {
    expect(run("min", [I(3), I(5)])).toBe("3");
    expect(run("min", [I(5), I(3)])).toBe("3");
    expect(run("max", [I(3), I(5)])).toBe("5");
    expect(run("max", [I(5), I(3)])).toBe("5");
    expect(run("min", [I(1), N(0.5)])).toBe("0.5");
    expect(run("max", [I(1), N(0.5)])).toBe("1");
    expect(run("min", [I(1), N(1)])).toBe("1");
    expect(run("min", [N(1), I(1)])).toBe("1.0");
    expect(run("max", [I(1), N(1)])).toBe("1");
    expect(run("max", [N(1), I(1)])).toBe("1.0");
    expect(run("min", [big(2n ** 60n), N(1e18)])).toBe("1000000000000000000.0");
    expect(run("max", [big(2n ** 60n), N(1e18)])).toBe((2n ** 60n).toString());
    expect(codeOf("min", [S("a"), I(1)])).toBe("E_TYPE");
    expect(codeOf("max", [I(1), S("a")])).toBe("E_TYPE");
  });
});

// ---------------------------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------------------------

describe("= and <>", () => {
  test("C25", () => {
    expect(run("=", [I(1), N(1)])).toBe("true");
    expect(run("=", [S("a"), S("a")])).toBe("true");
    expect(run("=", [S("a"), B(0x61)])).toBe("false");
    expect(run("=", [L(I(1), I(2)), L(I(1), I(2))])).toBe("true");
    expect(run("<>", [S("a"), B(0x61)])).toBe("true");
    expect(run("<>", [I(1), N(1)])).toBe("false");
  });
  test("exact int/num equality (C156)", () => {
    expect(run("=", [I(9007199254740992n), N(9007199254740992)])).toBe("true");
    expect(run("=", [I(9007199254740993n), N(9007199254740992)])).toBe("false");
    expect(run("=", [N(1.5), I(1)])).toBe("false");
    expect(run("=", [R(["a", I(1)], ["b", I(2)]), R(["b", I(2)], ["a", I(1)])])).toBe("true");
    expect(run("=", [I(1), T])).toBe("false");
  });
});

describe("< > <= >=", () => {
  test("numbers, exact across int and num", () => {
    expect(run("<", [I(1), I(2)])).toBe("true"); // C25
    expect(run("<", [I(2), I(1)])).toBe("false");
    expect(run(">", [I(9007199254740993n), N(9007199254740992)])).toBe("true"); // C156
    expect(run(">=", [I(9007199254740992n), N(9007199254740992)])).toBe("true");
    expect(run("<=", [I(1), N(1.5)])).toBe("true");
    expect(run("<=", [N(2.5), I(2)])).toBe("false");
    expect(run("<", [big(2n ** 80n), N(1e30)])).toBe("true");
    expect(run(">", [big(-(2n ** 80n)), I(0)])).toBe("false");
  });
  test("strings compare by code point", () => {
    expect(run(">", [S("b"), S("a")])).toBe("true"); // C25
    expect(run("<", [S("a"), S("ab")])).toBe("true");
    expect(run("<=", [S("a"), S("a")])).toBe("true");
    expect(run(">=", [S("a"), S("b")])).toBe("false");
    // U+10000 is above U+FFFF, although its UTF-16 code units sort below
    expect(run(">", [S("\u{10000}"), S("￿")])).toBe("true");
    expect(run("<", [S("￿"), S("\u{10000}")])).toBe("true");
  });
  test("bytes compare lexicographically", () => {
    expect(run("<", [B(1, 2), B(1, 3)])).toBe("true");
    expect(run("<", [B(1), B(1, 0)])).toBe("true");
    expect(run(">", [B(1, 0), B(1)])).toBe("true");
    expect(run("<=", [B(), B()])).toBe("true");
    expect(run(">=", [B(2), B(1, 255)])).toBe("true");
    expect(run(">", [B(0), B(255)])).toBe("false");
  });
  test("other operands are E_TYPE (C26)", () => {
    expect(errorOf("<", [I(1), S("a")]).code).toBe("E_TYPE");
    expect(errorOf("<", [I(1), S("a")]).detail).toMatchObject({
      expected: "number",
      actual: "str",
    });
    expect(codeOf(">", [S("a"), I(1)])).toBe("E_TYPE");
    expect(errorOf("<=", [S("a"), B(0x61)]).detail).toMatchObject({
      expected: "str",
      actual: "bytes",
    });
    expect(codeOf(">=", [B(1), S("a")])).toBe("E_TYPE");
    expect(errorOf("<", [L(), L()]).detail).toMatchObject({ actual: "list" });
    expect(codeOf("<", [T, F])).toBe("E_TYPE");
  });
});

// ---------------------------------------------------------------------------------------------
// Logic and bitwise
// ---------------------------------------------------------------------------------------------

describe("logic", () => {
  test("and or not (C28)", () => {
    expect(run("or", [T, F])).toBe("true");
    expect(run("or", [F, F])).toBe("false");
    expect(run("and", [T, F])).toBe("false");
    expect(run("and", [T, T])).toBe("true");
    expect(run("not", [T])).toBe("false");
    expect(run("not", [F])).toBe("true");
  });
});

describe("bitwise", () => {
  test("band bor bxor on ints (C27)", () => {
    expect(run("band", [I(5), I(3)])).toBe("1");
    expect(run("bor", [I(5), I(3)])).toBe("7");
    expect(run("bxor", [I(5), I(3)])).toBe("6");
  });
  test("two's complement of any width", () => {
    expect(run("band", [I(-1), I(255)])).toBe("255");
    expect(run("bor", [I(-6), I(3)])).toBe("-5");
    expect(run("bxor", [I(-1), I(5)])).toBe("-6");
    expect(run("band", [I(2 ** 31), I(1)])).toBe("0");
    expect(run("bor", [I(2 ** 31), I(1)])).toBe("2147483649");
    expect(run("bxor", [I(-(2 ** 31) - 1), I(0)])).toBe("-2147483649");
    expect(run("bor", [big(2n ** 70n), I(1)])).toBe((2n ** 70n + 1n).toString());
    expect(run("band", [big(-(2n ** 70n)), big(2n ** 70n)])).toBe((2n ** 70n).toString());
    expect(run("bxor", [big(2n ** 70n), big(2n ** 70n)])).toBe("0");
  });
  test("bnot", () => {
    expect(run("bnot", [I(0)])).toBe("-1"); // C27
    expect(run("bnot", [I(-1)])).toBe("0");
    expect(run("bnot", [I(5)])).toBe("-6");
    expect(run("bnot", [I(MAX_SAFE)])).toBe(String(-(2n ** 53n)));
    expect(run("bnot", [big(2n ** 70n)])).toBe(String(-(2n ** 70n) - 1n));
    expect(run("bnot", [big(-(2n ** 70n) - 1n)])).toBe((2n ** 70n).toString());
  });
  test("bxor on bytes uses a repeating key (C145, C146)", () => {
    expect(run("bxor", [B(1, 2, 3, 4), B(0xff, 0x0f)])).toBe("#[ fe 0d fc 0b ]");
    expect(run("bxor", [B(1), B(0xff, 0x0f)])).toBe("#[ fe ]");
    expect(run("bxor", [B(), B(7)])).toBe("#[ ]");
    expect(codeOf("bxor", [B(1), B()])).toBe("E_RANGE");
    expect(codeOf("bxor", [B(), B()])).toBe("E_RANGE");
  });
  test("bxor with mixed or other tags is E_TYPE", () => {
    expect(codeOf("bxor", [I(1), B(1)])).toBe("E_TYPE");
    expect(codeOf("bxor", [B(1), I(1)])).toBe("E_TYPE");
    expect(codeOf("bxor", [S("a"), S("b")])).toBe("E_TYPE");
    expect(errorOf("bxor", [S("a"), S("b")]).detail).toMatchObject({ expected: "int or bytes" });
    expect(codeOf("bxor", [N(1), N(2)])).toBe("E_TYPE");
  });
  test("shl and shr (C27, C157)", () => {
    expect(run("shl", [I(1), I(8)])).toBe("256");
    expect(run("shl", [I(-1), I(3)])).toBe("-8");
    expect(run("shl", [I(0), I(2n ** 70n)])).toBe("0");
    expect(run("shl", [I(3), I(0)])).toBe("3");
    expect(run("shl", [I(1), I(100)])).toBe((2n ** 100n).toString());
    expect(run("shr", [I(-8), I(1)])).toBe("-4");
    expect(run("shr", [I(8), I(1)])).toBe("4");
    expect(run("shr", [I(5), I(0)])).toBe("5");
    expect(run("shr", [I(5), I(100)])).toBe("0");
    expect(run("shr", [I(-5), I(100)])).toBe("-1");
    expect(run("shr", [I(-8), I(3)])).toBe("-1");
    expect(run("shr", [I(5), I(2n ** 70n)])).toBe("0");
    expect(run("shr", [I(-5), I(2n ** 70n)])).toBe("-1");
    expect(run("shr", [big(2n ** 70n), I(69)])).toBe("2");
    expect(codeOf("shl", [I(1), I(-1)])).toBe("E_RANGE");
    expect(codeOf("shr", [I(1), I(-1)])).toBe("E_RANGE");
  });
  test("shl checks maxIntBits before computing", () => {
    expect(codeOf("shl", [I(1), I(200)], { maxIntBits: 100 })).toBe("E_LIMIT_VALUE"); // C157
    expect(run("shl", [I(1), I(99)], { maxIntBits: 100 })).toBe((2n ** 99n).toString());
    expect(codeOf("shl", [I(1), I(100)], { maxIntBits: 100 })).toBe("E_LIMIT_VALUE");
    expect(codeOf("shl", [I(1), I(2n ** 70n)])).toBe("E_LIMIT_VALUE");
    expect(codeOf("shl", [I(-5), I(65536)])).toBe("E_LIMIT_VALUE");
  });
});

// ---------------------------------------------------------------------------------------------
// Sequences
// ---------------------------------------------------------------------------------------------

describe("len", () => {
  test("counts code points, bytes and elements", () => {
    expect(run("len", [S("\u{1F600}")])).toBe("1"); // C42
    expect(run("len", [S("héllo")])).toBe("5");
    expect(run("len", [S("")])).toBe("0");
    expect(run("len", [S("\ud800x")])).toBe("2");
    expect(run("len", [B()])).toBe("0");
    expect(run("len", [B(1, 2, 3)])).toBe("3");
    expect(run("len", [L(I(1), L())])).toBe("2");
  });
  test("other tags are E_TYPE", () => {
    expect(codeOf("len", [I(1)])).toBe("E_TYPE");
    expect(codeOf("len", [R()])).toBe("E_TYPE");
  });
});

describe("cat", () => {
  test("concatenates two of a kind (C42, C43)", () => {
    expect(run("cat", [S("abc"), S("xyz")])).toBe('"abcxyz"');
    expect(run("cat", [S(""), S("")])).toBe('""');
    expect(run("cat", [B(0xde, 0xad), B(0xbe, 0xef)])).toBe("#[ de ad be ef ]");
    expect(run("cat", [B(), B()])).toBe("#[ ]");
    expect(run("cat", [B(1), B()])).toBe("#[ 01 ]");
    expect(run("cat", [L(I(1)), L(I(2), I(3))])).toBe("{ 1 2 3 }");
    expect(run("cat", [L(), L()])).toBe("{ }");
  });
  test("different kinds are E_TYPE", () => {
    expect(codeOf("cat", [S("a"), B(1)])).toBe("E_TYPE");
    expect(codeOf("cat", [B(1), L()])).toBe("E_TYPE");
    expect(codeOf("cat", [L(), S("a")])).toBe("E_TYPE");
    expect(codeOf("cat", [I(1), I(2)])).toBe("E_TYPE");
    expect(errorOf("cat", [S("a"), I(2)]).detail).toMatchObject({ expected: "str", actual: "int" });
  });
  test("is metered against maxValueBytes before allocating", () => {
    const limits = { maxValueBytes: 10 };
    expect(codeOf("cat", [S("abc"), S("def")], limits)).toBe("E_LIMIT_VALUE");
    expect(run("cat", [S("ab"), S("cde")], limits)).toBe('"abcde"');
    expect(codeOf("cat", [B(1, 2, 3, 4, 5, 6), B(1, 2, 3, 4, 5)], limits)).toBe("E_LIMIT_VALUE");
    expect(run("cat", [B(1, 2, 3, 4, 5, 6), B(1, 2, 3, 4)], limits)).toContain("#[ 01");
    expect(codeOf("cat", [L(I(1)), L(I(2))], limits)).toBe("E_LIMIT_VALUE");
    expect(errorOf("cat", [S("abc"), S("def")], limits).detail).toMatchObject({
      limit: 10,
      value: 12,
    });
  });
});

describe("slice", () => {
  test("takes [from, to) by code point (C42)", () => {
    expect(run("slice", [S("hello"), I(1), I(3)])).toBe('"el"');
    expect(run("slice", [S("a\u{1F600}b"), I(1), I(2)])).toBe('"\u{1F600}"');
    expect(run("slice", [S("a\u{1F600}b"), I(2), I(3)])).toBe('"b"');
    expect(run("slice", [S("abc"), I(0), I(3)])).toBe('"abc"');
    expect(run("slice", [S("abc"), I(3), I(3)])).toBe('""');
    expect(run("slice", [B(1, 2, 3, 4), I(1), I(3)])).toBe("#[ 02 03 ]");
    expect(run("slice", [B(1, 2), I(0), I(2)])).toBe("#[ 01 02 ]");
    expect(run("slice", [B(), I(0), I(0)])).toBe("#[ ]");
    expect(run("slice", [L(I(1), I(2), I(3)), I(1), I(3)])).toBe("{ 2 3 }");
    expect(run("slice", [L(), I(0), I(0)])).toBe("{ }");
  });
  test("bad bounds are E_RANGE", () => {
    expect(codeOf("slice", [S("abc"), I(-1), I(2)])).toBe("E_RANGE");
    expect(codeOf("slice", [S("abc"), I(2), I(1)])).toBe("E_RANGE");
    expect(codeOf("slice", [S("abc"), I(0), I(4)])).toBe("E_RANGE");
    expect(codeOf("slice", [B(1), I(0), I(2)])).toBe("E_RANGE");
    expect(codeOf("slice", [L(), I(0), I(1)])).toBe("E_RANGE");
    expect(codeOf("slice", [S("abc"), I(2n ** 70n), I(2n ** 71n)])).toBe("E_RANGE");
    expect(codeOf("slice", [S("abc"), I(0), I(2n ** 70n)])).toBe("E_RANGE");
    expect(errorOf("slice", [S("abc"), I(0), I(9)]).detail).toMatchObject({ length: 3 });
  });
  test("other tags are E_TYPE", () => {
    expect(codeOf("slice", [I(1), I(0), I(0)])).toBe("E_TYPE");
  });
});

describe("nth", () => {
  test("element i (C42, C43)", () => {
    expect(run("nth", [S("abc"), I(1)])).toBe('"b"');
    expect(run("nth", [S("a\u{1F600}b"), I(1)])).toBe('"\u{1F600}"');
    expect(run("nth", [S("a\u{1F600}b"), I(2)])).toBe('"b"');
    expect(run("nth", [B(1, 2, 3), I(1)])).toBe("2");
    expect(run("nth", [L(I(1), S("x")), I(1)])).toBe('"x"');
    expect(run("nth", [L(L(I(1))), I(0)])).toBe("{ 1 }");
  });
  test("out of range is E_RANGE", () => {
    expect(codeOf("nth", [S("abc"), I(3)])).toBe("E_RANGE");
    expect(codeOf("nth", [S("abc"), I(-1)])).toBe("E_RANGE");
    expect(codeOf("nth", [S(""), I(0)])).toBe("E_RANGE");
    expect(codeOf("nth", [B(1), I(1)])).toBe("E_RANGE");
    expect(codeOf("nth", [L(), I(0)])).toBe("E_RANGE");
    expect(codeOf("nth", [L(I(1)), I(2n ** 70n)])).toBe("E_RANGE");
  });
  test("other tags are E_TYPE", () => {
    expect(codeOf("nth", [T, I(0)])).toBe("E_TYPE");
  });
});

describe("rev", () => {
  test("reverses by code point", () => {
    expect(run("rev", [S("abc")])).toBe('"cba"'); // C42
    expect(run("rev", [S("a\u{1F600}b")])).toBe('"b\u{1F600}a"');
    expect(run("rev", [S("\ud800a")])).toBe('"a\ud800"');
    expect(run("rev", [S("")])).toBe('""');
    expect(run("rev", [B(1, 2, 3)])).toBe("#[ 03 02 01 ]");
    expect(run("rev", [B()])).toBe("#[ ]");
    expect(run("rev", [L(I(1), S("a"))])).toBe('{ "a" 1 }');
    expect(run("rev", [L()])).toBe("{ }");
  });
  test("other tags are E_TYPE", () => {
    expect(codeOf("rev", [I(1)])).toBe("E_TYPE");
  });
});

// ---------------------------------------------------------------------------------------------
// Strings
// ---------------------------------------------------------------------------------------------

describe("split", () => {
  test("splits at every separator (C42, C138)", () => {
    expect(run("split", [S("a,b,c"), S(",")])).toBe('{ "a" "b" "c" }');
    expect(run("split", [S(""), S(",")])).toBe('{ "" }');
    expect(run("split", [S("a,"), S(",")])).toBe('{ "a" "" }');
    expect(run("split", [S(",a"), S(",")])).toBe('{ "" "a" }');
    expect(run("split", [S(","), S(",")])).toBe('{ "" "" }');
    expect(run("split", [S("a,,b"), S(",")])).toBe('{ "a" "" "b" }');
    expect(run("split", [S("abc"), S(",")])).toBe('{ "abc" }');
    expect(run("split", [S("a--b--c"), S("--")])).toBe('{ "a" "b" "c" }');
    expect(run("split", [S("aaa"), S("aa")])).toBe('{ "" "a" }');
  });
  test("never splits inside a surrogate pair", () => {
    expect(run("split", [S("a\u{1F600}b"), S("\ude00")])).toBe('{ "a\u{1F600}b" }');
    expect(run("split", [S("a\u{1F600}b"), S("\ud83d")])).toBe('{ "a\u{1F600}b" }');
    expect(run("split", [S("a\u{1F600}b"), S("\u{1F600}")])).toBe('{ "a" "b" }');
    expect(run("split", [S("\ud83d,\ude00"), S(",")])).toBe('{ "\ud83d" "\ude00" }');
    expect(run("split", [S("\u{1F600}\ude00x\ude00"), S("\ude00")])).toBe('{ "\u{1F600}" "x" "" }');
  });
  test("an empty separator is E_RANGE", () => {
    expect(codeOf("split", [S("abc"), S("")])).toBe("E_RANGE");
  });
  test("is metered", () => {
    expect(codeOf("split", [S("a,b,c,d,e,f"), S(",")], { maxValueBytes: 50 })).toBe(
      "E_LIMIT_VALUE",
    );
  });
});

describe("join and bjoin", () => {
  test("join (C42)", () => {
    expect(run("join", [L(S("a"), S("b")), S("-")])).toBe('"a-b"');
    expect(run("join", [L(S("a")), S("-")])).toBe('"a"');
    expect(run("join", [L(), S("-")])).toBe('""');
    expect(run("join", [L(S(""), S("")), S("-")])).toBe('"-"');
    expect(run("join", [L(S("a"), S("b")), S("")])).toBe('"ab"');
  });
  test("join with a non-str element is E_TYPE", () => {
    const e = errorOf("join", [L(S("a"), I(1)), S("-")]);
    expect(e.code).toBe("E_TYPE");
    expect(e.detail).toMatchObject({ expected: "str", actual: "int", index: 1 });
  });
  test("join is metered", () => {
    expect(codeOf("join", [L(S("aaaa"), S("bbbb")), S("--")], { maxValueBytes: 19 })).toBe(
      "E_LIMIT_VALUE",
    );
  });
  test("bjoin (C149)", () => {
    expect(run("bjoin", [L(B(1), B(2, 3)), B(0xff)])).toBe("#[ 01 ff 02 03 ]");
    expect(run("bjoin", [L(B(1)), B(0xff)])).toBe("#[ 01 ]");
    expect(run("bjoin", [L(), B(0xff)])).toBe("#[ ]");
    expect(run("bjoin", [L(B(), B()), B(7, 8)])).toBe("#[ 07 08 ]");
    expect(run("bjoin", [L(B(1), B(2)), B()])).toBe("#[ 01 02 ]");
  });
  test("bjoin with a non-bytes element is E_TYPE", () => {
    const e = errorOf("bjoin", [L(B(1), S("a")), B(0)]);
    expect(e.code).toBe("E_TYPE");
    expect(e.detail).toMatchObject({ expected: "bytes", actual: "str", index: 1 });
  });
  test("bjoin is metered", () => {
    expect(codeOf("bjoin", [L(B(1, 2, 3, 4), B(5, 6, 7, 8)), B(0, 0)], { maxValueBytes: 9 })).toBe(
      "E_LIMIT_VALUE",
    );
  });
});

describe("upper and lower", () => {
  test("use the JavaScript case mappings (C42)", () => {
    expect(run("upper", [S("aBc")])).toBe('"ABC"');
    expect(run("lower", [S("aBc")])).toBe('"abc"');
    expect(run("upper", [S("straße")])).toBe('"STRASSE"');
    expect(run("upper", [S("é")])).toBe('"É"');
    expect(run("lower", [S("É")])).toBe('"é"');
    expect(run("upper", [S("")])).toBe('""');
    expect(run("lower", [S("\u{1F600}")])).toBe('"\u{1F600}"');
  });
});

// ---------------------------------------------------------------------------------------------
// Bytes, lists, records
// ---------------------------------------------------------------------------------------------

describe("translate", () => {
  const table = new Uint8Array(256).map((_, i) => 255 - i);
  test("replaces each byte through the table (C147)", () => {
    expect(run("translate", [B(0, 1, 255), bytes(table)])).toBe("#[ ff fe 00 ]");
    expect(run("translate", [B(), bytes(table)])).toBe("#[ ]");
    expect(run("translate", [B(7), bytes(new Uint8Array(256).map((_, i) => i))])).toBe("#[ 07 ]");
  });
  test("a table that is not exactly 256 bytes is E_PARAM_INVALID (C148)", () => {
    const e = errorOf("translate", [B(0), B(1)]);
    expect(e.code).toBe("E_PARAM_INVALID");
    expect(e.detail).toMatchObject({ param: "table", constraint: "[256]" });
    expect(codeOf("translate", [B(0), bytes(new Uint8Array(257))])).toBe("E_PARAM_INVALID");
    expect(codeOf("translate", [B(0), B()])).toBe("E_PARAM_INVALID");
  });
});

describe("append zip range", () => {
  test("append (C43)", () => {
    expect(run("append", [L(I(1), I(2)), I(3)])).toBe("{ 1 2 3 }");
    expect(run("append", [L(), S("a")])).toBe('{ "a" }');
    expect(run("append", [L(I(1)), L(I(2))])).toBe("{ 1 { 2 } }");
  });
  test("append is metered", () => {
    expect(codeOf("append", [L(I(1), I(2)), I(3)], { maxValueBytes: 40 })).toBe("E_LIMIT_VALUE");
  });
  test("zip (C149)", () => {
    expect(run("zip", [L(I(1), I(2), I(3)), L(S("a"), S("b"))])).toBe('{ { 1 "a" } { 2 "b" } }');
    expect(run("zip", [L(I(1)), L(S("a"), S("b"))])).toBe('{ { 1 "a" } }');
    expect(run("zip", [L(), L(I(1))])).toBe("{ }");
    expect(codeOf("zip", [L(I(1), I(2)), L(I(1), I(2))], { maxValueBytes: 50 })).toBe(
      "E_LIMIT_VALUE",
    );
  });
  test("range (C43)", () => {
    expect(run("range", [I(0), I(3)])).toBe("{ 0 1 2 }");
    expect(run("range", [I(-2), I(2)])).toBe("{ -2 -1 0 1 }");
    expect(run("range", [I(3), I(3)])).toBe("{ }");
    expect(run("range", [I(5), I(2)])).toBe("{ }");
    expect(run("range", [I(9007199254740990n), I(9007199254740994n)])).toBe(
      "{ 9007199254740990 9007199254740991 9007199254740992 9007199254740993 }",
    );
    expect(run("range", [I(MAX_SAFE - 1), I(MAX_SAFE + 1)])).toBe(
      "{ 9007199254740990 9007199254740991 }",
    );
    expect(run("range", [I(-(2n ** 60n)), I(-(2n ** 60n) + 2n)])).toBe(
      `{ ${-(2n ** 60n)} ${-(2n ** 60n) + 1n} }`,
    );
  });
  test("range results are normal-form ints", () => {
    const [r] = callWith("range", [I(9007199254740990n), I(9007199254740993n)]);
    if (r?.tag !== "list") throw new Error("expected a list");
    expect(r.v.map((x) => typeof x.v)).toEqual(["number", "number", "bigint"]);
  });
  test("range is metered before allocating", () => {
    expect(codeOf("range", [I(0), I(10_000_000)], { maxValueBytes: 1000 })).toBe("E_LIMIT_VALUE");
    expect(codeOf("range", [I(0), I(2n ** 70n)])).toBe("E_LIMIT_VALUE");
    expect(run("range", [I(0), I(2)], { maxValueBytes: 32 })).toBe("{ 0 1 }");
  });
});

describe("records", () => {
  test(">record (C48)", () => {
    expect(run(">record", [L(L(S("a"), I(1)), L(S("b"), I(2)))])).toBe('record{ "a": 1 "b": 2 }');
    expect(run(">record", [L()])).toBe("record{ }");
    expect(run(">record", [L(L(S("a"), I(1)), L(S("b"), I(2)), L(S("a"), I(3)))])).toBe(
      'record{ "a": 3 "b": 2 }',
    );
  });
  test(">record rejects malformed pairs with E_TYPE", () => {
    expect(codeOf(">record", [L(I(1))])).toBe("E_TYPE");
    expect(codeOf(">record", [L(L(S("a")))])).toBe("E_TYPE");
    expect(codeOf(">record", [L(L(S("a"), I(1), I(2)))])).toBe("E_TYPE");
    expect(errorOf(">record", [L(L(I(1), I(1)))]).detail).toMatchObject({ expected: "str key" });
  });
  test("get (C48)", () => {
    expect(run("get", [R(["a", I(1)]), S("a")])).toBe("1");
    expect(run("get", [R(["a", L(I(1))]), S("a")])).toBe("{ 1 }");
    expect(codeOf("get", [R(), S("z")])).toBe("E_RANGE");
    expect(codeOf("get", [R(["a", I(1)]), S("b")])).toBe("E_RANGE");
  });
  test("put returns a new record (C48)", () => {
    const orig = R(["a", I(1)], ["b", I(2)]);
    expect(run("put", [orig, S("c"), I(3)])).toBe('record{ "a": 1 "b": 2 "c": 3 }');
    expect(run("put", [orig, S("a"), S("x")])).toBe('record{ "a": "x" "b": 2 }');
    expect(run("put", [R(), S("a"), I(5)])).toBe('record{ "a": 5 }');
    expect(repr(orig)).toBe('record{ "a": 1 "b": 2 }');
  });
  test("keys in insertion order (C48)", () => {
    expect(run("keys", [R(["b", I(1)], ["a", I(2)])])).toBe('{ "b" "a" }');
    expect(run("keys", [R()])).toBe("{ }");
  });
});

// ---------------------------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------------------------

describe("type", () => {
  test("names every tag (C49)", () => {
    const quot = { tag: "quot", v: {} } as unknown as Value;
    const file = { tag: "file", v: { name: "n", type: "t", bytes: new Uint8Array() } } as Value;
    const expected: [Value, string][] = [
      [I(1), "int"],
      [N(1), "num"],
      [S("a"), "str"],
      [B(), "bytes"],
      [L(), "list"],
      [quot, "quot"],
      [T, "bool"],
      [R(), "record"],
      [file, "file"],
    ];
    for (const [v, name] of expected) expect(run("type", [v])).toBe(JSON.stringify(name));
  });
});

describe("int and string conversion", () => {
  test("int>str", () => {
    expect(run("int>str", [I(42)])).toBe('"42"');
    expect(run("int>str", [I(-7)])).toBe('"-7"');
    expect(run("int>str", [I(0)])).toBe('"0"');
    expect(run("int>str", [big(2n ** 100n)])).toBe(`"${2n ** 100n}"`);
  });
  test("str>int (C46, C47)", () => {
    expect(run("str>int", [S("42")])).toBe("42");
    expect(run("str>int", [S("-7")])).toBe("-7");
    expect(run("str>int", [S("007")])).toBe("7");
    expect(run("str>int", [S("-0")])).toBe("0");
    expect(run("str>int", [S("123456789012345678901234567890")])).toBe(
      "123456789012345678901234567890",
    );
    expect(run("str>int", [S("-9007199254740993")])).toBe("-9007199254740993");
    const [z] = callWith("str>int", [S("-0")]);
    expect(Object.is((z as { v: number }).v, 0)).toBe(true);
    for (const bad of ["x", "", "-", "+1", "1.5", " 1", "1 ", "1\n", "1_000", "１", "--1"]) {
      expect(codeOf("str>int", [S(bad)]), JSON.stringify(bad)).toBe("E_COERCE");
    }
  });
  test("str>int is bounded by maxIntBits", () => {
    expect(codeOf("str>int", [S("300")], { maxIntBits: 8 })).toBe("E_LIMIT_VALUE");
    expect(run("str>int", [S("255")], { maxIntBits: 8 })).toBe("255");
    expect(run("str>int", [S("-255")], { maxIntBits: 8 })).toBe("-255");
    expect(codeOf("str>int", [S("1".repeat(100))], { maxIntBits: 8 })).toBe("E_LIMIT_VALUE");
  });
  test("int>str-radix (C153, C155)", () => {
    expect(run("int>str-radix", [I(255), I(16)])).toBe('"ff"');
    expect(run("int>str-radix", [I(-255), I(2)])).toBe('"-11111111"');
    expect(run("int>str-radix", [I(0), I(7)])).toBe('"0"');
    expect(run("int>str-radix", [I(35), I(36)])).toBe('"z"');
    expect(run("int>str-radix", [big(2n ** 80n), I(16)])).toBe('"100000000000000000000"');
    for (const radix of [1, 0, 37, -2]) {
      expect(codeOf("int>str-radix", [I(5), I(radix)])).toBe("E_RANGE");
    }
    expect(codeOf("int>str-radix", [I(5), I(2n ** 70n)])).toBe("E_RANGE");
  });
  test("str>int-radix (C153, C154, C155)", () => {
    expect(run("str>int-radix", [S("FF"), I(16)])).toBe("255");
    expect(run("str>int-radix", [S("ff"), I(16)])).toBe("255");
    expect(run("str>int-radix", [S("zz"), I(36)])).toBe("1295");
    expect(run("str>int-radix", [S("ZZ"), I(36)])).toBe("1295");
    expect(run("str>int-radix", [S("-ff"), I(16)])).toBe("-255");
    expect(run("str>int-radix", [S("000"), I(2)])).toBe("0");
    expect(run("str>int-radix", [S("-0"), I(2)])).toBe("0");
    expect(run("str>int-radix", [S("101"), I(2)])).toBe("5");
    expect(run("str>int-radix", [S("1".repeat(70)), I(2)])).toBe((2n ** 70n - 1n).toString());
    expect(run("str>int-radix", [S("z".repeat(20)), I(36)])).toBe((36n ** 20n - 1n).toString());
    expect(run("str>int-radix", [S("1" + "0".repeat(60)), I(16)])).toBe((16n ** 60n).toString());
    expect(run("str>int-radix", [S("9".repeat(30)), I(10)])).toBe("9".repeat(30));
    for (const bad of ["12", "", "-", "0x1", "g", " 1", "+1"]) {
      expect(codeOf("str>int-radix", [S(bad), I(2)]), bad).toBe("E_COERCE");
    }
    expect(codeOf("str>int-radix", [S("z"), I(16)])).toBe("E_COERCE");
    for (const radix of [1, 0, 37]) {
      expect(codeOf("str>int-radix", [S("1"), I(radix)])).toBe("E_RANGE");
    }
    // the radix is checked before the text
    expect(codeOf("str>int-radix", [S("!!"), I(99)])).toBe("E_RANGE");
  });
  test("str>int-radix is bounded by maxIntBits", () => {
    const limits = { maxIntBits: 64 };
    expect(run("str>int-radix", [S("1" + "0".repeat(63)), I(2)], limits)).toBe(
      (2n ** 63n).toString(),
    );
    expect(codeOf("str>int-radix", [S("1" + "0".repeat(64)), I(2)], limits)).toBe("E_LIMIT_VALUE");
    expect(codeOf("str>int-radix", [S("1" + "0".repeat(100)), I(2)], limits)).toBe("E_LIMIT_VALUE");
    expect(codeOf("str>int-radix", [S("-" + "f".repeat(17)), I(16)], limits)).toBe("E_LIMIT_VALUE");
    expect(errorOf("str>int-radix", [S("1" + "0".repeat(100)), I(2)], limits).detail).toMatchObject(
      {
        limit: 64,
      },
    );
  });
});

describe("number conversion", () => {
  test("int>num (C46)", () => {
    expect(run("int>num", [I(3)])).toBe("3.0");
    expect(run("int>num", [I(-5)])).toBe("-5.0");
    expect(codeOf("int>num", [big(2n ** 60n)])).toBe("E_COERCE");
  });
  test("num>int (C46)", () => {
    expect(run("num>int", [N(3)])).toBe("3");
    expect(run("num>int", [N(-4)])).toBe("-4");
    expect(run("num>int", [N(1e20)])).toBe("100000000000000000000");
    expect(run("num>int", [N(2 ** 53)])).toBe("9007199254740992");
    const [z] = callWith("num>int", [N(-0)]);
    expect(Object.is((z as { v: number }).v, 0)).toBe(true);
    expect(codeOf("num>int", [N(3.5)])).toBe("E_COERCE");
    expect(codeOf("num>int", [N(-0.1)])).toBe("E_COERCE");
  });
  test("floor ceil round (C46, C152)", () => {
    expect(run("floor", [N(3.7)])).toBe("3");
    expect(run("floor", [N(-3.2)])).toBe("-4");
    expect(run("floor", [I(5)])).toBe("5");
    expect(run("floor", [big(2n ** 70n)])).toBe((2n ** 70n).toString());
    expect(run("floor", [N(1e300)])).toBe(BigInt(1e300).toString());
    expect(run("ceil", [N(2.5)])).toBe("3");
    expect(run("ceil", [N(-2.5)])).toBe("-2");
    expect(run("ceil", [N(2)])).toBe("2");
    expect(run("ceil", [I(-3)])).toBe("-3");
    expect(run("round", [N(2.5)])).toBe("3");
    expect(run("round", [N(-2.5)])).toBe("-3");
    expect(run("round", [N(2.4)])).toBe("2");
    expect(run("round", [N(-2.6)])).toBe("-3");
    expect(run("round", [N(0.49999999999999994)])).toBe("0");
    expect(run("round", [N(1e20)])).toBe("100000000000000000000");
    expect(run("round", [I(7)])).toBe("7");
    for (const name of ["floor", "ceil", "round"]) {
      const [z] = callWith(name, [N(-0.4)]);
      expect(Object.is((z as { v: number }).v, 0), name).toBe(name !== "floor" ? true : false);
    }
    expect(codeOf("floor", [S("a")])).toBe("E_TYPE");
    expect(codeOf("ceil", [S("a")])).toBe("E_TYPE");
    expect(codeOf("round", [S("a")])).toBe("E_TYPE");
  });
});

describe("text and byte conversion", () => {
  test("str>bytes is UTF-8, strict (C42)", () => {
    expect(run("str>bytes", [S("héllo")])).toBe("#[ 68 c3 a9 6c 6c 6f ]");
    expect(run("str>bytes", [S("")])).toBe("#[ ]");
    expect(run("str>bytes", [S("\u{1F600}")])).toBe("#[ f0 9f 98 80 ]");
    expect(run("str>bytes", [S("﻿")])).toBe("#[ ef bb bf ]");
    expect(codeOf("str>bytes", [S("a\ud800")])).toBe("E_COERCE");
    expect(codeOf("str>bytes", [S("\udc00")])).toBe("E_COERCE");
  });
  test("bytes>str is strict and keeps the BOM (C45)", () => {
    expect(run("bytes>str", [B(0x68, 0xc3, 0xa9)])).toBe('"hé"');
    expect(run("bytes>str", [B()])).toBe('""');
    expect(run("bytes>str", [B(0xef, 0xbb, 0xbf)])).toBe('"﻿"');
    expect(callWith("bytes>str", [B(0xef, 0xbb, 0xbf)])[0]).toEqual({ tag: "str", v: "﻿" });
    for (const bad of [[0xff], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xe2, 0x82], [0xf8, 0x88]]) {
      expect(codeOf("bytes>str", [B(...bad)]), bad.join(",")).toBe("E_COERCE");
    }
  });
  test("latin1>bytes (C143, C144)", () => {
    expect(run("latin1>bytes", [S("é")])).toBe("#[ e9 ]");
    expect(run("latin1>bytes", [S("Aÿ")])).toBe("#[ 41 ff ]");
    expect(run("latin1>bytes", [S("")])).toBe("#[ ]");
    expect(codeOf("latin1>bytes", [S("€")])).toBe("E_RANGE");
    expect(codeOf("latin1>bytes", [S("Ā")])).toBe("E_RANGE");
    expect(codeOf("latin1>bytes", [S("\u{1F600}")])).toBe("E_RANGE");
    expect(codeOf("latin1>bytes", [S("\ud800")])).toBe("E_RANGE");
  });
  test("bytes>latin1 (C143)", () => {
    expect(run("bytes>latin1", [B(0xc3, 0xa9)])).toBe('"Ã©"');
    expect(run("bytes>latin1", [B()])).toBe('""');
    expect(run("len", [str(callWithStr("bytes>latin1", [B(0xc3, 0xa9)]))])).toBe("2");
    const all = new Uint8Array(256).map((_, i) => i);
    const text = callWithStr("bytes>latin1", [bytes(all)]);
    expect(text).toHaveLength(256);
    expect([...text].every((c, i) => c.codePointAt(0) === i)).toBe(true);
    expect(callWith("latin1>bytes", [S(text)])[0]).toEqual(bytes(all));
    const long = new Uint8Array(20000).fill(0xe9);
    expect(callWithStr("bytes>latin1", [bytes(long)])).toBe("é".repeat(20000));
    expect(codeOf("bytes>latin1", [B(1, 2, 3)], { maxValueBytes: 5 })).toBe("E_LIMIT_VALUE");
  });
  test("bytes>hex", () => {
    expect(run("bytes>hex", [B(0xde, 0xad, 0xbe, 0xef)])).toBe('"deadbeef"');
    expect(run("bytes>hex", [B()])).toBe('""');
    expect(run("bytes>hex", [B(0, 1, 0x0a)])).toBe('"00010a"');
    expect(codeOf("bytes>hex", [B(1, 2, 3)], { maxValueBytes: 10 })).toBe("E_LIMIT_VALUE");
  });
  test("hex>bytes", () => {
    expect(run("hex>bytes", [S("DEad")])).toBe("#[ de ad ]");
    expect(run("hex>bytes", [S("de ad\nbe\tef\r\f\v ")])).toBe("#[ de ad be ef ]");
    expect(run("hex>bytes", [S("")])).toBe("#[ ]");
    expect(run("hex>bytes", [S(" \n ")])).toBe("#[ ]");
    expect(codeOf("hex>bytes", [S("abc")])).toBe("E_COERCE");
    expect(codeOf("hex>bytes", [S("a b c")])).toBe("E_COERCE");
    expect(codeOf("hex>bytes", [S("zz")])).toBe("E_COERCE");
    expect(codeOf("hex>bytes", [S("0x01")])).toBe("E_COERCE");
    expect(codeOf("hex>bytes", [S("a b")])).toBe("E_COERCE");
    const all = new Uint8Array(256).map((_, i) => i);
    const hex = callWithStr("bytes>hex", [bytes(all)]);
    expect(callWith("hex>bytes", [S(hex)])[0]).toEqual(bytes(all));
  });
  test("str>codes and codes>str", () => {
    expect(run("str>codes", [S("a\u{1F600}")])).toBe("{ 97 128512 }");
    expect(run("str>codes", [S("")])).toBe("{ }");
    expect(run("str>codes", [S("\ud800")])).toBe("{ 55296 }");
    expect(codeOf("str>codes", [S("abc")], { maxValueBytes: 40 })).toBe("E_LIMIT_VALUE");
    expect(run("codes>str", [L(I(97), I(128512))])).toBe('"a\u{1F600}"');
    expect(run("codes>str", [L()])).toBe('""');
    expect(run("codes>str", [L(I(0), I(0x10ffff), I(0xd7ff), I(0xe000))])).toBe(
      '"\\0\u{10ffff}\ud7ff\ue000"',
    );
    const many = L(...Array.from({ length: 20000 }, (_, i) => I(i % 2 ? 0x1f600 : 97)));
    expect(callWithStr("codes>str", [many])).toBe("a\u{1F600}".repeat(10000));
    for (const bad of [0xd800, 0xdfff, 0x110000, -1, 2n ** 70n]) {
      expect(codeOf("codes>str", [L(I(97), I(bad))]), String(bad)).toBe("E_RANGE");
    }
    expect(codeOf("codes>str", [L(S("a"))])).toBe("E_TYPE");
    expect(codeOf("codes>str", [L(N(97))])).toBe("E_TYPE");
    expect(errorOf("codes>str", [L(I(97), T)]).detail).toMatchObject({ index: 1 });
    expect(codeOf("codes>str", [L(I(97), I(98), I(99))], { maxValueBytes: 5 })).toBe(
      "E_LIMIT_VALUE",
    );
  });
  test("bytes>list and list>bytes (C43, C44)", () => {
    expect(run("bytes>list", [B(1, 2, 3)])).toBe("{ 1 2 3 }");
    expect(run("bytes>list", [B()])).toBe("{ }");
    expect(codeOf("bytes>list", [B(1, 2, 3)], { maxValueBytes: 40 })).toBe("E_LIMIT_VALUE");
    expect(run("list>bytes", [L(I(1), I(2))])).toBe("#[ 01 02 ]");
    expect(run("list>bytes", [L(I(0), I(255))])).toBe("#[ 00 ff ]");
    expect(run("list>bytes", [L()])).toBe("#[ ]");
    expect(codeOf("list>bytes", [L(I(300))])).toBe("E_RANGE");
    expect(codeOf("list>bytes", [L(I(256))])).toBe("E_RANGE");
    expect(codeOf("list>bytes", [L(I(-1))])).toBe("E_RANGE");
    expect(codeOf("list>bytes", [L(I(2n ** 70n))])).toBe("E_RANGE");
    expect(codeOf("list>bytes", [L(S("a"))])).toBe("E_TYPE");
    expect(codeOf("list>bytes", [L(N(1))])).toBe("E_TYPE");
    expect(errorOf("list>bytes", [L(I(1), T)]).detail).toMatchObject({ index: 1 });
  });
});

function callWithStr(name: string, args: Value[]): string {
  const [r] = callWith(name, args);
  if (r?.tag !== "str") throw new Error("expected a str result");
  return r.v;
}

describe("fail", () => {
  test("raises E_USER with the message", () => {
    const e = errorOf("fail", [S("boom")]);
    expect(e.code).toBe("E_USER");
    expect(e.message).toBe("boom");
    expect(e.word).toBe("core:fail");
    expect(codeOf("fail", [S("")])).toBe("E_USER");
  });
});

// ---------------------------------------------------------------------------------------------
// Conformance tests that exercise only primitives, and coverage of the whole word list
// ---------------------------------------------------------------------------------------------

describe("conformance (section 16), primitives only", () => {
  test("C42 string words", () => {
    expect(run("bytes>hex", [callWith("str>bytes", [S("héllo")])[0] as Value])).toBe(
      '"68c3a96c6c6f"',
    );
    expect(run("len", [S("\u{1F600}")])).toBe("1");
    expect(run("cat", [S("abc"), S("xyz")])).toBe('"abcxyz"');
    expect(run("slice", [S("hello"), I(1), I(3)])).toBe('"el"');
    expect(run("nth", [S("abc"), I(1)])).toBe('"b"');
    expect(run("rev", [S("abc")])).toBe('"cba"');
    expect(run("split", [S("a,b,c"), S(",")])).toBe('{ "a" "b" "c" }');
    expect(run("join", [L(S("a"), S("b")), S("-")])).toBe('"a-b"');
    expect(run("upper", [S("aBc")])).toBe('"ABC"');
  });
  test("C43 bytes and list words", () => {
    const cat = callWith("cat", [B(0xde, 0xad), B(0xbe, 0xef)])[0] as Value;
    expect(run("bytes>hex", [cat])).toBe('"deadbeef"');
    expect(run("nth", [B(1, 2, 3), I(1)])).toBe("2");
    expect(run("bytes>list", [B(1, 2, 3)])).toBe("{ 1 2 3 }");
    expect(run("list>bytes", [L(I(1), I(2))])).toBe("#[ 01 02 ]");
    expect(run("range", [I(0), I(3)])).toBe("{ 0 1 2 }");
    expect(run("append", [L(I(1), I(2)), I(3)])).toBe("{ 1 2 3 }");
  });
  test("C46 explicit conversions", () => {
    expect(run("str>int", [S("42")])).toBe("42");
    expect(run("cat", [S(callWithStr("int>str", [I(42)])), S("!")])).toBe('"42!"');
    expect(run("int>num", [I(3)])).toBe("3.0");
    expect(run("num>int", [N(3)])).toBe("3");
    expect(run("floor", [N(3.7)])).toBe("3");
  });
  test("C48 records", () => {
    const rec = callWith(">record", [L(L(S("a"), I(1)), L(S("b"), I(2)))])[0] as Value;
    expect(run("keys", [rec])).toBe('{ "a" "b" }');
    expect(run("get", [rec, S("a")])).toBe("1");
    const put = callWith("put", [R(), S("a"), I(5)])[0] as Value;
    expect(run("get", [put, S("a")])).toBe("5");
    expect(codeOf("get", [R(), S("z")])).toBe("E_RANGE");
  });
  test("C152 sqrt, ceil, round", () => {
    expect(run("sqrt", [I(16)])).toBe("4.0");
    expect(run("ceil", [N(2.5)])).toBe("3");
    expect(run("round", [N(2.5)])).toBe("3");
    expect(run("round", [N(-2.5)])).toBe("-3");
    expect(run("ceil", [N(-2.5)])).toBe("-2");
    expect(run("round", [N(2.4)])).toBe("2");
  });
  test("C147 translate", () => {
    const items = Array.from({ length: 256 }, (_, i) => I(255 - i));
    const table = callWith("list>bytes", [L(...items)])[0] as Value;
    expect(run("bytes>hex", [callWith("translate", [B(0, 1, 255), table])[0] as Value])).toBe(
      '"fffe00"',
    );
  });
});

describe("has-key?", () => {
  const rec = R(["a", I(1)], ["b", L()]);
  test("true for a present key, false for an absent one", () => {
    expect(run("has-key?", [rec, S("a")])).toBe("true");
    expect(run("has-key?", [rec, S("b")])).toBe("true");
    expect(run("has-key?", [rec, S("c")])).toBe("false");
    expect(run("has-key?", [R(), S("")])).toBe("false");
    expect(run("has-key?", [R(["", I(0)]), S("")])).toBe("true");
  });
  test("a non-record or a non-string key is E_TYPE", async () => {
    const rt = createRuntime();
    for (const src of ['{ } "a" has-key?', '{ { "a" 1 } } >record 1 has-key?']) {
      const r = await rt.run(src);
      expect(!r.ok && r.error.code, src).toBe("E_TYPE");
    }
  });
  test("C261 has-key?", async () => {
    const rt = createRuntime();
    const r = await rt.run(
      '{ { "a" 1 } } >record "a" has-key? . { { "a" 1 } } >record "b" has-key? .',
    );
    expect(r.ok && r.output).toBe("true\nfalse\n");
  });
});

describe("sort", () => {
  test("numbers, int and num mixed and exact, bigint included", () => {
    expect(run("sort", [L(I(3), N(1.5), I(2))])).toBe("{ 1.5 2 3 }");
    expect(run("sort", [L(I(2), N(2), I(1))])).toBe("{ 1 2 2.0 }");
    expect(run("sort", [L(big(2n ** 70n), I(5), N(-0.5), I(-5))])).toBe(
      `{ -5 -0.5 5 ${String(2n ** 70n)} }`,
    );
  });
  test("strings in code point order, bytes lexicographically", () => {
    expect(run("sort", [L(S("b"), S("a"), S("ab"), S(""))])).toBe('{ "" "a" "ab" "b" }');
    expect(run("sort", [L(S("\u{1F600}"), S("\uFF5A"))])).toBe('{ "\uFF5A" "\u{1F600}" }');
    const out = callWith("sort", [L(B(2), B(1, 5), B(1), B())])[0] as Extract<
      Value,
      { tag: "list" }
    >;
    expect(out.v.map((x) => Array.from((x as { v: Uint8Array }).v))).toEqual([
      [],
      [1],
      [1, 5],
      [2],
    ]);
  });
  test("the empty and one-element lists are always valid", () => {
    expect(run("sort", [L()])).toBe("{ }");
    expect(run("sort", [L(R())])).toBe(`{ ${repr(R())} }`);
    expect(run("sort", [L(T)])).toBe("{ true }");
  });
  test("it is stable", () => {
    const out = callWith("sort", [L(I(1), N(1), I(1))])[0] as Value;
    expect(repr(out)).toBe("{ 1 1.0 1 }");
  });
  test("a new list: the input is not changed", () => {
    const input = L(I(3), I(1), I(2));
    const out = callWith("sort", [input])[0] as Value;
    expect(out).not.toBe(input);
    expect(repr(input)).toBe("{ 3 1 2 }");
  });
  test("a mixture, or any other tag in a list of two or more, is E_TYPE", () => {
    expect(codeOf("sort", [L(I(1), S("a"))])).toBe("E_TYPE");
    expect(codeOf("sort", [L(S("a"), B(1))])).toBe("E_TYPE");
    expect(codeOf("sort", [L(B(1), I(1))])).toBe("E_TYPE");
    expect(codeOf("sort", [L(T, F)])).toBe("E_TYPE");
    expect(codeOf("sort", [L(L(), L())])).toBe("E_TYPE");
    expect(codeOf("sort", [L(R(), R())])).toBe("E_TYPE");
    expect(codeOf("sort", [L(I(1), I(2), T)])).toBe("E_TYPE");
    expect(codeOf("sort", [S("ab")])).toBe("E_TYPE");
  });
  test("C262 and C263", async () => {
    const rt = createRuntime();
    const a = await rt.run('{ 3 1.5 2 } sort . { "b" "a" "ab" } sort . { } sort .');
    expect(a.ok && a.output).toBe('{ 1.5 2 3 }\n{ "a" "ab" "b" }\n{ }\n');
    const b = await rt.run('{ 1 "a" } sort');
    expect(!b.ok && b.error.code).toBe("E_TYPE");
  });
});

describe("fail-coerce and fail-range", () => {
  test("fail-coerce raises E_COERCE with the message and detail of raise:coerce", () => {
    const e = errorOf("fail-coerce", [S("bad bytes")]);
    expect(e.code).toBe("E_COERCE");
    expect(e.message).toBe("cannot convert str to bytes: bad bytes");
    expect(e.detail).toEqual({ from: "str", to: "bytes", reason: "bad bytes" });
  });
  test("fail-range raises E_RANGE with the reason as the message and an empty detail", () => {
    const e = errorOf("fail-range", [S("bad value")]);
    expect(e.code).toBe("E_RANGE");
    expect(e.message).toBe("bad value");
    expect(e.detail).toEqual({});
  });
  test("a non-string reason is E_TYPE", async () => {
    const rt = createRuntime();
    for (const src of ["1 fail-range", "1 fail-coerce"]) {
      const r = await rt.run(src);
      expect(!r.ok && r.error.code, src).toBe("E_TYPE");
    }
  });
  test("C281 and C282", async () => {
    const rt = createRuntime();
    const a = await rt.run(
      '[ "bad" fail-range ] [ "code" get ] try . [ "bad" fail-coerce ] [ "code" get ] try .',
    );
    expect(a.ok && a.output).toBe("E_RANGE\nE_COERCE\n");
    const b = await rt.run('"bad-bytes" fail-coerce');
    expect(!b.ok && b.error.code).toBe("E_COERCE");
    expect(!b.ok && b.error.detail).toMatchObject({ reason: "bad-bytes" });
  });
});

test("every core primitive is exercised by this file or by numeric.test.ts", () => {
  const numeric = new Set(NUMERIC_PRIMITIVES.map((d) => d.name));
  const expected = [
    ...CORE_PRIMITIVES.map((d) => d.name),
    ...CORE_PRIMITIVES_V02.map((d) => d.name).filter((n) => !numeric.has(n)),
  ];
  expect([...tested].sort()).toEqual(expected.sort());
});
