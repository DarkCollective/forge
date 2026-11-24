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
 * Tests of the harness additions of LANGUAGE-0.3.md section 3: `@call`, `@meta` paths, the section
 * 17.0 fixtures, and running a case that uses them against the v0.2 runtime.
 */
import { describe, expect, it } from "vitest";
import { createRuntime } from "../../src/runtime.js";
import {
  EXT_PRIMITIVE_NAMES,
  extKinds,
  extPrimitives,
  literalTags,
  parsePair,
  registerExtFixtures,
  type AnyValue,
  type ExtKindFixture,
  type ExtRegistryApi,
  type ExtValue,
  type LiteralTagFixture,
} from "./ext-fixtures.js";
import { supportedExtPrimitives } from "./ext-support.js";
import { META_FIELDS, parseSpec, SpecParseError } from "./parse.js";
import { executeCase } from "./run.js";

function block(...lines: string[]): string {
  return ["```fl-test", ...lines, "```", ""].join("\n");
}
const rejects = (text: string, re: RegExp) => {
  expect(() => parseSpec(text)).toThrow(SpecParseError);
  expect(() => parseSpec(text)).toThrow(re);
};
const one = (text: string) => {
  const c = parseSpec(text).cases[0];
  if (c === undefined) throw new Error("no case");
  return c;
};

describe("@call", () => {
  it("parses a name on the directive line as a run with no source", () => {
    const c = one(
      block("# C1 x", "@unit", ": f ( -- int ) 1 ;", "@call user:f", "@stack", "<1> 1"),
    );
    expect(c.runs).toHaveLength(1);
    expect(c.runs[0]).toMatchObject({ call: "user:f", source: "", stack: "<1> 1" });
    expect(c.directives).toContain("call");
  });

  it("takes @stack-in as the arguments and @error as for @run", () => {
    const c = one(
      block(
        "# C1 x",
        "@unit",
        ": f ( n:int -- int ) ;",
        "@stack-in",
        "5",
        "@call user:f",
        "@error",
        "E_TYPE",
      ),
    );
    expect(c.stackIn).toEqual([{ tag: "int", v: 5 }]);
    expect(c.runs[0]?.error?.code).toBe("E_TYPE");
  });

  it("rejects a missing or unqualified name and a body", () => {
    rejects(block("# C1 x", "@call"), /@call needs one qualified name/);
    rejects(block("# C1 x", "@call f"), /@call needs one qualified name/);
    rejects(block("# C1 x", "@call user:f", "1 2"), /@call takes no body/);
  });
});

describe("@meta paths", () => {
  it("accepts the fields of section 15", () => {
    const text = block(
      "# C1 x",
      "@unit",
      ": f ( -- ) ;",
      "@meta",
      'user:f params[0].kind = "fx-pair"',
      'user:f params[0].values = ["a"]',
      "user:f generic = true",
      'user:f discovery.friends = ["app"]',
      "user:f discovery.kernel = true",
    );
    const paths = one(text).meta.map((m) => m.path);
    expect(paths).toEqual([
      ["params", 0, "kind"],
      ["params", 0, "values"],
      ["generic"],
      ["discovery", "friends"],
      ["discovery", "kernel"],
    ]);
    for (const f of ["generic", "discovery", "params", "effects"]) expect(META_FIELDS).toContain(f);
  });

  it("rejects a path that does not start at a WordMeta field", () => {
    rejects(
      block("# C1 x", "@unit", ": f ( -- ) ;", "@meta", "user:f nonsense = 1"),
      /WordMeta field/,
    );
  });
});

