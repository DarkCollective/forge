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
 * Tagged literals (LANGUAGE-0.3.md section 6): the `tstr` token of the reader and the compile-time
 * evaluation of the compiler, including hostile input. The conformance blocks C446 to C455 and C427
 * run in test/conformance; this file covers what a block cannot say.
 */
import { describe, expect, test } from "vitest";
import { ForgeError } from "./errors.js";
import { registerExtKind, registerLiteralTag } from "./ext.js";
import { definePrimitive } from "./primitives.js";
import { read } from "./reader.js";
import { createRuntime } from "./runtime.js";
import type { ForgeErrorShape, Limits, Token } from "./types.js";

interface P {
  readonly a: number;
  readonly b: number;
}

type Tstr = Token & { kind: "tstr" };

function bad(text: string, offset: number): never {
  throw new ForgeError({
    code: "E_COERCE",
    message: `not a pair: ${JSON.stringify(text)}`,
    detail: { offset },
  });
}

/** `a,b` where both are non-negative integers; the offset is the first character that does not fit. */
function parse(text: string): P {
  const m = /^(\d+),(\d+)$/.exec(text);
  if (m === null) {
    const i = text.search(/[^\d,]/);
    return bad(text, i < 0 ? text.length : i);
  }
  return { a: Number(m[1]), b: Number(m[2]) };
}

registerExtKind<P>({
  kind: "tl-pair",
  equals: (x, y) => x.a === y.a && x.b === y.b,
  sizeOf: () => 16,
  toText: (p) => `${p.a},${p.b}`,
});
registerExtKind<string>({
  kind: "tl-text",
  equals: (x, y) => x === y,
  sizeOf: (s) => s.length,
  toText: (s) => s,
});
registerLiteralTag({ tag: "tlp", kind: "tl-pair", parse });
registerLiteralTag({ tag: "tl-text", kind: "tl-text", parse: (s) => s });
registerLiteralTag({
  tag: "tl-rough",
  kind: "tl-text",
  parse: () => {
    throw new Error("rough");
  },
});
registerLiteralTag({ tag: "tl-far", kind: "tl-text", parse: (s) => bad(s, s.length + 5) });
registerLiteralTag({ tag: "tl-lines", kind: "tl-text", parse: (s) => bad(s, s.indexOf("!")) });
registerLiteralTag({ tag: "tl-nokind", kind: "tl-no-such-kind", parse: (s) => s });
const LONG = "a123456789b123456789c123456789de";
registerLiteralTag({ tag: LONG, kind: "tl-text", parse: (s) => s });

const prims = [
  definePrimitive("tl", "pa", "( p:ext{tl-pair} -- int )", (p) => (p as P).a),
  definePrimitive("tl", "len", "( p:ext{tl-text} -- int )", (p) => (p as string).length),
];

const TAGS: ReadonlySet<string> = new Set([
  "tlp",
  "tl-text",
  "tl-rough",
  "tl-far",
  "tl-lines",
  "tl-nokind",
  LONG,
]);

function tokens(src: string): Token[] {
  return read(src, { literalTags: TAGS });
}

function readFails(src: string): ForgeError {
  try {
    read(src, { literalTags: TAGS });
  } catch (e) {
    if (e instanceof ForgeError) return e;
    throw e;
  }
  throw new Error("expected a ForgeError");
}

async function run(src: string, limits?: Partial<Limits>) {
  return createRuntime({ primitives: prims, ...(limits === undefined ? {} : { limits }) }).run(src);
}

async function error(src: string, limits?: Partial<Limits>): Promise<ForgeErrorShape> {
  const r = await run(src, limits);
  if (r.ok) throw new Error("expected an error");
  return r.error;
}

