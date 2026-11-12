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
import type { CatalogueOp } from "@forge/ops";
import type { ParamType } from "@forge/lang";
import type { Recipe, Step } from "@forge/recipe";
import type { BakeResult, OutputValue } from "@forge/worker";
import { dataLabel, dataTypeAtEnd, fits, whyNotFit } from "./fit.js";
import type { DataType } from "./fit.js";

function op(qname: string, input: ParamType, output: ParamType): CatalogueOp {
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
  };
}

const OPS = [
  op("t:toStr", "bytes", "str"),
  op("t:toList", "str", "list"),
  op("t:toAny", "bytes", "any"),
  op("t:toNumber", "bytes", "number"),
  op("t:toChoice", "bytes", "choice"),
  op("t:toKey", "bytes", "key"),
];

const rec = (...steps: Step[]): Recipe => ({ steps }) as unknown as Recipe;
const o = (name: string, extra: object = {}): Step =>
  ({ kind: "op", op: name, ...extra }) as unknown as Step;

function result(ok: true, output: OutputValue): BakeResult;
function result(ok: false): BakeResult;
function result(ok: boolean, output?: OutputValue): BakeResult {
  return (ok ? { ok, output } : { ok, error: { code: "E_TYPE" } }) as unknown as BakeResult;
}
const noBake = { result: null, stale: false };

describe("fits", () => {
  const ALL: DataType[] = ["bytes", "str", "int", "num", "bool", "list", "quot", "record", "file"];
  const INPUTS: ParamType[] = [
    "bytes",
    "str",
    "int",
    "num",
    "number",
    "bool",
    "list",
    "quot",
    "record",
    "file",
  ];
  // LANGUAGE.md section 4.2: the pairs with a coercion, besides the diagonal and the `any` column.
  const COERCED = new Set([
    "bytes>str",
    "str>bytes",
    "int>num",
    "num>int",
    "int>number",
    "num>number",
  ]);

  for (const input of INPUTS) {
    for (const data of ALL) {
      const expected = input === data || COERCED.has(`${data}>${input}`);
      it(`${data} into ${input}: ${expected ? "fits" : "does not fit"}`, () => {
        expect(fits(input, data)).toBe(expected);
      });
    }
  }

  it("fits everything when the data type is unknown", () => {
    for (const input of INPUTS) expect(fits(input, "unknown")).toBe(true);
  });

  it("fits every data type when the operation takes any", () => {
    for (const data of ALL) expect(fits("any", data)).toBe(true);
  });

  it("reads refinements by their runtime type (section 5.6)", () => {
    expect(fits("choice", "bytes")).toBe(true);
    expect(fits("regex", "str")).toBe(true);
    expect(fits("charset", "list")).toBe(false);
    expect(fits("toggle", "str")).toBe(true);
    expect(fits("key", "int")).toBe(false);
  });
});

describe("dataTypeAtEnd (static)", () => {
  const at = (recipe: Recipe, ops: readonly CatalogueOp[] | null = OPS): DataType =>
    dataTypeAtEnd({ recipe, bake: noBake, ops });

  it("is bytes for an empty recipe", () => {
    expect(at(rec())).toBe("bytes");
  });

  it("is bytes when every step is disabled or a comment", () => {
    const comment = { kind: "comment", text: "x" } as unknown as Step;
    expect(at(rec(comment, o("t:toList", { disabled: true })))).toBe("bytes");
  });

  it("is the declared output of the last active op", () => {
    expect(at(rec(o("t:toStr")))).toBe("str");
    expect(at(rec(o("t:toStr"), o("t:toList")))).toBe("list");
  });

  it("skips a disabled or comment step at the end", () => {
    const comment = { kind: "comment", text: "x" } as unknown as Step;
    expect(at(rec(o("t:toStr"), o("t:toList", { disabled: true }), comment))).toBe("str");
  });

  it("maps refinements to their runtime type", () => {
    expect(at(rec(o("t:toChoice")))).toBe("str");
    expect(at(rec(o("t:toKey")))).toBe("bytes");
  });

  it("is unknown for an output of any or number", () => {
    expect(at(rec(o("t:toAny")))).toBe("unknown");
    expect(at(rec(o("t:toNumber")))).toBe("unknown");
  });

  it("is unknown for an op the catalogue does not know, or while it is not loaded", () => {
    expect(at(rec(o("gone:op")))).toBe("unknown");
    expect(at(rec(o("t:toStr")), null)).toBe("unknown");
  });

  it("is bytes after fork, subsection and repeat, and unknown after if", () => {
    for (const kind of ["fork", "subsection", "repeat"]) {
      const step = { kind, steps: [] } as unknown as Step;
      expect(at(rec(o("t:toList"), step))).toBe("bytes");
    }
    const ifStep = { kind: "if", then: [] } as unknown as Step;
    expect(at(rec(o("t:toStr"), ifStep))).toBe("unknown");
  });
});

