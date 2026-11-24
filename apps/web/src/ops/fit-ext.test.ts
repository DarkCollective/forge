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
// Kind-aware fit (UI-TOOLKIT.md section 2): every row of the table in section 2.2, "Data here" for each source
// of the answer, and the pure parts of the card badges.
import type { CatalogueOp } from "@forge/ops";
import type { ParamType } from "@forge/lang";
import type { Recipe } from "@forge/recipe";
import type { OutputValue } from "@forge/worker";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerViewer, resetViewers } from "../io/viewers.js";
import type { ExtOutput, Viewer } from "../io/viewers.js";
import {
  convertHint,
  dataAboveStatic,
  dataFactsAtEnd,
  dataLabel,
  dataLine,
  extKindOf,
  fitLevel,
  inputMark,
  needOf,
  opOutputType,
  outputBadge,
  sameFacts,
  whyNotFit,
} from "./fit.js";
import type { DataType, KindConversion } from "./fit.js";

function op(
  qname: string,
  input: ParamType,
  output: ParamType,
  kinds: { inputKind?: string; outputKind?: string } = {},
): CatalogueOp {
  return {
    qname,
    name: qname.slice(qname.indexOf(":") + 1),
    vocab: qname.slice(0, qname.indexOf(":")),
    category: null,
    doc: null,
    aliases: [],
    seeAlso: [],
    input,
    output,
    effect: "",
    params: [],
    effects: [],
    version: "1",
    hash: "h",
    needsHardKill: false,
    ...kinds,
  } as CatalogueOp;
}

const render: Viewer["render"] = () => {
  throw new Error("not drawn in a unit test");
};

const TABLE: ExtType = "ext{table}";
type ExtType = `ext{${string}}`;
const RELATION: ExtType = "ext{relation}";

const conversions: readonly KindConversion[] = [
  { from: "table", to: "relation", lift: true },
  { from: "relation", to: "table", lift: false, hint: "runs the query first" },
];

beforeEach(() => {
  registerViewer({
    kind: "table",
    noun: "table",
    render,
    summary: (o: ExtOutput) => (o.view === undefined ? null : "2 columns, 3 rows"),
    repairs: [{ from: "bytes", op: "csv:parse", label: "Parse CSV" }],
  });
  registerViewer({
    kind: "relation",
    noun: "relation",
    render,
    summary: () => "lazy",
  });
});
afterEach(() => resetViewers());

const extOut = (extKind: string, view?: unknown): OutputValue => ({
  kind: "ext",
  extKind,
  text: "t",
  truncated: false,
  ...(view === undefined ? {} : { view }),
});

describe("the data types", () => {
  it("extKindOf reads the kind of an ext type", () => {
    expect(extKindOf(TABLE)).toBe("table");
    expect(extKindOf("ext")).toBeUndefined();
    expect(extKindOf("bytes")).toBeUndefined();
    expect(extKindOf("unknown")).toBeUndefined();
  });

  it("needOf reads inputKind when the catalogue carries it", () => {
    expect(needOf(op("t:a", "ext", "bytes", { inputKind: "table" }))).toEqual({
      type: "ext",
      kind: "table",
    });
    expect(needOf(op("t:b", "str", "str"))).toEqual({ type: "str" });
  });

  it("opOutputType gives ext{kind} for an ext output with a known kind, else unknown", () => {
    expect(opOutputType(op("t:a", "bytes", "ext", { outputKind: "table" }))).toBe(TABLE);
    expect(opOutputType(op("t:a", "bytes", "ext"))).toBe("unknown");
    expect(opOutputType(op("t:a", "bytes", "any"))).toBe("unknown");
    expect(opOutputType(op("t:a", "bytes", "str"))).toBe("str");
  });
});

