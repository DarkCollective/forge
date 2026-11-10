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

// Multi-step Phase 4 recipes, baked with the in-process baker the way vectors.test.ts does it
// (trusted, pins ignored). Single-op vectors cannot feed a list into text:join, so these chain ops.
// Every expected value is computed by hand (see the comment on each case), never by running the ops.
import { loadBundleNode } from "@forge/ops/node";
import { validateRecipe } from "@forge/recipe";
import type { Recipe } from "@forge/recipe";
import { beforeAll, describe, expect, test } from "vitest";
import { createInProcessBaker } from "../src/index.js";
import type { BakeResult } from "../src/index.js";
import { catalogue, utf8 } from "./helpers.js";

interface Step {
  kind: "op";
  op: string;
  params: Record<string, unknown>;
}
const op = (name: string, params: Record<string, unknown> = {}): Step => ({
  kind: "op",
  op: name,
  params,
});
const recipeOf = (...steps: Step[]): Recipe => ({ forge: 1, steps }) as unknown as Recipe;

const baker = createInProcessBaker({ loadBundle: loadBundleNode });
beforeAll(async () => {
  await baker.init({ vocabs: "all" });
});

/** Bakes a recipe over UTF-8 text and returns the output as text. */
async function run(recipe: Recipe, text: string): Promise<string> {
  const v = validateRecipe(recipe, catalogue);
  expect(v.issues, "the recipe is valid against the catalogue").toEqual([]);
  const result: BakeResult = await baker.bake(recipe, utf8(text), {
    trust: "trusted",
    pins: "ignore",
  });
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  const out = result.output;
  if (out.kind === "str") return out.text;
  if (out.kind === "bytes") return new TextDecoder().decode(out.bytes);
  throw new Error(`unexpected output kind ${out.kind}`);
}

describe("text:split then text:join", () => {
  test.each([
    ["a,b,,c", ","], // the empty piece is kept, so the join restores both commas
    ["one, two, three", ", "], // multi-character separator
    ["a--b", "-"],
    ["no separator here", ","], // one piece
  ])("%j with separator %j is the identity", async (text, sep) => {
    const r = recipeOf(op("text:split", { separator: sep }), op("text:join", { separator: sep }));
    expect(await run(r, text)).toBe(text);
  });

  test("the default separator is a newline on both sides", async () => {
    const r = recipeOf(op("text:split"), op("text:join"));
    expect(await run(r, "l1\nl2\nl3")).toBe("l1\nl2\nl3");
  });

  test("a different join separator replaces the split separator", async () => {
    // "a,b,c" splits to [a, b, c]; joining with ";" gives "a;b;c".
    const r = recipeOf(op("text:split", { separator: "," }), op("text:join", { separator: ";" }));
    expect(await run(r, "a,b,c")).toBe("a;b;c");
  });
});

describe("regex:split then text:join", () => {
  test("[0-9]+ on a1b22c, joined with '-', gives a-b-c", async () => {
    // The digit runs "1" and "22" are the separators, so the pieces are [a, b, c] (the same as
    // the regex:split vector for \d+ on this input), and the join gives "a-b-c".
    const r = recipeOf(
      op("regex:split", { pattern: "[0-9]+" }),
      op("text:join", { separator: "-" }),
    );
    expect(await run(r, "a1b22c")).toBe("a-b-c");
  });

  test("a trailing separator keeps a trailing empty piece", async () => {
    // "x1y2" splits on the digits to [x, y, ""], so joining with "|" gives "x|y|".
    const r = recipeOf(
      op("regex:split", { pattern: "[0-9]+" }),
      op("text:join", { separator: "|" }),
    );
    expect(await run(r, "x1y2")).toBe("x|y|");
  });
});

