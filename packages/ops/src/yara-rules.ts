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
 * The YARA rule parser (WP 5.58). A documented subset of the YARA 4 language is read into a tree; anything
 * outside the subset is `E_COERCE` with the line and column, never skipped. See the "YARA Rules (WP 5.58)"
 * section of the ops README for the exact subset. The parser is a plain recursive descent with a depth
 * limit, and it allocates in proportion to the rule text only (which is capped).
 *
 * This module has no regular expression of its own: the YARA regex syntax is translated to the ECMAScript
 * pattern text here (`translateRegex`) and run only through the regex seam (`src/regex-engine.ts`).
 */
import { coerceFailure } from "./prim-util.js";
import { testAny } from "./regex-engine.js";

export const MAX_RULE_TEXT = 1_048_576;
export const MAX_RULES = 5_000;
export const MAX_STRINGS = 20_000;
export const MAX_DEPTH = 100;
const MAX_REPEAT = 1000;

// ---------------------------------------------------------------------------------------------
// the tree
// ---------------------------------------------------------------------------------------------

export type HexItem =
  | { k: "b"; val: number; mask: number; neg: boolean }
  | { k: "j"; lo: number; hi: number }
  | { k: "a"; alts: HexItem[][] };

export interface TextModifiers {
  ascii: boolean;
  wide: boolean;
  nocase: boolean;
  fullword: boolean;
  xor: [number, number] | null;
  base64: string | null;
  base64wide: string | null;
}

export type StringDef = {
  id: string;
  isPrivate: boolean;
  fullword: boolean;
  at: number;
  used: boolean;
} & (
  | { kind: "text"; bytes: Uint8Array; mods: TextModifiers }
  | { kind: "hex"; items: HexItem[] }
  | { kind: "regex"; pattern: string; flags: string; ascii: boolean }
);

export type Expr =
  | { t: "int"; v: bigint }
  | { t: "bool"; v: boolean }
  | { t: "filesize" }
  | { t: "str"; i: number }
  | { t: "cnt"; i: number }
  | { t: "cntin"; i: number; lo: Expr; hi: Expr }
  | { t: "off"; i: number; idx: Expr | null }
  | { t: "len"; i: number; idx: Expr | null }
  | { t: "at"; i: number; e: Expr }
  | { t: "in"; i: number; lo: Expr; hi: Expr }
  | { t: "rd"; size: 1 | 2 | 4; signed: boolean; be: boolean; e: Expr }
  | { t: "bin"; op: string; a: Expr; b: Expr }
  | { t: "neg"; a: Expr }
  | { t: "bnot"; a: Expr }
  | { t: "cmp"; op: string; a: Expr; b: Expr }
  | { t: "and"; a: Expr; b: Expr }
  | { t: "or"; a: Expr; b: Expr }
  | { t: "not"; a: Expr }
  | { t: "var"; slot: number }
  | { t: "rule"; i: number }
  | { t: "of"; q: Quant; set: number[]; at: Expr | null; range: [Expr, Expr] | null }
  | { t: "forof"; q: Quant; set: number[]; body: Expr }
  | {
      t: "forin";
      q: Quant;
      slot: number;
      lo: Expr | null;
      hi: Expr | null;
      list: Expr[] | null;
      body: Expr;
    }
  | { t: "cur"; what: "str" | "cnt" | "off" | "len" };

export type Quant =
  { k: "any" } | { k: "all" } | { k: "none" } | { k: "n"; e: Expr } | { k: "pct"; e: Expr };

export type MetaValue =
  { kind: "str"; v: string } | { kind: "int"; v: bigint } | { kind: "bool"; v: boolean };

export interface Rule {
  name: string;
  tags: string[];
  isPrivate: boolean;
  isGlobal: boolean;
  meta: { key: string; value: MetaValue }[];
  strings: StringDef[];
  cond: Expr;
  slots: number;
}

// ---------------------------------------------------------------------------------------------
// the parser
// ---------------------------------------------------------------------------------------------

const KEYWORDS_UNSUPPORTED = new Set([
  "matches",
  "contains",
  "icontains",
  "startswith",
  "istartswith",
  "endswith",
  "iendswith",
  "iequals",
  "defined",
  "entrypoint",
  "import",
  "include",
]);

const RESERVED = new Set([
  "all",
  "and",
  "any",
  "ascii",
  "at",
  "base64",
  "base64wide",
  "condition",
  "false",
  "filesize",
  "for",
  "fullword",
  "global",
  "in",
  "meta",
  "nocase",
  "none",
  "not",
  "of",
  "or",
  "private",
  "rule",
  "strings",
  "them",
  "true",
  "wide",
  "xor",
]);

type Tok = {
  k: "int" | "id" | "sv" | "cv" | "ov" | "lv" | "p" | "str" | "end";
  s: string;
  n?: bigint;
  at: number;
};