describe("reader: the tstr token", () => {
  test("without literalTags the text is lexed as before (E_LEX at the token)", () => {
    for (const opts of [undefined, {}, { literalTags: new Set<string>() }]) {
      let err: unknown;
      try {
        read('tlp"1,2"', opts);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ForgeError);
      expect((err as ForgeError).code).toBe("E_LEX");
      expect((err as ForgeError).pos).toMatchObject({ line: 1, col: 1 });
    }
  });

  test("a registered tag gives one tstr token with tag, decoded value and positions", () => {
    const [t, eof] = tokens('  tlp"1,2"  ');
    expect(t).toMatchObject({
      kind: "tstr",
      tag: "tlp",
      value: "1,2",
      escapeAt: null,
      text: 'tlp"1,2"',
      pos: { offset: 2, line: 1, col: 3 },
      end: { offset: 10, line: 1, col: 11 },
    });
    expect(eof?.kind).toBe("eof");
  });

  test("the body follows the string rules: escapes, raw line breaks, Unicode", () => {
    const t = tokens('tl-text"a\\n\\x41\\u{1F600}\\"\\\\é\r\nz"')[0] as Tstr;
    expect(t.value).toBe('a\nA\u{1F600}"\\é\r\nz');
    expect(t.escapeAt).toBe(1);
    expect(t.end.line).toBe(2);
    expect(tokens('tl-text"é\u{1F600}"')[0]).toMatchObject({ value: "é\u{1F600}", escapeAt: null });
  });

  test("an empty body, and tagged literals beside other tokens", () => {
    const ts = tokens('tl-text"" 1 tlp"3,4" "s" tl-text"x"');
    expect(ts.map((t) => t.kind)).toEqual(["tstr", "int", "tstr", "str", "tstr", "eof"]);
    expect((ts[0] as Tstr).value).toBe("");
  });

  test("a tag may be 32 characters; a longer run is not a tag", () => {
    expect(LONG).toHaveLength(32);
    expect(tokens(`${LONG}"x"`)[0]).toMatchObject({ kind: "tstr", tag: LONG });
    expect(readFails(`${LONG}f"x"`).code).toBe("E_LEX");
  });

  test("only a token that begins with the tag counts", () => {
    expect(readFails('xtlp"1,2"').code).toBe("E_LEX");
    expect(readFails('a.tlp"1,2"').code).toBe("E_LEX");
    expect(readFails('TLP"1,2"').code).toBe("E_LEX");
  });

  test("a tag with no quote directly after it is an ordinary word", () => {
    expect(tokens("tlp tl-text").map((t) => t.kind)).toEqual(["word", "word", "eof"]);
    expect(tokens('tlp "1,2"').map((t) => t.kind)).toEqual(["word", "str", "eof"]);
  });

  test("a tag inside a string, a block comment or a line comment is not a literal", () => {
    expect(tokens('"tlp\\"1,2\\""')[0]).toMatchObject({ kind: "str", value: 'tlp"1,2"' });
    expect(tokens('( tlp"1,2" ) 1').map((t) => t.kind)).toEqual(["int", "eof"]);
    expect(tokens('\\ tlp"x\n1').map((t) => t.kind)).toEqual(["int", "eof"]);
  });

  test("an unterminated literal is E_LEX at the start of the token", () => {
    const e = readFails('1 tlp"1,2');
    expect(e.code).toBe("E_LEX");
    expect(e.pos).toMatchObject({ line: 1, col: 3 });
    expect(readFails('tlp"').code).toBe("E_LEX");
    expect(readFails('tlp"abc\\').code).toBe("E_LEX");
  });

  test("a bad escape is E_LEX at the backslash", () => {
    const e = readFails('tlp"12\\q"');
    expect(e.code).toBe("E_LEX");
    expect(e.pos).toMatchObject({ col: 7 });
    expect(readFails('tlp"\\x4"').code).toBe("E_LEX");
    expect(readFails('tlp"\\u{D800}"').code).toBe("E_LEX");
    expect(readFails('tlp"\\u{1234567}"').code).toBe("E_LEX");
  });

  test("a literal must be followed by white space or the end of input", () => {
    expect(readFails('tlp"1,2"x').code).toBe("E_LEX");
    expect(tokens('tlp"1,2"').length).toBe(2);
    expect(tokens('tlp"1,2"\n').length).toBe(2);
  });

  test("a huge literal reads as one token, and maxSourceChars still bounds the source", () => {
    const body = "7".repeat(2_000_000);
    const t = read(`tl-text"${body}"`, { literalTags: TAGS, maxSourceChars: 3_000_000 })[0];
    expect((t as Tstr).value).toHaveLength(2_000_000);
    expect(() => read(`tl-text"${body}"`, { literalTags: TAGS, maxSourceChars: 1000 })).toThrow(
      /maxSourceChars/,
    );
  });

  test("many escapes in a long body stay linear", () => {
    const body = "\\n".repeat(200_000);
    const t = read(`tl-text"${body}"`, { literalTags: TAGS })[0] as Tstr;
    expect(t.value).toHaveLength(200_000);
    expect(t.escapeAt).toBe(0);
  });
});