describe("cross-vocabulary chains", () => {
  // base64 "SGVsbG8=" is the bytes 48 65 6c 6c 6f ("Hello"). XOR with 0x20 flips the case bit of
  // each letter: 48->68 h, 65->45 E, 6c->4c L, 6c->4c L, 6f->4f O, so the result is "hELLO".
  const key = { value: "20", enc: "hex" };

  test("base64:decode -> bits:xor -> hex:encode", async () => {
    const r = recipeOf(
      op("base64:decode"),
      op("bits:xor", { key }),
      op("hex:encode", { delimiter: "none", case: "lower" }),
    );
    expect(await run(r, "SGVsbG8=")).toBe("68454c4c4f");
  });

  test("base64:decode -> bits:xor -> text:lower", async () => {
    // "hELLO" in lower case is "hello".
    const r = recipeOf(op("base64:decode"), op("bits:xor", { key }), op("text:lower"));
    expect(await run(r, "SGVsbG8=")).toBe("hello");
  });

  test("base64:decode -> bits:xor -> text:upper", async () => {
    // "hELLO" in upper case is "HELLO".
    const r = recipeOf(op("base64:decode"), op("bits:xor", { key }), op("text:upper"));
    expect(await run(r, "SGVsbG8=")).toBe("HELLO");
  });

  test("xor with the same key twice is the identity", async () => {
    const r = recipeOf(op("bits:xor", { key }), op("bits:xor", { key }));
    expect(await run(r, "Hello")).toBe("Hello");
  });
});

describe("encode -> decode round trips", () => {
  const text = "Hello, World!";
  const vocabs = ["base32", "base58", "base85", "binary", "decimal", "url"];

  test.each(vocabs)("%s", async (vocab) => {
    const r = recipeOf(op(`${vocab}:encode`), op(`${vocab}:decode`));
    expect(await run(r, text)).toBe(text);
  });

  test("all six in one recipe", async () => {
    const r = recipeOf(...vocabs.flatMap((v) => [op(`${v}:encode`), op(`${v}:decode`)]));
    expect(await run(r, text)).toBe(text);
  });

  test("a chain of encodings unwinds in reverse order", async () => {
    const r = recipeOf(
      op("base32:encode"),
      op("decimal:encode"),
      op("decimal:decode"),
      op("base32:decode"),
    );
    expect(await run(r, text)).toBe(text);
  });

  // Exact encodings, hand-computed or from the standards.
  test.each([
    // RFC 4648 section 10: BASE32("foobar") = "MZXW6YTBOI======".
    ["base32:encode", "foobar", "MZXW6YTBOI======"],
    // 0x41 = 0100 0001, 0x42 = 0100 0010, separated by a space.
    ["binary:encode", "AB", "01000001 01000010"],
    // 0x41 = 65, 0x42 = 66.
    ["decimal:encode", "AB", "65 66"],
    // Space is %20, "/" is %2F, U+00E9 is the UTF-8 bytes C3 A9.
    ["url:encode", "a b/é", "a%20b%2F%C3%A9"],
    // The classic Ascii85 example: "Man " -> "9jqo^".
    ["base85:encode", "Man ", "9jqo^"],
    // Bitcoin alphabet Base58 of "Hello World!".
    ["base58:encode", "Hello World!", "2NEpo7TZRRrLZSi2U"],
  ])("%s of %j is %j", async (name, input, expected) => {
    expect(await run(recipeOf(op(name)), input)).toBe(expected);
  });

  test("morse: SOS encodes to ... --- ... and decodes back", async () => {
    // ITU-R M.1677-1: S = "...", O = "---".
    expect(await run(recipeOf(op("morse:encode")), "SOS")).toBe("... --- ...");
    expect(await run(recipeOf(op("morse:encode"), op("morse:decode")), "SOS")).toBe("SOS");
  });

  test("morse: two words round trip through the slash separator", async () => {
    // Letters and spaces only; decode gives upper case, so the input is upper case already.
    const r = recipeOf(op("morse:encode"), op("morse:decode"));
    expect(await run(r, "HELLO WORLD")).toBe("HELLO WORLD");
  });
});