describe("the section 17.0 kinds and tags", () => {
  const kinds = Object.fromEntries(extKinds().map((k) => [k.kind, k])) as Record<
    string,
    ExtKindFixture
  >;
  const pair = (a: number, b: number): ExtValue => ({ tag: "ext", kind: "fx-pair", v: { a, b } });
  const int = (v: number): AnyValue => ({ tag: "int", v });
  const m = (name: string, ...args: AnyValue[]) => kinds["fx-pair"]?.methods?.[name]?.(args, {});

  it("fx-pair: equality, size and text", () => {
    const k = kinds["fx-pair"] as ExtKindFixture;
    expect(k.equals({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(k.equals({ a: 1, b: 2 }, { a: 2, b: 1 })).toBe(false);
    expect(k.sizeOf({ a: 1, b: 2 })).toBe(16);
    expect(k.toText({ a: 1, b: -2 }, 100)).toBe("1,-2");
    expect(k.fromText?.("3,-4")).toEqual({ a: 3, b: -4 });
  });

  it("fromText reports the offset of the first character that does not fit", () => {
    const offset = (t: string): unknown => {
      try {
        parsePair(t);
      } catch (e) {
        return (e as { code: string; detail: { offset: number } }).code === "E_COERCE"
          ? (e as { detail: { offset: number } }).detail.offset
          : "wrong code";
      }
      return "no error";
    };
    expect(offset("1,2x")).toBe(3);
    expect(offset("1;2")).toBe(1);
    expect(offset("")).toBe(0);
    expect(offset("1,")).toBe(2);
    expect(offset("a,2")).toBe(0);
    expect(offset("9007199254740993,1")).toBe(0);
  });

  it("fx-pair methods follow the table", () => {
    expect(m("+", pair(1, 2), pair(10, 20))).toEqual(pair(11, 22));
    expect(m("+", pair(1, 2), int(5))).toEqual(pair(6, 7));
    expect(m("+", int(5), pair(1, 2))).toEqual(pair(6, 7));
    expect(m("+", int(5), int(5))).toBeUndefined();
    expect(m("*", pair(1, 2), int(3))).toEqual(pair(3, 6));
    expect(m("*", int(3), pair(1, 2))).toEqual(pair(3, 6));
    expect(m("*", pair(1, 2), pair(1, 2))).toBeUndefined();
    expect(m("neg", pair(1, -2))).toEqual(pair(-1, 2));
    expect(m("compare", pair(1, 9), pair(2, 0))).toEqual(int(-1));
    expect(m("compare", pair(2, 1), pair(2, 0))).toEqual(int(1));
    expect(m("compare", pair(2, 1), pair(2, 1))).toEqual(int(0));
    expect(m("compare", pair(1, 1), int(1))).toBeUndefined();
    expect(m("len", pair(1, 2))).toEqual(int(2));
    expect(m("nth", pair(7, 8), int(0))).toEqual(int(7));
    expect(m("nth", pair(7, 8), int(1))).toEqual(int(8));
    expect(() => m("nth", pair(7, 8), int(2))).toThrow(/index/);
  });

  it("fx-other and fx-big", () => {
    const o = kinds["fx-other"] as ExtKindFixture;
    expect([o.equals({}, {}), o.sizeOf({}), o.toText({}, 9), o.methods, o.fromText]).toEqual([
      true,
      16,
      "o",
      undefined,
      undefined,
    ]);
    const b = kinds["fx-big"] as ExtKindFixture;
    expect([b.sizeOf(1000), b.toText(1000, 9), b.methods]).toEqual([1000, "big", undefined]);
  });

  it("the tags pair and big parse to their kinds", () => {
    const tags = Object.fromEntries(literalTags().map((t) => [t.tag, t])) as Record<
      string,
      LiteralTagFixture
    >;
    expect(tags["pair"]?.kind).toBe("fx-pair");
    expect(tags["pair"]?.parse("1,2")).toEqual({ a: 1, b: 2 });
    expect(tags["big"]?.kind).toBe("fx-big");
    expect(tags["big"]?.parse("123")).toBe(123);
    expect(() => tags["big"]?.parse("12x")).toThrow(/not a pair/);
  });

  it("registers once per process through the registry api", () => {
    const seen: string[] = [];
    const api: ExtRegistryApi = {
      registerExtKind: (k) => void seen.push(`kind ${k.kind}`),
      registerLiteralTag: (t) => void seen.push(`tag ${t.tag}`),
    };
    expect(registerExtFixtures(api)).toBe(true);
    expect(registerExtFixtures(api)).toBe(false);
    expect(seen).toEqual(["kind fx-pair", "kind fx-other", "kind fx-big", "tag pair", "tag big"]);
  });

  it("uses the ext() builder of the api when it has one", () => {
    const made: ExtValue[] = [];
    const api: ExtRegistryApi = {
      registerExtKind: () => undefined,
      registerLiteralTag: () => undefined,
      ext: (kind, v) => {
        const x: ExtValue = { tag: "ext", kind, v };
        made.push(x);
        return x;
      },
    };
    registerExtFixtures(api);
    const k = extKinds(api.ext)[0] as ExtKindFixture;
    k.methods?.["neg"]?.([pair(1, 2)], {});
    expect(made).toHaveLength(1);
  });
});

describe("the section 17.0 primitives", () => {
  it("are the seven of the table, in order", () => {
    expect(extPrimitives().map((d) => `${d.vocab}:${d.name}`)).toEqual([...EXT_PRIMITIVE_NAMES]);
  });

  it("after X1 every fixture primitive but fx:media-op (label +media, L8) is accepted", () => {
    const { accepted, rejected } = supportedExtPrimitives(createRuntime);
    expect(accepted.map((d) => d.name)).toEqual([
      "pair",
      "pair-a",
      "other",
      "big",
      "charge",
      "spin",
    ]);
    expect(rejected).toEqual(["fx:media-op"]);
  });

  it("fx:spin fails instead of looping when the context has no charge", () => {
    const spin = extPrimitives().find((d) => d.name === "spin");
    expect(() => spin?.fn({})).toThrow(/needs PrimitiveContext.charge/);
  });

  it("fx:spin loops on charge(0) and fx:charge charges once, given a context that has it", () => {
    const defs = extPrimitives();
    const charged: number[] = [];
    defs.find((d) => d.name === "charge")?.fn(7, { charge: (n: number) => charged.push(n) });
    expect(charged).toEqual([7]);
    let calls = 0;
    expect(() =>
      defs
        .find((d) => d.name === "spin")
        ?.fn({
          charge: () => {
            if (++calls === 5) throw new Error("stop");
          },
        }),
    ).toThrow("stop");
    expect(calls).toBe(5);
  });

  it("fx:pair, fx:pair-a, fx:other, fx:big and fx:media-op behave as specified", () => {
    const d = (n: string) => extPrimitives().find((x) => x.name === n);
    // A primitive with an ext{kind} slot takes and returns the bare payload (LANGUAGE-0.3.md 4.8).
    expect(d("pair")?.fn(1n, 2n, {})).toEqual({ a: 1, b: 2 });
    expect(d("pair-a")?.fn({ a: 4, b: 5 }, {})).toBe(4);
    expect(d("other")?.fn({})).toEqual({});
    expect(d("big")?.fn(9, {})).toBe(9);
    expect(d("media-op")?.fn({})).toBe(1);
    expect(d("media-op")?.effects).toEqual(["+media"]);
  });
});

describe("a case that uses fixtures and @call runs against the v0.2 runtime", () => {
  const run = async (text: string) => {
    const spec = parseSpec(text);
    const tc = spec.cases[0];
    if (tc === undefined) throw new Error("no case");
    await executeCase(
      createRuntime,
      spec.units,
      tc,
      supportedExtPrimitives(createRuntime).accepted,
    );
  };

  it("an @call with @stack-in as its arguments", async () => {
    await run(
      block(
        "# C9001 call with a fixture",
        "@unit",
        ": f ( n:int -- int ) n 2 * ;",
        "@stack-in",
        "21",
        "@call user:f",
        "@stack",
        "<1> 42",
      ),
    );
  });

  it("a fixture primitive from section 17.0 fails cleanly without charge (E_PRIMITIVE)", async () => {
    await run(block("# C9002 spin", "@run", "fx:spin", "@error", "E_PRIMITIVE"));
  });

  it("the v0.2 fixture fx:add-async still works in the same run", async () => {
    await run(block("# C9003 add", "@run", "2 3 fx:add-async .", "@out", "5"));
  });

  it("@call that fails reports the error", async () => {
    await run(
      block(
        "# C9004 underflow",
        "@unit",
        ": h ( s:str n:int -- str ) s ;",
        "@stack-in",
        '"a"',
        "@call user:h",
        "@error",
        "E_STACK_UNDERFLOW",
      ),
    );
  });

  it("a wrong expectation fails the case", async () => {
    await expect(
      run(block("# C9005 wrong", "@unit", ": f ( -- int ) 1 ;", "@call user:f", "@stack", "<1> 2")),
    ).rejects.toThrow();
  });
});
