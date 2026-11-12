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
import { describe, expect, test } from "vitest";
import { ForgeError } from "./errors.js";
import { read } from "./index.js";
import type { Token } from "./types.js";

/** The token kinds of a source, without the final eof. */
function kinds(src: string): string[] {
  return read(src)
    .slice(0, -1)
    .map((t) => t.kind);
}

/** The single token before eof. */
function one(src: string): Token {
  const toks = read(src);
  expect(toks).toHaveLength(2);
  return toks[0] as Token;
}

/** Values of the value-carrying tokens. */
function values(src: string): unknown[] {
  return read(src).flatMap((t) => ("value" in t ? [t.value] : []));
}

/** Reads `src` expecting a ForgeError and returns it. */
function fail(src: string, opts?: Parameters<typeof read>[1]): ForgeError {
  try {
    read(src, opts);
  } catch (e) {
    expect(e).toBeInstanceOf(ForgeError);
    return e as ForgeError;
  }
  throw new Error(`expected a failure for ${JSON.stringify(src)}`);
}

/** Asserts an E_LEX at the given 1-based line and column. */
function lexAt(src: string, line: number, col: number, offset?: number): void {
  const e = fail(src);
  expect(e.code).toBe("E_LEX");
  expect(e.pos?.line).toBe(line);
  expect(e.pos?.col).toBe(col);
  if (offset !== undefined) expect(e.pos?.offset).toBe(offset);
}

describe("conformance: lexical tests of LANGUAGE.md section 16", () => {
  test("C01 integer addition tokenises", () => {
    expect(read("1 2 + .").map((t) => t.text)).toEqual(["1", "2", "+", ".", ""]);
    expect(values("1 2 + .")).toEqual([1, 2]);
  });

  test("C02 line and block comments produce no tokens", () => {
    const toks = read("1 \\ line comment ( not a block )\n( block\n  comment ) 2 + .");
    expect(toks.map((t) => t.text)).toEqual(["1", "2", "+", ".", ""]);
    expect(toks[1]?.pos).toEqual({ offset: 53, line: 3, col: 13 });
  });

  test("C03 number forms, separators, negative", () => {
    expect(values("0xff 0b101 + 1_000 + -7 + .")).toEqual([255, 5, 1000, -7]);
  });

  test("C04 bigint promotion", () => {
    expect(values("9007199254740993 .")).toEqual([9007199254740993n]);
    expect(values("9007199254740991 2 *")).toEqual([9007199254740991, 2]);
  });

  test("C05 floats are num even when integral", () => {
    expect(kinds("1.5 2 * . 1e3 . 0.1 0.2 + .")).toEqual([
      "float",
      "int",
      "word",
      "word",
      "float",
      "word",
      "float",
      "float",
      "word",
      "word",
    ]);
    expect(values("1.5 1e3 0.1 0.2")).toEqual([1.5, 1000, 0.1, 0.2]);
  });

  test("C06 string escapes", () => {
    expect(values('"A\\x42\\u{43}\\\\\\"" .')).toEqual(['ABC\\"']);
  });

  test("C07 char literals are ints (code points)", () => {
    expect(values("'a' 'Z' + . '\\n' . '\\'' .")).toEqual([97, 90, 10, 39]);
    expect(kinds("'a'")).toEqual(["char"]);
  });

  test("C08 byte-array literals", () => {
    expect(values("#[ de AD 00 ] .")).toEqual([Uint8Array.from([0xde, 0xad, 0])]);
    expect(values("#[ ] len .")).toEqual([new Uint8Array(0)]);
  });

  test("C09 unterminated string reports the opening quote", () => {
    lexAt('1 2\n  "abc', 2, 3);
  });

  test("C10 bad byte element", () => {
    lexAt("#[ de zz ]", 1, 7);
  });

  test("C11 malformed numbers", () => {
    lexAt("12abc", 1, 1);
  });

  test("C12 bad string escape reports the backslash", () => {
    lexAt('"a\\qb"', 1, 3);
  });

  test("C13 unterminated block comment", () => {
    lexAt("1 ( never closed", 1, 3);
  });

  test("C14 brackets must be whitespace-separated", () => {
    lexAt("[1 ]", 1, 1);
  });

  test("C42 a code point escape beyond the BMP is one string", () => {
    expect(values('"\\u{1F600}" len .')).toEqual(["\u{1F600}"]);
  });

  test("C43 byte literals in expressions", () => {
    expect(values("#[ de ad ] #[ be ef ] cat bytes>hex .")).toEqual([
      Uint8Array.from([0xde, 0xad]),
      Uint8Array.from([0xbe, 0xef]),
    ]);
    expect(values("#[ 01 02 03 ] 1 nth .")).toEqual([Uint8Array.from([1, 2, 3]), 1]);
  });

  test("C45 a lone ff byte element", () => {
    expect(values("#[ ff ] bytes>str")).toEqual([Uint8Array.from([0xff])]);
  });

  test("C115 invisible characters inside a token are rejected", () => {
    lexAt("ab\u200Bc", 1, 3);
  });

  test("C158 an oversize integer literal", () => {
    const e = fail("0x1_0000_0000_0000_0000 .", { maxIntBits: 64 });
    expect(e.code).toBe("E_LIMIT_VALUE");
    expect(e.pos).toEqual({ offset: 0, line: 1, col: 1 });
    expect(e.detail).toEqual({ limit: 64, value: 65 });
  });

  test("C159 a literal of exactly maxIntBits bits is fine", () => {
    expect(values("0xffff_ffff_ffff_ffff .").slice(0, 1)).toEqual([18446744073709551615n]);
    expect(read("0xffff_ffff_ffff_ffff .", { maxIntBits: 64 })[0]).toMatchObject({
      kind: "int",
      value: 18446744073709551615n,
    });
  });

  test("C168 source length limit", () => {
    const e = fail("1 2 3 4 5 6", { maxSourceChars: 5 });
    expect(e.code).toBe("E_LIMIT_SOURCE");
    expect(e.pos).toBeNull();
    expect(e.detail).toEqual({ limit: 5, value: 11 });
  });
});

