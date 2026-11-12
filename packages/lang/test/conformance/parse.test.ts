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
import { describe, expect, it } from "vitest";
import { createFixtures } from "./fixtures.js";
import {
  expandEscapes,
  hasExpectation,
  KNOWN_DIRECTIVES,
  parseSpec,
  parseSpecs,
  loadSpec,
  parseStackIn,
  readSpec,
  scanDirectiveNames,
  SpecParseError,
} from "./parse.js";

const markdown = readSpec();
const spec = parseSpec(markdown);

/** Wraps a body in an fl-test fence for the negative tests. */
function block(...lines: string[]): string {
  return ["```fl-test", ...lines, "```", ""].join("\n");
}

describe("spec extraction", () => {
  it("finds exactly 171 cases, C01 to C171, without gaps or duplicates", () => {
    expect(spec.cases).toHaveLength(171);
    expect(spec.cases.map((c) => c.id)).toEqual(Array.from({ length: 171 }, (_, i) => i + 1));
    expect(new Set(spec.cases.map((c) => c.name)).size).toBe(171);
    expect(spec.cases.map((c) => c.label)).toEqual(
      Array.from({ length: 171 }, (_, i) => `C${String(i + 1).padStart(2, "0")}`),
    );
  });

  it("finds the U-rot unit", () => {
    const rot = spec.units.get("U-rot");
    expect(rot).toBeDefined();
    expect(rot).toContain("IN: classical");
    expect(rot).toContain(": rot ( bytes amount:int[0..25]=13 -- bytes )");
    expect(rot).toContain("alias rot13 ;");
    expect([...spec.units.keys()]).toEqual(["U-rot"]);
  });

  it("gives every case something to run or load, and an expectation", () => {
    for (const c of spec.cases) {
      // C93 and C170 only load U-rot (@use) and assert metadata or hashes.
      expect(c.runs.length + c.units.length + c.uses.length, c.name).toBeGreaterThan(0);
      expect(hasExpectation(c), `${c.name} has no expectation`).toBe(true);
    }
    const noRunNoUnit = spec.cases.filter((c) => c.runs.length === 0 && c.units.length === 0);
    expect(noRunNoUnit.map((c) => c.label)).toEqual(["C93", "C170"]);
    for (const c of noRunNoUnit) expect(c.uses).toEqual(["U-rot"]);
  });

  it("uses only known directives", () => {
    const known = new Set<string>(KNOWN_DIRECTIVES);
    const used = scanDirectiveNames(markdown);
    expect([...used].filter((d) => !known.has(d))).toEqual([]);
    for (const c of spec.cases) {
      for (const d of c.directives) expect(known.has(d), `${c.name}: @${d}`).toBe(true);
    }
  });

  it("matches the directive census of the spec", () => {
    const count = new Map<string, number>();
    for (const c of spec.cases) {
      for (const d of c.directives) count.set(d, (count.get(d) ?? 0) + 1);
    }
    // Number of tests that use each directive at least once.
    expect(count.get("run")).toBe(spec.cases.filter((c) => c.runs.length > 0).length);
    expect(count.get("use")).toBe(12);
    expect(count.get("unit-fails")).toBe(1);
    expect(count.get("hash-eq")).toBe(1);
    expect(count.get("hash-ne")).toBe(1);
    expect(count.get("meta")).toBe(3);
    expect(count.get("coercions")).toBe(1);
    expect(count.get("abort")).toBe(1);
  });

  it("recognises the timing tests", () => {
    expect(spec.cases.filter((c) => c.timing).map((c) => c.label)).toEqual(["C106", "C107"]);
  });
});

describe("two documents form one suite", () => {
  const caseText = (id: string, fence = "fl-test"): string =>
    ["```" + fence, `# ${id} a case`, "@run", "1", "@stack", "1", "```", ""].join("\n");

  it("merges the cases of both documents in order", () => {
    const merged = parseSpecs([
      { file: "A.md", text: caseText("C1") },
      { file: "B.md", text: caseText("C201") },
    ]);
    expect(merged.cases.map((c) => c.label)).toEqual(["C1", "C201"]);
  });

  it("fails clearly on a case id defined in both documents", () => {
    const docs = [
      { file: "A.md", text: caseText("C7") },
      { file: "B.md", text: caseText("C7") },
    ];
    expect(() => parseSpecs(docs)).toThrow(SpecParseError);
    expect(() => parseSpecs(docs)).toThrow(/duplicate case id C7.*A\.md.*B\.md/);
  });

  it("does not run a block fenced fl-proposed, and picks up fl-test", () => {
    expect(parseSpec(caseText("C201", "fl-proposed")).cases).toHaveLength(0);
    expect(parseSpec(caseText("C201", "fl-test")).cases).toHaveLength(1);
    const merged = parseSpecs([
      { file: "A.md", text: caseText("C1") },
      { file: "B.md", text: caseText("C201", "fl-proposed") + caseText("C202") },
    ]);
    expect(merged.cases.map((c) => c.label)).toEqual(["C1", "C202"]);
  });

  it("names the document in a parse error", () => {
    expect(() => parseSpec("```fl-test\nnot a title\n```\n", "B.md")).toThrow(/^B\.md:/);
  });

  it("loads the real documents with unique ids", () => {
    const ids = loadSpec().cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, 171)).toEqual(Array.from({ length: 171 }, (_, i) => i + 1));
  });
});

