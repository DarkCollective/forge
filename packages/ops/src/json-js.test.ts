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

/* Tests for the FL value to JavaScript value converters of src/json-js.ts. */
import { DEFAULT_LIMITS, ForgeError, valueHelpers } from "@forge/lang";
import type { PrimitiveContext, Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { MAX_DEPTH, fromJs, hasLoneSurrogate, isNullValue, nullValue, toJs } from "./json-js.js";

const { int, num, str, bool, list, record } = valueHelpers;
const ctx = (over: Partial<typeof DEFAULT_LIMITS> = {}): PrimitiveContext => ({
  limits: { ...DEFAULT_LIMITS, ...over },
  signal: undefined,
  scope: undefined as never,
});
const code = (f: () => unknown): string => {
  try {
    f();
    return "ok";
  } catch (e) {
    return e instanceof ForgeError ? e.code : "other";
  }
};

describe("toJs", () => {
  test("scalars, containers and null", () => {
    const v = record([
      ["a", int(1)],
      ["b", list([num(1.5), str("x"), bool(true), nullValue()])],
      ["c", int(123456789012345678901234567890n)],
    ]);
    const js = toJs(v, true) as Record<string, unknown>;
    expect(js.a).toBe(1);
    expect(js.b).toEqual([1.5, "x", true, null]);
    expect(js.c).toBe(123456789012345678901234567890n);
    expect((toJs(v, false) as Record<string, unknown>).c).toBe(1.2345678901234568e29);
  });

  test("a record has no prototype, so any key is an ordinary key", () => {
    const js = toJs(
      record([
        ["__proto__", int(1)],
        ["constructor", int(2)],
      ]),
      true,
    ) as Record<string, unknown>;
    expect(Object.getPrototypeOf(js)).toBeNull();
    expect(js.__proto__).toBe(1);
    expect(js.constructor).toBe(2);
    expect(Object.keys(js)).toEqual(["__proto__", "constructor"]);
  });

  test("bytes have no JSON form; depth past 512 is E_LIMIT_VALUE", () => {
    expect(code(() => toJs({ tag: "bytes", v: new Uint8Array(1) } as Value, true))).toBe("E_TYPE");
    let v: Value = list([]);
    for (let i = 0; i < MAX_DEPTH; i++) v = list([v]);
    expect(code(() => toJs(v, true))).toBe("E_LIMIT_VALUE");
    let ok: Value = list([]);
    for (let i = 0; i < MAX_DEPTH - 1; i++) ok = list([ok]);
    expect(code(() => toJs(ok, true))).toBe("ok");
  });
});

describe("fromJs", () => {
  test("numbers: safe integers are ints, others are nums, bigints are ints", () => {
    const v = fromJs([1, -7, 1.5, 2 ** 60, 10n ** 25n], ctx());
    expect(v.tag).toBe("list");
    const tags = (v.v as Value[]).map((x) => x.tag);
    expect(tags).toEqual(["int", "int", "num", "num", "int"]);
  });

  test("null, undefined in arrays and in objects, functions", () => {
    const v = fromJs({ a: null, b: undefined, c: [undefined, null], d: () => 1 }, ctx());
    const m = v.v as Map<string, Value>;
    expect([...m.keys()]).toEqual(["a", "c"]);
    expect(isNullValue(m.get("a") as Value)).toBe(true);
    expect((m.get("c")?.v as Value[]).every((x) => isNullValue(x))).toBe(true);
  });

  test("NaN, infinities, lone surrogates and JSONata functions are E_COERCE", () => {
    expect(code(() => fromJs(Number.NaN, ctx()))).toBe("E_COERCE");
    expect(code(() => fromJs(Number.POSITIVE_INFINITY, ctx()))).toBe("E_COERCE");
    expect(code(() => fromJs("a\ud800b", ctx()))).toBe("E_COERCE");
    expect(code(() => fromJs({ "\udc00": 1 }, ctx()))).toBe("E_COERCE");
    expect(code(() => fromJs({ _jsonata_lambda: true }, ctx()))).toBe("E_COERCE");
    expect(code(() => fromJs("😀", ctx()))).toBe("ok");
  });

  test("the size of what is built is held to the value limit", () => {
    const big = Array.from({ length: 10_000 }, () => "xxxxxxxxxxxxxxxx");
    expect(code(() => fromJs(big, ctx({ maxValueBytes: 10_000 })))).toBe("E_LIMIT_VALUE");
    expect(code(() => fromJs(big, ctx()))).toBe("ok");
  });

  test("a cyclic object is cut by the depth limit", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(code(() => fromJs(a, ctx()))).toBe("E_LIMIT_VALUE");
  });

  test("lone surrogate test", () => {
    expect(hasLoneSurrogate("ok 😀")).toBe(false);
    expect(hasLoneSurrogate("\ud83d")).toBe(true);
    expect(hasLoneSurrogate("\ude00")).toBe(true);
  });
});