describe("source text and positions (2.1, 2.2)", () => {
  test("empty and whitespace-only input give only eof", () => {
    expect(read("")).toEqual([
      {
        kind: "eof",
        text: "",
        pos: { offset: 0, line: 1, col: 1 },
        end: { offset: 0, line: 1, col: 1 },
      },
    ]);
    expect(kinds(" \t\n\r\u000b\u000c ")).toEqual([]);
  });

  test("the limit is on UTF-16 code units and is inclusive", () => {
    expect(read("12345", { maxSourceChars: 5 })).toHaveLength(2);
    expect(fail("123456", { maxSourceChars: 5 }).code).toBe("E_LIMIT_SOURCE");
    expect(fail("\u{1F600}\u{1F600}\u{1F600}", { maxSourceChars: 5 }).code).toBe("E_LIMIT_SOURCE");
    expect(fail("x ".repeat(524_288) + " ").code).toBe("E_LIMIT_SOURCE");
    expect(read("x ".repeat(524_288))).toHaveLength(524_289);
  });

  test("a leading BOM is skipped; offsets index the original string, col ignores the BOM", () => {
    const toks = read("\uFEFFab cd");
    expect(toks.map((t) => t.text)).toEqual(["ab", "cd", ""]);
    expect(toks[0]?.pos).toEqual({ offset: 1, line: 1, col: 1 });
    expect(toks[1]?.pos).toEqual({ offset: 4, line: 1, col: 4 });
    expect(toks[2]?.pos).toEqual({ offset: 6, line: 1, col: 6 });
    expect(read("\uFEFF").map((t) => t.kind)).toEqual(["eof"]);
  });

  test("a BOM anywhere else is an invisible character", () => {
    lexAt("a \uFEFF", 1, 3);
    lexAt("\uFEFF\uFEFFa", 1, 1, 1);
  });

  test("line breaks: LF, CRLF and lone CR each count as one line", () => {
    const toks = read("a\nb\r\nc\rd");
    expect(toks.map((t) => [t.text, t.pos.line, t.pos.col])).toEqual([
      ["a", 1, 1],
      ["b", 2, 1],
      ["c", 3, 1],
      ["d", 4, 1],
      ["", 4, 2],
    ]);
  });

  test("columns count UTF-16 code units and a tab counts as 1", () => {
    const toks = read("\t\u{1F600}x y");
    expect(toks[0]?.pos).toEqual({ offset: 1, line: 1, col: 2 });
    expect(toks[0]?.end).toEqual({ offset: 4, line: 1, col: 5 });
    expect(toks[1]?.pos).toEqual({ offset: 5, line: 1, col: 6 });
    expect(toks[2]?.pos.offset).toBe(6);
  });

  test("end is exclusive and text is the exact slice", () => {
    const toks = read('foo  "a\nb"  #[ 01 ]');
    expect(toks[0]).toMatchObject({ text: "foo", end: { offset: 3, line: 1, col: 4 } });
    expect(toks[1]).toMatchObject({
      text: '"a\nb"',
      pos: { offset: 5, line: 1, col: 6 },
      end: { offset: 10, line: 2, col: 3 },
    });
    expect(toks[2]).toMatchObject({ text: "#[ 01 ]", pos: { line: 2, col: 5 }, end: { col: 12 } });
    expect(toks[3]).toMatchObject({ kind: "eof", pos: { offset: 19, line: 2, col: 12 } });
  });

  test("Zs, Zl, Zp and Cf characters are neither separators nor name characters", () => {
    for (const ch of ["\u00A0", "\u2028", "\u2029", "\u200B", "\u3000", "\u2060"]) {
      lexAt(`ab${ch}c`, 1, 3, 2);
      lexAt(`ab ${ch}`, 1, 4, 3);
      lexAt(`${ch}ab`, 1, 1, 0);
      lexAt(`1${ch}2`, 1, 2, 1);
      lexAt(`[${ch}`, 1, 2, 1);
    }
  });

  test("invisible characters are allowed in strings, chars and comments", () => {
    expect(values('"a\u00A0\u200Bb"')).toEqual(["a\u00A0\u200Bb"]);
    expect(values("'\u00A0'")).toEqual([0xa0]);
    expect(kinds("\\ a\u00A0b\n( \u200B ) x")).toEqual(["word"]);
  });

  test("lone surrogates are accepted in names and strings", () => {
    expect(one("a\uD800b").text).toBe("a\uD800b");
    expect(values('"\uD800"')).toEqual(["\uD800"]);
    expect(values("'\uD800'")).toEqual([0xd800]);
  });
});