const isIdStart = (c: string): boolean =>
  (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
const isDigit = (c: string): boolean => c >= "0" && c <= "9";
const isIdChar = (c: string): boolean => isIdStart(c) || isDigit(c);
const isHex = (c: string): boolean =>
  isDigit(c) || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");

const INT64_MAX = (1n << 63n) - 1n;

class Parser {
  i = 0;
  depth = 0;
  rules: Rule[] = [];
  ruleIndex = new Map<string, number>();
  toks: Tok[] = [];
  ti = 0;
  // per-rule state
  strs: StringDef[] = [];
  slots = 0;
  curDepth = 0; // nesting of for-of bodies where an anonymous $ is allowed
  constructor(readonly src: string) {}

  where(at: number): string {
    let line = 1;
    let col = 1;
    const end = Math.min(at, this.src.length);
    for (let k = 0; k < end; k++) {
      if (this.src.charCodeAt(k) === 10) {
        line++;
        col = 1;
      } else col++;
    }
    return `line ${line}, column ${col}`;
  }
  fail(msg: string, at: number = this.i): never {
    throw coerceFailure("YARA rules", "a rule set", `${this.where(at)}: ${msg}`);
  }
  unsupported(what: string, at: number = this.i): never {
    return this.fail(`${what} is not supported (see the YARA subset in the README)`, at);
  }
  enter(at: number): void {
    if (++this.depth > MAX_DEPTH) this.fail(`nesting deeper than ${MAX_DEPTH} levels`, at);
  }
  leave(): void {
    this.depth--;
  }

  // ---- characters ----
  ws(): void {
    const s = this.src;
    for (;;) {
      const c = s.charAt(this.i);
      if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v") this.i++;
      else if (c === "/" && s.charAt(this.i + 1) === "/") {
        while (this.i < s.length && s.charAt(this.i) !== "\n") this.i++;
      } else if (c === "/" && s.charAt(this.i + 1) === "*") {
        const e = s.indexOf("*/", this.i + 2);
        if (e < 0) this.fail("unterminated comment");
        this.i = e + 2;
      } else return;
    }
  }
  word(): string {
    this.ws();
    const st = this.i;
    if (!isIdStart(this.src.charAt(st))) return "";
    let j = st;
    while (isIdChar(this.src.charAt(j))) j++;
    return this.src.slice(st, j);
  }
  takeWord(): string {
    const w = this.word();
    this.i += w.length;
    return w;
  }
  expectWord(w: string): void {
    const got = this.word();
    if (got !== w) this.fail(`expected '${w}'${got === "" ? "" : `, found '${got}'`}`);
    this.i += w.length;
  }
  peekCh(): string {
    this.ws();
    return this.src.charAt(this.i);
  }
  expectCh(c: string): void {
    if (this.peekCh() !== c) this.fail(`expected '${c}'`);
    this.i++;
  }

  // ---- literals ----
  /** A quoted string with YARA escapes, as bytes (the text is UTF-8). `i` is at the opening quote. */
  stringLiteral(): Uint8Array {
    const s = this.src;
    const start = this.i;
    this.i++;
    const out: number[] = [];
    const enc = new TextEncoder();
    for (;;) {
      if (this.i >= s.length) this.fail("unterminated string", start);
      const c = s.charAt(this.i);
      if (c === '"') {
        this.i++;
        break;
      }
      if (c === "\n") this.fail("unterminated string", start);
      if (c === "\\") {
        const e = s.charAt(this.i + 1);
        if (e === "n") out.push(10);
        else if (e === "t") out.push(9);
        else if (e === "r") out.push(13);
        else if (e === '"') out.push(34);
        else if (e === "\\") out.push(92);
        else if (e === "x" && isHex(s.charAt(this.i + 2)) && isHex(s.charAt(this.i + 3))) {
          out.push(parseInt(s.slice(this.i + 2, this.i + 4), 16));
          this.i += 2;
        } else this.fail("illegal escape sequence in a string", this.i);
        this.i += 2;
        continue;
      }
      const cp = s.codePointAt(this.i) as number;
      const ch = String.fromCodePoint(cp);
      for (const b of enc.encode(ch)) out.push(b);
      this.i += ch.length;
      if (out.length > 1_000_000) this.fail("string longer than 1,000,000 bytes", start);
    }
    return Uint8Array.from(out);
  }
  decode(b: Uint8Array): string {
    // meta strings are shown as text: bytes that are not UTF-8 are shown as Latin-1
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(b);
    } catch {
      let r = "";
      for (const x of b) r += String.fromCharCode(x);
      return r;
    }
  }
  intLiteral(): bigint {
    this.ws();
    const s = this.src;
    const st = this.i;
    let neg = false;
    if (s.charAt(this.i) === "-") {
      neg = true;
      this.i++;
    }
    const t = this.readNumber();
    if (t === null) this.fail("expected an integer", st);
    return neg ? -t : t;
  }
  /** Reads an integer literal at `i` (decimal, 0x hex, KB or MB suffix); null when there is none. */
  readNumber(): bigint | null {
    const s = this.src;
    const st = this.i;
    if (!isDigit(s.charAt(st))) return null;
    let j = st;
    let v: bigint;
    if (s.charAt(j) === "0" && (s.charAt(j + 1) === "x" || s.charAt(j + 1) === "X")) {
      j += 2;
      const a = j;
      while (isHex(s.charAt(j))) j++;
      if (j === a) this.fail("malformed hexadecimal number", st);
      v = BigInt("0x" + s.slice(a, j));
    } else {
      while (isDigit(s.charAt(j))) j++;
      if (s.charAt(j) === "." && isDigit(s.charAt(j + 1)))
        this.unsupported("a floating point number", st);
      v = BigInt(s.slice(st, j));
    }
    if (s.startsWith("KB", j)) {
      v *= 1024n;
      j += 2;
    } else if (s.startsWith("MB", j)) {
      v *= 1048576n;
      j += 2;
    }
    if (isIdChar(s.charAt(j))) this.fail("malformed number", st);
    if (v > INT64_MAX) this.fail("integer literal does not fit in 64 bits", st);
    this.i = j;
    return v;
  }

  // ---- the file ----
  parseFile(): Rule[] {
    for (;;) {
      this.ws();
      if (this.i >= this.src.length) break;
      const w = this.word();
      if (w === "import") {
        this.i += w.length;
        this.ws();
        let name = "";
        if (this.src.charAt(this.i) === '"') name = this.decode(this.stringLiteral());
        this.fail(
          `the module "${name}" is not supported (no YARA modules are available: pe, elf, math, hash, ...)`,
        );
      }
      if (w === "include") this.unsupported('"include"');
      this.rule();
      if (this.rules.length > MAX_RULES) this.fail(`more than ${MAX_RULES} rules`);
    }
    return this.rules;
  }

  rule(): void {
    let isPrivate = false;
    let isGlobal = false;
    for (;;) {
      const w = this.word();
      if (w === "private") {
        if (isPrivate) this.fail("duplicate 'private'");
        isPrivate = true;
        this.i += w.length;
      } else if (w === "global") {
        if (isGlobal) this.fail("duplicate 'global'");
        isGlobal = true;
        this.i += w.length;
      } else break;
    }
    if (this.word() !== "rule") this.fail("expected 'rule'");
    this.i += 4;
    this.ws();
    const nameAt = this.i;
    const name = this.takeWord();
    if (name === "") this.fail("expected a rule name");
    if (RESERVED.has(name))
      this.fail(`'${name}' is a reserved word and cannot be a rule name`, nameAt);
    if (this.ruleIndex.has(name)) this.fail(`duplicated rule name "${name}"`, nameAt);
    const tags: string[] = [];
    if (this.peekCh() === ":") {
      this.i++;
      for (;;) {
        this.ws();
        if (this.src.charAt(this.i) === "{") break;
        const tAt = this.i;
        const t = this.takeWord();
        if (t === "" || RESERVED.has(t)) this.fail("expected a tag name", tAt);
        tags.push(t);
      }
    }
    this.expectCh("{");
    this.strs = [];
    this.slots = 0;
    const meta: Rule["meta"] = [];
    let w = this.word();
    if (w === "meta") {
      this.i += 4;
      this.expectCh(":");
      for (;;) {
        const k = this.word();
        if (k === "" || k === "strings" || k === "condition") break;
        if (RESERVED.has(k) && k !== "private") this.fail(`'${k}' is a reserved word`);
        this.i += k.length;
        this.expectCh("=");
        this.ws();
        const c = this.src.charAt(this.i);
        let value: MetaValue;
        if (c === '"') value = { kind: "str", v: this.decode(this.stringLiteral()) };
        else if (c === "-" || isDigit(c)) value = { kind: "int", v: this.intLiteral() };
        else {
          const b = this.word();
          if (b !== "true" && b !== "false")
            this.fail("expected a string, an integer, true or false");
          this.i += b.length;
          value = { kind: "bool", v: b === "true" };
        }
        meta.push({ key: k, value });
      }
      w = this.word();
    }
    if (w === "strings") {
      this.i += 7;
      this.expectCh(":");
      this.stringsSection();
      w = this.word();
    }
    if (w !== "condition") this.fail("expected 'condition'");
    this.i += 9;
    this.expectCh(":");
    const cond = this.condition();
    for (const s of this.strs) {
      if (!s.used) this.fail(`unreferenced string "$${s.id}"`, s.at);
    }
    this.expectCh("}");
    this.ruleIndex.set(name, this.rules.length);
    this.rules.push({
      name,
      tags,
      isPrivate,
      isGlobal,
      meta,
      strings: this.strs,
      cond,
      slots: this.slots,
    });
  }

  // ---- strings ----
  stringsSection(): void {
    for (;;) {
      this.ws();
      if (this.src.charAt(this.i) !== "$") break;
      const at = this.i;
      this.i++;
      let j = this.i;
      while (isIdChar(this.src.charAt(j))) j++;
      const id = this.src.slice(this.i, j);
      this.i = j;
      if (id !== "" && this.strs.some((s) => s.id === id))
        this.fail(`duplicated string identifier "$${id}"`, at);
      this.expectCh("=");
      this.ws();
      const c = this.src.charAt(this.i);
      const base = { id, isPrivate: false, fullword: false, used: false, at };
      let def: StringDef;
      if (c === '"') def = this.textString(base);
      else if (c === "{") def = this.hexString(base);
      else if (c === "/") def = this.regexString(base);
      else return this.fail("expected a text string, a hex string or a regular expression");
      if (this.strs.length >= MAX_STRINGS) this.fail(`more than ${MAX_STRINGS} strings in a rule`);
      this.strs.push(def);
    }
  }

  textString(base: Omit<StringDef, "kind">): StringDef {
    const at = this.i;
    const bytes = this.stringLiteral();
    if (bytes.length === 0) this.fail("empty string", at);
    const mods: TextModifiers = {
      ascii: false,
      wide: false,
      nocase: false,
      fullword: false,
      xor: null,
      base64: null,
      base64wide: null,
    };
    let isPrivate = false;
    const seen = new Set<string>();
    for (;;) {
      const w = this.word();
      if (w === "") break;
      if (
        !["ascii", "wide", "nocase", "fullword", "xor", "base64", "base64wide", "private"].includes(
          w,
        )
      )
        break;
      const wAt = this.i;
      this.i += w.length;
      if (seen.has(w)) this.fail(`duplicated modifier '${w}'`, wAt);
      seen.add(w);
      if (w === "ascii") mods.ascii = true;
      else if (w === "wide") mods.wide = true;
      else if (w === "nocase") mods.nocase = true;
      else if (w === "fullword") mods.fullword = true;
      else if (w === "private") isPrivate = true;
      else if (w === "xor") {
        mods.xor = [0, 255];
        if (this.src.charAt(this.i) === "(") {
          this.i++;
          const lo = this.intLiteral();
          let hi = lo;
          this.ws();
          if (this.src.charAt(this.i) === "-") {
            this.i++;
            hi = this.intLiteral();
          }
          this.expectCh(")");
          if (lo < 0n || hi > 255n || lo > hi)
            this.fail("the xor range must be within 0 to 255, low to high", wAt);
          mods.xor = [Number(lo), Number(hi)];
        }
      } else {
        // base64 / base64wide with an optional 64-character alphabet
        let alpha = STD_ALPHABET;
        if (this.src.charAt(this.i) === "(") {
          this.i++;
          this.ws();
          if (this.src.charAt(this.i) !== '"')
            this.fail("expected the base64 alphabet as a string");
          const a = this.stringLiteral();
          this.expectCh(")");
          if (a.length !== 64) this.fail("the base64 alphabet must be 64 bytes long", wAt);
          alpha = Array.from(a, (x) => String.fromCharCode(x)).join("");
          if (new Set(alpha).size !== 64)
            this.fail("the base64 alphabet must have 64 distinct bytes", wAt);
        }
        if (w === "base64") mods.base64 = alpha;
        else mods.base64wide = alpha;
      }
    }
    const b64 = mods.base64 !== null || mods.base64wide !== null;
    if (b64 && (mods.nocase || mods.fullword || mods.xor !== null || mods.wide))
      this.fail("base64 cannot be combined with nocase, fullword, xor or wide");
    if (mods.xor !== null && mods.nocase) this.fail("xor cannot be combined with nocase");
    if (!b64 && !mods.ascii && !mods.wide) mods.ascii = true;
    return { ...base, isPrivate, fullword: mods.fullword, kind: "text", bytes, mods };
  }

  regexString(base: Omit<StringDef, "kind">): StringDef {
    const s = this.src;
    const at = this.i;
    let j = this.i + 1;
    for (;;) {
      if (j >= s.length || s.charAt(j) === "\n") this.fail("unterminated regular expression", at);
      const c = s.charAt(j);
      if (c === "\\") j += 2;
      else if (c === "/") break;
      else j++;
    }
    const body = s.slice(this.i + 1, j);
    j++;
    let rflags = "";
    while (s.charAt(j) === "i" || s.charAt(j) === "s") {
      rflags += s.charAt(j);
      j++;
    }
    this.i = j;
    const pattern = translateRegex(body, rflags.includes("s"), (m, off) =>
      this.fail(m, at + 1 + off),
    );
    try {
      testAny(`(?=(${pattern}))`, rflags.includes("i") ? "i" : "", ""); // compiles it through the regex seam
    } catch (e) {
      this.fail(`invalid regular expression: ${e instanceof Error ? e.message : String(e)}`, at);
    }
    let nocase = rflags.includes("i");
    let ascii = false;
    let fullword = false;
    let isPrivate = false;
    const seen = new Set<string>();
    for (;;) {
      const w = this.word();
      if (
        !["ascii", "wide", "nocase", "fullword", "private", "xor", "base64", "base64wide"].includes(
          w,
        )
      )
        break;
      const wAt = this.i;
      this.i += w.length;
      if (seen.has(w)) this.fail(`duplicated modifier '${w}'`, wAt);
      seen.add(w);
      if (w === "ascii") ascii = true;
      else if (w === "nocase") nocase = true;
      else if (w === "fullword") fullword = true;
      else if (w === "private") isPrivate = true;
      else this.unsupported(`the '${w}' modifier on a regular expression`, wAt);
    }
    return {
      ...base,
      isPrivate,
      fullword,
      kind: "regex",
      pattern,
      flags: nocase ? "i" : "",
      ascii,
    };
  }

  hexString(base: Omit<StringDef, "kind">): StringDef {
    const at = this.i;
    this.i++;
    const items = this.hexSeq(true, 0);
    if (items.length === 0) this.fail("empty hex string", at);
    const bytesCount = { n: 0 };
    countStates(items, bytesCount);
    if (bytesCount.n > 65_536)
      this.fail("the hex string needs more than 65,536 states (jumps are too long)", at);
    let isPrivate = false;
    for (;;) {
      const w = this.word();
      if (w === "private") {
        isPrivate = true;
        this.i += 7;
      } else if (
        ["ascii", "wide", "nocase", "fullword", "xor", "base64", "base64wide"].includes(w)
      ) {
        this.fail(`the '${w}' modifier cannot be used on a hex string`);
      } else break;
    }
    return { ...base, isPrivate, kind: "hex", items };
  }

  /** The items up to '}' (top level) or up to '|' or ')' (inside an alternative). */
  hexSeq(top: boolean, depth: number): HexItem[] {
    this.enter(this.i);
    const items: HexItem[] = [];
    for (;;) {
      this.ws();
      const c = this.src.charAt(this.i);
      if (c === "") this.fail("unterminated hex string");
      if (c === "}") {
        if (!top) this.fail("unbalanced parenthesis in a hex string");
        this.i++;
        break;
      }
      if (c === "|" || c === ")") {
        if (top) this.fail(`unexpected '${c}' in a hex string`);
        break;
      }
      if (c === "(") {
        const at = this.i;
        this.i++;
        const alts: HexItem[][] = [];
        for (;;) {
          const alt = this.hexSeq(false, depth + 1);
          alts.push(alt);
          const d = this.src.charAt(this.i);
          this.i++;
          if (d === ")") break;
        }
        if (alts.length < 2) this.fail("an alternative needs at least two choices", at);
        items.push({ k: "a", alts });
        continue;
      }
      if (c === "[") {
        const at = this.i;
        this.i++;
        this.ws();
        let lo: number;
        let hi: number;
        const num = (): number | null => {
          this.ws();
          const a = this.i;
          while (isDigit(this.src.charAt(this.i))) this.i++;
          if (this.i === a) return null;
          const v = Number(this.src.slice(a, this.i));
          if (v > 32767) this.fail("a jump of more than 32,767 bytes", at);
          return v;
        };
        const first = num();
        this.ws();
        if (this.src.charAt(this.i) === "-") {
          this.i++;
          lo = first ?? 0;
          const second = num();
          hi = second ?? -1;
        } else {
          if (first === null) this.fail("invalid jump", at);
          lo = first;
          hi = first;
        }
        this.expectCh("]");
        if (hi !== -1 && lo > hi)
          this.fail("invalid jump: the lower bound is above the upper bound", at);
        if (lo === 0 && hi === 0) this.fail("invalid jump length", at);
        items.push({ k: "j", lo, hi });
        continue;
      }
      let neg = false;
      const at = this.i;
      if (c === "~") {
        neg = true;
        this.i++;
      }
      const h = this.src.charAt(this.i);
      const l = this.src.charAt(this.i + 1);
      const okDigit = (x: string): boolean => x === "?" || isHex(x);
      if (!okDigit(h) || !okDigit(l)) {
        if (okDigit(h) && !okDigit(l)) this.fail("an uneven number of digits in a hex string", at);
        this.fail(`unexpected '${c}' in a hex string`, at);
      }
      this.i += 2;
      let val = 0;
      let mask = 0;
      if (h !== "?") {
        val |= parseInt(h, 16) << 4;
        mask |= 0xf0;
      }
      if (l !== "?") {
        val |= parseInt(l, 16);
        mask |= 0x0f;
      }
      if (neg && mask === 0) this.fail("'~' cannot be applied to a wildcard", at);
      items.push({ k: "b", val, mask, neg });
    }
    this.leave();
    if (items.length === 0) this.fail(top ? "empty hex string" : "an empty choice in a hex string");
    const first = items[0] as HexItem;
    const last = items[items.length - 1] as HexItem;
    if (first.k === "j" || last.k === "j")
      this.fail("a jump cannot be at the start or the end of a hex string or choice");
    for (let k = 1; k < items.length; k++) {
      if ((items[k] as HexItem).k === "j" && (items[k - 1] as HexItem).k === "j")
        this.fail("two jumps in a row");
    }
    return items;
  }

  // ---- the condition ----
  tokenize(): void {
    const s = this.src;
    const toks: Tok[] = [];
    for (;;) {
      this.ws();
      const at = this.i;
      const c = s.charAt(at);
      if (c === "") this.fail("unterminated rule: expected '}'");
      if (c === "}") {
        toks.push({ k: "end", s: "}", at });
        break;
      }
      if (toks.length > 200_000) this.fail("the condition has more than 200,000 tokens");
      if (isIdStart(c)) {
        let j = at;
        while (isIdChar(s.charAt(j))) j++;
        toks.push({ k: "id", s: s.slice(at, j), at });
        this.i = j;
      } else if (isDigit(c)) {
        const n = this.readNumber() as bigint;
        toks.push({ k: "int", s: s.slice(at, this.i), n, at });
      } else if (c === '"') {
        this.unsupported("a string in a condition", at);
      } else if (c === "/") {
        this.unsupported("a regular expression in a condition ('matches' and its relatives)", at);
      } else if (c === "$" || c === "#" || c === "@" || (c === "!" && s.charAt(at + 1) !== "=")) {
        let j = at + 1;
        while (isIdChar(s.charAt(j))) j++;
        let name = s.slice(at + 1, j);
        if (c === "$" && s.charAt(j) === "*") {
          name += "*";
          j++;
        }
        toks.push({
          k: c === "$" ? "sv" : c === "#" ? "cv" : c === "@" ? "ov" : "lv",
          s: name,
          at,
        });
        this.i = j;
      } else {
        const two = s.slice(at, at + 2);
        if (["..", "<<", ">>", "<=", ">=", "==", "!="].includes(two)) {
          toks.push({ k: "p", s: two, at });
          this.i += 2;
        } else if ("()[],:+-*\\%~&|^<>=.".includes(c)) {
          toks.push({ k: "p", s: c, at });
          this.i++;
        } else this.fail(`unexpected character '${c}'`, at);
      }
    }
    this.toks = toks;
    this.ti = 0;
  }
  get tok(): Tok {
    return this.toks[this.ti] as Tok;
  }
  tokAt(k: number): Tok {
    return this.toks[Math.min(this.ti + k, this.toks.length - 1)] as Tok;
  }
  isP(s: string, k = 0): boolean {
    const t = this.tokAt(k);
    return t.k === "p" && t.s === s;
  }
  isW(s: string, k = 0): boolean {
    const t = this.tokAt(k);
    return t.k === "id" && t.s === s;
  }
  eatP(s: string): boolean {
    if (this.isP(s)) {
      this.ti++;
      return true;
    }
    return false;
  }
  needP(s: string): void {
    if (!this.eatP(s)) this.fail(`expected '${s}'`, this.tok.at);
  }

  condition(): Expr {
    this.tokenizeStart();
    const e = this.orExpr();
    if (this.tok.k !== "end") this.fail(`unexpected '${this.tok.s}' in the condition`, this.tok.at);
    this.i = this.tok.at; // at the closing brace
    return e;
  }
  tokenizeStart(): void {
    this.tokenize();
  }

  orExpr(): Expr {
    this.enter(this.tok.at);
    let a = this.andExpr();
    while (this.isW("or")) {
      this.ti++;
      a = { t: "or", a, b: this.andExpr() };
    }
    this.leave();
    return a;
  }
  andExpr(): Expr {
    let a = this.notExpr();
    while (this.isW("and")) {
      this.ti++;
      a = { t: "and", a, b: this.notExpr() };
    }
    return a;
  }
  notExpr(): Expr {
    if (this.isW("not")) {
      this.enter(this.tok.at);
      this.ti++;
      const e: Expr = { t: "not", a: this.notExpr() };
      this.leave();
      return e;
    }
    return this.cmpExpr();
  }

  quantWord(): Quant | null {
    const t = this.tok;
    if (t.k === "id" && (t.s === "any" || t.s === "all" || t.s === "none")) return { k: t.s };
    return null;
  }

  cmpExpr(): Expr {
    const t = this.tok;
    if (t.k === "id" && t.s === "for") return this.forExpr();
    if (t.k === "id" && (t.s === "any" || t.s === "all" || t.s === "none") && this.isW("of", 1)) {
      this.ti++;
      return this.ofExpr({ k: t.s });
    }
    if (t.k === "id" && KEYWORDS_UNSUPPORTED.has(t.s) && t.s !== "entrypoint")
      this.unsupported(`'${t.s}'`, t.at);
    const a = this.arith(0);
    if (this.isW("of") || (this.isP("%") && this.isW("of", 1))) {
      const pct = this.isP("%");
      if (pct) this.ti++;
      return this.ofExpr(pct ? { k: "pct", e: a } : { k: "n", e: a });
    }
    const op = this.tok.k === "p" ? this.tok.s : "";
    if (["<", "<=", ">", ">=", "==", "!="].includes(op)) {
      this.ti++;
      const b = this.arith(0);
      const nx = this.tok.k === "p" ? this.tok.s : "";
      if (["<", "<=", ">", ">=", "==", "!="].includes(nx))
        this.fail("a comparison cannot be chained", this.tok.at);
      return { t: "cmp", op, a, b };
    }
    const w = this.tok;
    if (w.k === "id" && KEYWORDS_UNSUPPORTED.has(w.s)) this.unsupported(`'${w.s}'`, w.at);
    return a;
  }

  /** `<quant> of <set> [at e | in (lo..hi)]`: the quantifier is read, `of` is next. */
  ofExpr(q: Quant): Expr {
    const ofAt = this.tok.at;
    if (!this.isW("of")) this.fail("expected 'of'", ofAt);
    this.ti++;
    const set = this.stringSet();
    let at: Expr | null = null;
    let range: [Expr, Expr] | null = null;
    if (this.isW("at")) {
      this.ti++;
      at = this.arith(0);
    } else if (this.isW("in")) {
      this.ti++;
      range = this.range();
    }
    return { t: "of", q, set, at, range };
  }
  range(): [Expr, Expr] {
    this.needP("(");
    const lo = this.arith(0);
    this.needP("..");
    const hi = this.arith(0);
    this.needP(")");
    return [lo, hi];
  }

  stringSet(): number[] {
    const t = this.tok;
    const out: number[] = [];
    const addPattern = (p: string, at: number): void => {
      const star = p.endsWith("*");
      const prefix = star ? p.slice(0, -1) : p;
      let hit = false;
      this.strs.forEach((s, i) => {
        if (star ? s.id.startsWith(prefix) : s.id === prefix) {
          if (!out.includes(i)) out.push(i);
          s.used = true;
          hit = true;
        }
      });
      if (!hit) this.fail(`no string matches "$${p}"`, at);
    };
    if (t.k === "id" && t.s === "them") {
      this.ti++;
      this.strs.forEach((s, i) => {
        out.push(i);
        s.used = true;
      });
      if (out.length === 0) this.fail("the rule has no strings for 'them'", t.at);
      return out;
    }
    if (this.isP("(")) {
      this.ti++;
      for (;;) {
        const s = this.tok;
        if (s.k !== "sv") this.fail("expected a string identifier such as $a or $a*", s.at);
        this.ti++;
        addPattern(s.s, s.at);
        if (this.eatP(",")) continue;
        this.needP(")");
        break;
      }
      return out;
    }
    return this.fail("expected 'them' or a parenthesised list of strings", t.at);
  }

  forExpr(): Expr {
    const forAt = this.tok.at;
    this.enter(forAt);
    this.ti++;
    let q = this.quantWord();
    if (q !== null) this.ti++;
    else {
      const e = this.arith(0);
      q = this.isP("%") && this.isW("of", 1) ? (this.ti++, { k: "pct", e }) : { k: "n", e };
    }
    let result: Expr;
    if (this.isW("of")) {
      this.ti++;
      const set = this.stringSet();
      this.needP(":");
      this.needP("(");
      this.curDepth++;
      const body = this.orExpr();
      this.curDepth--;
      this.needP(")");
      result = { t: "forof", q, set, body };
    } else {
      const v = this.tok;
      if (v.k !== "id" || RESERVED.has(v.s))
        this.fail("expected 'of' or a loop variable name", v.at);
      if (this.isP(",", 1)) this.unsupported("a loop over several variables", v.at);
      this.ti++;
      if (!this.isW("in")) this.fail("expected 'in'", this.tok.at);
      this.ti++;
      let lo: Expr | null = null;
      let hi: Expr | null = null;
      let list: Expr[] | null = null;
      this.needP("(");
      const first = this.arith(0);
      if (this.eatP("..")) {
        lo = first;
        hi = this.arith(0);
      } else {
        list = [first];
        while (this.eatP(",")) list.push(this.arith(0));
      }
      this.needP(")");
      this.needP(":");
      this.needP("(");
      const slot = this.slots++;
      this.slotOf.set(v.s, (this.slotOf.get(v.s) ?? []).concat([slot]));
      const body = this.orExpr();
      this.slotOf.get(v.s)?.pop();
      this.needP(")");
      result = { t: "forin", q, slot, lo, hi, list, body };
    }
    this.leave();
    return result;
  }
  slotOf = new Map<string, number[]>();

  // arithmetic: | < ^ < & < shifts < + - < * \ % < unary
  static LEVELS: string[][] = [["|"], ["^"], ["&"], ["<<", ">>"], ["+", "-"], ["*", "\\", "%"]];
  arith(level: number): Expr {
    if (level >= Parser.LEVELS.length) return this.unary();
    const ops = Parser.LEVELS[level] as string[];
    let a = this.arith(level + 1);
    for (;;) {
      const t = this.tok;
      if (t.k !== "p" || !ops.includes(t.s)) return a;
      if (t.s === "%" && this.isW("of", 1)) return a;
      this.ti++;
      const b = this.arith(level + 1);
      if ((t.s === "\\" || t.s === "%") && b.t === "int" && b.v === 0n)
        this.fail("division by zero", t.at);
      a = { t: "bin", op: t.s, a, b };
    }
  }
  unary(): Expr {
    const t = this.tok;
    if (t.k === "p" && (t.s === "-" || t.s === "~")) {
      this.enter(t.at);
      this.ti++;
      const a = this.unary();
      this.leave();
      return t.s === "-" ? { t: "neg", a } : { t: "bnot", a };
    }
    return this.primary();
  }

  strIndex(name: string, at: number): number {
    const i = this.strs.findIndex((s) => s.id === name);
    if (i < 0) this.fail(`undefined string identifier "${name === "" ? "$" : "$" + name}"`, at);
    (this.strs[i] as StringDef).used = true;
    return i;
  }

  primary(): Expr {
    const t = this.tok;
    switch (t.k) {
      case "int":
        this.ti++;
        return { t: "int", v: t.n as bigint };
      case "sv": {
        this.ti++;
        if (t.s.endsWith("*"))
          this.fail("a string wildcard is only valid in a set after 'of'", t.at);
        let i: number;
        if (t.s === "") {
          if (this.curDepth === 0)
            this.fail("'$' without a name is only valid inside 'for ... of'", t.at);
          i = -1;
        } else i = this.strIndex(t.s, t.at);
        if (this.isW("at")) {
          this.ti++;
          return { t: "at", i, e: this.arith(0) };
        }
        if (this.isW("in")) {
          this.ti++;
          const [lo, hi] = this.range();
          return { t: "in", i, lo, hi };
        }
        return i < 0 ? { t: "cur", what: "str" } : { t: "str", i };
      }
      case "cv":
      case "ov":
      case "lv": {
        this.ti++;
        const what = t.k === "cv" ? "cnt" : t.k === "ov" ? "off" : "len";
        if (t.s === "") {
          if (this.curDepth === 0)
            this.fail(
              `'${t.k === "cv" ? "#" : t.k === "ov" ? "@" : "!"}' without a name is only valid inside 'for ... of'`,
              t.at,
            );
          return { t: "cur", what };
        }
        const i = this.strIndex(t.s, t.at);
        if (what === "cnt") {
          if (this.isW("in")) {
            this.ti++;
            const [lo, hi] = this.range();
            return { t: "cntin", i, lo, hi };
          }
          return { t: "cnt", i };
        }
        let idx: Expr | null = null;
        if (this.eatP("[")) {
          idx = this.arith(0);
          this.needP("]");
        }
        return { t: what, i, idx };
      }
      case "p": {
        if (t.s === "(") {
          this.enter(t.at);
          this.ti++;
          const e = this.orExpr();
          this.needP(")");
          this.leave();
          return e;
        }
        return this.fail(`unexpected '${t.s}' in the condition`, t.at);
      }
      case "id": {
        this.ti++;
        const w = t.s;
        if (w === "true" || w === "false") return { t: "bool", v: w === "true" };
        if (w === "filesize") return { t: "filesize" };
        const m = /^(u?int)(8|16|32)(be)?$/.exec(w);
        if (m !== null && this.isP("(")) {
          this.ti++;
          const e = this.arith(0);
          this.needP(")");
          return {
            t: "rd",
            size: (Number(m[2]) / 8) as 1 | 2 | 4,
            signed: m[1] === "int",
            be: m[3] === "be",
            e,
          };
        }
        const stack = this.slotOf.get(w);
        if (stack !== undefined && stack.length > 0)
          return { t: "var", slot: stack[stack.length - 1] as number };
        if (this.isP(".") || this.isP("[")) {
          this.fail(
            `the module "${w}" is not supported (no YARA modules are available: pe, elf, math, hash, ...)`,
            t.at,
          );
        }
        if (w === "entrypoint")
          this.fail("'entrypoint' needs the pe or elf module, which is not supported", t.at);
        if (/^u?int(8|16|32|64)(be)?$/.test(w) || w === "uint64" || w === "int64")
          this.fail(`'${w}' is not supported`, t.at);
        if (KEYWORDS_UNSUPPORTED.has(w)) this.unsupported(`'${w}'`, t.at);
        const r = this.ruleIndex.get(w);
        if (r !== undefined) return { t: "rule", i: r };
        if (this.isP("(")) this.fail(`the function "${w}" is not supported`, t.at);
        return this.fail(
          `undefined identifier "${w}" (a rule can only use rules defined before it)`,
          t.at,
        );
      }
      default:
        return this.fail(`unexpected '${t.s}' in the condition`, t.at);
    }
  }
}

