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
import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import { ForgeError } from "./errors.js";
import {
  RESERVED_WORDS,
  WORD_META_SCHEMA,
  WordMetaBuilder,
  computeHash,
  effectText,
  isPrivateName,
  isReservedWord,
  isVocabName,
  isWordName,
  ownText,
  parseHeader,
  renderHelp,
  renderSee,
  slotText,
} from "./meta.js";
import type { ClauseArg, WordMetaInit } from "./meta.js";
import { DEFAULT_LIMITS } from "./types.js";
import type { ChoiceTypeEntry, SourcePos, StackEffect, StackSlot, WordMeta } from "./types.js";

const P0: SourcePos = { offset: 0, line: 1, col: 1 };

const ajv = new Ajv2020({ strict: true, allErrors: true });
const validateSchema = ajv.compile(WORD_META_SCHEMA);

/** Every WordMeta this file builds goes through here, so each one is checked against the schema. */
function checked(meta: WordMeta): WordMeta {
  // JSON round trip: the record must be JSON-serialisable and survive it unchanged.
  const json = JSON.parse(JSON.stringify(meta)) as WordMeta;
  expect(json).toStrictEqual(meta);
  const ok = validateSchema(json);
  expect(ajv.errorsText(validateSchema.errors), JSON.stringify(json)).toBe("No errors");
  expect(ok).toBe(true);
  return meta;
}

const strict = (text: string): StackEffect => parseHeader(text, P0, "strict");
const lenient = (text: string): StackEffect => parseHeader(text, P0, "lenient");

function headerError(
  text: string,
  mode: "strict" | "lenient" = "strict",
  pos: SourcePos = P0,
  limits = DEFAULT_LIMITS,
): ForgeError {
  try {
    parseHeader(text, pos, mode, limits);
  } catch (e) {
    expect(e).toBeInstanceOf(ForgeError);
    return e as ForgeError;
  }
  throw new Error(`expected E_HEADER for ${JSON.stringify(text)}`);
}

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