describe("comments (2.3 rule 1, 2.9)", () => {
  test("a line comment stops at LF, CR or end of input", () => {
    expect(kinds("a \\ x\nb")).toEqual(["word", "word"]);
    expect(kinds("a \\ x\rb")).toEqual(["word", "word"]);
    expect(kinds("a \\ x\r\nb")).toEqual(["word", "word"]);
    expect(kinds("a \\")).toEqual(["word"]);
    expect(kinds("\\")).toEqual([]);
  });

  test("a backslash that is not standalone is an error", () => {
    lexAt("\\foo", 1, 1);
    lexAt("a\\", 1, 1);
    lexAt("a \\\\", 1, 3);
  });

  test("block comments end at the first standalone close and do not nest", () => {
    expect(read("( a ( b ) c").map((t) => t.text)).toEqual(["c", ""]);
    lexAt("( a ( b ) c )", 1, 13);
  });

  test("a close that is not standalone does not end a comment", () => {
    expect(kinds("( a) b) c )")).toEqual([]);
    expect(kinds("( (a b )")).toEqual([]);
    expect(kinds("( a)\n)")).toEqual([]);
  });

  test("a comment may contain quotes, brackets and other comment openers", () => {
    expect(kinds("( \" ' [ { #[ \\ ) x")).toEqual(["word"]);
  });

  test("an empty comment needs whitespace", () => {
    expect(kinds("( ) a")).toEqual(["word"]);
    lexAt("()", 1, 1);
    lexAt("( ) ()", 1, 5);
  });

  test("a comment closed at the very end of input", () => {
    expect(kinds("a ( b )")).toEqual(["word"]);
  });

  test("unterminated block comment reports its open paren", () => {
    lexAt("a\n  ( never )x", 2, 3);
    lexAt("(", 1, 1);
    lexAt("( x", 1, 1);
    lexAt("( x )y", 1, 1);
  });

  test("a stray close paren is an error", () => {
    lexAt(")", 1, 1);
    lexAt("a )b", 1, 3);
    lexAt("a(b", 1, 1);
  });
});