describe("dataTypeAtEnd (from the bake)", () => {
  const recipe = rec(o("t:toStr"));
  const at = (bake: Parameters<typeof dataTypeAtEnd>[0]["bake"]): DataType =>
    dataTypeAtEnd({ recipe, bake, ops: OPS });

  it("uses the real type of a fresh successful output", () => {
    const list = { kind: "list", items: [], total: 0 } as unknown as OutputValue;
    expect(at({ result: result(true, list), stale: false })).toBe("list");
    const bytes = { kind: "bytes", bytes: new Uint8Array(), text: "" } as unknown as OutputValue;
    expect(at({ result: result(true, bytes), stale: false })).toBe("bytes");
    expect(at({ result: result(true, { kind: "int", text: "1" }), stale: false })).toBe("int");
    expect(at({ result: result(true, { kind: "num", value: 1 }), stale: false })).toBe("num");
    expect(at({ result: result(true, { kind: "bool", value: true }), stale: false })).toBe("bool");
    expect(at({ result: result(true, { kind: "str", text: "" }), stale: false })).toBe("str");
    const rcd = { kind: "record", entries: [], total: 0 } as unknown as OutputValue;
    expect(at({ result: result(true, rcd), stale: false })).toBe("record");
  });

  it("reads the tag of an other output, and is unknown for a tag it does not know", () => {
    const quot = { kind: "other", tag: "quot", repr: "[ ]" } as unknown as OutputValue;
    expect(at({ result: result(true, quot), stale: false })).toBe("quot");
    const odd = { kind: "other", tag: "mystery", repr: "?" } as unknown as OutputValue;
    expect(at({ result: result(true, odd), stale: false })).toBe("unknown");
  });

  it("falls back to the static type when the result is stale, failed or missing", () => {
    const list = { kind: "list", items: [], total: 0 } as unknown as OutputValue;
    expect(at({ result: result(true, list), stale: true })).toBe("str");
    expect(at({ result: result(false), stale: false })).toBe("str");
    expect(at(noBake)).toBe("str");
  });
});

describe("labels and reasons", () => {
  it("names the data type in plain words", () => {
    expect(dataLabel("str")).toBe("text");
    expect(dataLabel("bytes")).toBe("bytes");
    expect(dataLabel("list")).toBe("list");
    expect(dataLabel("unknown")).toBe("any");
  });

  it("says why an operation does not fit", () => {
    expect(whyNotFit("list", "str")).toBe("needs a list");
    expect(whyNotFit("bytes", "list")).toBe("needs bytes");
    expect(whyNotFit("choice", "list")).toBe("needs text");
  });

  it("says nothing when it fits", () => {
    expect(whyNotFit("bytes", "str")).toBe("");
    expect(whyNotFit("list", "unknown")).toBe("");
    expect(whyNotFit("any", "list")).toBe("");
  });
});