const STD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function countStates(items: HexItem[], acc: { n: number }): void {
  for (const it of items) {
    if (it.k === "b") acc.n++;
    else if (it.k === "j") acc.n += (it.hi === -1 ? it.lo + 1 : it.hi) * 2 + 1;
    else {
      acc.n++;
      for (const a of it.alts) {
        acc.n++;
        countStates(a, acc);
      }
    }
  }
}

/** Parses the rule text. Anything outside the supported subset is `E_COERCE` with the line and column. */
export function parseRules(src: string): Rule[] {
  if (src.length > MAX_RULE_TEXT) {
    throw coerceFailure(
      "YARA rules",
      "a rule set",
      `the rules are ${src.length} characters, over the limit of ${MAX_RULE_TEXT}`,
    );
  }
  return new Parser(src).parseFile();
}

// ---------------------------------------------------------------------------------------------
// YARA regular expressions to ECMAScript
// ---------------------------------------------------------------------------------------------

const hex2 = (c: number): string => "\\x" + c.toString(16).padStart(2, "0");
const SPACE_CLASS = " \\t\\n\\r\\f\\v";

/**
 * Translates the supported YARA regular expression syntax (literals, escapes, `.`, classes, the shorthand
 * classes, `|`, groups, the greedy and lazy quantifiers `* + ? {n} {n,} {,m} {n,m}`, `^`, `$`, `\b`, `\B`)
 * to ECMAScript pattern text that is valid under the `u` flag. Every literal is written as `\xHH`, so no
 * character can change meaning. Anything else is refused through `fail(message, offsetInPattern)`.
 * Non-ASCII characters are refused (write them as \\xNN): the data is matched as Latin-1 text.
 */