describe("headers (2.8)", () => {
  test("a header directly after : name", () => {
    const toks = read(": rot ( bytes n:int -- bytes ) body ;");
    expect(toks.map((t) => t.kind)).toEqual(["word", "word", "header", "word", "word", "eof"]);
    const h = toks[2] as Extract<Token, { kind: "header" }>;
    expect(h.headerText).toBe(" bytes n:int -- bytes ");
    expect(h.text).toBe("( bytes n:int -- bytes )");
    expect(h.pos).toEqual({ offset: 6, line: 1, col: 7 });
    expect(h.headerTextPos).toEqual({ offset: 7, line: 1, col: 8 });
    expect(h.end).toEqual({ offset: 30, line: 1, col: 31 });
  });

  test("a qualified name before the header also counts", () => {
    expect(kinds(": core:x ( -- ) ;")).toEqual(["word", "qword", "header", "word"]);
  });

  test("any word token after : counts, including keywords", () => {
    expect(kinds(": ; ( -- )")).toEqual(["word", "word", "header"]);
    expect(kinds(": true ( -- )")).toEqual(["word", "bool"]); // a bool is not a name
  });

  test("comments before the header do not count as tokens", () => {
    expect(kinds(": a \\ note\n ( -- )")).toEqual(["word", "word", "header"]);
    expect(kinds(": a ( c ) ( -- )")).toEqual(["word", "word", "header"]); // the first ( ) is the header
  });

  test("multi-line headers keep exact positions", () => {
    const src = "x\n: f (\n  a:int\n  -- int\n) 1 ;";
    const toks = read(src);
    const h = toks[3] as Extract<Token, { kind: "header" }>;
    expect(h.kind).toBe("header");
    expect(h.headerText).toBe("\n  a:int\n  -- int\n");
    expect(h.pos).toEqual({ offset: 6, line: 2, col: 5 });
    expect(h.headerTextPos).toEqual({ offset: 7, line: 2, col: 6 });
    expect(h.end).toEqual({ offset: 26, line: 5, col: 2 });
    expect(h.text).toBe(src.slice(6, 26));
    expect(toks[4]).toMatchObject({ text: "1", pos: { line: 5, col: 3 } });
  });

  test("CRLF inside a header advances one line per break", () => {
    const h = read(": f (\r\n a\r\n) x")[2] as Extract<Token, { kind: "header" }>;
    expect(h.headerText).toBe("\r\n a\r\n");
    expect(h.end).toMatchObject({ line: 3, col: 2 });
  });

  test("a close paren inside a string does not end the header", () => {
    const h = one2(': f ( s:str="a ) b" -- str )');
    expect(h.headerText).toBe(' s:str="a ) b" -- str ');
    const e = one2(': f ( s:str="a \\" ) b" -- )');
    expect(e.headerText).toBe(' s:str="a \\" ) b" -- ');
  });

  test("a non-standalone close paren does not end the header", () => {
    const h = one2(": f ( a)b c ) x");
    expect(h.headerText).toBe(" a)b c ");
    const g = one2(": f ( a )b c ) x");
    expect(g.headerText).toBe(" a )b c ");
    const k = one2(': f ( "a")  ) x');
    expect(k.headerText).toBe(' "a")  ');
  });

  test("a header with an empty body", () => {
    const h = one2(": f ( ) x");
    expect(h.headerText).toBe(" ");
  });

  test("an unterminated header reports its open paren", () => {
    lexAt(": f ( a:int", 1, 5);
    lexAt(': f (\n s:str="a ) ', 1, 5);
    lexAt(': f ( s:str="a\\', 1, 5);
    lexAt(": f (", 1, 5);
    lexAt(": f ( x )y", 1, 5);
  });

  test("elsewhere ( ... ) is a comment, even with a colon earlier", () => {
    expect(kinds("( -- )")).toEqual([]);
    expect(kinds("a ( -- )")).toEqual(["word"]);
    expect(kinds(": 1 ( -- )")).toEqual(["word", "int"]);
    expect(kinds(": [ ( -- )")).toEqual(["word", "lbracket"]);
    expect(kinds(": a b ( -- )")).toEqual(["word", "word", "word"]);
    expect(kinds("; a ( -- )")).toEqual(["word", "word"]);
    expect(kinds("x : ( -- )")).toEqual(["word", "word"]);
    expect(kinds(": a ( -- ) ( x )")).toEqual(["word", "word", "header"]);
  });

  test("a header after a second definition in the same source", () => {
    expect(kinds(": a ( -- ) ; : b ( -- ) ;")).toEqual([
      "word",
      "word",
      "header",
      "word",
      "word",
      "word",
      "header",
      "word",
    ]);
  });
});

/** The header token of a source that is `: f ( ... ) ...`. */
function one2(src: string): Extract<Token, { kind: "header" }> {
  const t = read(src).find((x) => x.kind === "header");
  expect(t).toBeDefined();
  return t as Extract<Token, { kind: "header" }>;
}

describe("punctuation (2.3 rule 6)", () => {
  test("standalone brackets and braces", () => {
    expect(kinds("[ ] { }")).toEqual(["lbracket", "rbracket", "lbrace", "rbrace"]);
    expect(kinds("[\n]")).toEqual(["lbracket", "rbracket"]);
  });

  test("brackets inside tokens are errors", () => {
    for (const s of [
      "[1",
      "1]",
      "[1 2]",
      "{a",
      "a}",
      "[]",
      "{}",
      "a[b",
      "a]",
      "[[",
      "]]",
      "x{y}",
    ]) {
      expect(fail(s).code).toBe("E_LEX");
    }
    lexAt("[]", 1, 1);
    lexAt("a [b", 1, 3);
  });
});