describe("fitLevel, the rows of UI-TOOLKIT.md section 2.2", () => {
  const fit = (need: ParamType | { type: ParamType; kind?: string }, data: DataType): string =>
    fitLevel(need, data, "unknown", conversions);

  it("any takes every ext", () => {
    expect(fit("any", TABLE)).toBe("fits");
    expect(fit("any", "ext")).toBe("fits");
  });

  it("ext{k} takes ext{k}", () => {
    expect(fit({ type: "ext", kind: "table" }, TABLE)).toBe("fits");
  });

  it("ext{k} takes ext{j} only through a declared conversion: a lift is green, a run amber", () => {
    expect(fit({ type: "ext", kind: "relation" }, TABLE)).toBe("fits");
    expect(fit({ type: "ext", kind: "table" }, RELATION)).toBe("converts");
    expect(fit({ type: "ext", kind: "table" }, "ext{relix-expr}")).toBe("no");
    expect(fitLevel({ type: "ext", kind: "table" }, RELATION)).toBe("no"); // no conversion given
  });

  it("ext{k} refuses every tag", () => {
    for (const tag of ["bytes", "str", "int", "num", "bool", "list", "record", "file"] as const) {
      expect(fit({ type: "ext", kind: "table" }, tag), tag).toBe("no");
    }
  });

  it("a typed input refuses ext{k}", () => {
    for (const type of [
      "bytes",
      "str",
      "int",
      "num",
      "number",
      "bool",
      "list",
      "record",
    ] as const) {
      expect(fit(type, TABLE), type).toBe("no");
      expect(fit(type, "ext"), type).toBe("no");
    }
    expect(fit("choice", TABLE)).toBe("no");
    expect(fit("key", TABLE)).toBe("no");
  });

  it("unknown data rules nothing out; an ext input of no known kind takes any ext", () => {
    expect(fit({ type: "ext", kind: "table" }, "unknown")).toBe("fits");
    expect(fit("ext", TABLE)).toBe("fits");
    expect(fit("ext", "ext")).toBe("fits");
    expect(fit("ext", "bytes")).toBe("no");
    expect(fit({ type: "ext", kind: "table" }, "ext")).toBe("fits");
  });

  it("the rows of v0.2 are unchanged", () => {
    expect(fitLevel("str", "bytes")).toBe("converts");
    expect(fitLevel("str", "bytes", "valid")).toBe("fits");
    expect(fitLevel("str", "bytes", "invalid")).toBe("no");
    expect(fitLevel("bytes", "str")).toBe("converts");
    expect(fitLevel("num", "int")).toBe("converts");
    expect(fitLevel("number", "int")).toBe("fits");
    expect(fitLevel("list", "bytes")).toBe("no");
    expect(fitLevel("any", "bytes")).toBe("fits");
  });
});

describe("the hint texts", () => {
  it("red rows say what is needed and what it is", () => {
    const need = { type: "ext", kind: "table" } as const;
    expect(whyNotFit(need, RELATION)).toBe("needs a table; this is a relation");
    expect(whyNotFit(need, "ext{relix-expr}")).toBe(
      "needs a table; this is a relix-expr extension value",
    );
    expect(whyNotFit("str", TABLE)).toBe("needs text; this is a table");
    expect(whyNotFit("list", TABLE)).toBe("needs a list; this is a table");
    expect(whyNotFit("str", "ext")).toBe("needs text; this is an extension value");
    expect(whyNotFit({ type: "ext" }, "bytes")).toBe("needs an extension value");
  });

  it("a kind that registers a repair adds it", () => {
    expect(whyNotFit({ type: "ext", kind: "table" }, "bytes")).toBe(
      "needs a table. Add Parse CSV first.",
    );
    expect(whyNotFit({ type: "ext", kind: "table" }, "str")).toBe("needs a table");
    expect(whyNotFit({ type: "ext", kind: "relation" }, "bytes")).toBe("needs a relation");
  });

  it("a row that is not red has no reason; an amber row has a hint", () => {
    expect(whyNotFit({ type: "ext", kind: "table" }, TABLE, "unknown", conversions)).toBe("");
    expect(convertHint({ type: "ext", kind: "table" }, RELATION, "unknown", conversions)).toBe(
      "runs the query first",
    );
    expect(
      convertHint({ type: "ext", kind: "table" }, RELATION, "unknown", [
        { from: "relation", to: "table", lift: false },
      ]),
    ).toBe("converts to a table");
    expect(convertHint({ type: "ext", kind: "table" }, TABLE, "unknown", conversions)).toBe("");
    expect(convertHint("str", "bytes")).toBe("text only if valid UTF-8");
    expect(convertHint("bytes", "str")).toBe("converts to bytes");
  });
});

