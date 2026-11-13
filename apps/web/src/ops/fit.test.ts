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
import { RENDER_LIMITS } from "@forge/worker";
import {
  MAX_TEXT_BYTES,
  convertHint,
  dataFactsAtEnd,
  dataLabel,
  dataLine,
  dataTypeAtEnd,
  fitLevel,
  fits,
  sameFacts,
  whyNotFit,
} from "./fit.js";
import type { DataType, FitLevel } from "./fit.js";

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

describe("fitLevel (the traffic light, LANGUAGE.md section 4.2)", () => {
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
    "any",
  ];
  // The "co" cells; every other cell that is not the diagonal, `any` or `number` is "-".
  const AMBER = new Set(["bytes>str", "str>bytes", "int>num", "num>int"]);
  const GREEN_EXTRA = new Set(["int>number", "num>number"]);

  for (const input of INPUTS) {
    for (const data of ALL) {
      let expected: FitLevel = "no";
      if (input === "any" || input === data || GREEN_EXTRA.has(`${data}>${input}`)) {
        expected = "fits";
      } else if (AMBER.has(`${data}>${input}`)) expected = "converts";
      it(`${data} into ${input}: ${expected}`, () => {
        expect(fitLevel(input, data)).toBe(expected);
      });
    }
  }

  it("is green for every input when the data type is unknown", () => {
    for (const input of INPUTS) expect(fitLevel(input, "unknown")).toBe("fits");
  });

  it("reads refinements by their runtime type", () => {
    expect(fitLevel("choice", "bytes")).toBe("converts");
    expect(fitLevel("toggle", "str")).toBe("converts");
    expect(fitLevel("key", "bytes")).toBe("fits");
    expect(fitLevel("regex", "list")).toBe("no");
  });

  it("refines bytes into str by the UTF-8 state: valid green, invalid red, unknown amber", () => {
    expect(fitLevel("str", "bytes", "valid")).toBe("fits");
    expect(fitLevel("str", "bytes", "invalid")).toBe("no");
    expect(fitLevel("str", "bytes", "unknown")).toBe("converts");
  });

  it("does not let the UTF-8 state touch any other cell", () => {
    for (const utf8 of ["valid", "invalid", "unknown"] as const) {
      expect(fitLevel("bytes", "bytes", utf8)).toBe("fits");
      expect(fitLevel("list", "bytes", utf8)).toBe("no");
      expect(fitLevel("bytes", "str", utf8)).toBe("converts");
    }
  });
});

describe("dataFactsAtEnd (UTF-8 state)", () => {
  const recipe = rec(o("t:toStr"));
  const bytesOut = (bytes: Uint8Array, text: string | null): OutputValue =>
    ({ kind: "bytes", bytes, text }) as unknown as OutputValue;
  const factsOf = (output: OutputValue) =>
    dataFactsAtEnd({ recipe, bake: { result: result(true, output), stale: false }, ops: OPS });

  it("matches the worker's text limit", () => {
    expect(MAX_TEXT_BYTES).toBe(RENDER_LIMITS.maxTextBytes);
  });

  it("is valid when the bake gave text", () => {
    expect(factsOf(bytesOut(new Uint8Array([104, 105]), "hi"))).toEqual({
      type: "bytes",
      utf8: "valid",
    });
  });

  it("is invalid when the bake gave no text for bytes within the limit", () => {
    expect(factsOf(bytesOut(new Uint8Array([0xff, 0xfe]), null))).toEqual({
      type: "bytes",
      utf8: "invalid",
    });
  });

  it("is unknown when the bake gave no text because the bytes are over the limit", () => {
    const big = { length: MAX_TEXT_BYTES + 1 } as unknown as Uint8Array;
    expect(factsOf(bytesOut(big, null))).toEqual({ type: "bytes", utf8: "unknown" });
  });

  it("is unknown for a type other than bytes", () => {
    expect(factsOf({ kind: "str", text: "x" })).toEqual({ type: "str", utf8: "unknown" });
  });

  it("is unknown with no usable bake, unless an empty recipe has input bytes", () => {
    const facts = (r: Recipe, bytes?: Uint8Array) =>
      dataFactsAtEnd({ recipe: r, bake: noBake, ops: OPS, inputBytes: bytes });
    expect(facts(rec(), new Uint8Array([104, 105]))).toEqual({ type: "bytes", utf8: "valid" });
    expect(facts(rec(), new Uint8Array([0xc3, 0x28]))).toEqual({ type: "bytes", utf8: "invalid" });
    expect(facts(rec(), new Uint8Array())).toEqual({ type: "bytes", utf8: "valid" });
    expect(facts(rec())).toEqual({ type: "bytes", utf8: "unknown" });
    // With steps, the input says nothing about the data at the end.
    expect(facts(rec(o("t:toList")), new Uint8Array([104]))).toEqual({
      type: "list",
      utf8: "unknown",
    });
    const fork = rec({ kind: "fork", steps: [] } as unknown as Step);
    expect(facts(fork, new Uint8Array([104]))).toEqual({ type: "bytes", utf8: "unknown" });
  });

  it("ignores a stale bake", () => {
    const stale = dataFactsAtEnd({
      recipe: rec(),
      bake: { result: result(true, bytesOut(new Uint8Array([0xff]), null)), stale: true },
      ops: OPS,
      inputBytes: new Uint8Array([104]),
    });
    expect(stale).toEqual({ type: "bytes", utf8: "valid" });
  });

  it("compares facts", () => {
    expect(sameFacts({ type: "bytes", utf8: "valid" }, { type: "bytes", utf8: "valid" })).toBe(
      true,
    );
    expect(sameFacts({ type: "bytes", utf8: "valid" }, { type: "bytes", utf8: "invalid" })).toBe(
      false,
    );
  });
});

describe("hints and the header line", () => {
  it("says what an amber row does", () => {
    expect(convertHint("str", "bytes")).toBe("text only if valid UTF-8");
    expect(convertHint("choice", "bytes")).toBe("text only if valid UTF-8");
    expect(convertHint("bytes", "str")).toBe("converts to bytes");
    expect(convertHint("num", "int")).toBe("converts to a number");
    expect(convertHint("int", "num")).toBe("converts to a whole number");
  });

  it("has no convert hint for green or red", () => {
    expect(convertHint("str", "bytes", "valid")).toBe("");
    expect(convertHint("str", "bytes", "invalid")).toBe("");
    expect(convertHint("list", "str")).toBe("");
    expect(convertHint("number", "int")).toBe("");
  });

  it("says needs valid text for bytes that are certainly not text", () => {
    expect(whyNotFit("str", "bytes", "invalid")).toBe("needs valid text");
    expect(whyNotFit("str", "bytes", "valid")).toBe("");
    expect(whyNotFit("str", "bytes")).toBe("");
    expect(whyNotFit("list", "bytes", "invalid")).toBe("needs a list");
  });

  it("words the header line", () => {
    expect(dataLine({ type: "bytes", utf8: "valid" })).toBe("bytes (valid text)");
    expect(dataLine({ type: "bytes", utf8: "invalid" })).toBe("bytes");
    expect(dataLine({ type: "bytes", utf8: "unknown" })).toBe("bytes");
    expect(dataLine({ type: "str", utf8: "unknown" })).toBe("text");
  });
});