describe("integers (2.4)", () => {
  test("decimal, hex and binary with separators and signs", () => {
    expect(values("0 7 007 1_0 1_000_000 -1 -0 0xFf 0xDEAD_beef -0x10 0b0 0b1_0 -0b11")).toEqual([
      0, 7, 7, 10, 1_000_000, -1, 0, 255, 0xdeadbeef, -16, 0, 2, -3,
    ]);
    expect(Object.is(values("-0")[0], 0)).toBe(true);
    expect(Object.is(values("-0x0")[0], 0)).toBe(true);
    expect(kinds("1 0x1 0b1 -1")).toEqual(["int", "int", "int", "int"]);
  });

  test("normal form: number iff safe integer", () => {
    expect(values("9007199254740991 -9007199254740991")).toEqual([
      9007199254740991, -9007199254740991,
    ]);
    expect(values("9007199254740992 -9007199254740992")).toEqual([
      9007199254740992n,
      -9007199254740992n,
    ]);
    expect(values("0x1fffffffffffff 0x20000000000000")).toEqual([
      9007199254740991,
      9007199254740992n,
    ]);
    expect(values(`0b1${"0".repeat(53)}`)).toEqual([9007199254740992n]);
    expect(values("123456789012345678901234567890")).toEqual([123456789012345678901234567890n]);
    expect(typeof values("9007199254740992")[0]).toBe("bigint");
  });

  test("malformed integers", () => {
    for (const s of [
      "1__0",
      "1_",
      "0x_1",
      "0x",
      "0b",
      "0b2",
      "0X1",
      "0B1",
      "0xg",
      "0b1_",
      "0x1__2",
      "1+",
      "12abc",
      "-1a",
      "1-",
      "0o7",
      "1.",
      "5.",
      "1._5",
      "1.5.2",
      "1e",
      "1e+",
      "1_e5",
      "1e_5",
      "1.e5",
      "0x1.5",
      "-0x",
    ]) {
      lexAt(s, 1, 1);
    }
  });

  test("a digit-leading or minus-digit token is never a word", () => {
    lexAt("1+", 1, 1);
    lexAt("-1x", 1, 1);
    lexAt("2x", 1, 1);
    lexAt("a\n  3d", 2, 3);
  });

  test("minus on its own and minus-leading names are words", () => {
    expect(read("- -rot --").map((t) => t.text)).toEqual(["-", "-rot", "--", ""]);
    expect(kinds("- -rot -- -_1 --1")).toEqual(["word", "word", "word", "word", "word"]);
  });

  test("maxIntBits applies to decimal, hex and binary, and counts magnitude", () => {
    const bits = (n: number): string => `0b${"1".repeat(n)}`;
    expect(read(bits(64), { maxIntBits: 64 })).toHaveLength(2);
    const e = fail(bits(65), { maxIntBits: 64 });
    expect(e.code).toBe("E_LIMIT_VALUE");
    expect(e.pos).toEqual({ offset: 0, line: 1, col: 1 });
    expect(e.detail).toEqual({ limit: 64, value: 65 });
    expect(read(`-${bits(64)}`, { maxIntBits: 64 })).toHaveLength(2);
    const neg = fail(`x -${bits(65)}`, { maxIntBits: 64 });
    expect(neg.code).toBe("E_LIMIT_VALUE");
    expect(neg.pos).toMatchObject({ offset: 2, col: 3 });
    expect(fail("18446744073709551616", { maxIntBits: 64 }).code).toBe("E_LIMIT_VALUE");
    expect(read("18446744073709551615", { maxIntBits: 64 })).toHaveLength(2);
    expect(fail("0x1_0000", { maxIntBits: 16 }).code).toBe("E_LIMIT_VALUE");
    expect(read("0xffff", { maxIntBits: 16 })).toHaveLength(2);
    expect(read("0", { maxIntBits: 0 })).toHaveLength(2);
    expect(fail("1", { maxIntBits: 0 }).code).toBe("E_LIMIT_VALUE");
  });

  test("the default maxIntBits is 65 536", () => {
    expect(read(`0x1${"0".repeat(16383)}`)).toHaveLength(2); // 4 * 16383 + 1 = 65 533 bits
    expect(read(`0b1${"0".repeat(65535)}`)).toHaveLength(2); // 65 536 bits
    expect(fail(`0b1${"0".repeat(65536)}`).code).toBe("E_LIMIT_VALUE");
  });

  test("an oversize literal does not hide an earlier lexical error", () => {
    expect(fail('"abc 0x1_0000_0000_0000_0000', { maxIntBits: 64 }).code).toBe("E_LEX");
    expect(fail("0x1_0000_0000_0000_0000 12x", { maxIntBits: 64 }).code).toBe("E_LIMIT_VALUE");
  });
});

describe("floats (2.5)", () => {
  test("forms", () => {
    expect(values("0.0 1.5 -2.25 1e3 1E3 1e+3 1e-3 1.5e3 1_0.2_5e1_0 -1e2 0e0")).toEqual([
      0, 1.5, -2.25, 1000, 1000, 1000, 0.001, 1500, 10.25e10, -100, 0,
    ]);
    expect(kinds("1.0 1e3 -1.5")).toEqual(["float", "float", "float"]);
  });

  test("-0.0 is negative zero, but -0 is the integer 0", () => {
    expect(Object.is(values("-0.0")[0], -0)).toBe(true);
    expect(Object.is(values("-0e0")[0], -0)).toBe(true);
    expect(one("-0").kind).toBe("int");
  });

  test("underflow to zero is accepted, overflow is E_LEX", () => {
    expect(values("1e-999")).toEqual([0]);
    expect(values("1.7976931348623157e308")).toEqual([Number.MAX_VALUE]);
    lexAt("1e999", 1, 1);
    lexAt("-1e999", 1, 1);
    lexAt("a 1.8e308", 1, 3);
  });

  test("a float token is never an int token", () => {
    expect(one("1e3").kind).toBe("float");
    expect(one("0.5").text).toBe("0.5");
  });

  test(".5 is a word name, 5. is E_LEX", () => {
    expect(one(".5")).toMatchObject({ kind: "word", text: ".5" });
    lexAt("5.", 1, 1);
    lexAt("-5.", 1, 1);
  });
});