describe("Data here", () => {
  const recipe: Recipe = { forge: 1, name: "", steps: [] } as unknown as Recipe;
  const result = (output: OutputValue) => ({
    recipe,
    bake: {
      result: {
        id: 1,
        ok: true as const,
        output,
        steps: [],
        coercions: [],
        coercionsTruncated: false,
        warnings: [],
        stats: { elapsedMs: 0, vmSteps: 0, effects: [] },
      },
      stale: false,
    },
    ops: null,
  });

  it("a finished bake of a table with a view: the noun and the shape", () => {
    const facts = dataFactsAtEnd(result(extOut("table", { rows: 3 })));
    expect(facts).toEqual({ type: TABLE, utf8: "unknown", shape: "2 columns, 3 rows" });
    expect(dataLine(facts)).toBe("table (2 columns, 3 rows)");
  });

  it("the same with no view: the noun alone", () => {
    const facts = dataFactsAtEnd(result(extOut("table")));
    expect(facts).toEqual({ type: TABLE, utf8: "unknown" });
    expect(dataLine(facts)).toBe("table");
  });

  it("a relation is lazy", () => {
    expect(dataLine(dataFactsAtEnd(result(extOut("relation", {}))))).toBe("relation (lazy)");
  });

  it("an unregistered kind", () => {
    const facts = dataFactsAtEnd(result(extOut("rat")));
    expect(facts.type).toBe("ext{rat}");
    expect(dataLine(facts)).toBe("rat extension value");
  });

  it("without a bake, the last step's declared output kind", () => {
    const steps = [{ kind: "op", op: "t:parse" }] as unknown as Recipe["steps"];
    const facts = dataFactsAtEnd({
      recipe: { ...recipe, steps } as Recipe,
      bake: { result: null, stale: false },
      ops: [op("t:parse", "bytes", "ext", { outputKind: "table" })],
    });
    expect(facts).toEqual({ type: TABLE, utf8: "unknown" });
    expect(dataLine(facts)).toBe("table");
    const unknownKind = dataFactsAtEnd({
      recipe: { ...recipe, steps } as Recipe,
      bake: { result: null, stale: false },
      ops: [op("t:parse", "bytes", "ext")],
    });
    expect(unknownKind.type).toBe("unknown");
  });

  it("an ext nested too deep to render has no kind, and the labels", () => {
    expect(dataLabel("ext")).toBe("extension value");
    expect(dataLabel(TABLE)).toBe("table");
    expect(dataLabel("unknown")).toBe("any");
    const facts = dataFactsAtEnd(result({ kind: "other", tag: "ext", repr: "<ext x>" }));
    expect(facts.type).toBe("ext");
  });

  it("sameFacts compares the shape too", () => {
    expect(sameFacts({ type: TABLE, utf8: "unknown" }, { type: TABLE, utf8: "unknown" })).toBe(
      true,
    );
    expect(
      sameFacts({ type: TABLE, utf8: "unknown", shape: "a" }, { type: TABLE, utf8: "unknown" }),
    ).toBe(false);
    expect(
      sameFacts(
        { type: TABLE, utf8: "unknown", shape: "a" },
        { type: TABLE, utf8: "unknown", shape: "b" },
      ),
    ).toBe(false);
  });
});

describe("the badges of a step card", () => {
  it("the output badge exists only for an extension value", () => {
    expect(outputBadge("str")).toBeNull();
    expect(outputBadge("unknown")).toBeNull();
    expect(outputBadge(TABLE)).toBe("table");
    expect(outputBadge(TABLE, { kind: "table", shape: "4 columns" })).toBe("table, 4 columns");
    expect(outputBadge(RELATION, { kind: "relation", shape: "lazy" })).toBe("relation, lazy");
    expect(outputBadge("unknown", { kind: "table", shape: null })).toBe("table");
    expect(outputBadge("bytes", { kind: "table", shape: "" })).toBe("table");
  });

  it("the input mark is quiet unless a kind is involved and the level is not green", () => {
    expect(inputMark("str", "bytes")).toBeNull();
    expect(inputMark("list", "str")).toBeNull();
    expect(inputMark({ type: "ext", kind: "table" }, TABLE)).toBeNull();
    expect(inputMark({ type: "ext", kind: "relation" }, TABLE, "unknown", conversions)).toBeNull();
    expect(inputMark({ type: "ext", kind: "table" }, "bytes")).toEqual({
      level: "no",
      text: "needs a table. Add Parse CSV first.",
    });
    expect(inputMark("str", TABLE)).toEqual({ level: "no", text: "needs text; this is a table" });
    expect(inputMark({ type: "ext", kind: "table" }, RELATION, "unknown", conversions)).toEqual({
      level: "converts",
      text: "runs the query first",
    });
    expect(inputMark({ type: "ext", kind: "table" }, "ext{rat}")).toEqual({
      level: "no",
      text: "needs a table; this is a rat extension value",
    });
    expect(inputMark("any", TABLE)).toBeNull();
  });

  it("dataAboveStatic follows the declared outputs of the steps before", () => {
    const ops = [
      op("t:parse", "bytes", "ext", { outputKind: "table" }),
      op("t:hash", "bytes", "bytes"),
    ];
    const steps = [
      { kind: "op", op: "t:parse" },
      { kind: "comment", text: "x" },
      { kind: "op", op: "t:hash", disabled: true },
      { kind: "op", op: "t:hash" },
    ] as unknown as Recipe["steps"];
    expect(dataAboveStatic(steps, 0, ops, true)).toBe("bytes");
    expect(dataAboveStatic(steps, 0, ops, false)).toBe("unknown");
    expect(dataAboveStatic(steps, 1, ops, true)).toBe(TABLE);
    expect(dataAboveStatic(steps, 3, ops, true)).toBe(TABLE);
    expect(dataAboveStatic(steps, 4, ops, true)).toBe("bytes");
    expect(dataAboveStatic(steps, 1, null, true)).toBe("unknown");
    const withFork = [{ kind: "fork" }, { kind: "op", op: "t:hash" }] as unknown as Recipe["steps"];
    expect(dataAboveStatic(withFork, 1, ops, true)).toBe("bytes");
    const withIf = [{ kind: "if" }, { kind: "op", op: "t:hash" }] as unknown as Recipe["steps"];
    expect(dataAboveStatic(withIf, 1, ops, true)).toBe("unknown");
  });
});