describe("directive interpretation", () => {
  const byLabel = (label: string) => {
    const c = spec.cases.find((x) => x.label === label);
    if (c === undefined) throw new Error(`no ${label}`);
    return c;
  };

  it("joins @out lines and adds the final newline", () => {
    expect(byLabel("C01").runs[0]?.out).toBe("3\n");
    expect(byLabel("C04").runs[0]?.out).toBe("9007199254740993\n18014398509481982\n");
  });

  it("keeps @out with an error as the output before the error", () => {
    const run = byLabel("C48").runs[0];
    expect(run?.out).toBe('{ "a" "b" }\n1\n5\n');
    expect(run?.error?.code).toBe("E_RANGE");
  });

  it("parses @error assertions", () => {
    expect(byLabel("C09").runs[0]?.error).toMatchObject({ code: "E_LEX", line: 2, col: 3 });
    expect(byLabel("C52").runs[0]?.error).toMatchObject({ code: "E_EFFECT", word: "user:bad" });
    expect(byLabel("C70").runs[0]?.error?.detail).toEqual({
      name: "greet",
      candidates: ["alpha:greet", "beta:greet"],
    });
    expect(byLabel("C166").runs[1]?.error?.detail).toEqual({ param: "k", value: "<redacted>" });
  });

  it("attaches an @error without @run to the last unit", () => {
    const c = byLabel("C61");
    expect(c.runs).toHaveLength(0);
    expect(c.units).toHaveLength(2);
    expect(c.units[0]?.error).toBeUndefined();
    expect(c.units[1]?.error?.code).toBe("E_PRIVATE");
  });

  it("handles @unit-fails, @trusted and @warnings", () => {
    expect(byLabel("C85").units[0]?.failsWith).toBe("E_UNDEFINED");
    expect(byLabel("C128").units[0]?.trusted).toBe(true);
    expect(byLabel("C127").units[0]).toMatchObject({
      trusted: true,
      error: { code: "E_NO_PRIMITIVE" },
    });
    expect(byLabel("C77").units.map((u) => u.warnings)).toEqual([undefined, ["W_REDEFINED"]]);
  });

  it("splits @meta at the first ' = '", () => {
    const m = byLabel("C93").meta;
    expect(m).toHaveLength(11);
    expect(m[0]).toMatchObject({
      qname: "classical:rot",
      path: ["effect", "text"],
      expected: "( bytes amount:int[0..25]=13 -- bytes )",
    });
    expect(m[1]?.path).toEqual(["params", 0, "name"]);
    expect(m[10]).toMatchObject({ pathText: "effects", expected: [] });
  });

  it("reads @limits, @abort, @deny, @break, @hook, @hits, @vars, @stack-in", () => {
    expect(byLabel("C106").limits).toEqual({ maxMillis: 50, maxSteps: 1000000000000 });
    expect(byLabel("C107").abortMs).toBe(20);
    expect(byLabel("C110").deny).toEqual(["+time"]);
    expect(byLabel("C132")).toMatchObject({
      breakpoints: [{ word: "user:f" }],
      hook: "record",
      hits: ["user:f 0 lit"],
    });
    expect(byLabel("C133").hook).toBe("stop");
    expect(byLabel("C130").sharedVars).toBe(true);
    expect(byLabel("C131").stackIn).toEqual([
      { tag: "int", v: 7 },
      { tag: "str", v: "x" },
    ]);
    expect(byLabel("C169").hashNe).toEqual([["v1:top", "v2:top"]]);
    expect(byLabel("C170").hashEq).toEqual([["classical:rot", "classical:rot13"]]);
    expect(byLabel("C67").runs[0]?.coercions).toEqual([
      { word: "classical:rot", slot: 0, from: "str", to: "bytes" },
    ]);
  });

  it("expands <<U+XXXX>> in sources", () => {
    expect(byLabel("C115").runs[0]?.source).toBe("ab​c");
    expect(expandEscapes("a<<U+1F600>>b")).toBe("a\u{1F600}b");
    expect(() => expandEscapes("<<U+110000>>")).toThrow(RangeError);
  });

  it("parses @stack-in literals", () => {
    expect(parseStackIn("1 -0x10 2.5 \"a b\\n\" 'a' #[ 0a ff ] true")).toEqual([
      { tag: "int", v: 1 },
      { tag: "int", v: -16 },
      { tag: "num", v: 2.5 },
      { tag: "str", v: "a b\n" },
      { tag: "int", v: 97 },
      { tag: "bytes", v: Uint8Array.from([10, 255]) },
      { tag: "bool", v: true },
    ]);
    expect(parseStackIn("9007199254740993")).toEqual([{ tag: "int", v: 9007199254740993n }]);
    expect(() => parseStackIn("nope")).toThrow();
  });
});