export function translateRegex(
  body: string,
  dotAll: boolean,
  fail: (m: string, off: number) => never,
): string {
  let i = 0;
  let out = "";
  let depth = 0;
  let canQuantify = false;
  let greedy = false;
  let lazy = false;
  const n = body.length;
  const classEscape = (c: string): string | null => {
    switch (c) {
      case "w":
        return "A-Za-z0-9_";
      case "d":
        return "0-9";
      case "s":
        return SPACE_CLASS;
      default:
        return null;
    }
  };
  const simpleEscape = (c: string): number | null => {
    switch (c) {
      case "n":
        return 10;
      case "t":
        return 9;
      case "r":
        return 13;
      case "f":
        return 12;
      case "a":
        return 7;
      default:
        return null;
    }
  };
  /** The byte of an escape that stands for one character, with `i` at the character after the backslash. */
  const escapedByte = (): number => {
    const c = body.charAt(i);
    if (c === "x") {
      const h = body.slice(i + 1, i + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(h))
        fail("illegal escape sequence in a regular expression", i - 1);
      i += 3;
      return parseInt(h, 16);
    }
    const s = simpleEscape(c);
    if (s !== null) {
      i++;
      return s;
    }
    if (c !== "" && "\\/.*+?|()[]{}^$-\"'".includes(c)) {
      i++;
      return c.charCodeAt(0);
    }
    return fail("illegal escape sequence in a regular expression", i - 1);
  };
  while (i < n) {
    const c = body.charAt(i);
    const at = i;
    if (c === "\\") {
      i++;
      const e = body.charAt(i);
      if (e === "") fail("a regular expression cannot end in a backslash", at);
      if (e === "b" || e === "B") {
        i++;
        out += "\\" + e;
        canQuantify = false;
      } else if (e === "w" || e === "d" || e === "s") {
        i++;
        out += "[" + classEscape(e) + "]";
        canQuantify = true;
      } else if (e === "W" || e === "D" || e === "S") {
        i++;
        out += "[^" + classEscape(e.toLowerCase()) + "]";
        canQuantify = true;
      } else if (e >= "0" && e <= "9") {
        fail("a back reference is not supported in a regular expression", at);
      } else {
        out += hex2(escapedByte());
        canQuantify = true;
      }
    } else if (c === "[") {
      i++;
      let cls = "[";
      if (body.charAt(i) === "^") {
        cls += "^";
        i++;
      }
      let first = true;
      for (;;) {
        if (i >= n) fail("unterminated character class", at);
        const d = body.charAt(i);
        if (d === "]" && !first) {
          i++;
          break;
        }
        first = false;
        let lo: number;
        if (d === "\\") {
          i++;
          const e = body.charAt(i);
          const ce = classEscape(e.toLowerCase());
          if (e !== "" && "wds".includes(e)) {
            i++;
            cls += ce;
            continue;
          }
          if (e !== "" && "WDS".includes(e))
            fail("a negated shorthand class inside a character class is not supported", i - 1);
          if (e === "b" || e === "B") fail("illegal escape sequence in a character class", i - 1);
          lo = escapedByte();
        } else {
          const cp = d.charCodeAt(0);
          if (cp > 0x7f)
            fail(
              "a non-ASCII character in a regular expression is not supported (write it as \\xNN)",
              i,
            );
          lo = cp;
          i++;
        }
        if (body.charAt(i) === "-" && body.charAt(i + 1) !== "]" && i + 1 < n) {
          i++;
          let hi: number;
          if (body.charAt(i) === "\\") {
            i++;
            const e = body.charAt(i);
            if (e !== "" && "wdsWDS".includes(e))
              fail("a shorthand class cannot end a range", i - 1);
            hi = escapedByte();
          } else {
            hi = body.charCodeAt(i);
            if (hi > 0x7f)
              fail(
                "a non-ASCII character in a regular expression is not supported (write it as \\xNN)",
                i,
              );
            i++;
          }
          if (hi < lo) fail("the range in a character class is reversed", at);
          cls += hex2(lo) + "-" + hex2(hi);
        } else cls += hex2(lo);
      }
      out += cls + "]";
      canQuantify = true;
    } else if (c === "(") {
      if (body.charAt(i + 1) === "?")
        fail("a group with '?' (non-capturing, lookahead, named, flags) is not supported", at);
      depth++;
      if (depth > 50) fail("groups nested deeper than 50 levels", at);
      i++;
      out += "(?:";
      canQuantify = false;
    } else if (c === ")") {
      if (depth === 0) fail("unbalanced parenthesis in a regular expression", at);
      depth--;
      i++;
      out += ")";
      canQuantify = true;
    } else if (c === "|") {
      i++;
      out += "|";
      canQuantify = false;
    } else if (c === ".") {
      i++;
      out += dotAll ? "[^]" : "[^\\n]";
      canQuantify = true;
    } else if (c === "^" || c === "$") {
      i++;
      out += c;
      canQuantify = false;
    } else if (c === "*" || c === "+" || c === "?" || c === "{") {
      if (!canQuantify) fail("a quantifier with nothing to repeat in a regular expression", at);
      let q: string;
      if (c === "{") {
        const m = /^\{(\d*)(,?)(\d*)\}/.exec(body.slice(i));
        if (m === null || (m[1] === "" && m[3] === "")) {
          fail("malformed repeat count in a regular expression", at);
        }
        const mm = m as RegExpExecArray;
        const lo = mm[1] === "" ? 0 : Number(mm[1]);
        const hi = mm[2] === "" ? lo : mm[3] === "" ? -1 : Number(mm[3]);
        if (lo > MAX_REPEAT || hi > MAX_REPEAT)
          fail(`a repeat count over ${MAX_REPEAT} is not supported`, at);
        if (hi !== -1 && hi < lo) fail("the repeat count is reversed", at);
        q = hi === -1 ? `{${lo},}` : mm[2] === "" ? `{${lo}}` : `{${lo},${hi}}`;
        i += mm[0].length;
      } else {
        q = c;
        i++;
      }
      if (body.charAt(i) === "?") {
        q += "?";
        i++;
        lazy = true;
      } else greedy = true;
      if (greedy && lazy)
        fail("greedy and lazy quantifiers cannot be mixed in a regular expression", at);
      const nx = body.charAt(i);
      if (nx === "*" || nx === "+" || nx === "{")
        fail("a repeat of a repeat in a regular expression", i);
      out += q;
      canQuantify = false;
    } else {
      const cp = c.charCodeAt(0);
      if (cp > 0x7f)
        fail(
          "a non-ASCII character in a regular expression is not supported (write it as \\xNN)",
          at,
        );
      out += hex2(cp);
      i++;
      canQuantify = true;
    }
  }
  if (depth !== 0) fail("unbalanced parenthesis in a regular expression", n);
  return out;
}
