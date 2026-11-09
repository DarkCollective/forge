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
/**
 * The FL reader (spec section 2): source text to tokens. Pure, and it never looks at a dictionary.
 *
 * Conventions chosen where the spec leaves room:
 *  - A leading U+FEFF is skipped. Offsets index the original string (so they include the BOM); the
 *    column of the first line does not count it.
 *  - A lexical error is reported at the start of the offending token, except where the spec names a
 *    place: the backslash of a bad escape, the opening quote of an unterminated string, the `(` of an
 *    unterminated comment or header, the bad element of a byte array, and the Zs/Zl/Zp/Cf character.
 *  - Reserved words (`VOCAB`, `CONSTANT`, `recurse`, ...) are ordinary `word` tokens; the compiler
 *    rejects them in defining positions (E_NAME).
 */
import { ForgeError } from "./errors.js";
import { DEFAULT_LIMITS } from "./types.js";
import type { ReadOptions, SourcePos, Token } from "./types.js";
import { normaliseInt } from "./values.js";

/** Zs, Zl, Zp and Cf characters are never part of a token (spec 2.1). */
const INVISIBLE = /[\p{Zs}\p{Zl}\p{Zp}\p{Cf}]/u;

const DEC_INT = /^-?[0-9]+(?:_[0-9]+)*$/;
const HEX_INT = /^-?0x[0-9a-fA-F]+(?:_[0-9a-fA-F]+)*$/;
const BIN_INT = /^-?0b[01]+(?:_[01]+)*$/;
const DIGITS = "[0-9]+(?:_[0-9]+)*";
const EXPONENT = `[eE][+-]?${DIGITS}`;
const FLOAT = new RegExp(`^-?${DIGITS}(?:\\.${DIGITS}(?:${EXPONENT})?|${EXPONENT})$`);
const HEX_BYTE = /^[0-9a-fA-F]{2}$/;
const VOCAB_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/** The ASCII symbol characters allowed in word names. */
const SYMBOLS = "!$%&*+,./<=>?@^|~";
/** Tokens that are `word` tokens by rule 9 even though they contain `:`. */
const COLON_KEYWORDS: ReadonlySet<string> = new Set([":", ";", "IN:", "USING:", "META:"]);
const MAX_WORD_NAME = 128;

const CH_TAB = 0x09;
const CH_LF = 0x0a;
const CH_VT = 0x0b;
const CH_FF = 0x0c;
const CH_CR = 0x0d;
const CH_SPACE = 0x20;
const CH_QUOTE = 0x22;
const CH_APOS = 0x27;
const CH_BACKSLASH = 0x5c;

/** The six whitespace characters of spec 2.1. */
function isWs(c: number): boolean {
  return c === CH_SPACE || c === CH_TAB || c === CH_LF || c === CH_CR || c === CH_VT || c === CH_FF;
}

function isDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}

/** Start offset of each line; CRLF is one break, a lone CR is a break. */
function lineStartsOf(src: string, first: number): number[] {
  const starts = [first];
  for (let i = first; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if (c === CH_LF) {
      starts.push(i + 1);
    } else if (c === CH_CR) {
      if (src.charCodeAt(i + 1) === CH_LF) i++;
      starts.push(i + 1);
    }
  }
  return starts;
}

/** Result of reading one escape sequence. */
interface Escape {
  readonly cp: number;
  readonly next: number;
}

const SIMPLE_ESCAPES: Readonly<Record<string, number>> = {
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  "0": 0x00,
  "\\": 0x5c,
  '"': 0x22,
};

/**
 * Reads the escape whose backslash is at `bs`. Strings also accept `\"`; char literals accept `\'`
 * and `\"`. Returns null when the escape is invalid (including one cut short by the end of input).
 */
function readEscape(src: string, bs: number, inChar: boolean): Escape | null {
  const e = src[bs + 1];
  if (e === undefined) return null;
  const simple = SIMPLE_ESCAPES[e];
  if (simple !== undefined) return { cp: simple, next: bs + 2 };
  if (inChar && e === "'") return { cp: 0x27, next: bs + 2 };
  if (e === "x") {
    const h = src.slice(bs + 2, bs + 4);
    if (!HEX_BYTE.test(h)) return null;
    return { cp: parseInt(h, 16), next: bs + 4 };
  }
  if (e === "u" && src[bs + 2] === "{") {
    let j = bs + 3;
    while (j < bs + 10 && /[0-9a-fA-F]/.test(src[j] ?? "")) j++;
    const digits = j - (bs + 3);
    if (digits < 1 || digits > 6 || src[j] !== "}") return null;
    const cp = parseInt(src.slice(bs + 3, j), 16);
    if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
    return { cp, next: j + 1 };
  }
  return null;
}