describe("names", () => {
  test("word names", () => {
    for (const ok of [
      "rot",
      "-rot",
      ">str",
      ".s",
      "<>",
      "_x",
      "see-also",
      "base64",
      "é",
      "a\u{1f600}",
      "x".repeat(128),
    ]) {
      expect(isWordName(ok), ok).toBe(true);
    }
    for (const bad of [
      "",
      "1+",
      "-1",
      "a:b",
      "a b",
      "a(b",
      "x;",
      "a\u00a0b",
      "a\u200bb",
      "a\tb",
      "x".repeat(129),
      "a\u0085",
    ]) {
      expect(isWordName(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  test("vocab names", () => {
    expect(isVocabName("classical")).toBe(true);
    expect(isVocabName("a-b_c9")).toBe(true);
    expect(isVocabName("9a")).toBe(false);
    expect(isVocabName("a:b")).toBe(false);
    expect(isVocabName("a".repeat(65))).toBe(false);
    expect(isVocabName("")).toBe(false);
  });

  test("reserved and private", () => {
    expect(RESERVED_WORDS).toContain("recurse");
    expect(isReservedWord("true")).toBe(true);
    expect(isReservedWord("MEMO:")).toBe(true);
    expect(isReservedWord("CHOICE:")).toBe(true);
    expect(isReservedWord(":>")).toBe(false);
    expect(isReservedWord("rot")).toBe(false);
    expect(isPrivateName("_x")).toBe(true);
    expect(isPrivateName("x")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// parseHeader: well-formed headers
// ---------------------------------------------------------------------------------------------

describe("parseHeader: the examples of spec 5.4", () => {
  test("( str amount:int[1..25]=13 -- str )", () => {
    const e = strict(" str  amount:int[1..25]=13 -- str ");
    expect(e.text).toBe("( str amount:int[1..25]=13 -- str )");
    expect(e).toStrictEqual({
      inputs: [
        { name: null, type: "str" },
        { name: "amount", type: "int", constraint: { min: 1, max: 25 }, default: 13 },
      ],
      outputs: [{ name: null, type: "str" }],
      unchecked: false,
      variadicInput: false,
      text: "( str amount:int[1..25]=13 -- str )",
    });
  });

  test("( text:str -- str )", () => {
    const e = strict("text:str -- str");
    expect(e.text).toBe("( text:str -- str )");
    expect(e.inputs).toStrictEqual([{ name: "text", type: "str" }]);
  });

  test("key, toggle and choice in one header", () => {
    const e = strict(
      "bytes key:key{hex|utf8}[16|24|32] iv:toggle{hex}[16] mode:choice{cbc|ctr|gcm}=cbc -- bytes",
    );
    expect(e.text).toBe(
      "( bytes key:key{hex|utf8}[16|24|32] iv:toggle{hex}[16] mode:choice{cbc|ctr|gcm}=cbc -- bytes )",
    );
    expect(e.inputs[1]).toStrictEqual({
      name: "key",
      type: "key",
      options: ["hex", "utf8"],
      constraint: { lengthOneOf: [16, 24, 32] },
    });
    expect(e.inputs[2]).toStrictEqual({
      name: "iv",
      type: "toggle",
      options: ["hex"],
      constraint: { minLength: 16, maxLength: 16 },
    });
    expect(e.inputs[3]).toStrictEqual({
      name: "mode",
      type: "choice",
      options: ["cbc", "ctr", "gcm"],
      default: "cbc",
    });
  });

  test("quoted choice options may contain spaces", () => {
    const e = strict('str style:choice{"Upper case"|"Lower case"}="Upper case" -- str');
    expect(e.inputs[1]).toStrictEqual({
      name: "style",
      type: "choice",
      options: ["Upper case", "Lower case"],
      default: "Upper case",
    });
    expect(e.text).toBe('( str style:choice{"Upper case"|"Lower case"}="Upper case" -- str )');
  });

  test("( -- int )", () => {
    const e = strict("-- int");
    expect(e.inputs).toStrictEqual([]);
    expect(e.text).toBe("( -- int )");
  });

  test("( a b -- c ) in lenient mode: labels are named inputs of type any", () => {
    const e = lenient("a b -- c");
    expect(e.inputs).toStrictEqual([
      { name: "a", type: "any" },
      { name: "b", type: "any" },
    ]);
    expect(e.outputs).toStrictEqual([{ name: "c", type: "any" }]);
    expect(e.text).toBe("( a b -- c )");
  });

  test("( quot -- .. ) is an unchecked output", () => {
    const e = strict("quot -- ..");
    expect(e.unchecked).toBe(true);
    expect(e.outputs).toStrictEqual([]);
    expect(e.text).toBe("( quot -- .. )");
  });

  test("a string default may contain a closing parenthesis (C91)", () => {
    const e = strict('str sep:str=" ) " -- str');
    expect(e.inputs[1]).toStrictEqual({ name: "sep", type: "str", default: " ) " });
    expect(e.text).toBe('( str sep:str=" ) " -- str )');
  });
});

describe("parseHeader: shapes", () => {
  test("empty effects", () => {
    expect(strict("--").text).toBe("( -- )");
    expect(strict("int --").text).toBe("( int -- )");
    expect(strict("  \n  --  ").text).toBe("( -- )");
  });

  test("variadic input (lenient only)", () => {
    const e = lenient(".. n:int --");
    expect(e.variadicInput).toBe(true);
    expect(e.inputs).toStrictEqual([{ name: "n", type: "int" }]);
    expect(e.text).toBe("( .. n:int -- )");
    expect(lenient(".. --").text).toBe("( .. -- )");
    expect(lenient(".. -- ..").text).toBe("( .. -- .. )");
    expect(lenient("-- ..").unchecked).toBe(true);
    expect(strict("-- ..").text).toBe("( -- .. )");
  });

  test("every type name, anonymous or named", () => {
    for (const t of [
      "any",
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
      "regex",
      "charset",
    ]) {
      expect(strict(`${t} -- ${t}`).inputs).toStrictEqual([{ name: null, type: t }]);
      const named = strict(`a:${t} b:${t} -- ${t}`);
      expect(named.inputs[1]).toStrictEqual({ name: "b", type: t });
    }
  });

  test("named outputs and labels", () => {
    const e = strict("int -- r:str flag:bool total");
    expect(e.outputs).toStrictEqual([
      { name: "r", type: "str" },
      { name: "flag", type: "bool" },
      { name: "total", type: "any" },
    ]);
    expect(e.text).toBe("( int -- r:str flag:bool total )");
  });

  test("an explicit :any renders as the bare label", () => {
    expect(strict("int x:any -- int").text).toBe("( int x -- int )");
  });

  test("anonymous and labelled parameters are fine in lenient mode", () => {
    const e = lenient("int int lbl -- int");
    expect(e.inputs.map((s) => s.name)).toStrictEqual([null, null, "lbl"]);
  });

  test("the data input may be a label or typed in strict mode", () => {
    expect(strict("a -- int").inputs).toStrictEqual([{ name: "a", type: "any" }]);
    expect(strict("a:int[1..3] b:int -- int").inputs[0]).toStrictEqual({
      name: "a",
      type: "int",
      constraint: { min: 1, max: 3 },
    });
  });

  test("whitespace is the six characters, any mix", () => {
    const e = strict("\tint\r\n\v\fp:int\n--\tint ");
    expect(e.text).toBe("( int p:int -- int )");
  });

  test("a type word that is a prefix of a name", () => {
    expect(lenient("integer strange -- int").inputs.map((s) => s.name)).toStrictEqual([
      "integer",
      "strange",
    ]);
  });
});

describe("parseHeader: constraints", () => {
  const c = (type: string, body: string): unknown =>
    strict(`a:${type} b:${type}[${body}] -- int`).inputs[1];

  test("int intervals and sets", () => {
    expect(c("int", "1..25")).toMatchObject({ constraint: { min: 1, max: 25 } });
    expect(c("int", "..5")).toMatchObject({ constraint: { max: 5 } });
    expect(c("int", "5..")).toMatchObject({ constraint: { min: 5 } });
    expect(c("int", "5")).toMatchObject({ constraint: { min: 5, max: 5 } });
    expect(c("int", "1|2|3")).toMatchObject({ constraint: { oneOf: [1, 2, 3] } });
    expect(c("int", "-5..-1")).toMatchObject({ constraint: { min: -5, max: -1 } });
    expect(c("int", "0b101..0x10")).toMatchObject({ constraint: { min: 5, max: 16 } });
    expect(c("int", "1_000..2_000")).toMatchObject({ constraint: { min: 1000, max: 2000 } });
    expect(c("int", "-0..0")).toMatchObject({ constraint: { min: 0, max: 0 } });
    expect(c("int", "9007199254740991")).toMatchObject({ constraint: { min: 9007199254740991 } });
  });

  test("num intervals take integers and floats", () => {
    expect(c("num", "0.5..1.5")).toMatchObject({ constraint: { min: 0.5, max: 1.5 } });
    expect(c("num", "1e3")).toMatchObject({ constraint: { min: 1000, max: 1000 } });
    expect(c("num", "..1_0.5e-1")).toMatchObject({ constraint: { max: 1.05 } });
    expect(c("num", "-0.0..1")).toMatchObject({ constraint: { min: 0, max: 1 } });
    expect(c("num", "-2..2.5")).toMatchObject({ constraint: { min: -2, max: 2.5 } });
  });

  test("length constraints use the length fields", () => {
    expect(c("str", "1..10")).toMatchObject({ constraint: { minLength: 1, maxLength: 10 } });
    expect(c("str", "3")).toMatchObject({ constraint: { minLength: 3, maxLength: 3 } });
    expect(c("charset", "4|8")).toMatchObject({ constraint: { lengthOneOf: [4, 8] } });
    expect(c("bytes", "16")).toMatchObject({ constraint: { minLength: 16, maxLength: 16 } });
    expect(c("list", "..3")).toMatchObject({ constraint: { maxLength: 3 } });
    expect(c("key", "16|24|32")).toMatchObject({ constraint: { lengthOneOf: [16, 24, 32] } });
    expect(c("toggle", "8..")).toMatchObject({ constraint: { minLength: 8 } });
  });

  test("str patterns, alone or with a length", () => {
    expect(c("str", "/[a-z]+/")).toMatchObject({ constraint: { pattern: "[a-z]+" } });
    expect(c("str", "2..5,/x{2}/")).toMatchObject({
      constraint: { minLength: 2, maxLength: 5, pattern: "x{2}" },
    });
    expect(c("str", "/[ab]/,3")).toMatchObject({
      constraint: { minLength: 3, maxLength: 3, pattern: "[ab]" },
    });
    expect(c("str", "/a\\/b/")).toMatchObject({ constraint: { pattern: "a\\/b" } });
    expect(c("str", "/a,b/")).toMatchObject({ constraint: { pattern: "a,b" } });
    expect(c("str", "/[\\]]/")).toMatchObject({ constraint: { pattern: "[\\]]" } });
    expect(c("str", "//")).toMatchObject({ constraint: { pattern: "" } });
    expect(strict('int a:str[/[a-z]{2}/]="ab" -- int').text).toBe(
      '( int a:str[/[a-z]{2}/]="ab" -- int )',
    );
  });

  test("a pattern at the length limit is accepted", () => {
    const limits = { ...DEFAULT_LIMITS, maxRegexLength: 3 };
    expect(parseHeader("a:str[/abc/] --", P0, "strict", limits).text).toBe("( a:str[/abc/] -- )");
  });

  test("canonical text of constraints", () => {
    expect(strict("a:int[5..5] --").text).toBe("( a:int[5] -- )");
    expect(strict("a:int[1|2] b:num[..2.5] --").text).toBe("( a:int[1|2] b:num[..2.5] -- )");
    expect(strict("a:str[/x/,1..2] --").text).toBe("( a:str[1..2,/x/] -- )");
  });
});

describe("parseHeader: defaults", () => {
  const d = (decl: string): unknown =>
    (strict(`int p:${decl} -- int`).inputs[1] as StackSlot).default;
  const t = (decl: string): string => strict(`int p:${decl} -- int`).text;

  test("int", () => {
    expect(d("int=13")).toBe(13);
    expect(d("int=-5")).toBe(-5);
    expect(d("int=0xff")).toBe(255);
    expect(d("int[1..5]=5")).toBe(5);
    expect(t("int=13")).toBe("( int p:int=13 -- int )");
  });

  test("num: an integer literal is accepted and rendered as a float", () => {
    expect(d("num=1")).toBe(1);
    expect(d("num=2.5")).toBe(2.5);
    expect(d("num[0..1]=0.25")).toBe(0.25);
    expect(t("num=1")).toBe("( int p:num=1.0 -- int )");
    expect(t("num=2.5")).toBe("( int p:num=2.5 -- int )");
  });

  test("str, regex and charset", () => {
    expect(d('str=""')).toBe("");
    expect(d('str="a b"')).toBe("a b");
    expect(d('str[3]="abc"')).toBe("abc");
    expect(d('str[/[a-c]+/]="abc"')).toBe("abc");
    expect(d('regex="a+"')).toBe("a+");
    expect(d('charset[2..3]="abc"')).toBe("abc");
    expect(t('str="a\\nb"')).toBe('( int p:str="a\\nb" -- int )');
  });

  test("string escapes", () => {
    expect(d('str="a\\nb\\tc\\rd\\0e\\\\f\\"g\\x41\\u{1F600}\\u{41}"')).toBe(
      'a\nb\tc\rd\0e\\f"gA\u{1f600}A',
    );
  });

  test("bool", () => {
    expect(d("bool=true")).toBe(true);
    expect(d("bool=false")).toBe(false);
    expect(t("bool=false")).toBe("( int p:bool=false -- int )");
  });

  test("choice: bare or quoted, rendered bare unless awkward", () => {
    expect(d("choice{a|b}=b")).toBe("b");
    expect(d('choice{a|b}="b"')).toBe("b");
    expect(t('choice{a|b}="b"')).toBe("( int p:choice{a|b}=b -- int )");
    expect(t('choice{"a b"|c}="a b"')).toBe('( int p:choice{"a b"|c}="a b" -- int )');
    expect(t('choice{""|c}=""')).toBe('( int p:choice{""|c}="" -- int )');
  });

  test("choice options: quoted specials round trip", () => {
    const e = strict('int p:choice{"a b"|"c|d"|"e{f}"|"g\\"h"|""|i[1]} -- int');
    expect((e.inputs[1] as StackSlot).options).toStrictEqual([
      "a b",
      "c|d",
      "e{f}",
      'g"h',
      "",
      "i[1]",
    ]);
    expect(e.text).toBe('( int p:choice{"a b"|"c|d"|"e{f}"|"g\\"h"|""|i[1]} -- int )');
    expect(strict(e.text.slice(2, -2)).text).toBe(e.text);
  });

  test("bytes: hex digit pairs, whitespace ignored, stored compact lowercase", () => {
    expect(d('bytes="de AD\\nbe"')).toBe("deadbe");
    expect(d('bytes=""')).toBe("");
    expect(d('bytes[2]="00ff"')).toBe("00ff");
    expect(t('bytes="de AD"')).toBe('( int p:bytes="dead" -- int )');
  });

  test("toggle and key: {value, enc} with the first-listed encoding", () => {
    expect(d('toggle{hex}[2]="00ff"')).toStrictEqual({ value: "00ff", enc: "hex" });
    expect(d('key{utf8|hex}="abc"')).toStrictEqual({ value: "abc", enc: "utf8" });
    expect(d('key{latin1}="\\xe9"')).toStrictEqual({ value: "\u00e9", enc: "latin1" });
    expect(d('key{base64}[3]="YWJj"')).toStrictEqual({ value: "YWJj", enc: "base64" });
    expect(d('key{base64}[2]="YWI="')).toStrictEqual({ value: "YWI=", enc: "base64" });
    expect(d('key{base64}[1]="YQ=="')).toStrictEqual({ value: "YQ==", enc: "base64" });
    expect(d('key{base64}[1]="YQ"')).toStrictEqual({ value: "YQ", enc: "base64" });
    expect(d('key="abc"')).toStrictEqual({ value: "abc", enc: "utf8" });
    expect(t('key{hex}[2]="00 11"')).toBe('( int p:key{hex}[2]="00 11" -- int )');
  });

  test("bare toggle and key mean the four encodings, rendered bare", () => {
    const e = strict("bytes k:key iv:toggle[8] -- bytes");
    expect(e.inputs[1]).toStrictEqual({
      name: "k",
      type: "key",
      options: ["utf8", "hex", "latin1", "base64"],
    });
    expect(e.text).toBe("( bytes k:key iv:toggle[8] -- bytes )");
    expect(strict("bytes k:key{utf8|hex|latin1|base64} --").text).toBe("( bytes k:key -- )");
    expect(strict("bytes k:key{hex|utf8|latin1|base64} --").text).toBe(
      "( bytes k:key{hex|utf8|latin1|base64} -- )",
    );
  });

  test("canonical text parses back to itself", () => {
    const headers = [
      "str amount:int[1..25]=13 -- str",
      'bytes key:key{hex|utf8}[16|24|32]="000102030405060708090a0b0c0d0e0f" iv:toggle{hex}[16] mode:choice{cbc|ctr|gcm}=cbc -- bytes',
      'str x:num[0.5..9]=1 y:str[2..4,/[a-z]+/]="ab" z:bool=true w:bytes="dead" -- list r:str',
      'int m:choice{"a b"|"c"}="a b" cs:charset[1..4]="xyz" rx:regex="a+" -- ..',
      ".. a b:int -- c",
    ];
    for (const h of headers) {
      const e = lenient(h);
      const inner = e.text.slice(2, -2);
      const again = lenient(inner);
      expect(again).toStrictEqual(e);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// parseHeader: E_HEADER
// ---------------------------------------------------------------------------------------------

describe("parseHeader: E_HEADER", () => {
  // [header text, mode, the offending item]; the error must be E_HEADER at the start of the item.
  const cases: [string, "strict" | "lenient", string][] = [
    // structure
    ["int p:int -- int -- int", "strict", "--"],
    ["int p:wat -- int", "strict", "p:wat"],
    ["int p:int2 -- int", "strict", "p:int2"],
    ["int p: -- int", "strict", "p:"],
    ["int p:intx -- int", "strict", "p:intx"],
    ["int p=3 -- int", "strict", "p=3"],
    ["int p:int[5..1] -- int", "strict", "p:int[5..1]"],
    ["int p:choice{a|b}=c -- int", "strict", "p:choice{a|b}=c"],
    ["int int -- int", "strict", "int"],
    ["int a -- int", "strict", "a"],
    ["p:int=3 -- int", "strict", "p:int=3"],
    ["int p:int p:int -- int", "strict", "p:int"],
    ["a a -- int", "lenient", "a"],
    ["int recurse:int -- int", "strict", "recurse:int"],
    ["a true -- int", "lenient", "true"],
    ["-- false", "strict", "false"],
    ["-- true:int", "strict", "true:int"],
    ["int P:int -- int", "strict", "P:int"],
    ["int 1x:int -- int", "strict", "1x:int"],
    ['int "x" -- int', "strict", '"x"'],
    ["-- Int", "strict", "Int"],
    // variadics
    [".. -- int", "strict", ".."],
    ["int .. -- int", "lenient", ".."],
    ["int .. int -- int", "strict", ".."],
    ["-- int ..", "strict", ".."],
    ["-- .. int", "strict", ".."],
    ["-- .. ..", "strict", ".."],
    // outputs
    ["int -- x:int[1..2]", "strict", "x:int[1..2]"],
    ["int -- x:int=3", "strict", "x:int=3"],
    ["int -- x:choice{a}", "strict", "x:choice{a}"],
    ["int -- x:wat", "strict", "x:wat"],
    ["int -- x=1", "strict", "x=1"],
    ["int -- int[1]", "strict", "int[1]"],
    // constraints
    ["int p:int[..] -- int", "strict", "p:int[..]"],
    ["int p:int[] -- int", "strict", "p:int[]"],
    ["int p:int[1,2] -- int", "strict", "p:int[1,2]"],
    ["int p:int[1..2,3..4] -- int", "strict", "p:int[1..2,3..4]"],
    ["int p:int[1..2,] -- int", "strict", "p:int[1..2,]"],
    ["int p:int[1.5] -- int", "strict", "p:int[1.5]"],
    ["int p:int[1..2.5] -- int", "strict", "p:int[1..2.5]"],
    ["int p:int[9007199254740993] -- int", "strict", "p:int[9007199254740993]"],
    ["int p:int[-9007199254740993..0] -- int", "strict", "p:int[-9007199254740993..0]"],
    ["int p:str[-1..2] -- int", "strict", "p:str[-1..2]"],
    ["int p:list[-1] -- int", "strict", "p:list[-1]"],
    ["int p:num[1|2] -- int", "strict", "p:num[1|2]"],
    ["int p:num[a] -- int", "strict", "p:num[a]"],
    ["int p:num[1e999] -- int", "strict", "p:num[1e999]"],
    ["int p:int[1__0] -- int", "strict", "p:int[1__0]"],
    ["int p:int[1|] -- int", "strict", "p:int[1|]"],
    ["int p:int[1 ..2] -- int", "strict", "p:int[1 ..2]"],
    ["int p:int[1...5] -- int", "strict", "p:int[1...5]"],
    ["int p:bool[1] -- int", "strict", "p:bool[1]"],
    ["int p:choice{a}[1] -- int", "strict", "p:choice{a}[1]"],
    ["int p:any[1] -- int", "strict", "p:any[1]"],
    ["int p:regex[1] -- int", "strict", "p:regex[1]"],
    ["int p:number[1] -- int", "strict", "p:number[1]"],
    ["int p:int[/a/] -- int", "strict", "p:int[/a/]"],
    ["int p:charset[/a/] -- int", "strict", "p:charset[/a/]"],
    ["int p:str[/a/,/b/] -- int", "strict", "p:str[/a/,/b/]"],
    ["int p:str[/a b/] -- int", "strict", "p:str[/a b/]"],
    ['int p:str[/a"b/] -- int', "strict", 'p:str[/a"b/]'],
    ["int p:str[/(/] -- int", "strict", "p:str[/(/]"],
    ["int p:str[/a/x] -- int", "strict", "p:str[/a/x]"],
    ["int p:str[/abc/] -- int", "strict", "p:str[/abc/]"], // with maxRegexLength 2 below
    ["int p:str[/a -- int", "strict", "p:str[/a"],
    ["int p:str[/a\\/ -- int", "strict", "p:str[/a\\/"],
    ["int p:int[1..2]x -- int", "strict", "p:int[1..2]x"],
    // options
    ["int p:int{a} -- int", "strict", "p:int{a}"],
    ["int p:choice -- int", "strict", "p:choice"],
    ["int p:choice=a -- int", "strict", "p:choice=a"],
    ["int p:choice{} -- int", "strict", "p:choice{}"],
    ["int p:choice{a||b} -- int", "strict", "p:choice{a||b}"],
    ["int p:choice{a|} -- int", "strict", "p:choice{a|}"],
    ["int p:choice{a b} -- int", "strict", "p:choice{a b}"],
    ["int p:choice{a{b} -- int", "strict", "p:choice{a{b}"],
    ['int p:choice{"a"b} -- int', "strict", 'p:choice{"a"b}'],
    ["int p:key{rot13} -- int", "strict", "p:key{rot13}"],
    ["int p:toggle{hex|} -- int", "strict", "p:toggle{hex|}"],
    ["int p:toggle{hex|base32} -- int", "strict", "p:toggle{hex|base32}"],
    // lexical
    ["int p:choice{a|b -- int", "strict", "p:choice{a|b"],
    ["int p:int[1..2 -- int", "strict", "p:int[1..2"],
    ["int p:int] -- int", "strict", "p:int]"],
    ["int p:int} -- int", "strict", "p:int}"],
    ['int s:str="abc -- int', "strict", 's:str="abc'],
    ['int s:str="abc\\" -- int', "strict", 's:str="abc\\"'],
    ['int s:str="\\q" -- int', "strict", 's:str="\\q"'],
    ['int s:str="\\xZZ" -- int', "strict", 's:str="\\xZZ"'],
    ['int s:str="\\x4" -- int', "strict", 's:str="\\x4"'],
    ['int s:str="\\u41" -- int', "strict", 's:str="\\u41"'],
    ['int s:str="\\u{}" -- int', "strict", 's:str="\\u{}"'],
    ['int s:str="\\u{110000}" -- int', "strict", 's:str="\\u{110000}"'],
    ['int s:str="\\u{D800}" -- int', "strict", 's:str="\\u{D800}"'],
    ['int s:str="\\u{1234567}" -- int', "strict", 's:str="\\u{1234567}"'],
    ['int s:str="a" "b" -- int', "strict", '"b"'],
    // defaults
    ["int p:str=abc -- int", "strict", "p:str=abc"],
    ['int p:str="a"b -- int', "strict", 'p:str="a"b'],
    ["int p:str= -- int", "strict", "p:str="],
    ['int p:int="1" -- int', "strict", 'p:int="1"'],
    ["int p:int=1.5 -- int", "strict", "p:int=1.5"],
    ["int p:int=x -- int", "strict", "p:int=x"],
    ["int p:int=9007199254740993 -- int", "strict", "p:int=9007199254740993"],
    ["int p:int[0..5]=9 -- int", "strict", "p:int[0..5]=9"],
    ["int p:int[1|3]=2 -- int", "strict", "p:int[1|3]=2"],
    ["int p:num=x -- int", "strict", "p:num=x"],
    ["int p:num[0..1]=2 -- int", "strict", "p:num[0..1]=2"],
    ["int p:bool=yes -- int", "strict", "p:bool=yes"],
    ["int p:bool=1 -- int", "strict", "p:bool=1"],
    ['int p:str[3]="ab" -- int', "strict", 'p:str[3]="ab"'],
    ['int p:str[/a+/]="b" -- int', "strict", 'p:str[/a+/]="b"'],
    ['int p:regex="(" -- int', "strict", 'p:regex="("'],
    ['int p:charset="aa" -- int', "strict", 'p:charset="aa"'],
    ['int p:charset="" -- int', "strict", 'p:charset=""'],
    ['int p:charset[2]="abc" -- int', "strict", 'p:charset[2]="abc"'],
    ["int p:choice{a|b}=c -- int", "lenient", "p:choice{a|b}=c"],
    ['int p:choice{a|b}="c" -- int', "strict", 'p:choice{a|b}="c"'],
    ["int p:any=1 -- int", "strict", "p:any=1"],
    ["int p:number=1 -- int", "strict", "p:number=1"],
    ["int p:list=1 -- int", "strict", "p:list=1"],
    ["int p:quot=1 -- int", "strict", "p:quot=1"],
    ["int p:record=1 -- int", "strict", "p:record=1"],
    ["int p:file=1 -- int", "strict", "p:file=1"],
    ['int p:bytes="xyz" -- int', "strict", 'p:bytes="xyz"'],
    ['int p:bytes="abc" -- int', "strict", 'p:bytes="abc"'],
    ["int p:bytes=7 -- int", "strict", "p:bytes=7"],
    ['int p:bytes[1]="0000" -- int', "strict", 'p:bytes[1]="0000"'],
    ['int p:key{hex}="zz" -- int', "strict", 'p:key{hex}="zz"'],
    ['int p:key{hex}[2]="00" -- int', "strict", 'p:key{hex}[2]="00"'],
    ['int p:key{latin1}="\\u{100}" -- int', "strict", 'p:key{latin1}="\\u{100}"'],
    ['int p:key{base64}="ab!c" -- int', "strict", 'p:key{base64}="ab!c"'],
    ['int p:key{base64}="a" -- int', "strict", 'p:key{base64}="a"'],
    ["int p:toggle{utf8}=1 -- int", "strict", "p:toggle{utf8}=1"],
  ];

  test.each(cases)("%s (%s)", (text, mode, item) => {
    const limits =
      item === "p:str[/abc/]" ? { ...DEFAULT_LIMITS, maxRegexLength: 2 } : DEFAULT_LIMITS;
    const e = headerError(text, mode, P0, limits);
    expect(e.code).toBe("E_HEADER");
    expect(e.detail.item).toBe(item);
    const index = text.indexOf(item);
    expect(index).toBeGreaterThanOrEqual(0);
    // The reported item is the LAST occurrence only for the repeated cases below.
    expect(e.pos).toStrictEqual({ offset: e.pos?.offset, line: 1, col: (e.pos?.offset ?? 0) + 1 });
    expect(text.slice(e.pos?.offset ?? 0).startsWith(item)).toBe(true);
    expect(e.message).toMatch(/^invalid header: /);
  });

  test("the first offending item in text order is reported", () => {
    // p:wat comes before the unterminated string, even though the string is a lexical error
    const e = headerError('int p:wat q:str="abc -- int');
    expect(e.detail.item).toBe("p:wat");
    expect(e.pos?.col).toBe(5);
    // a wrong item before a missing '--' is reported rather than the missing '--'
    expect(headerError("int p:wat").pos?.col).toBe(5);
  });

  test("a second -- is reported at the second", () => {
    expect(headerError("int -- int -- int").pos).toStrictEqual({ offset: 11, line: 1, col: 12 });
  });

  test("a missing -- is reported at the start of the header text", () => {
    const e = headerError("  int p:int", "strict", { offset: 40, line: 7, col: 9 });
    expect(e.code).toBe("E_HEADER");
    expect(e.pos).toStrictEqual({ offset: 40, line: 7, col: 9 });
    expect(headerError("").pos).toStrictEqual(P0);
    expect(headerError("   ").detail.item).toBe("");
  });

  test("positions are computed from pos, across LF, CRLF and CR", () => {
    const start: SourcePos = { offset: 100, line: 5, col: 8 };
    // same line
    expect(headerError("int p:wat --", "strict", start).pos).toStrictEqual({
      offset: 104,
      line: 5,
      col: 12,
    });
    // after LF
    expect(headerError("int\n  p:wat --", "strict", start).pos).toStrictEqual({
      offset: 106,
      line: 6,
      col: 3,
    });
    // after CRLF (one line break)
    expect(headerError("int\r\n  p:wat --", "strict", start).pos).toStrictEqual({
      offset: 107,
      line: 6,
      col: 3,
    });
    // after a lone CR
    expect(headerError("int\r  p:wat --", "strict", start).pos).toStrictEqual({
      offset: 106,
      line: 6,
      col: 3,
    });
    // several breaks of each kind
    expect(headerError("a\nb\r\nc\rd p:wat --", "lenient", start).pos).toStrictEqual({
      offset: 109,
      line: 8,
      col: 3,
    });
    // columns count UTF-16 code units
    expect(headerError('int a:str="\u{1f600}" x:wat --', "lenient", start).pos).toStrictEqual({
      offset: 115,
      line: 5,
      col: 23,
    });
  });

  test("strict versus lenient", () => {
    expect(lenient("a b -- c").text).toBe("( a b -- c )");
    expect(headerError("a b -- c", "strict").detail.item).toBe("b");
    expect(lenient(".. --").variadicInput).toBe(true);
    expect(headerError(".. --", "strict").code).toBe("E_HEADER");
  });

  test("default limits apply when none are passed", () => {
    const long = `a:str[/${"x".repeat(1025)}/] --`;
    expect(headerError(long).code).toBe("E_HEADER");
    expect(() => parseHeader(`a:str[/${"x".repeat(1024)}/] --`, P0, "strict")).not.toThrow();
  });

  test("a pattern of any length is bounded in code points, not UTF-16 units", () => {
    const limits = { ...DEFAULT_LIMITS, maxRegexLength: 2 };
    expect(
      parseHeader("a:str[/\u{1f600}\u{1f600}/] --", P0, "strict", limits).inputs[0],
    ).toMatchObject({
      constraint: { pattern: "\u{1f600}\u{1f600}" },
    });
  });

  test("a lone surrogate in a utf8 default is rejected", () => {
    const e = headerError('int p:key{utf8}="\ud800" -- int');
    expect(e.code).toBe("E_HEADER");
  });
});

// ---------------------------------------------------------------------------------------------
// Canonical text
// ---------------------------------------------------------------------------------------------

describe("canonical text", () => {
  test("slotText", () => {
    expect(slotText({ name: null, type: "bytes" })).toBe("bytes");
    expect(slotText({ name: null, type: "any" })).toBe("any");
    expect(slotText({ name: "x", type: "any" })).toBe("x");
    expect(slotText({ name: "n", type: "int", constraint: { min: 0, max: 25 }, default: 13 })).toBe(
      "n:int[0..25]=13",
    );
    expect(slotText({ name: "n", type: "num", default: 2 })).toBe("n:num=2.0");
    expect(slotText({ name: "n", type: "str", constraint: { pattern: "a+" }, default: "a" })).toBe(
      'n:str[/a+/]="a"',
    );
    expect(slotText({ name: "m", type: "choice", options: ["a", "b c"], default: "b c" })).toBe(
      'm:choice{a|"b c"}="b c"',
    );
    expect(
      slotText({ name: "k", type: "key", options: ["hex"], default: { value: "00", enc: "hex" } }),
    ).toBe('k:key{hex}="00"');
    expect(slotText({ name: "b", type: "bool", default: false })).toBe("b:bool=false");
  });

  test("effectText", () => {
    const i: StackSlot = { name: null, type: "int" };
    const base = { inputs: [i], outputs: [i], unchecked: false, variadicInput: false };
    expect(effectText(base)).toBe("( int -- int )");
    expect(effectText({ ...base, inputs: [], outputs: [] })).toBe("( -- )");
    expect(effectText({ ...base, unchecked: true, outputs: [] })).toBe("( int -- .. )");
    expect(effectText({ ...base, variadicInput: true })).toBe("( .. int -- int )");
  });
});

// ---------------------------------------------------------------------------------------------
// WordMetaBuilder
// ---------------------------------------------------------------------------------------------

const ROT_TEXT =
  ': rot ( bytes amount:int[0..25]=13 -- bytes )\n  "Rotate each ASCII letter by a fixed amount; other bytes pass through." doc\n  "Classical ciphers" category\n  [ amount _rot-code ] map ;';

function rotBuilder(extra: Partial<WordMetaInit> = {}): WordMetaBuilder {
  return new WordMetaBuilder({
    name: "rot",
    vocab: "classical",
    kind: "fl",
    effect: strict("bytes amount:int[0..25]=13 -- bytes"),
    source: { unit: null, text: ROT_TEXT, pos: { offset: 0, line: 1, col: 1 } },
    ...extra,
  });
}

function metaError(fn: () => void): ForgeError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ForgeError);
    return e as ForgeError;
  }
  throw new Error("expected an error");
}

describe("WordMetaBuilder: classical:rot (spec 15.1)", () => {
  const SPEC_JSON = `{
  "name": "rot", "vocab": "classical", "qname": "classical:rot",
  "kind": "fl", "exported": true, "op": true,
  "effect": {
    "inputs": [
      { "name": null, "type": "bytes" },
      { "name": "amount", "type": "int", "constraint": { "min": 0, "max": 25 }, "default": 13, "doc": "Shift (13 = ROT13)" }
    ],
    "outputs": [ { "name": null, "type": "bytes" } ],
    "unchecked": false,
    "variadicInput": false,
    "text": "( bytes amount:int[0..25]=13 -- bytes )"
  },
  "params": [
    { "name": "amount", "type": "int", "index": 1, "required": false,
      "constraint": { "min": 0, "max": 25 }, "default": 13, "doc": "Shift (13 = ROT13)" }
  ],
  "category": "Classical ciphers",
  "doc": "Rotate each ASCII letter by a fixed amount; other bytes pass through.",
  "aliases": ["rot13"],
  "seeAlso": ["classical:atbash"],
  "effects": [],
  "version": "1",
  "hash": "<64 hex digits>",
  "source": { "unit": null, "text": ": rot ( bytes amount:int[0..25]=13 -- bytes ) …", "pos": { "offset": 0, "line": 1, "col": 1 } }
}`;

  function buildRot(): WordMeta {
    const b = rotBuilder();
    b.declare("doc", "Rotate each ASCII letter by a fixed amount; other bytes pass through.", {
      offset: 50,
      line: 2,
      col: 3,
    });
    b.declare("category", "Classical ciphers");
    b.clauseFromArgs("param", [
      { type: "name", text: "amount" },
      { type: "str", value: "Shift (13 = ROT13)" },
    ]);
    b.clauseFromArgs("alias", [{ type: "name", text: "rot13" }]);
    b.clauseFromArgs("see-also", [{ type: "name", text: "classical:atbash" }]);
    const hash = computeHash(
      ownText({
        kind: "fl",
        qname: "classical:rot",
        effectText: "",
        version: "1",
        sourceText: ROT_TEXT,
      }),
      [],
    );
    return checked(b.build(hash));
  }

  test("matches the spec JSON except for the hash and the abridged source text", () => {
    const meta = buildRot();
    const expected = JSON.parse(SPEC_JSON) as Record<string, unknown>;
    expect(meta.hash).toMatch(/^[0-9a-f]{64}$/);
    expected.hash = meta.hash;
    (expected.source as { text: string }).text = ROT_TEXT;
    expect(JSON.parse(JSON.stringify(meta))).toStrictEqual(expected);
  });

  test("help output (C95)", () => {
    expect(renderHelp(buildRot()).split("\n")).toStrictEqual([
      "classical:rot  ( bytes amount:int[0..25]=13 -- bytes )",
      "Rotate each ASCII letter by a fixed amount; other bytes pass through.",
      "category: Classical ciphers",
      "aliases: rot13",
      "see also: classical:atbash",
      "parameters:",
      "  amount:int[0..25]=13  -- Shift (13 = ROT13)",
      "",
    ]);
  });

  test("see returns the source text (C96)", () => {
    const meta = buildRot();
    expect(renderSee(meta)).toBe(`${ROT_TEXT}\n`);
  });

  test("clauses may arrive in any order, from META: blocks, with positions", () => {
    const b = rotBuilder();
    b.clause({ kind: "version", text: "2" }, { offset: 1, line: 1, col: 2 });
    b.clause({ kind: "category", text: "C" });
    b.clause({ kind: "doc", text: "D" });
    b.clause({ kind: "param", name: "amount", text: "A" });
    b.clause({ kind: "alias", names: ["r1", "r2", "r1"] });
    b.clause({ kind: "see-also", names: ["x", "o:y", "x", "o:y"] });
    const m = checked(b.build("0".repeat(64)));
    expect(m).toMatchObject({
      version: "2",
      category: "C",
      doc: "D",
      aliases: ["r1", "r2"],
      seeAlso: ["classical:x", "o:y"],
    });
  });
});

describe("WordMetaBuilder: record rules", () => {
  const hash = "a".repeat(64);

  test("defaults: nothing set", () => {
    const m = checked(rotBuilder({ source: undefined }).build(hash));
    expect(m).toMatchObject({
      category: null,
      doc: null,
      aliases: [],
      seeAlso: [],
      effects: [],
      version: "1",
      source: { unit: null, text: null, pos: null },
      exported: true,
      op: true,
    });
    expect(m.params[0]).toStrictEqual({
      name: "amount",
      type: "int",
      index: 1,
      required: false,
      constraint: { min: 0, max: 25 },
      default: 13,
    });
    expect(m.effect.inputs[1]).not.toHaveProperty("doc");
  });

  test("required parameters, anonymous parameters and the data input", () => {
    const eff = lenient("a:str int p:int q:key{hex} -- int");
    const m = checked(
      new WordMetaBuilder({ name: "w", vocab: "v", kind: "primitive", effect: eff }).build(hash),
    );
    // inputs[0] (named) is the data input, not a parameter; the anonymous input has no ParamSpec
    expect(m.params.map((p) => [p.name, p.index, p.required])).toStrictEqual([
      ["p", 2, true],
      ["q", 3, true],
    ]);
    expect(m.kind).toBe("primitive");
  });

  test("op: public, not in core, with an input; override allowed", () => {
    const mk = (init: Partial<WordMetaInit>): boolean =>
      checked(
        new WordMetaBuilder({
          name: "w",
          vocab: "v",
          kind: "fl",
          effect: strict("int -- int"),
          ...init,
        }).build(hash),
      ).op;
    expect(mk({})).toBe(true);
    expect(mk({ vocab: "core" })).toBe(false);
    expect(mk({ name: "_w" })).toBe(false);
    expect(mk({ effect: strict("-- int") })).toBe(false);
    expect(mk({ op: false })).toBe(false);
    expect(mk({ vocab: "core", op: true })).toBe(true);
  });

  test("private words: declarations allowed, META: clauses are E_META", () => {
    const b = new WordMetaBuilder({
      name: "_h",
      vocab: "v",
      kind: "fl",
      effect: strict("int -- int"),
    });
    b.declare("doc", "helper");
    const m = checked(b.build(hash));
    expect(m.exported).toBe(false);
    expect(m.doc).toBe("helper");
    const e = metaError(() => b.clause({ kind: "doc", text: "x" }, { offset: 3, line: 2, col: 1 }));
    expect(e.code).toBe("E_META");
    expect(e.word).toBe("v:_h");
    expect(e.vocab).toBe("v");
    expect(e.pos).toStrictEqual({ offset: 3, line: 2, col: 1 });
    expect(e.detail.clause).toBe("doc");
    expect(metaError(() => b.clauseFromArgs("alias", [{ type: "name", text: "z" }])).code).toBe(
      "E_META",
    );
  });

  test("effects are sorted and deduplicated", () => {
    const m = checked(rotBuilder({ effects: ["+time", "+async", "+time", "+random"] }).build(hash));
    expect(m.effects).toStrictEqual(["+async", "+random", "+time"]);
  });

  test("a primitive's own doc/category/version count as already set", () => {
    const mk = (): WordMetaBuilder =>
      rotBuilder({ kind: "primitive", doc: "d", category: "c", version: "3" });
    const m = checked(mk().build(hash));
    expect(m).toMatchObject({ doc: "d", category: "c", version: "3" });
    for (const k of ["doc", "category", "version"] as const) {
      expect(metaError(() => mk().clause({ kind: k, text: "again" })).code).toBe("E_META");
    }
    // null and absent values are not "set"
    const free = rotBuilder({ doc: null, category: null });
    free.clause({ kind: "doc", text: "ok" });
    free.clause({ kind: "category", text: "ok" });
    free.clause({ kind: "version", text: "ok" });
    expect(checked(free.build(hash))).toMatchObject({ doc: "ok", category: "ok", version: "ok" });
  });

  test("source info is carried over", () => {
    const m = checked(
      rotBuilder({ source: { unit: "U", text: "t", pos: { offset: 4, line: 2, col: 1 } } }).build(
        hash,
      ),
    );
    expect(m.source).toStrictEqual({ unit: "U", text: "t", pos: { offset: 4, line: 2, col: 1 } });
  });
});

describe("WordMetaBuilder: E_META and friends", () => {
  const pos: SourcePos = { offset: 9, line: 3, col: 4 };

  test("a singular field may be set once across declarations and clauses (C98)", () => {
    for (const k of ["doc", "category"] as const) {
      const b = rotBuilder();
      b.declare(k, "one");
      const e = metaError(() => b.clause({ kind: k, text: "two" }, pos));
      expect(e).toMatchObject({ code: "E_META", word: "classical:rot", vocab: "classical", pos });
      expect(e.detail.clause).toBe(k);
      expect(metaError(() => b.declare(k, "three")).code).toBe("E_META");
    }
    const b = rotBuilder();
    b.clause({ kind: "version", text: "2" });
    expect(metaError(() => b.clause({ kind: "version", text: "3" })).code).toBe("E_META");
  });

  test("string length bounds: doc 2000, everything else 200, in code points", () => {
    const b = rotBuilder();
    expect(() => b.declare("doc", "x".repeat(2000))).not.toThrow();
    expect(metaError(() => rotBuilder().declare("doc", "x".repeat(2001))).code).toBe("E_META");
    expect(() => rotBuilder().declare("category", "\u{1f600}".repeat(200))).not.toThrow();
    expect(metaError(() => rotBuilder().declare("category", "x".repeat(201))).code).toBe("E_META");
    expect(
      metaError(() => rotBuilder().clause({ kind: "version", text: "x".repeat(201) })).code,
    ).toBe("E_META");
    expect(() =>
      rotBuilder().clause({ kind: "param", name: "amount", text: "x".repeat(200) }),
    ).not.toThrow();
    expect(
      metaError(() => rotBuilder().clause({ kind: "param", name: "amount", text: "x".repeat(201) }))
        .detail,
    ).toStrictEqual({ clause: "param", name: "amount" });
  });

  test("param must name an existing parameter, once", () => {
    const b = rotBuilder();
    expect(
      metaError(() => b.clause({ kind: "param", name: "nosuch", text: "x" }, pos)).detail,
    ).toStrictEqual({
      clause: "param",
      name: "nosuch",
    });
    // the data input is not a parameter
    const d = new WordMetaBuilder({
      name: "w",
      vocab: "v",
      kind: "fl",
      effect: strict("text:str n:int -- str"),
    });
    expect(metaError(() => d.clause({ kind: "param", name: "text", text: "x" })).code).toBe(
      "E_META",
    );
    d.clause({ kind: "param", name: "n", text: "x" });
    expect(metaError(() => d.clause({ kind: "param", name: "n", text: "y" })).code).toBe("E_META");
  });

  test("alias: valid, unreserved, not already defined", () => {
    const taken = new Set(["taken"]);
    const mk = (): WordMetaBuilder => rotBuilder({ isNameTaken: (n) => taken.has(n) });
    for (const bad of ["bad:name", "recurse", "true", "1x", "", "a b"]) {
      const e = metaError(() => mk().clause({ kind: "alias", names: [bad] }, pos));
      expect(e.code, bad).toBe("E_NAME");
      expect(e.detail.name).toBe(bad);
    }
    const e = metaError(() => mk().clause({ kind: "alias", names: ["taken"] }, pos));
    expect(e).toMatchObject({ code: "E_REDEFINED", pos });
    expect(e.detail.name).toBe("taken");
    // an alias equal to the word itself is already defined
    expect(metaError(() => mk().clause({ kind: "alias", names: ["rot"] })).code).toBe(
      "E_REDEFINED",
    );
    // no collision callback: only the word's own name collides
    const b = rotBuilder();
    b.clause({ kind: "alias", names: ["a", "b"] });
    b.clause({ kind: "alias", names: ["b", "c"] });
    expect(b.build("0".repeat(64)).aliases).toStrictEqual(["a", "b", "c"]);
  });

  test("see-also: names are qualified with the word's vocabulary", () => {
    const b = rotBuilder();
    b.clause({ kind: "see-also", names: ["atbash", "core:rot", "classical:atbash"] });
    expect(checked(b.build("0".repeat(64))).seeAlso).toStrictEqual([
      "classical:atbash",
      "core:rot",
    ]);
    for (const bad of ["a:b:c", ":x", "x:", "9v:x", "a b", "", "v:a b", "v:1+"]) {
      const e = metaError(() => rotBuilder().clause({ kind: "see-also", names: [bad] }, pos));
      expect(e.code, bad).toBe("E_META");
      expect(e.detail).toStrictEqual({ clause: "see-also", name: bad });
    }
  });
});

describe("WordMetaBuilder.clauseFromArgs", () => {
  const s = (value: string): ClauseArg => ({ type: "str", value });
  const n = (text: string): ClauseArg => ({ type: "name", text });
  const pos: SourcePos = { offset: 1, line: 2, col: 3 };
  const bad = (keyword: string, args: ClauseArg[]): ForgeError =>
    metaError(() => rotBuilder().clauseFromArgs(keyword, args, pos));

  test("well-formed clauses reach the right field", () => {
    const b = rotBuilder();
    b.clauseFromArgs("doc", [s("D")]);
    b.clauseFromArgs("category", [s("C")]);
    b.clauseFromArgs("version", [s("9")]);
    b.clauseFromArgs("param", [n("amount"), s("A")]);
    b.clauseFromArgs("alias", [n("x"), n("y")]);
    b.clauseFromArgs("see-also", [n("p"), n("q:r")]);
    expect(checked(b.build("0".repeat(64)))).toMatchObject({
      doc: "D",
      category: "C",
      version: "9",
      aliases: ["x", "y"],
      seeAlso: ["classical:p", "q:r"],
    });
  });

  test("unknown clause words are E_META (C171)", () => {
    const e = bad("bogus", [n("x")]);
    expect(e).toMatchObject({ code: "E_META", pos, word: "classical:rot" });
    expect(e.detail.clause).toBe("bogus");
  });

  test("wrong arity or argument kinds are E_META", () => {
    expect(bad("doc", []).code).toBe("E_META");
    expect(bad("doc", [s("a"), s("b")]).code).toBe("E_META");
    expect(bad("doc", [n("a")]).code).toBe("E_META");
    expect(bad("doc", [s("a"), n("b")]).code).toBe("E_META");
    expect(bad("version", [n("a")]).code).toBe("E_META");
    expect(bad("param", [n("amount")]).code).toBe("E_META");
    expect(bad("param", [s("A"), n("amount")]).code).toBe("E_META");
    expect(bad("param", [n("amount"), s("A"), s("B")]).code).toBe("E_META");
    expect(bad("param", [n("a"), n("b")]).code).toBe("E_META");
    expect(bad("alias", []).code).toBe("E_META");
    expect(bad("alias", [s("x")]).code).toBe("E_META");
    expect(bad("see-also", [n("x"), s("y")]).code).toBe("E_META");
  });
});

// ---------------------------------------------------------------------------------------------
// Hash
// ---------------------------------------------------------------------------------------------

describe("hash", () => {
  const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

  test("ownText by kind", () => {
    const base = {
      qname: "v:w",
      effectText: "( int -- int )",
      version: "1",
      sourceText: ": w ( int -- int ) ;",
    };
    expect(ownText({ ...base, kind: "fl" })).toBe(": w ( int -- int ) ;");
    expect(ownText({ ...base, kind: "constant", sourceText: "1 CONSTANT w" })).toBe("1 CONSTANT w");
    expect(ownText({ ...base, kind: "variable", sourceText: "1 VARIABLE w" })).toBe("1 VARIABLE w");
    expect(ownText({ ...base, kind: "primitive", version: "2" })).toBe(
      "primitive v:w ( int -- int ) 2",
    );
    expect(ownText({ ...base, kind: "intrinsic", sourceText: null })).toBe(
      "intrinsic v:w ( int -- int ) 1",
    );
    expect(ownText({ ...base, kind: "fl", sourceText: null })).toBe("");
  });

  test("no dependencies: own text plus a newline", () => {
    expect(computeHash("abc", [])).toBe(sha("abc\n"));
  });

  test("dependencies: sorted by qname, joined by newline, deduplicated", () => {
    const a = { qname: "a:x", hash: "1".repeat(64) };
    const b = { qname: "b:x", hash: "2".repeat(64) };
    const expected = sha(`own\n${a.qname} ${a.hash}\n${b.qname} ${b.hash}`);
    expect(computeHash("own", [b, a])).toBe(expected);
    expect(computeHash("own", [a, b, a])).toBe(expected);
  });

  test("the word itself is excluded", () => {
    const a = { qname: "a:x", hash: "1".repeat(64) };
    const self = { qname: "v:me", hash: "9".repeat(64) };
    expect(computeHash("own", [a, self], "v:me")).toBe(computeHash("own", [a]));
    expect(computeHash("own", [a, self])).not.toBe(computeHash("own", [a]));
  });

  test("qnames sort by code point, not UTF-16 unit", () => {
    const astral = { qname: "a:\u{10000}", hash: "1".repeat(64) };
    const bmp = { qname: "a:\uffff", hash: "2".repeat(64) };
    expect(computeHash("o", [astral, bmp])).toBe(
      sha(`o\n${bmp.qname} ${bmp.hash}\n${astral.qname} ${astral.hash}`),
    );
  });

  test("transitive: a change anywhere below changes the hash (C169)", () => {
    const word = (qname: string, src: string, deps: { qname: string; hash: string }[]) => ({
      qname,
      hash: computeHash(src, deps, qname),
    });
    const base1 = word("v1:base", ": base ( -- int ) 1 ;", []);
    const base2 = word("v2:base", ": base ( -- int ) 2 ;", []);
    const mid1 = word("v:mid", ": mid ( -- int ) base ;", [base1]);
    const mid2 = word("v:mid", ": mid ( -- int ) base ;", [base2]);
    expect(mid1.hash).not.toBe(mid2.hash);
    const top1 = word("v:top", ": top ( -- int ) mid ;", [mid1]);
    const top2 = word("v:top", ": top ( -- int ) mid ;", [mid2]);
    expect(top1.hash).not.toBe(top2.hash);
    // unchanged inputs: identical hash
    expect(word("v:top", ": top ( -- int ) mid ;", [mid1]).hash).toBe(top1.hash);
  });

  test("a custom hasher can be supplied", () => {
    expect(
      computeHash("x", [{ qname: "a:b", hash: "h" }], undefined, (d) => `<${String(d)}>`),
    ).toBe("<x\na:b h>");
  });

  test("metadata does not change the hash", () => {
    const own = ownText({
      kind: "fl",
      qname: "v:w",
      effectText: "",
      version: "1",
      sourceText: ": w ( -- ) ;",
    });
    expect(computeHash(own, [])).toBe(computeHash(own, []));
  });
});

// ---------------------------------------------------------------------------------------------
// help and see
// ---------------------------------------------------------------------------------------------

describe("renderHelp and renderSee", () => {
  const hash = "b".repeat(64);
  function full(): WordMeta {
    const b = new WordMetaBuilder({
      name: "w",
      vocab: "v",
      kind: "primitive",
      effect: strict("bytes k:key{hex}[16] n:int[1..9]=3 m:choice{a|b} -- bytes"),
      effects: ["+time", "+async"],
    });
    b.declare("doc", "Line one.\nLine two.");
    b.declare("category", "Cat");
    b.clause({ kind: "param", name: "k", text: "The key" });
    b.clause({ kind: "param", name: "n", text: "" });
    b.clause({ kind: "alias", names: ["w2", "w3"] });
    b.clause({ kind: "see-also", names: ["x", "o:y"] });
    return checked(b.build(hash));
  }

  test("every line", () => {
    expect(renderHelp(full())).toBe(
      [
        "v:w  ( bytes k:key{hex}[16] n:int[1..9]=3 m:choice{a|b} -- bytes )",
        "Line one.\nLine two.",
        "category: Cat",
        "aliases: w2, w3",
        "see also: v:x, o:y",
        "effects: +async, +time",
        "parameters:",
        "  k:key{hex}[16]  -- The key",
        "  n:int[1..9]=3",
        "  m:choice{a|b}",
        "",
      ].join("\n"),
    );
  });

  test("lines with an empty source are omitted", () => {
    const m = checked(
      new WordMetaBuilder({ name: "w", vocab: "v", kind: "fl", effect: strict("-- int") }).build(
        hash,
      ),
    );
    expect(renderHelp(m)).toBe("v:w  ( -- int )\n");
    const empties = { ...m, doc: "", category: "" };
    expect(renderHelp(empties)).toBe("v:w  ( -- int )\n");
  });

  test("see by kind", () => {
    const m = full();
    expect(renderSee(m)).toBe(
      "\\ primitive v:w ( bytes k:key{hex}[16] n:int[1..9]=3 m:choice{a|b} -- bytes )\n",
    );
    expect(renderSee({ ...m, kind: "intrinsic", qname: "core:dup" })).toBe(
      "\\ intrinsic core:dup ( bytes k:key{hex}[16] n:int[1..9]=3 m:choice{a|b} -- bytes )\n",
    );
    const src = { unit: null, pos: null, text: "5 CONSTANT five" };
    expect(renderSee({ ...m, kind: "constant", source: src })).toBe("5 CONSTANT five\n");
    expect(renderSee({ ...m, kind: "variable", source: src })).toBe("5 CONSTANT five\n");
    expect(renderSee({ ...m, kind: "fl", source: src })).toBe("5 CONSTANT five\n");
    expect(renderSee({ ...m, kind: "fl", source: { unit: null, pos: null, text: null } })).toBe(
      "\\ fl v:w ( bytes k:key{hex}[16] n:int[1..9]=3 m:choice{a|b} -- bytes )\n",
    );
  });
});

// ---------------------------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------------------------

describe("meta.schema.json", () => {
  const good = (): WordMeta =>
    checked(
      new WordMetaBuilder({
        name: "w",
        vocab: "v",
        kind: "fl",
        effect: strict(
          'bytes k:key{hex}[16]="00112233445566778899aabbccddeeff" t:toggle p:str[1..9,/a+/]="a" -- r:bytes',
        ),
        source: { unit: "u", text: "x", pos: { offset: 0, line: 1, col: 1 } },
      }).build("c".repeat(64)),
    );

  const reject = (mutate: (m: Record<string, unknown>) => void): void => {
    const m = JSON.parse(JSON.stringify(good())) as Record<string, unknown>;
    mutate(m);
    expect(validateSchema(m), JSON.stringify(m)).toBe(false);
  };

  test("is a draft 2020-12 schema", () => {
    expect(WORD_META_SCHEMA.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });

  test("accepts the unusual-but-legal forms", () => {
    const m = good();
    expect(m.params[0]?.default).toStrictEqual({
      value: "00112233445566778899aabbccddeeff",
      enc: "hex",
    });
    // a unicode name, a quoted-option choice and an empty constraint-free any
    const u = checked(
      new WordMetaBuilder({
        name: "\u00e9t\u00e9",
        vocab: "v",
        kind: "constant",
        effect: strict("-- int"),
      }).build("0".repeat(64)),
    );
    expect(u.qname).toBe("v:\u00e9t\u00e9");
  });

  test("rejects extra properties at every level", () => {
    reject((m) => (m.extra = 1));
    reject((m) => ((m.effect as Record<string, unknown>).extra = 1));
    reject((m) => ((m.source as Record<string, unknown>).extra = 1));
    reject((m) => ((m.source as { pos: Record<string, unknown> }).pos.extra = 1));
    reject(
      (m) =>
        ((
          (m.effect as { inputs: Record<string, unknown>[] }).inputs[0] as Record<string, unknown>
        ).extra = 1),
    );
    reject((m) => ((m.params as Record<string, unknown>[])[0]!.extra = 1));
    reject(
      (m) => ((m.params as { constraint: Record<string, unknown> }[])[0]!.constraint.extra = 1),
    );
    reject((m) => ((m.params as { default: Record<string, unknown> }[])[0]!.default.extra = 1));
  });

  test("rejects missing, mistyped and out-of-range fields", () => {
    reject((m) => delete m.hash);
    reject((m) => (m.hash = "ABC"));
    reject((m) => (m.hash = "a".repeat(63)));
    reject((m) => (m.kind = "word"));
    reject((m) => (m.name = "a:b"));
    reject((m) => (m.name = "1+"));
    reject((m) => (m.name = ""));
    reject((m) => (m.vocab = "9v"));
    reject((m) => (m.qname = "nocolon"));
    reject((m) => (m.qname = "v:a:b"));
    reject((m) => (m.doc = "x".repeat(2001)));
    reject((m) => (m.category = "x".repeat(201)));
    reject((m) => (m.version = "x".repeat(201)));
    reject((m) => (m.effects = ["+fast"]));
    reject((m) => (m.effects = ["+time", "+time"]));
    reject((m) => (m.aliases = ["a b"]));
    reject((m) => (m.seeAlso = ["unqualified"]));
    reject((m) => (m.exported = "yes"));
    reject((m) => ((m.params as { index: number }[])[0]!.index = 0));
    reject((m) => ((m.params as { name: unknown }[])[0]!.name = null));
    reject((m) => ((m.params as { type: string }[])[0]!.type = "wat"));
    reject((m) => ((m.params as { doc: string }[])[0]!.doc = "x".repeat(201)));
    reject((m) => ((m.params as { options: string[] }[])[0]!.options = []));
    reject(
      (m) =>
        ((m.params as { constraint: Record<string, unknown> }[])[0]!.constraint.minLength = -1),
    );
    reject((m) => ((m.params as { constraint: unknown }[])[0]!.constraint = {}));
    reject(
      (m) => ((m.params as { default: unknown }[])[0]!.default = { value: "x", enc: "rot13" }),
    );
    reject((m) => ((m.params as { default: unknown }[])[0]!.default = null));
    reject((m) => ((m.effect as { text: unknown }).text = 1));
    reject((m) => ((m.effect as { inputs: { name: unknown }[] }).inputs[0]!.name = "Upper"));
    reject((m) => ((m.source as { pos: { line: number } }).pos.line = 0));
    reject((m) => ((m.source as { pos: unknown }).pos = undefined));
  });
});

describe("discovery clauses: use-when, link, inverse, helper, checks", () => {
  const H = "0".repeat(64);
  const pos = { offset: 3, line: 2, col: 4 };
  const n = (text: string): { type: "name"; text: string } => ({ type: "name", text });
  const s = (value: string): { type: "str"; value: string } => ({ type: "str", value });

  test("no discovery member without the clauses (JSON of existing words is unchanged)", () => {
    const m = rotBuilder().build(H);
    expect("discovery" in m).toBe(false);
    expect(JSON.stringify(m)).not.toContain("discovery");
  });

  test("use-when and link are stored and validate against the schema", () => {
    const b = rotBuilder();
    b.clauseFromArgs("use-when", [s("Shifted letters.")]);
    b.clauseFromArgs("link", [s("https://www.rfc-editor.org/rfc/rfc4648#section-4"), s("RFC")]);
    b.clauseFromArgs("link", [s("https://en.wikipedia.org/wiki/Base64")]);
    b.clauseFromArgs("inverse", [n("rot")]);
    const m = checked(b.build(H));
    expect(m.discovery).toStrictEqual({
      useWhen: "Shifted letters.",
      links: [
        { url: "https://www.rfc-editor.org/rfc/rfc4648#section-4", label: "RFC" },
        { url: "https://en.wikipedia.org/wiki/Base64", label: null },
      ],
      inverse: "classical:rot",
    });
  });

  test("use-when errors", () => {
    const bad = (t: string): ForgeError =>
      metaError(() => rotBuilder().clauseFromArgs("use-when", [s(t)], pos));
    for (const t of ["a\nb", "a\rb", "a\u0001b", " x", "x ", "x".repeat(161), "", " ", "\u00a0 "]) {
      const e = bad(t);
      expect(e.code).toBe("E_META");
      expect(e.detail.clause).toBe("use-when");
    }
    expect(bad("").message).toContain("use-when must not be empty or only white space");
    expect(bad("   ").message).toContain("use-when must not be empty or only white space");
    rotBuilder().clauseFromArgs("use-when", [s("x".repeat(160))]);
    rotBuilder().clauseFromArgs("use-when", [s("x")]);
    const b = rotBuilder();
    b.clauseFromArgs("use-when", [s("one")]);
    expect(metaError(() => b.clauseFromArgs("use-when", [s("two")])).code).toBe("E_META");
    for (const args of [[], [s("a"), s("b")], [n("x")]]) {
      expect(metaError(() => rotBuilder().clauseFromArgs("use-when", args)).code).toBe("E_META");
    }
  });

  test("link URL grammar", () => {
    const ok = [
      "https://example.com",
      "https://a.b-c.example.org:8443/p/q?x=1&y=%2F#frag",
      "https://example.com?x",
      "https://xn--bcher-kva.example/",
    ];
    for (const u of ok) rotBuilder().clauseFromArgs("link", [s(u)]);
    const bad = [
      "http://example.com/a",
      "https://user@example.com/a",
      "https://192.168.0.1/a",
      "https://localhost/a",
      "https://example.com:0/",
      "https://example.com:65536/",
      "https://example.com:/",
      "https://-a.example.com/",
      "https://a-.example.com/",
      "https://example..com/",
      "https://example.com/a b",
      "https://example.com/a<b",
      "https://example.com/a\\b",
      "https://example.com/a|b",
      "https://example.com/%zz",
      "https://example.com/é",
      "https://example.com\u0000",
      "javascript:alert(1)",
      "",
      `https://example.com/${"a".repeat(300)}`,
    ];
    for (const u of bad) {
      const e = metaError(() => rotBuilder().clauseFromArgs("link", [s(u)], pos));
      expect(e.code, u).toBe("E_META");
      expect(e.detail.clause).toBe("link");
      expect(typeof e.detail.reason).toBe("string");
    }
    expect(
      metaError(() => rotBuilder().clauseFromArgs("link", [s(`https://e.com/${"a".repeat(287)}`)]))
        .code,
    ).toBe("E_META");
    rotBuilder().clauseFromArgs("link", [s(`https://e.com/${"a".repeat(286)}`)]);
  });

  test("link label, arity, repeats and the cap of eight", () => {
    for (const label of ["a\nb", "x".repeat(81)]) {
      expect(
        metaError(() => rotBuilder().clauseFromArgs("link", [s("https://a.example/"), s(label)]))
          .code,
      ).toBe("E_META");
    }
    rotBuilder().clauseFromArgs("link", [s("https://a.example/"), s("x".repeat(80))]);
    for (const args of [[], [s("https://a.example/"), s("l"), s("m")], [n("x")]]) {
      expect(metaError(() => rotBuilder().clauseFromArgs("link", args)).code).toBe("E_META");
    }
    const b = rotBuilder();
    b.clauseFromArgs("link", [s("https://a.example/1")]);
    expect(
      metaError(() => b.clauseFromArgs("link", [s("https://a.example/1"), s("again")])).code,
    ).toBe("E_META");
    for (let i = 2; i <= 8; i++) b.clauseFromArgs("link", [s(`https://a.example/${i}`)]);
    const e = metaError(() => b.clauseFromArgs("link", [s("https://a.example/9")]));
    expect(e.code).toBe("E_META");
    expect(e.detail.clause).toBe("link");
    expect(b.build(H).discovery?.links).toHaveLength(8);
  });

  test("inverse: qualification, same vocabulary only, singular, arity", () => {
    const b = rotBuilder();
    b.clauseFromArgs("inverse", [n("atbash")]);
    expect(b.build(H).discovery).toStrictEqual({ inverse: "classical:atbash" });
    const q = rotBuilder();
    q.clauseFromArgs("inverse", [n("classical:atbash")]);
    expect(q.build(H).discovery?.inverse).toBe("classical:atbash");
    expect(metaError(() => rotBuilder().clauseFromArgs("inverse", [n("other:x")])).code).toBe(
      "E_META",
    );
    expect(metaError(() => b.clauseFromArgs("inverse", [n("x")])).code).toBe("E_META");
    for (const args of [[], [n("a"), n("b")], [s("a")]]) {
      expect(metaError(() => rotBuilder().clauseFromArgs("inverse", args)).code).toBe("E_META");
    }
    expect(metaError(() => rotBuilder().clauseFromArgs("inverse", [n("a:b:c")])).code).toBe(
      "E_META",
    );
  });

  test("helper sets op to false, is idempotent, takes no argument", () => {
    const b = rotBuilder();
    expect(rotBuilder().build(H).op).toBe(true);
    b.clauseFromArgs("helper", []);
    b.clauseFromArgs("helper", []);
    const m = checked(b.build(H));
    expect(m.op).toBe(false);
    expect(m.exported).toBe(true);
    expect("discovery" in m).toBe(false);
    expect(metaError(() => rotBuilder().clauseFromArgs("helper", [n("x")])).code).toBe("E_META");
  });

  test("checks and expects are parsed, ranged and accumulated", () => {
    const b = rotBuilder();
    b.clauseFromArgs("checks", [n("input"), n("magic-bytes"), s("1F8B")]);
    b.clauseFromArgs("checks", [n("output"), n("charset"), s("a-z+-"), n("0.5")]);
    b.clauseFromArgs("checks", [n("input"), n("entropy"), n("7"), n("8")]);
    b.clauseFromArgs("checks", [n("input"), n("binary")]);
    b.clauseFromArgs("checks", [n("input"), n("magic-bytes"), n("format"), s("gzip")]);
    b.clauseFromArgs("expects", [s("gzip data")]);
    const m = checked(b.build(H));
    expect(m.discovery).toStrictEqual({
      checks: [
        { scope: "input", test: { kind: "magic-bytes", hex: "1f8b", offset: 0 } },
        { scope: "output", test: { kind: "charset", alphabet: "a-z+-", min: 0.5 } },
        { scope: "input", test: { kind: "entropy", min: 7, max: 8 } },
        { scope: "input", test: { kind: "binary" } },
        { scope: "input", test: { kind: "magic-bytes", format: "gzip" } },
      ],
      expects: "gzip data",
    });
  });

  test("a bad checks clause is E_META with the clause and a reason", () => {
    const e = metaError(() => rotBuilder().clauseFromArgs("checks", [n("both"), n("utf8")], pos));
    expect(e.code).toBe("E_META");
    expect(e.detail).toMatchObject({ clause: "checks" });
    expect(e.pos).toBe(pos);
    const bad = (args: ClauseArg[]): string =>
      metaError(() => rotBuilder().clauseFromArgs("checks", args)).code;
    for (const args of [
      [],
      [n("input")],
      [n("input"), s("utf8")],
      [n("input"), n("utf8"), n("1")],
      [n("input"), n("regex"), s("(")],
      [n("input"), n("regex"), s("a".repeat(1025))],
      [n("input"), n("charset"), s("z-a")],
      [n("input"), n("entropy"), n("9"), n("9")],
      [n("input"), n("printable"), n("0")],
      [n("input"), n("magic-bytes"), s("abc")],
      [n("input"), n("magic-bytes"), s("ab"), n("4096")],
      [n("input"), n("magic-bytes"), n("format"), s("Gzip")],
    ]) {
      expect(bad(args), JSON.stringify(args)).toBe("E_META");
    }
  });

  test("at most eight checks, and expects once", () => {
    const b = rotBuilder();
    for (let i = 0; i < 8; i++) b.clauseFromArgs("checks", [n("input"), n("utf8")]);
    expect(metaError(() => b.clauseFromArgs("checks", [n("input"), n("utf8")])).code).toBe(
      "E_META",
    );
    b.clauseFromArgs("expects", [s("x".repeat(64))]);
    expect(metaError(() => b.clauseFromArgs("expects", [s("y")])).code).toBe("E_META");
    for (const text of ["", " a", "a ", "a\nb", "x".repeat(65)]) {
      expect(metaError(() => rotBuilder().clauseFromArgs("expects", [s(text)])).code, text).toBe(
        "E_META",
      );
    }
  });

  test("the clauses are refused on a private word", () => {
    const priv = (): WordMetaBuilder => rotBuilder({ name: "_rot" });
    for (const [k, a] of [
      ["use-when", [s("x")]],
      ["link", [s("https://a.example/")]],
      ["inverse", [n("x")]],
      ["helper", []],
    ] as const) {
      expect(metaError(() => priv().clauseFromArgs(k, a)).code, k).toBe("E_META");
    }
  });

  test("a builder seeded with earlier discovery keeps it and enforces the rules", () => {
    const b = rotBuilder({
      discovery: { useWhen: "u", links: [{ url: "https://a.example/", label: null }] },
    });
    expect(metaError(() => b.clauseFromArgs("use-when", [s("v")])).code).toBe("E_META");
    expect(metaError(() => b.clauseFromArgs("link", [s("https://a.example/")])).code).toBe(
      "E_META",
    );
    b.clauseFromArgs("link", [s("https://b.example/")]);
    expect(b.build(H).discovery?.links).toHaveLength(2);
  });

  test("renderHelp: use when and links lines only for words that set them", () => {
    const plain = rotBuilder().build(H);
    const b = rotBuilder();
    b.clause({ kind: "category", text: "Ciphers" });
    b.clause({ kind: "alias", names: ["r"] });
    b.clause({ kind: "use-when", text: "You have shifted text." });
    b.clauseFromArgs("link", [s("https://a.example/x"), s("A")]);
    b.clauseFromArgs("link", [s("https://b.example/")]);
    b.clause({ kind: "param", name: "amount", text: "How far." });
    const lines = renderHelp(b.build(H)).split("\n");
    expect(lines).toContain("use when: You have shifted text.");
    expect(lines).toContain("links: https://a.example/x (A), https://b.example/");
    expect(lines.indexOf("use when: You have shifted text.")).toBe(
      lines.indexOf("category: Ciphers") + 1,
    );
    expect(lines.indexOf("links: https://a.example/x (A), https://b.example/")).toBeLessThan(
      lines.indexOf("parameters:"),
    );
    expect(renderHelp(plain)).not.toContain("use when");
    expect(renderHelp(plain)).not.toContain("links:");
  });

  test("the schema rejects a malformed discovery member", () => {
    const base = JSON.parse(JSON.stringify(rotBuilder().build(H))) as Record<string, unknown>;
    const bad = (d: unknown): void => {
      expect(validateSchema({ ...base, discovery: d }), JSON.stringify(d)).toBe(false);
    };
    bad({});
    bad({ useWhen: "x".repeat(161) });
    bad({ useWhen: "a\nb" });
    bad({ links: [] });
    bad({ links: [{ url: "http://a.example/", label: null }] });
    bad({ links: [{ url: "https://a.example/", label: null, extra: 1 }] });
    bad({
      links: Array.from({ length: 9 }, (_, i) => ({ url: `https://a.example/${i}`, label: null })),
    });
    bad({ inverse: "nocolon" });
    bad({ other: 1 });
    expect(validateSchema({ ...base, discovery: { inverse: "v:w" } })).toBe(true);
  });
});

describe("shared choice types: header, hash, builder (LANGUAGE-0.2.md section 4)", () => {
  const entry = (options: string[]): ChoiceTypeEntry => ({
    qname: "v:t",
    name: "t",
    vocab: "v",
    options,
    docs: {},
    hash: sha256Hex(`{${options.join("|")}}`),
    source: { unit: null, text: null, pos: null },
  });
  const sha256Hex = (s: string): string => createHash("sha256").update(s).digest("hex");

  test("choice<ref> expands to the options of the resolved type", () => {
    const seen: string[] = [];
    const resolve = (ref: string, pos: SourcePos): ChoiceTypeEntry => {
      seen.push(`${ref}@${pos.offset}`);
      return entry(["pkcs7", "none"]);
    };
    const e = parseHeader(
      "bytes p:choice<v:t>=none q:choice<t> --",
      P0,
      "strict",
      DEFAULT_LIMITS,
      resolve,
    );
    expect(e.text).toBe("( bytes p:choice{pkcs7|none}=none q:choice{pkcs7|none} -- )");
    expect(e.inputs[1]).toMatchObject({
      type: "choice",
      options: ["pkcs7", "none"],
      default: "none",
    });
    expect(seen).toEqual(["v:t@6", "t@25"]);
  });

  test("the slot is the slot of the inline form", () => {
    const resolve = (): ChoiceTypeEntry => entry(["a", "b"]);
    const shared = parseHeader("bytes m:choice<t>=a --", P0, "strict", DEFAULT_LIMITS, resolve);
    const inline = parseHeader("bytes m:choice{a|b}=a --", P0, "strict");
    expect(JSON.stringify(shared)).toBe(JSON.stringify(inline));
  });

  test("a default that is not an option is E_HEADER, as for an inline choice", () => {
    const resolve = (): ChoiceTypeEntry => entry(["a", "b"]);
    expect(() =>
      parseHeader("bytes m:choice<t>=c --", P0, "strict", DEFAULT_LIMITS, resolve),
    ).toThrow(/default/);
  });

  test("without a resolver, and for malformed references, choice<…> is E_HEADER", () => {
    const code = (text: string, withResolver = true): string => {
      try {
        parseHeader(
          text,
          P0,
          "strict",
          DEFAULT_LIMITS,
          withResolver ? () => entry(["a"]) : undefined,
        );
      } catch (e) {
        return `${(e as ForgeError).code}: ${(e as ForgeError).message}`;
      }
      return "ok";
    };
    expect(code("bytes m:choice<t> --", false)).toMatch(
      /^E_HEADER: .*type references need a source unit/,
    );
    for (const bad of [
      "choice<t",
      "choice<>",
      "choice<a:b:c>",
      "choice<:t>",
      "choice<t>x",
      "choice<1:t>",
    ]) {
      expect(code(`bytes m:${bad} --`), bad).toMatch(/^E_HEADER/);
    }
    expect(code("bytes m:choice<t>[1] --")).toMatch(/takes no constraint/);
    expect(code("bytes m:toggle<t> --")).toMatch(/^E_HEADER/);
    expect(code("bytes m:choice --")).toMatch(/needs options/);
  });

  test("a resolver error propagates unchanged", () => {
    const boom = new ForgeError({
      code: "E_UNDEFINED",
      message: "nope",
      detail: { kind: "choice" },
    });
    expect(() =>
      parseHeader("bytes m:choice<t> --", P0, "strict", DEFAULT_LIMITS, () => {
        throw boom;
      }),
    ).toThrow(boom);
  });

  test("computeHash: no type lines by default, one sorted line per distinct type hash", () => {
    expect(computeHash("abc", [])).toBe(sha256Hex("abc\n"));
    expect(computeHash("abc", [], undefined, undefined, [])).toBe(sha256Hex("abc\n"));
    expect(computeHash("abc", [{ qname: "v:d", hash: "h" }], undefined, undefined, [])).toBe(
      sha256Hex("abc\nv:d h"),
    );
    expect(computeHash("abc", [], undefined, undefined, ["bb", "aa", "bb"])).toBe(
      sha256Hex("abc\nchoice aa\nchoice bb"),
    );
    expect(computeHash("abc", [{ qname: "v:d", hash: "h" }], undefined, undefined, ["aa"])).toBe(
      sha256Hex("abc\nv:d h\nchoice aa"),
    );
  });

  test("WordMetaBuilder keeps optionDocs of its discovery init and omits them when empty", () => {
    const effect = strict("bytes m:choice{a|b} --");
    const docs = { m: { a: "First." } };
    const withDocs = new WordMetaBuilder({
      name: "w",
      vocab: "v",
      kind: "fl",
      effect,
      discovery: { optionDocs: docs },
    }).build("0".repeat(64));
    expect(checked(withDocs).discovery).toEqual({ optionDocs: docs });
    const plain = new WordMetaBuilder({ name: "w", vocab: "v", kind: "fl", effect }).build(
      "0".repeat(64),
    );
    expect("discovery" in checked(plain)).toBe(false);
    const both = new WordMetaBuilder({
      name: "w",
      vocab: "v",
      kind: "fl",
      effect,
      discovery: { optionDocs: docs },
    });
    both.clause({ kind: "use-when", text: "Use it." });
    expect(both.build("0".repeat(64)).discovery).toEqual({ useWhen: "Use it.", optionDocs: docs });
  });

  test("meta.schema.json accepts optionDocs and rejects malformed ones", () => {
    const effect = strict("bytes m:choice{a|b} --");
    const meta = new WordMetaBuilder({
      name: "w",
      vocab: "v",
      kind: "fl",
      effect,
      discovery: { optionDocs: { m: { a: "First." } } },
    }).build("0".repeat(64));
    const ok = (m: unknown): boolean => validateSchema(JSON.parse(JSON.stringify(m)) as unknown);
    expect(ok(meta)).toBe(true);
    const withDiscovery = (d: unknown): unknown => ({ ...meta, discovery: d });
    expect(ok(withDiscovery({ optionDocs: { m: { a: 1 } } }))).toBe(false);
    expect(ok(withDiscovery({ optionDocs: { m: { a: "x".repeat(201) } } }))).toBe(false);
    expect(ok(withDiscovery({ optionDocs: { m: "x" } }))).toBe(false);
    expect(ok(withDiscovery({ optionDocs: {} }))).toBe(false);
  });
});
