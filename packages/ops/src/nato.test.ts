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
 * Tests for the `nato` vocabulary (vocab/nato.fth): the whole alphabet, both digit spellings, the delimiters, and the
 * way decode reads encode's output back.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { buildCatalogue } from "./catalogue.js";
import { loadBundleNode } from "./sources-node.js";

const { str } = valueHelpers;
type Result = Awaited<ReturnType<ReturnType<typeof assembleRuntime>["call"]>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const top = (r: Result) => (r.ok ? (r.stack[r.stack.length - 1] as { v: unknown }).v : undefined);

const bundle = await loadBundleNode(["nato"]);
const runtime = assembleRuntime(bundle);
const encode = async (s: string, digits = "plain", delimiter = "space") =>
  top(await runtime.call("nato:encode", [str(s), str(digits), str(delimiter)])) as string;
const decode = async (s: string, delimiter = "space") =>
  top(await runtime.call("nato:decode", [str(s), str(delimiter)])) as string;

const LETTERS =
  "Alfa Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliett Kilo Lima Mike November Oscar Papa Quebec Romeo Sierra Tango Uniform Victor Whiskey X-ray Yankee Zulu";

describe("catalogue", () => {
  test("nato:encode and nato:decode are Language ops", () => {
    const ops = buildCatalogue(assembleRuntime(bundle)).ops.filter((o) => o.vocab === "nato");
    expect(ops.map((o) => o.qname)).toEqual(["nato:decode", "nato:encode"]);
    expect(ops.every((o) => o.category === "Language")).toBe(true);
  });
});

describe("nato:encode", () => {
  test("all 26 letters in either case", async () => {
    expect(await encode("abcdefghijklmnopqrstuvwxyz")).toBe(LETTERS);
    expect(await encode("ABCDEFGHIJKLMNOPQRSTUVWXYZ")).toBe(LETTERS);
  });

  test("digits, plain and ICAO", async () => {
    expect(await encode("0123456789")).toBe("Zero One Two Three Four Five Six Seven Eight Nine");
    expect(await encode("0123456789", "icao")).toBe(
      "Zero Wun Too Tree Fower Fife Six Seven Ait Niner",
    );
  });

  test("a space is a slash and other characters are kept", async () => {
    expect(await encode("Hello 42!")).toBe("Hotel Echo Lima Lima Oscar / Four Two !");
    expect(await encode("a-b é\n")).toBe("Alfa - Bravo / é \n");
    expect(await encode("")).toBe("");
  });

  test("the delimiters", async () => {
    expect(await encode("ab", "plain", "comma")).toBe("Alfa,Bravo");
    expect(await encode("ab", "plain", "semicolon")).toBe("Alfa;Bravo");
    expect(await encode("ab", "plain", "colon")).toBe("Alfa:Bravo");
    expect(await encode("ab", "plain", "newline")).toBe("Alfa\nBravo");
    expect(await encode("ab", "plain", "crlf")).toBe("Alfa\r\nBravo");
    expect(await encode("ab", "plain", "cr")).toBe("Alfa\rBravo");
    expect(await encode("ab", "plain", "tab")).toBe("Alfa\tBravo");
  });

  test("a delimiter of none is refused", async () => {
    expect(code(await runtime.call("nato:encode", [str("ab"), str("plain"), str("none")]))).toBe(
      "E_PARAM_INVALID",
    );
  });
});

describe("nato:decode", () => {
  test("the alphabet back, in upper case", async () => {
    expect(await decode(LETTERS)).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(await decode(LETTERS.toLowerCase())).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(await decode(LETTERS.toUpperCase())).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
  });

  test("both digit spellings and the variants", async () => {
    expect(await decode("Zero One Two Three Four Five Six Seven Eight Nine")).toBe("0123456789");
    expect(await decode("Zero Wun Too Tree Fower Fife Six Seven Ait Niner")).toBe("0123456789");
    expect(await decode("Alpha Juliet Xray Whisky")).toBe("AJXW");
  });

  test("a slash is a space; anything that is not a word is kept", async () => {
    expect(await decode("Hotel Echo Lima Lima Oscar / Four Two !")).toBe("HELLO 42!");
    expect(await decode("Alfa foo Bravo")).toBe("AfooB");
    expect(await decode("Alfa - Bravo")).toBe("A-B");
  });

  test("empty tokens are dropped and spaces around a word are ignored", async () => {
    expect(await decode("Alfa   Bravo")).toBe("AB");
    expect(await decode("Alfa, Bravo ,Charlie", "comma")).toBe("ABC");
    expect(await decode("")).toBe("");
  });

  test("the delimiters", async () => {
    expect(await decode("Alfa\nBravo", "newline")).toBe("AB");
    expect(await decode("Alfa\r\nBravo", "crlf")).toBe("AB");
    expect(await decode("Alfa\tBravo", "tab")).toBe("AB");
    expect(await decode("Alfa;Bravo", "semicolon")).toBe("AB");
  });

  test("encode then decode gives the text back in upper case, in every delimiter", async () => {
    const text = "The Quick Brown Fox, 1234567890! jumps (over) 13 lazy dogs?";
    for (const d of ["space", "comma", "semicolon", "colon", "newline", "crlf", "cr", "tab"]) {
      for (const digits of ["plain", "icao"]) {
        // a comma in the text is a token that is not a word, so it only survives when the delimiter is another
        const sample = d === "comma" ? text.replaceAll(",", "") : text;
        const back = await decode(await encode(sample, digits, d), d);
        expect(back).toBe(sample.toUpperCase().replace(/é/g, "é"));
      }
    }
  });

  test("a large text is within the step limit", async () => {
    const text = "hello world ".repeat(5000);
    expect(await decode(await encode(text))).toBe(text.toUpperCase());
  });
});