/** Whether `c` (one ASCII character) may occur in a word name. */
function isAsciiNameChar(c: string): boolean {
  return (
    (c >= "a" && c <= "z") ||
    (c >= "A" && c <= "Z") ||
    (c >= "0" && c <= "9") ||
    c === "_" ||
    c === "-" ||
    SYMBOLS.includes(c)
  );
}

/** Whether `s` is a word-name (1 to 128 code points, spec 2.11); a number-like start is rejected. */
function isWordName(s: string): boolean {
  const first = s.charCodeAt(0);
  if (isDigit(first) || (first === 0x2d && isDigit(s.charCodeAt(1)))) return false;
  let count = 0;
  for (const ch of s) {
    if (++count > MAX_WORD_NAME) return false;
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x80) {
      if (!isAsciiNameChar(ch)) return false;
    } else if (cp <= 0x9f) {
      return false; // Cc
    }
  }
  return count > 0;
}

/** The reader (`ReadFn`, spec 2.13). */
export function read(source: string, opts?: ReadOptions): Token[] {
  const maxSourceChars = opts?.maxSourceChars ?? DEFAULT_LIMITS.maxSourceChars;
  const maxIntBits = opts?.maxIntBits ?? DEFAULT_LIMITS.maxIntBits;
  if (source.length > maxSourceChars) {
    throw new ForgeError({
      code: "E_LIMIT_SOURCE",
      message: `source of ${source.length} characters exceeds maxSourceChars ${maxSourceChars}`,
      detail: { limit: maxSourceChars, value: source.length },
    });
  }
  const src = source;
  const n = src.length;
  const bom = src.charCodeAt(0) === 0xfeff ? 1 : 0;
  const lineStarts = lineStartsOf(src, bom);

  const posAt = (offset: number): SourcePos => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((lineStarts[mid] as number) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { offset, line: lo + 1, col: offset - (lineStarts[lo] as number) + 1 };
  };

  const lex = (message: string, offset: number): ForgeError =>
    new ForgeError({ code: "E_LEX", message, pos: posAt(offset) });

  const tokens: Token[] = [];

  /** Index of the first standalone `)` at or after `from`, or -1. */
  const findClose = (from: number, trackStrings: boolean): number => {
    for (let k = from; k < n; k++) {
      const c = src.charCodeAt(k);
      if (c === CH_QUOTE && trackStrings) {
        for (k++; k < n && src.charCodeAt(k) !== CH_QUOTE; k++) {
          if (src.charCodeAt(k) === CH_BACKSLASH) k++;
        }
        if (k >= n) return -1;
      } else if (
        c === 0x29 &&
        isWs(src.charCodeAt(k - 1)) &&
        (k + 1 >= n || isWs(src.charCodeAt(k + 1)))
      ) {
        return k;
      }
    }
    return -1;
  };

  /** A literal must be followed by whitespace or the end of the input. */
  const checkLiteralEnd = (end: number, start: number, what: string): void => {
    if (end < n && !isWs(src.charCodeAt(end))) {
      throw lex(`${what} must be followed by whitespace`, start);
    }
  };

  let i = bom;
  while (i < n) {
    const c = src.charCodeAt(i);
    if (isWs(c)) {
      i++;
      continue;
    }
    const start = i;

    if (c === CH_QUOTE) {
      // String literal (2.6).
      let seg = i + 1;
      let value = "";
      let k = seg;
      for (;;) {
        if (k >= n) throw lex("unterminated string", start);
        const d = src.charCodeAt(k);
        if (d === CH_QUOTE) break;
        if (d === CH_BACKSLASH) {
          value += src.slice(seg, k);
          const esc = readEscape(src, k, false);
          if (esc === null) throw lex("invalid escape in string", k);
          value += String.fromCodePoint(esc.cp);
          k = esc.next;
          seg = k;
        } else {
          k++;
        }
      }
      value += src.slice(seg, k);
      i = k + 1;
      checkLiteralEnd(i, start, "string literal");
      tokens.push({
        kind: "str",
        value,
        text: src.slice(start, i),
        pos: posAt(start),
        end: posAt(i),
      });
      continue;
    }

    if (c === CH_APOS) {
      // Char literal (2.7).
      let k = i + 1;
      const d = src.charCodeAt(k);
      if (k >= n || d === CH_LF || d === CH_CR || d === CH_APOS) {
        throw lex("bad char literal", start);
      }
      let cp: number;
      if (d === CH_BACKSLASH) {
        const esc = readEscape(src, k, true);
        if (esc === null) throw lex("invalid escape in char literal", k);
        cp = esc.cp;
        k = esc.next;
      } else {
        cp = src.codePointAt(k) as number;
        k += cp > 0xffff ? 2 : 1;
      }
      if (src.charCodeAt(k) !== CH_APOS)
        throw lex("a char literal is exactly one code point", start);
      i = k + 1;
      checkLiteralEnd(i, start, "char literal");
      tokens.push({
        kind: "char",
        value: cp,
        text: src.slice(start, i),
        pos: posAt(start),
        end: posAt(i),
      });
      continue;
    }

    let j = i + 1;
    while (j < n && !isWs(src.charCodeAt(j))) j++;
    const run = src.slice(i, j);

    if (run === "\\") {
      // Line comment (rule 1).
      while (j < n && src.charCodeAt(j) !== CH_LF && src.charCodeAt(j) !== CH_CR) j++;
      i = j;
      continue;
    }

    if (run === "(") {
      // Header (2.8) or block comment (2.9).
      const a = tokens[tokens.length - 2];
      const b = tokens[tokens.length - 1];
      const isHeader =
        a !== undefined &&
        b !== undefined &&
        a.kind === "word" &&
        a.text === ":" &&
        (b.kind === "word" || b.kind === "qword");
      const close = findClose(j, isHeader);
      if (close < 0) {
        throw lex(isHeader ? "unterminated header" : "unterminated block comment", start);
      }
      if (isHeader) {
        tokens.push({
          kind: "header",
          headerText: src.slice(start + 1, close),
          headerTextPos: posAt(start + 1),
          text: src.slice(start, close + 1),
          pos: posAt(start),
          end: posAt(close + 1),
        });
      }
      i = close + 1;
      continue;
    }

    if (run === "#[") {
      // Byte-array literal (2.10).
      const out: number[] = [];
      let k = j;
      for (;;) {
        while (k < n && isWs(src.charCodeAt(k))) k++;
        if (k >= n) throw lex("unterminated byte-array literal", start);
        let m = k + 1;
        while (m < n && !isWs(src.charCodeAt(m))) m++;
        const el = src.slice(k, m);
        if (el === "]") break;
        if (!HEX_BYTE.test(el)) {
          const inv = el.search(INVISIBLE);
          throw lex("bad byte element", k + (inv < 0 ? 0 : inv));
        }
        out.push(parseInt(el, 16));
        k = m;
      }
      i = k + 1;
      tokens.push({
        kind: "bytes",
        value: Uint8Array.from(out),
        text: src.slice(start, i),
        pos: posAt(start),
        end: posAt(i),
      });
      continue;
    }

    i = j;
    const inv = run.search(INVISIBLE);
    if (inv >= 0) throw lex("invisible character inside a token", start + inv);
    const pos = posAt(start);
    const end = posAt(j);

    if (run === "[") {
      tokens.push({ kind: "lbracket", text: run, pos, end });
    } else if (run === "]") {
      tokens.push({ kind: "rbracket", text: run, pos, end });
    } else if (run === "{") {
      tokens.push({ kind: "lbrace", text: run, pos, end });
    } else if (run === "}") {
      tokens.push({ kind: "rbrace", text: run, pos, end });
    } else if (isDigit(c) || (c === 0x2d && isDigit(src.charCodeAt(start + 1)))) {
      // Number (2.4, 2.5).
      const neg = c === 0x2d;
      let radix = "";
      if (HEX_INT.test(run)) radix = "0x";
      else if (BIN_INT.test(run)) radix = "0b";
      if (radix !== "" || DEC_INT.test(run)) {
        const digits = run.slice((neg ? 1 : 0) + radix.length).replaceAll("_", "");
        const big = BigInt(radix + digits);
        try {
          const value = normaliseInt(neg ? -big : big, maxIntBits);
          tokens.push({ kind: "int", value, text: run, pos, end });
        } catch (e) {
          throw (e as ForgeError).with({ pos });
        }
      } else if (FLOAT.test(run)) {
        const value = Number(run.replaceAll("_", ""));
        if (!Number.isFinite(value)) throw lex("float literal overflows", start);
        tokens.push({ kind: "float", value, text: run, pos, end });
      } else {
        throw lex("malformed number", start);
      }
    } else if (run === "true" || run === "false") {
      tokens.push({ kind: "bool", value: run === "true", text: run, pos, end });
    } else if (COLON_KEYWORDS.has(run)) {
      tokens.push({ kind: "word", text: run, pos, end });
    } else if (run.includes(":")) {
      const colon = run.indexOf(":");
      const vocab = run.slice(0, colon);
      const name = run.slice(colon + 1);
      if (!VOCAB_NAME.test(vocab) || name.includes(":") || !isWordName(name)) {
        throw lex("bad qualified name", start);
      }
      tokens.push({ kind: "qword", vocab, name, text: run, pos, end });
    } else {
      if (!isWordName(run)) throw lex("invalid character in name", start);
      tokens.push({ kind: "word", text: run, pos, end });
    }
  }

  const eof = posAt(n);
  tokens.push({ kind: "eof", text: "", pos: eof, end: eof });
  return tokens;
}