describe("string literals (2.6)", () => {
  test("plain, empty, and adjacent to whitespace", () => {
    expect(values('"" "abc" "a b"')).toEqual(["", "abc", "a b"]);
    expect(one('"abc"')).toMatchObject({ kind: "str", text: '"abc"', value: "abc" });
  });

  test("every escape", () => {
    expect(values('"\\n\\r\\t\\0\\\\\\""')).toEqual(['\n\r\t\0\\"']);
    expect(values('"\\x00\\x41\\xe9\\xFF"')).toEqual(["\0A\u00e9\u00ff"]);
    expect(values('"\\u{0}\\u{41}\\u{e9}\\u{10FFFF}\\u{00000A}\\u{1F600}"')).toEqual([
      "\0A\u00e9\u{10ffff}\n\u{1F600}",
    ]);
    expect(values('"\\u{D7FF}\\u{E000}"')).toEqual(["\ud7ff\ue000"]);
  });

  test("raw line breaks are part of the string and advance line", () => {
    const toks = read('"a\nb\r\nc\rd" x');
    expect(toks[0]).toMatchObject({ kind: "str", value: "a\nb\r\nc\rd", end: { line: 4, col: 3 } });
    expect(toks[1]).toMatchObject({ text: "x", pos: { line: 4, col: 4 } });
  });

  test("strings may contain delimiters, comment markers and a single quote", () => {
    expect(values('"( ) [ ] # \' ; :"')).toEqual(["( ) [ ] # ' ; :"]);
  });

  test("invalid escapes are reported at the backslash", () => {
    lexAt('"a\\qb"', 1, 3);
    lexAt('"ab\\\'"', 1, 4); // \' is not a string escape
    lexAt('"\\x4"', 1, 2);
    lexAt('"\\xg1"', 1, 2);
    lexAt('"\\x"', 1, 2);
    lexAt('"\\u0041"', 1, 2);
    lexAt('"\\u{}"', 1, 2);
    lexAt('"\\u{41"', 1, 2);
    lexAt('"\\u{41', 1, 2);
    lexAt('"\\u{1234567}"', 1, 2);
    lexAt('"\\u{110000}"', 1, 2);
    lexAt('"\\u{D800}"', 1, 2);
    lexAt('"\\u{dfff}"', 1, 2);
    lexAt('"\\u{zz}"', 1, 2);
    lexAt('"\\u"', 1, 2);
    lexAt('"\\U{41}"', 1, 2);
    lexAt('"\\', 1, 2);
    lexAt('"abc\\', 1, 5);
    lexAt('x\n"a\n  \\q"', 3, 3);
  });

  test("unterminated strings report the opening quote", () => {
    lexAt('"', 1, 1);
    lexAt('"abc', 1, 1);
    lexAt('a "abc\\n', 1, 3);
    lexAt('a\n"abc\ndef', 2, 1);
  });

  test("a string must be followed by whitespace or end of input", () => {
    lexAt('"a""b"', 1, 1);
    lexAt('"a"b', 1, 1);
    lexAt('x "a"]', 1, 3);
    lexAt('"a"\u00A0', 1, 1);
    expect(kinds('"a"\n"b"')).toEqual(["str", "str"]);
  });

  test("a quote inside a token is an error", () => {
    lexAt('a"b"', 1, 1);
    lexAt('1"', 1, 1);
  });
});

describe("char literals (2.7)", () => {
  test("a code point, a space, an astral character", () => {
    expect(values("'a' ' ' '\u00e9' '\u{1F600}' '\"' '(' '#' ';' '[' ':'")).toEqual([
      97, 32, 0xe9, 0x1f600, 34, 40, 35, 59, 91, 58,
    ]);
    expect(values("'\t'")).toEqual([9]);
    expect(one("'a'")).toMatchObject({ kind: "char", text: "'a'", value: 97 });
  });

  test("escapes", () => {
    expect(values("'\\n' '\\r' '\\t' '\\0' '\\\\' '\\'' '\\\"'")).toEqual([
      10, 13, 9, 0, 92, 39, 34,
    ]);
    expect(values("'\\x41' '\\xFF' '\\u{41}' '\\u{1F600}' '\\u{10ffff}'")).toEqual([
      0x41, 0xff, 0x41, 0x1f600, 0x10ffff,
    ]);
  });

  test("raw LF and CR are not allowed in a char literal", () => {
    lexAt("'\n'", 1, 1);
    lexAt("'\r'", 1, 1);
  });

  test("'' and 'ab' and unterminated chars are errors at the opening quote", () => {
    lexAt("''", 1, 1);
    lexAt("a ''", 1, 3);
    lexAt("'ab'", 1, 1);
    lexAt("'", 1, 1);
    lexAt("'a", 1, 1);
    lexAt("'\u{1F600}\u{1F600}'", 1, 1);
    lexAt("'a b'", 1, 1);
    lexAt("'\\n", 1, 1);
  });

  test("bad escapes are reported at the backslash", () => {
    lexAt("'\\q'", 1, 2);
    lexAt("'\\", 1, 2);
    lexAt("'\\x4'", 1, 2);
    lexAt("'\\u{D800}'", 1, 2);
    lexAt("x '\\u{110000}'", 1, 4);
  });

  test("a char literal must be followed by whitespace or end of input", () => {
    lexAt("'a''b'", 1, 1);
    lexAt("'a'b", 1, 1);
    lexAt("'a']", 1, 1);
    expect(kinds("'a'\n'b'")).toEqual(["char", "char"]);
  });

  test("a quote inside a token is an error", () => {
    lexAt("a'b'", 1, 1);
    lexAt("x'", 1, 1);
  });
});

