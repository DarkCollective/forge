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
 * The header type `ext{kind}` (LANGUAGE-0.3.md section 4.3): parsing, canonical text, errors and
 * the JSON Schema of WordMeta.
 */
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import { ForgeError } from "./errors.js";
import { WORD_META_SCHEMA, WordMetaBuilder, parseHeader, slotText } from "./meta.js";
import { DEFAULT_LIMITS } from "./types.js";
import type { SourcePos, StackEffect } from "./types.js";

const P0: SourcePos = { offset: 0, line: 1, col: 1 };
const ajv = new Ajv2020({ strict: true, allErrors: true });
const validateSchema = ajv.compile(WORD_META_SCHEMA);

const strict = (text: string): StackEffect => parseHeader(text, P0, "strict");
const lenient = (text: string): StackEffect => parseHeader(text, P0, "lenient");

function headerError(text: string): ForgeError {
  try {
    parseHeader(text, P0, "strict", DEFAULT_LIMITS);
  } catch (e) {
    expect(e).toBeInstanceOf(ForgeError);
    return e as ForgeError;
  }
  throw new Error(`expected E_HEADER for ${JSON.stringify(text)}`);
}

describe("the header type ext{kind}", () => {
  test("a header round-trips and records the kind on the slot", () => {
    for (const text of [
      "t:ext{table} -- ext{table}",
      "t:ext{table} expr:ext{relix-expr} -- ext{table}",
      "t:ext{table} -- r:ext{table}",
      's:str p:ext{fx-pair}="1,2" -- str',
    ]) {
      const e = strict(text);
      expect(e.text).toBe(`( ${text} )`);
      expect(strict(e.text.slice(2, -2)).text).toBe(e.text);
    }
    const e = strict("t:ext{table} expr:ext{relix-expr} -- ext{table}");
    expect(e.inputs[0]).toStrictEqual({ name: "t", type: "ext", kind: "table" });
    expect(e.inputs[1]).toStrictEqual({ name: "expr", type: "ext", kind: "relix-expr" });
    expect(e.outputs[0]).toStrictEqual({ name: null, type: "ext", kind: "table" });
    expect(lenient("ext{table} -- ext{null}").inputs[0]).toStrictEqual({
      name: null,
      type: "ext",
      kind: "table",
    });
  });

  test("a bare ext, a bad kind name and a constraint are E_HEADER", () => {
    for (const bad of [
      "p:ext --",
      "ext --",
      "-- ext",
      "-- r:ext",
      "p:ext{Pair} --",
      "p:ext{} --",
      "p:ext{1a} --",
      "p:ext{a_b} --",
      "p:ext{" + "a".repeat(65) + "} --",
      "p:ext{a b} --",
      "s:str p:ext{fx-pair}[1..2] -- str",
      "p:ext{fx-pair --",
      '-- p:ext{a}="x"',
      "-- p:ext{a}[1]",
    ]) {
      expect(headerError(bad).code, bad).toBe("E_HEADER");
    }
    expect(headerError("p:ext --").message).toMatch(/needs a kind/);
    expect(headerError("p:ext{a}{b} --").code).toBe("E_HEADER");
  });

  test("a kind name of 1 to 64 characters is accepted, and the kind is never looked up", () => {
    expect(strict("a:ext{" + "a".repeat(64) + "} --").inputs[0]?.kind).toBe("a".repeat(64));
    expect(strict("a:ext{no-such-pack-kind} --").inputs[0]?.kind).toBe("no-such-pack-kind");
  });

  test("a string default is allowed on a parameter, any other default is E_HEADER", () => {
    const e = strict('s:str p:ext{fx-pair}="1,2" -- str');
    expect(e.inputs[1]).toStrictEqual({ name: "p", type: "ext", kind: "fx-pair", default: "1,2" });
    expect(headerError("s:str p:ext{fx-pair}=3 -- str").code).toBe("E_HEADER");
    expect(headerError("s:str p:ext{fx-pair}=true -- str").code).toBe("E_HEADER");
    expect(headerError("s:str p:ext{fx-pair}=abc -- str").code).toBe("E_HEADER");
    expect(headerError('p:ext{fx-pair}="1,2" -- str').message).toMatch(/data input/);
  });

  test("an anonymous ext parameter is refused in a strict header, allowed in a lenient one", () => {
    expect(headerError("str ext{fx-pair} -- str").code).toBe("E_HEADER");
    expect(lenient("str ext{fx-pair} -- str").inputs[1]?.kind).toBe("fx-pair");
  });

  test("the WordMeta of a word with ext slots validates against meta.schema.json", () => {
    const meta = new WordMetaBuilder({
      name: "f",
      vocab: "v",
      kind: "fl",
      effect: strict('t:ext{table} expr:ext{relix-expr}="true" -- ext{table}'),
    }).build("0".repeat(64));
    const ok = (m: unknown): boolean => validateSchema(JSON.parse(JSON.stringify(m)) as unknown);
    expect(ok(meta)).toBe(true);
    expect(meta.params[0]).toMatchObject({
      name: "expr",
      type: "ext",
      kind: "relix-expr",
      default: "true",
      required: false,
    });
    const withInput = (s: unknown): unknown => ({
      ...meta,
      effect: { ...meta.effect, inputs: [s] },
      params: [],
    });
    expect(ok(withInput({ name: "t", type: "ext", kind: "table" }))).toBe(true);
    expect(ok(withInput({ name: "t", type: "ext" }))).toBe(false); // an ext slot needs its kind
    expect(ok(withInput({ name: "t", type: "str", kind: "table" }))).toBe(false); // and only it has one
    expect(ok(withInput({ name: "t", type: "ext", kind: "Table" }))).toBe(false);
    expect(ok(withInput({ name: "t", type: "ext", kind: "a".repeat(65) }))).toBe(false);
  });

  test("slotText prints the kind, so the canonical text and the hash cover it", () => {
    expect(slotText({ name: "t", type: "ext", kind: "table" })).toBe("t:ext{table}");
    expect(slotText({ name: null, type: "ext", kind: "table" })).toBe("ext{table}");
    expect(strict("t:ext{a} --").text).not.toBe(strict("t:ext{b} --").text);
  });
});
