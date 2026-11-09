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
import { clip, codePointLength, dataProp, echo, hasLoneSurrogate, prewalk } from "./limits.js";
import { childPointer, escapePointer, unescapePointer } from "./pointer.js";
import { RECIPE_LIMITS } from "./types.js";

describe("strings", () => {
  test("hasLoneSurrogate", () => {
    expect(hasLoneSurrogate("")).toBe(false);
    expect(hasLoneSurrogate("a😀b")).toBe(false);
    for (const bad of ["\ud800", "\udc00", "a\ud800", "\ud800a", "\udc00\ud800", "\ud800\ud800"]) {
      expect(hasLoneSurrogate(bad)).toBe(true);
    }
  });

  test("codePointLength counts a pair once and a lone surrogate as one", () => {
    expect(codePointLength("abc")).toBe(3);
    expect(codePointLength("😀😀")).toBe(2);
    expect(codePointLength("\ud800")).toBe(1);
    expect(codePointLength("\ud800a")).toBe(2);
    expect(codePointLength("")).toBe(0);
  });

  test("clip never splits a pair", () => {
    expect(clip("abc", 5)).toBe("abc");
    expect(clip("abcdef", 3)).toBe("abc");
    expect(clip("😀😀😀", 2)).toBe("😀😀");
    expect(clip("x".repeat(100))).toHaveLength(80);
  });

  test("echo is JSON-safe and short", () => {
    expect(echo("x".repeat(100))).toBe("x".repeat(80));
    expect(echo(5)).toBe(5);
    expect(echo(NaN)).toBe("NaN");
    expect(echo(true)).toBe(true);
    expect(echo(null)).toBe(null);
    expect(echo([1])).toBe("array");
    expect(echo({})).toBe("object");
    expect(echo(undefined)).toBe("undefined");
    expect(echo(() => 1)).toBe("function");
  });
});

describe("dataProp", () => {
  test("reads data properties only", () => {
    let called = false;
    const o = { a: 1 };
    Object.defineProperty(o, "g", {
      get() {
        called = true;
        return 2;
      },
    });
    expect(dataProp(o, "a")).toBe(1);
    expect(dataProp(o, "g")).toBeUndefined();
    expect(dataProp(o, "missing")).toBeUndefined();
    expect(dataProp([5], 0)).toBe(5);
    expect(called).toBe(false);
  });
});

describe("prewalk", () => {
  test("small values pass, scalars too", () => {
    for (const v of [1, "x", null, true, undefined, [], {}, { a: [1, { b: "c" }] }])
      expect(prewalk(v)).toBeNull();
  });

  test("the byte count is that of JSON.stringify for JSON values", () => {
    const docs = [
      {},
      [],
      [1, 2, 3],
      { a: 1, b: [true, false, null], c: { d: "x\ny" } },
      ["é", "😀", "ࠀ", "\ud800", '"\\', "\u0001\b\f\r\t"],
      { ké: -1.5e-7, "": [[], [[]], {}] },
    ];
    for (const doc of docs) {
      const size = new TextEncoder().encode(JSON.stringify(doc)).length;
      expect(size).toBeGreaterThan(0);
      // a string that fills the budget exactly passes, one byte more does not
      const base = new TextEncoder().encode(JSON.stringify({ doc, pad: "" })).length;
      const exact = RECIPE_LIMITS.maxJsonBytes - base;
      expect(prewalk({ doc, pad: "x".repeat(exact) })).toBeNull();
      expect(prewalk({ doc, pad: "x".repeat(exact + 1) })).toMatchObject({ limit: "maxJsonBytes" });
    }
  });

  test("non-JSON values cost what JSON.stringify spends on a null", () => {
    expect(prewalk([undefined, () => 1, Symbol("s"), 10n, Infinity])).toBeNull();
  });

  test("depth: 64 levels pass, 65 do not", () => {
    const nest = (n: number): unknown => {
      let v: unknown = [];
      for (let i = 1; i < n; i++) v = [v];
      return v;
    };
    expect(prewalk(nest(64))).toBeNull();
    expect(prewalk(nest(65))).toEqual({ limit: "maxJsonDepth", max: 64 });
    let objects: unknown = {};
    for (let i = 0; i < 200_000; i++) objects = { a: objects };
    expect(prewalk(objects)).toEqual({ limit: "maxJsonDepth", max: 64 });
  });

  test("cycles", () => {
    const a: unknown[] = [];
    a.push(a);
    expect(prewalk(a)).toEqual({ limit: "cycle" });
    const o: Record<string, unknown> = {};
    o.x = { y: o };
    expect(prewalk(o)).toEqual({ limit: "cycle" });
  });

  test("a shared child is not a cycle", () => {
    const shared = { a: 1 };
    expect(prewalk([shared, shared, { s: shared }])).toBeNull();
  });
});

describe("JSON pointer (RFC 6901)", () => {
  test("escape and unescape", () => {
    expect(escapePointer("a/b~c")).toBe("a~1b~0c");
    expect(unescapePointer("a~1b~0c")).toBe("a/b~c");
    expect(unescapePointer("~01")).toBe("~1"); // ~1 is decoded before ~0, so ~01 is ~ then 1
    expect(escapePointer("~1")).toBe("~01");
    for (const t of ["", "plain", "a/b", "~", "/", "~/~", "~0~1"])
      expect(unescapePointer(escapePointer(t))).toBe(t);
  });

  test("childPointer", () => {
    expect(childPointer("", "steps")).toBe("/steps");
    expect(childPointer("/steps", 3)).toBe("/steps/3");
    expect(childPointer("/steps/0", "a/b")).toBe("/steps/0/a~1b");
  });
});