describe("byte-array literals (2.10)", () => {
  test("elements, either case, one token", () => {
    const t = one("#[ de AD 00 fF ]");
    expect(t).toMatchObject({ kind: "bytes", text: "#[ de AD 00 fF ]" });
    expect(t).toHaveProperty("value", Uint8Array.from([0xde, 0xad, 0, 0xff]));
    expect(t.end).toMatchObject({ offset: 16, col: 17 });
  });

  test("empty, and spread over lines", () => {
    expect(values("#[ ]")).toEqual([new Uint8Array(0)]);
    const toks = read("#[\n  01\n  02\n] x");
    expect(toks[0]).toMatchObject({ kind: "bytes", end: { line: 4, col: 2 } });
    expect(toks[0]).toHaveProperty("value", Uint8Array.from([1, 2]));
    expect(toks[1]).toMatchObject({ text: "x", pos: { line: 4, col: 3 } });
  });

  test("malformed elements are reported at the element", () => {
    lexAt("#[ d ]", 1, 4);
    lexAt("#[ 0xde ]", 1, 4);
    lexAt("#[ zz ]", 1, 4);
    lexAt("#[ dead ]", 1, 4);
    lexAt("#[ de ad]", 1, 7);
    lexAt("#[ de\n  g0 ]", 2, 3);
    lexAt("#[ de \\ x\n]", 1, 7);
    lexAt("#[ de ( x ) ]", 1, 7);
    lexAt("#[ de #[ ]", 1, 7);
    lexAt("#[ [ ]", 1, 4);
  });

  test("an invisible character in an element is reported at that character", () => {
    lexAt("#[ d\u200B ]", 1, 5);
    lexAt("#[ \u00A0 ]", 1, 4);
    lexAt("#[ a\u00A0b ]", 1, 5);
  });

  test("an unterminated byte array reports the opening", () => {
    lexAt("a #[ de", 1, 3);
    lexAt("#[", 1, 1);
    lexAt("#[ de \n ", 1, 1);
  });

  test("# on its own, or glued to anything, is an error", () => {
    lexAt("#", 1, 1);
    lexAt("#[]", 1, 1);
    lexAt("#[de ]", 1, 1);
    lexAt("a#[", 1, 1);
    lexAt("#x", 1, 1);
    lexAt("#[ ]x", 1, 4);
  });
});