describe("compiler: evaluation and errors", () => {
  test("a tagged literal is a value", async () => {
    const r = await run('tlp"3,4" tl:pa .');
    expect(r.ok && r.output).toBe("3\n");
  });

  test("a tag registered after the runtime was created is read", async () => {
    const rt = createRuntime({ primitives: prims });
    registerLiteralTag({ tag: "tl-late", kind: "tl-pair", parse });
    const r = await rt.run('tl-late"5,6" tl:pa .');
    expect(r.ok && r.output).toBe("5\n");
  });

  test("a bad body reports the character's own position", async () => {
    const e = await error('tlp"1;2"');
    expect(e.code).toBe("E_SYNTAX");
    expect(e.pos).toMatchObject({ line: 1, col: 6, offset: 5 });
    expect(e.detail).toMatchObject({ kind: "tl-pair", offset: 1 });
  });

  test("columns count UTF-16 units, as the reader does", async () => {
    // The emoji is two units; the bad character is the `!` after it, at body offset 2.
    const e = await error('1 tl-lines"\u{1F600}!"');
    expect(e.pos).toMatchObject({ line: 1, col: 14 });
  });

  test("a raw line break before the bad character moves the line", async () => {
    let e = await error('tl-lines"ab\ncd!"');
    expect(e.pos).toMatchObject({ line: 2, col: 3 });
    e = await error('tl-lines"ab\r\ncd!"');
    expect(e.pos).toMatchObject({ line: 2, col: 3 });
    e = await error('tl-lines"ab\rc!"');
    expect(e.pos).toMatchObject({ line: 2, col: 2 });
  });

  test("an escape at or before the bad character puts the error at the literal", async () => {
    let e = await error('  tlp"1\\x3b2"');
    expect(e.pos).toMatchObject({ col: 3 });
    // The bad character comes before the first escape: its own position.
    e = await error('tlp"1;\\x32"');
    expect(e.pos).toMatchObject({ col: 6 });
  });

  test("a parse error without a usable offset is at the literal, with the message", async () => {
    for (const tag of ["tl-rough", "tl-far"]) {
      const e = await error(`1 ${tag}"abc"`);
      expect(e.code).toBe("E_SYNTAX");
      expect(e.pos).toMatchObject({ col: 3 });
      expect(e.detail.offset).toBeUndefined();
      expect(e.detail.kind).toBe("tl-text");
    }
    expect((await error('tl-rough"x"')).message).toContain("rough");
  });

  test("a tag whose kind is not registered is E_SYNTAX", async () => {
    const e = await error('tl-nokind"x"');
    expect(e.code).toBe("E_SYNTAX");
    expect(e.detail.reason).toBe("unregistered kind");
  });

  test("a literal over maxValueBytes is E_LIMIT_VALUE at the literal", async () => {
    const e = await error(`1 tl-text"${"x".repeat(200)}"`, { maxValueBytes: 100 });
    expect(e.code).toBe("E_LIMIT_VALUE");
    expect(e.pos).toMatchObject({ col: 3 });
    const ok = await run(`tl-text"${"x".repeat(100)}" tl:len .`, { maxValueBytes: 100 });
    expect(ok.ok && ok.output).toBe("100\n");
  });

  test("a large accepted literal compiles and runs", async () => {
    const body = "y".repeat(500_000);
    const r = await run(`tl-text"${body}" tl:len .`, { maxSourceChars: 600_000 });
    expect(r.ok && r.output).toBe("500000\n");
  });

  test("hash: the literal is part of a word's hash; other words are unaffected", () => {
    const rt = createRuntime({ primitives: prims });
    rt.load(
      ': a ( -- ext{tl-pair} ) tlp"1,2" ;\n: b ( -- ext{tl-pair} ) tlp"1,3" ;\n: c ( -- int ) 7 ;',
    );
    const hash = (w: string): string => rt.meta(`user:${w}`).hash;
    expect(hash("a")).not.toBe(hash("b"));
    const rt2 = createRuntime({ primitives: prims });
    rt2.load(": c ( -- int ) 7 ;");
    expect(rt2.meta("user:c").hash).toBe(hash("c"));
    expect(hash("c")).not.toBe("");
  });

  test("a tagged literal as a CONSTANT is an ext constant", async () => {
    const r = await run('tlp"8,9" CONSTANT eight\neight tl:pa .');
    expect(r.ok && r.output).toBe("8\n");
  });
});