describe("malformed blocks are rejected precisely", () => {
  const rejects = (text: string, re: RegExp) => {
    expect(() => parseSpec(text)).toThrow(SpecParseError);
    expect(() => parseSpec(text)).toThrow(re);
  };

  it("reports the spec line and the test", () => {
    const text = "intro\n\n" + block("# C07 x", "@run", "1", "@bogus", "x");
    rejects(text, /LANGUAGE\.md:7 \(C07\): unknown directive @bogus/);
  });

  it("rejects a bad title", () => {
    rejects(block("C01 no hash", "@run", "1"), /first line must be "# C<number> <title>"/);
  });

  it("rejects an unterminated fence", () => {
    rejects("```fl-test\n# C01 x\n@run\n1\n", /unterminated code fence/);
  });

  it("rejects @out before any @run and @trusted without a unit", () => {
    rejects(block("# C01 x", "@out", "1", "@run", "1"), /@out before any @run/);
    rejects(block("# C01 x", "@run", "1", "@trusted"), /@trusted has no preceding @unit/);
  });

  it("rejects an @error without a unit or run", () => {
    rejects(block("# C01 x", "@use U-nope", "@error", "E_X"), /unknown unit "U-nope"/);
    rejects(block("# C01 x", "@run", "1", "@error", "E_NOPE"), /unknown error code "E_NOPE"/);
  });

  it("rejects bad @limits, @abort, @meta, @hits and a missing run", () => {
    rejects(block("# C01 x", "@limits", "maxFoo=1", "@run", "1"), /unknown limit "maxFoo"/);
    rejects(block("# C01 x", "@abort", "20s", "@run", "1"), /@abort needs/);
    rejects(
      block("# C01 x", "@unit", ": f ( -- ) ;", "@meta", "user:f doc = nope"),
      /not valid JSON/,
    );
    rejects(block("# C01 x", "@run", "1", "@hits", "user:f 0 lit"), /@hits requires @hook record/);
    rejects(block("# C01 x", "@out", "1"), /@out before any @run|no @run, @unit or @use/);
  });

  it("rejects text before the first directive and duplicates", () => {
    rejects(block("# C01 x", "stray", "@run", "1"), /text before the first directive/);
    rejects(block("# C01 x", "@run", "1", "@out", "1", "@out", "2"), /@out appears more than once/);
  });
});

describe("fixtures", () => {
  it("defines the section 16 primitives", () => {
    const f = createFixtures();
    expect(f.bound.map((d) => `${d.vocab}:${d.name}`)).toEqual([
      "fx:add-async",
      "fx:sleep",
      "fx:now",
      "fx:throw",
      "fx:bad-result",
      "fx:bad-int",
      "fx:small-big",
      "fx:reject",
    ]);
    expect(f.unbound.map((d) => `${d.vocab}:${d.name}`)).toEqual(["fz:twice"]);
    const labels = Object.fromEntries(f.bound.map((d) => [d.name, d.effects ?? []]));
    expect(labels).toMatchObject({
      "add-async": ["+async"],
      sleep: ["+async"],
      now: ["+time"],
      reject: ["+async"],
      throw: [],
    });
  });

  it("behaves as specified", async () => {
    const f = createFixtures();
    const get = (n: string) => {
      const d = [...f.bound, ...f.unbound].find((x) => x.name === n);
      if (d === undefined) throw new Error(n);
      return d;
    };
    const ctx = {};
    const pending = get("add-async").fn(2, 3, ctx);
    expect(pending).toBeInstanceOf(Promise);
    await expect(pending).resolves.toBe(5);
    expect(typeof get("now").fn(ctx)).toBe("number");
    expect(() => get("throw").fn(ctx)).toThrow("kaput");
    expect(get("bad-result").fn(ctx)).toBe("x");
    expect(get("bad-int").fn(ctx)).toBe(1.5);
    expect(get("small-big").fn(ctx)).toBe(5n);
    await expect(get("reject").fn(ctx)).rejects.toThrow("nope");
    await expect(get("sleep").fn(1, ctx)).resolves.toBeUndefined();
    expect(get("twice").fn(21, ctx)).toBe(42);
    expect(f.violations).toEqual([]);
  });
});