describe("booleans, keywords and names (2.3, 2.11)", () => {
  test("true and false are bool tokens", () => {
    expect(values("true false")).toEqual([true, false]);
    expect(kinds("true false")).toEqual(["bool", "bool"]);
    expect(kinds("True truex falsey TRUE")).toEqual(["word", "word", "word", "word"]);
  });

  test("syntactic keywords and reserved words are word tokens", () => {
    for (const w of [
      ":",
      ";",
      "IN:",
      "USING:",
      "META:",
      "VOCAB",
      "CONSTANT",
      "VARIABLE",
      "PRIMITIVE",
      "recurse",
    ]) {
      expect(one(w)).toMatchObject({ kind: "word", text: w });
    }
  });

  test(":> is a standalone keyword token (LANGUAGE-0.2.md section 8)", () => {
    expect(one(":>")).toMatchObject({ kind: "word", text: ":>" });
    expect(kinds("1 :> x")).toEqual(["int", "word", "word"]);
    expect(kinds("[ :> x ]")).toEqual(["lbracket", "word", "word", "rbracket"]);
    // Glued to other characters it is still a bad qualified name, as before, and `a:>` is unchanged.
    lexAt("  :>x", 1, 3);
    lexAt("  :>:", 1, 3);
    lexAt("  >:>", 1, 3);
    expect(one("a:>")).toMatchObject({ kind: "qword", vocab: "a", name: ">" });
  });

  test("qualified names", () => {
    expect(one("core:dup")).toMatchObject({
      kind: "qword",
      vocab: "core",
      name: "dup",
      text: "core:dup",
    });
    expect(one("a:b")).toMatchObject({ vocab: "a", name: "b" });
    expect(one("my-vocab_2:.s")).toMatchObject({ kind: "qword", vocab: "my-vocab_2", name: ".s" });
    expect(one("v:-rot")).toMatchObject({ name: "-rot" });
    expect(one("v:_private")).toMatchObject({ name: "_private" });
    expect(one("v:-")).toMatchObject({ name: "-" });
    expect(one("v:true")).toMatchObject({ kind: "qword", name: "true" });
    expect(one("IN:x")).toMatchObject({ kind: "qword", vocab: "IN", name: "x" });
    expect(one("v:caf\u00e9")).toMatchObject({ name: "caf\u00e9" });
  });

  test("bad qualified names are E_LEX at the token", () => {
    for (const s of [
      "a:b:c",
      ":x",
      "x:",
      "::",
      "x::y",
      "1a:b",
      "_a:b",
      "-a:b",
      "caf\u00e9:b",
      "a:1",
      "a:-1",
      "a:(",
      "a:[b",
      "a:b;",
      'a:"',
      "a.b:c",
      "a:b:",
    ]) {
      lexAt(`  ${s}`, 1, 3);
    }
    lexAt("a b:c:d", 1, 3);
  });

  test("vocab-name length is 1 to 64, word-name length 1 to 128 code points", () => {
    expect(one(`${"a".repeat(64)}:x`)).toMatchObject({ kind: "qword" });
    lexAt(`${"a".repeat(65)}:x`, 1, 1);
    expect(one(`v:${"b".repeat(128)}`)).toMatchObject({ kind: "qword" });
    lexAt(`v:${"b".repeat(129)}`, 1, 1);
    expect(one("b".repeat(128))).toMatchObject({ kind: "word" });
    lexAt("b".repeat(129), 1, 1);
    expect(one("\u{1F600}".repeat(128))).toMatchObject({ kind: "word" });
    lexAt("\u{1F600}".repeat(129), 1, 1);
  });

  test("symbol, underscore, hyphen and non-ASCII characters in names", () => {
    for (const w of [
      "!",
      "$",
      "%",
      "&",
      "*",
      "+",
      ",",
      ".",
      "/",
      "<",
      "=",
      ">",
      "?",
      "@",
      "^",
      "|",
      "~",
      "_",
      ".s",
      "<>",
      ">str",
      "bytes>hex",
      "str>int-radix",
      "a1_b-c",
      "!!!",
      "\u00e9",
      "\u03bb",
      "\u65e5\u672c",
      "\u{1F600}",
      "x\u00e9",
      "a\ue000",
      "a\u0378",
    ]) {
      expect(one(w)).toMatchObject({ kind: "word", text: w });
    }
  });

  test("characters outside the name alphabet are E_LEX", () => {
    for (const s of ["`", "a`", "a;", "foo;", "a(b", "a)", "a\\b", "a#", "a'", 'a"', "a{", "a:"]) {
      expect(fail(s).code).toBe("E_LEX");
    }
    lexAt("foo;", 1, 1);
    lexAt("x ;;", 1, 3);
    lexAt("x `y", 1, 3);
    lexAt("a\u0001", 1, 1);
    lexAt("a\u007f", 1, 1);
    lexAt("a\u0085", 1, 1);
    lexAt("\u009f", 1, 1);
    lexAt("x \u0000", 1, 3);
  });

  test("names are case-sensitive tokens, kept as written", () => {
    expect(read("Foo foo FOO").map((t) => t.text)).toEqual(["Foo", "foo", "FOO", ""]);
  });
});

describe("token stream", () => {
  test("a realistic definition", () => {
    const src =
      ': hyp2 ( a:int b:int -- int )  a a * b b * + ;\n1 2 hyp2 . \\ done\n[ 1 2 ] { "k" 1 } #[ 00 ]';
    expect(read(src).map((t) => t.kind)).toEqual([
      "word",
      "word",
      "header",
      "word",
      "word",
      "word",
      "word",
      "word",
      "word",
      "word",
      "word",
      "int",
      "int",
      "word",
      "word",
      "lbracket",
      "int",
      "int",
      "rbracket",
      "lbrace",
      "str",
      "int",
      "rbrace",
      "bytes",
      "eof",
    ]);
  });

  test("eof is always last, with zero width", () => {
    const toks = read("a \\ c");
    const last = toks[toks.length - 1] as Token;
    expect(last).toMatchObject({ kind: "eof", text: "" });
    expect(last.end).toEqual(last.pos);
    expect(last.pos).toEqual({ offset: 5, line: 1, col: 6 });
  });

  test("the first error in token order is reported", () => {
    lexAt('a 12x "unterminated', 1, 3);
    lexAt('"unterminated 12x', 1, 1);
  });

  test("read is pure: repeated reads give equal tokens", () => {
    const src = ': f ( -- ) 1 "x" #[ 01 ] ;';
    expect(read(src)).toEqual(read(src));
  });

  test("errors carry no run context", () => {
    const e = fail("12x");
    expect(e).toMatchObject({ word: null, vocab: null, step: null, ip: null });
    expect(e.stackSnapshot).toEqual([]);
  });
});
