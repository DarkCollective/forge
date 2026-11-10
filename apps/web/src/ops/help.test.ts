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
import type { ParamSpec } from "@forge/lang";
import { describeConstraint, describeDefault, describeParam, helpFor } from "./help.js";

function param(partial: Partial<ParamSpec> & { name: string; type: ParamSpec["type"] }): ParamSpec {
  return { index: 1, required: true, ...partial } as ParamSpec;
}

describe("describeConstraint", () => {
  it("states both bounds of a range in words", () => {
    expect(describeConstraint({ min: 1, max: 64 })).toEqual(["from 1 to 64"]);
    expect(describeConstraint({ min: 0 })).toEqual(["at least 0"]);
    expect(describeConstraint({ max: 9 })).toEqual(["at most 9"]);
  });

  it("states lengths, sets and patterns", () => {
    expect(describeConstraint({ minLength: 2, maxLength: 8 })).toEqual(["length 2 to 8"]);
    expect(describeConstraint({ minLength: 2 })).toEqual(["length at least 2"]);
    expect(describeConstraint({ maxLength: 2 })).toEqual(["length at most 2"]);
    expect(describeConstraint({ lengthOneOf: [4, 8] })).toEqual(["length 4 or 8"]);
    expect(describeConstraint({ oneOf: [1, 2] })).toEqual(["one of 1, 2"]);
    expect(describeConstraint({ pattern: "[a-f]+" })).toEqual(["matches [a-f]+"]);
  });

  it("is empty without a constraint", () => {
    expect(describeConstraint(undefined)).toEqual([]);
    expect(describeConstraint({})).toEqual([]);
  });
});

describe("describeDefault", () => {
  it("shows scalars as JSON and encoded values as value and encoding", () => {
    expect(describeDefault(5)).toBe("5");
    expect(describeDefault("x")).toBe('"x"');
    expect(describeDefault(true)).toBe("true");
    expect(describeDefault({ value: "\n", enc: "utf8" })).toBe('"\\n" as utf8');
    expect(describeDefault(undefined)).toBeNull();
  });
});

describe("describeParam", () => {
  it("says a required parameter is required, with its type and constraint", () => {
    const p = describeParam(
      param({ name: "width", type: "int", constraint: { min: 1 }, doc: "Columns." }),
    );
    expect(p).toEqual({
      name: "width",
      type: "int",
      summary: "int, required, at least 1",
      doc: "Columns.",
    });
  });

  it("shows the default of an optional parameter and its options", () => {
    const p = describeParam(
      param({
        name: "mode",
        type: "choice",
        required: false,
        default: "ecb",
        options: ["ecb", "cbc"],
      }),
    );
    expect(p.summary).toBe('choice, default "ecb", options ecb, cbc');
    expect(p.doc).toBeNull();
  });
});

describe("helpFor", () => {
  it("builds the text of an operation's help, including its parameters", () => {
    const op = {
      qname: "hex:encode",
      name: "encode",
      vocab: "hex",
      category: "Encoding",
      doc: "Encode bytes as hexadecimal.",
      aliases: ["hex", "tohex"],
      seeAlso: ["hex:decode"],
      input: "bytes",
      output: "str",
      effect: "( bytes -- str )",
      params: [
        param({
          name: "case",
          type: "choice",
          required: false,
          default: "lower",
          options: ["lower", "upper"],
        }),
      ],
      effects: [],
      version: "1",
      hash: "h",
      needsHardKill: false,
    } as unknown as CatalogueOp;
    const h = helpFor(op);
    expect(h.signature).toBe("Input bytes, output str.");
    expect(h.aliases).toBe("hex, tohex");
    expect(h.seeAlso).toBe("hex:decode");
    expect(h.effect).toBe("( bytes -- str )");
    expect(h.params.map((p) => p.summary)).toEqual([
      'choice, default "lower", options lower, upper',
    ]);
  });

  it("keeps markup-looking metadata as plain strings", () => {
    const op = {
      qname: "x:y",
      name: "y",
      vocab: "x",
      category: null,
      doc: "<img src=x onerror=alert(1)>",
      aliases: [],
      seeAlso: [],
      input: "any",
      output: "any",
      effect: "( any -- any )",
      params: [],
      effects: [],
      version: "1",
      hash: "h",
      needsHardKill: false,
    } as unknown as CatalogueOp;
    expect(helpFor(op).doc).toBe("<img src=x onerror=alert(1)>");
  });
});
