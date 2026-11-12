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
 * Headers and metadata (spec sections 5.4 to 5.9 and 12):
 *
 * - `parseHeader`: the stack-effect header grammar, strict and lenient.
 * - canonical text of slots, constraints and effects (12.3).
 * - `WordMetaBuilder`: desugars header, leading `doc`/`category` and `META:` clauses into `WordMeta` (12.1, 12.2).
 * - `ownText` / `computeHash`: the transitive word hash (12.4).
 * - `renderHelp` / `renderSee` (12.5).
 */
import { ForgeError } from "./errors.js";
import schema from "./meta.schema.json" with { type: "json" };
import { DEFAULT_LIMITS } from "./types.js";
import type {
  Constraint,
  EffectLabel,
  Limits,
  MetaLink,
  ParamDefault,
  ParamSpec,
  ParamType,
  SourceInfo,
  Sha256Fn,
  SourcePos,
  StackEffect,
  StackSlot,
  Value,
  WordDiscovery,
  WordKind,
  WordMeta,
} from "./types.js";
import {
  bytes,
  constraintText,
  cpCompare,
  cpLength,
  display,
  hasLoneSurrogate,
  int,
  num,
  optionsText,
  quoteString,
  str,
  validate,
} from "./values.js";
import { isPrivateName } from "./dictionary.js";
import { sha256 } from "./sha256.js";
import { LINKS_MAX, checkLinkLabel, checkLinkUrl, checkUseWhen } from "./meta-discovery.js";

/** The JSON Schema (draft 2020-12) of `WordMeta` (`meta.schema.json`). */
export const WORD_META_SCHEMA: Readonly<Record<string, unknown>> = schema;

// ---------------------------------------------------------------------------------------------
// Names (spec 2.11)
// ---------------------------------------------------------------------------------------------

/** Words that cannot be defined or used as parameter names (spec 2.11). */
export const RESERVED_WORDS: readonly string[] = [
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
  "true",
  "false",
];

const NAME_CHAR_ASCII = "A-Za-z_\\-!$%&*+,./<=>?@^|~";
const NON_ASCII_LETTER = "(?![\\p{Zs}\\p{Zl}\\p{Zp}\\p{Cc}\\p{Cf}])[^\\x00-\\x7f]";
const WORD_NAME_RE = new RegExp(
  `^(?!-[0-9])(?:[${NAME_CHAR_ASCII}]|${NON_ASCII_LETTER})(?:[${NAME_CHAR_ASCII}0-9]|${NON_ASCII_LETTER})*$`,
  "u",
);
const VOCAB_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** `word-name` of spec 2.11: 1 to 128 code points, no `:`. Reserved words are not checked here. */
export function isWordName(s: string): boolean {
  return WORD_NAME_RE.test(s) && cpLength(s) <= 128;
}

/** `vocab-name` of spec 2.11: 1 to 64 code points. */
export function isVocabName(s: string): boolean {
  return VOCAB_NAME_RE.test(s) && s.length <= 64;
}

export function isReservedWord(s: string): boolean {
  return RESERVED_WORDS.includes(s);
}

/** A name starting with `_` is private (spec 5.7). The single implementation lives in dictionary.ts. */
export { isPrivateName };

// ---------------------------------------------------------------------------------------------
// Canonical text (spec 12.3)
// ---------------------------------------------------------------------------------------------

const DEFAULT_ENCODINGS: readonly string[] = ["utf8", "hex", "latin1", "base64"];

/** Canonical text of a default value (spec 12.3). */
function defaultText(type: ParamType, d: ParamDefault): string {
  if (typeof d === "number") return type === "num" ? display(num(d)) : String(d);
  if (typeof d === "boolean") return String(d);
  if (typeof d === "object") return quoteString(d.value);
  return type === "choice" ? optionsText([d]).slice(1, -1) : quoteString(d);
}

/**
 * Canonical text of one slot: `name:` + type + options + constraint + `=default`. An anonymous slot
 * is its type; a named slot of type `any` with nothing else (a label) is just its name.
 * `toggle` / `key` options equal to the default list (`utf8|hex|latin1|base64`) are omitted.
 */
export function slotText(slot: StackSlot): string {
  if (slot.type === "any" && slot.name !== null) return slot.name;
  let out = slot.name === null ? "" : `${slot.name}:`;
  out += slot.type;
  const o = slot.options;
  if (o !== undefined && (slot.type === "choice" || o.join("|") !== DEFAULT_ENCODINGS.join("|"))) {
    out += optionsText(o);
  }
  out += constraintText(slot.constraint);
  if (slot.default !== undefined) out += `=${defaultText(slot.type, slot.default)}`;
  return out;
}

/** Canonical text of a stack effect: `( in... -- out... )` with `..` for variadic input / unchecked output. */
export function effectText(
  e: Pick<StackEffect, "inputs" | "outputs" | "unchecked" | "variadicInput">,
): string {
  const parts: string[] = [];
  if (e.variadicInput) parts.push("..");
  for (const s of e.inputs) parts.push(slotText(s));
  parts.push("--");
  for (const s of e.outputs) parts.push(slotText(s));
  if (e.unchecked) parts.push("..");
  return `( ${parts.join(" ")} )`;
}

// ---------------------------------------------------------------------------------------------
// parseHeader (spec 5.4 to 5.6)
// ---------------------------------------------------------------------------------------------

const TYPE_NAMES: readonly string[] = [
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
];
const OPTION_TYPES: readonly string[] = ["choice", "toggle", "key"];
const ENCODINGS: readonly string[] = ["hex", "utf8", "latin1", "base64"];
/** ptypes that may carry a constraint (spec 5.5). */
const CONSTRAINT_TYPES: readonly string[] = [
  "int",
  "num",
  "str",
  "charset",
  "bytes",
  "key",
  "toggle",
  "list",
];
const NAME_PREFIX_RE = /^[a-z][a-z0-9-]*/;
const WS_CHARS = " \t\n\r\v\f";
const WS_RE = /[ \t\n\r\v\f]/g;

const INT_RE = /^-?(?:0x[0-9a-fA-F](?:_?[0-9a-fA-F])*|0b[01](?:_?[01])*|[0-9](?:_?[0-9])*)$/;
const FLOAT_RE =
  /^-?[0-9](?:_?[0-9])*(?:\.[0-9](?:_?[0-9])*(?:[eE][+-]?[0-9](?:_?[0-9])*)?|[eE][+-]?[0-9](?:_?[0-9])*)$/;

/** A number of spec 2.4 / 2.5 that is exactly representable (safe integer or finite float), else undefined. */
function parseNumber(text: string): { value: number; isInt: boolean } | undefined {
  if (INT_RE.test(text)) {
    const neg = text.startsWith("-");
    const big = BigInt(text.replace(/_/g, "").slice(neg ? 1 : 0));
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
    return { value: neg ? 0 - Number(big) : Number(big), isInt: true };
  }
  if (FLOAT_RE.test(text)) {
    const v = Number(text.replace(/_/g, ""));
    return Number.isFinite(v) ? { value: v + 0, isInt: false } : undefined;
  }
  return undefined;
}

function hexBytes(s: string): Uint8Array | undefined {
  const hex = s.replace(WS_RE, "");
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(hex)) return undefined;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(?:==)?|[A-Za-z0-9+/]{3}=?)?$/;

function base64Bytes(s: string): Uint8Array | undefined {
  if (!B64_RE.test(s)) return undefined;
  const out: number[] = [];
  let acc = 0;
  let nbits = 0;
  for (const ch of s.replace(/=+$/, "")) {
    acc = (acc << 6) | B64.indexOf(ch);
    nbits += 6;
    if (nbits >= 8) {
      nbits -= 8;
      out.push((acc >> nbits) & 0xff);
      acc &= (1 << nbits) - 1;
    }
  }
  return Uint8Array.from(out);
}

// The package builds against ES2022 only (no DOM or Node typings), so declare the global used.
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

const utf8Encoder = new TextEncoder();

/** The bytes a `toggle` / `key` default string denotes in encoding `enc`, or undefined if malformed. */
function decodeEncoded(enc: string, s: string): Uint8Array | undefined {
  switch (enc) {
    case "hex":
      return hexBytes(s);
    case "utf8":
      return hasLoneSurrogate(s) ? undefined : utf8Encoder.encode(s);
    case "latin1": {
      const out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) {
        const u = s.charCodeAt(i);
        if (u > 0xff) return undefined;
        out[i] = u;
      }
      return out;
    }
    default:
      return base64Bytes(s);
  }
}

interface Item {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /** A lexical problem found while delimiting this item; thrown when the parse reaches the item. */
  readonly error?: ForgeError;
}

interface TypeSpec {
  readonly type: ParamType;
  readonly options?: string[];
  readonly constraint?: Constraint;
  readonly default?: ParamDefault;
}

function makeSlot(
  name: string | null,
  type: ParamType,
  options?: readonly string[],
  constraint?: Constraint,
  def?: ParamDefault,
): StackSlot {
  return {
    name,
    type,
    ...(options === undefined ? {} : { options }),
    ...(constraint === undefined ? {} : { constraint }),
    ...(def === undefined ? {} : { default: def }),
  };
}

class HeaderParser {
  constructor(
    private readonly text: string,
    private readonly pos: SourcePos,
    private readonly mode: "strict" | "lenient",
    private readonly limits: Readonly<Limits>,
  ) {}

  /** Source position of the character at `index` in the header text. */
  private posAt(index: number): SourcePos {
    const t = this.text;
    let line = this.pos.line;
    let lineStart = -1;
    for (let k = 0; k < index; k++) {
      const c = t[k];
      if (c === "\n" || (c === "\r" && t[k + 1] !== "\n")) {
        line++;
        lineStart = k + 1;
      }
    }
    const col = lineStart < 0 ? this.pos.col + index : index - lineStart + 1;
    return { offset: this.pos.offset + index, line, col };
  }

  private makeError(message: string, start: number, item: string): ForgeError {
    return new ForgeError({
      code: "E_HEADER",
      message: `invalid header: ${message}`,
      pos: this.posAt(start),
      detail: { item },
    });
  }

  private fail(message: string, start: number, item: string): never {
    throw this.makeError(message, start, item);
  }

  /** Reads the string literal starting at `i` (spec 2.6); `start` is the item start for errors. */
  private readString(i: number, start: number): { value: string; next: number } {
    const t = this.text;
    const bad = (m: string): never =>
      this.fail(m, start, t.slice(start).split(/\s/, 1)[0] as string);
    let out = "";
    let j = i + 1;
    for (;;) {
      if (j >= t.length) bad("unterminated string");
      const c = t[j] as string;
      if (c === '"') return { value: out, next: j + 1 };
      if (c !== "\\") {
        out += c;
        j++;
        continue;
      }
      const e = t[j + 1];
      if (e === "n" || e === "r" || e === "t" || e === "0" || e === "\\" || e === '"') {
        out += { n: "\n", r: "\r", t: "\t", "0": "\0", "\\": "\\", '"': '"' }[e];
        j += 2;
      } else if (e === "x") {
        const h = t.slice(j + 2, j + 4);
        if (!/^[0-9a-fA-F]{2}$/.test(h)) bad("invalid \\x escape");
        out += String.fromCharCode(parseInt(h, 16));
        j += 4;
      } else if (e === "u") {
        const m = /^\{([0-9a-fA-F]{1,6})\}/.exec(t.slice(j + 2, j + 10));
        const cp = m === null ? -1 : parseInt(m[1] as string, 16);
        if (m === null || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
          bad("invalid \\u escape");
        }
        out += String.fromCodePoint(cp);
        j += 2 + (m as RegExpExecArray)[0].length;
      } else {
        bad("invalid string escape");
      }
    }
  }

  /** Index just after the `/`-delimited pattern starting at `i`; `\` escapes the next character. */
  private readPattern(i: number, start: number): number {
    const t = this.text;
    for (let j = i + 1; j < t.length; j++) {
      if (t[j] === "\\") j++;
      else if (t[j] === "/") return j + 1;
    }
    return this.fail("unterminated pattern", start, t.slice(start).split(/\s/, 1)[0] as string);
  }

  /** Splits the header text into items at whitespace outside `[…]`, `{…}` and `"…"`. */
  private scan(): Item[] {
    const t = this.text;
    const items: Item[] = [];
    let i = 0;
    while (i < t.length) {
      if (WS_CHARS.includes(t[i] as string)) {
        i++;
        continue;
      }
      const start = i;
      try {
        let open = "";
        for (; i < t.length; i++) {
          const c = t[i] as string;
          if (open === "") {
            if (WS_CHARS.includes(c)) break;
            if (c === '"') i = this.readString(i, start).next - 1;
            else if (c === "{" || c === "[") open = c;
            else if (c === "}" || c === "]") {
              this.fail(`unbalanced '${c}'`, start, t.slice(start).split(/\s/, 1)[0] as string);
            }
          } else if (open === "{") {
            if (c === '"') i = this.readString(i, start).next - 1;
            else if (c === "}") open = "";
          } else if (c === "/") {
            i = this.readPattern(i, start) - 1;
          } else if (c === "]") {
            open = "";
          }
        }
        if (open !== "") {
          this.fail(`unterminated '${open}'`, start, t.slice(start).split(/\s/, 1)[0] as string);
        }
        items.push({ start, end: i, text: t.slice(start, i) });
      } catch (e) {
        items.push({ start, end: t.length, text: t.slice(start), error: e as ForgeError });
        break;
      }
    }
    return items;
  }

  parse(): StackEffect {
    const items = this.scan();
    const inputs: StackSlot[] = [];
    const outputs: StackSlot[] = [];
    const names = new Set<string>();
    let variadicInput = false;
    let unchecked = false;
    let dash = -1;
    items.forEach((it, k) => {
      if (it.error !== undefined) throw it.error;
      const fail = (m: string): never => this.fail(m, it.start, it.text);
      if (it.text === "--") {
        if (dash >= 0) fail("a second '--'");
        dash = k;
      } else if (it.text === "..") {
        if (dash < 0 && k === 0) {
          if (this.mode === "strict")
            fail("a variadic input '..' is only allowed in lenient headers");
          variadicInput = true;
        } else if (dash >= 0 && k === dash + 1 && k === items.length - 1) {
          unchecked = true;
        } else {
          fail("'..' must be the first input item or the only output item");
        }
      } else if (dash < 0) {
        const index = inputs.length;
        inputs.push(this.parseInput(it, index, names));
      } else {
        outputs.push(this.parseOutput(it));
      }
    });
    if (dash < 0) this.fail("missing '--'", 0, this.text.trim());
    const parts = { inputs, outputs, unchecked, variadicInput };
    return { ...parts, text: effectText(parts) };
  }

  private checkName(it: Item, name: string): void {
    if (isReservedWord(name)) this.fail(`'${name}' is a reserved word`, it.start, it.text);
  }

  private parseInput(it: Item, index: number, names: Set<string>): StackSlot {
    const fail = (m: string): never => this.fail(m, it.start, it.text);
    const m = NAME_PREFIX_RE.exec(it.text);
    if (m === null) fail("expected a parameter name or a type");
    const name = (m as RegExpExecArray)[0];
    const rest = it.text.slice(name.length);
    if (rest === "") {
      if (this.mode === "strict" && index >= 1) {
        fail("a public word's parameters must be named and typed (name:type)");
      }
      if (TYPE_NAMES.includes(name)) return makeSlot(null, name as ParamType);
      this.checkName(it, name);
      if (names.has(name)) fail(`duplicate name '${name}'`);
      names.add(name);
      return makeSlot(name, "any");
    }
    if (rest[0] !== ":") fail("expected ':' after the parameter name");
    this.checkName(it, name);
    if (names.has(name)) fail(`duplicate name '${name}'`);
    names.add(name);
    const spec = this.parseType(it, it.start + name.length + 1);
    if (index === 0 && spec.default !== undefined) fail("the data input may not have a default");
    return makeSlot(name, spec.type, spec.options, spec.constraint, spec.default);
  }

  private parseOutput(it: Item): StackSlot {
    const fail = (m: string): never => this.fail(m, it.start, it.text);
    const m = NAME_PREFIX_RE.exec(it.text);
    if (m === null) fail("expected an output name or a type");
    const name = (m as RegExpExecArray)[0];
    const rest = it.text.slice(name.length);
    if (rest === "") {
      if (TYPE_NAMES.includes(name)) return makeSlot(null, name as ParamType);
      this.checkName(it, name);
      return makeSlot(name, "any");
    }
    const type = rest.slice(1);
    if (rest[0] !== ":" || !TYPE_NAMES.includes(type)) {
      fail("an output is 'type', 'name:type' or a label, without constraint or default");
    }
    this.checkName(it, name);
    return makeSlot(name, type as ParamType);
  }

  /** Parses `ptype [options] [constraint] [= default]` starting at absolute index `i` of the item. */
  private parseType(it: Item, from: number): TypeSpec {
    const t = this.text;
    const fail = (m: string): never => this.fail(m, it.start, it.text);
    const word = /^[a-z]+/.exec(t.slice(from, it.end))?.[0] ?? "";
    if (!TYPE_NAMES.includes(word) && !OPTION_TYPES.includes(word)) {
      fail(`unknown parameter type '${t.slice(from, it.end).replace(/[[{=].*$/s, "")}'`);
    }
    const type = word as ParamType;
    let i = from + word.length;
    let options: string[] | undefined;
    if (t[i] === "{") {
      if (!OPTION_TYPES.includes(type)) fail(`'${type}' takes no options`);
      const r = this.parseOptions(it, i);
      options = r.options;
      i = r.next;
      if (type !== "choice" && !options.every((o) => ENCODINGS.includes(o))) {
        fail(`encodings must be among ${ENCODINGS.join(", ")}`);
      }
    } else if (type === "choice") {
      fail("'choice' needs options: choice{a|b}");
    } else if (OPTION_TYPES.includes(type)) {
      options = [...DEFAULT_ENCODINGS];
    }

    let constraint: Constraint | undefined;
    if (t[i] === "[") {
      if (!CONSTRAINT_TYPES.includes(type)) fail(`'${type}' takes no constraint`);
      const r = this.parseConstraint(it, i, type);
      constraint = r.constraint;
      i = r.next;
    }

    let def: ParamDefault | undefined;
    if (i < it.end) {
      if (t[i] !== "=") fail("unexpected text after the parameter type");
      def = this.parseDefault(it, i + 1, type, options, constraint);
    }
    return {
      type,
      ...(options === undefined ? {} : { options }),
      ...(constraint === undefined ? {} : { constraint }),
      ...(def === undefined ? {} : { default: def }),
    };
  }

  /** Parses `{opt|opt|…}` with `i` at the `{`. */
  private parseOptions(it: Item, from: number): { options: string[]; next: number } {
    const t = this.text;
    const fail = (m: string): never => this.fail(m, it.start, it.text);
    const options: string[] = [];
    let i = from + 1;
    for (;;) {
      if (t[i] === '"') {
        const r = this.readString(i, it.start);
        options.push(r.value);
        i = r.next;
      } else {
        let j = i;
        while (j < it.end && t[j] !== "|" && t[j] !== "}") {
          if (WS_CHARS.includes(t[j] as string) || t[j] === "{" || t[j] === '"') {
            fail("an option may not contain whitespace, '{', '}' or '\"' unless quoted");
          }
          j++;
        }
        if (j === i) fail("empty option");
        options.push(t.slice(i, j));
        i = j;
      }
      if (t[i] === "|") i++;
      else if (t[i] === "}") return { options, next: i + 1 };
      else fail("expected '|' or '}' after an option");
    }
  }

  /** Parses `[part,part…]` with `i` at the `[`. */
  private parseConstraint(
    it: Item,
    from: number,
    type: ParamType,
  ): { constraint: Constraint; next: number } {
    const t = this.text;
    const fail = (m: string): never => this.fail(m, it.start, it.text);
    const numeric = type === "int" || type === "num";
    const keys = numeric
      ? (["min", "max", "oneOf"] as const)
      : (["minLength", "maxLength", "lengthOneOf"] as const);
    const c: Record<string, number | number[] | string> = {};
    const bound = (s: string): number => {
      const n = parseNumber(s);
      if (n === undefined) fail(`'${s}' is not a number`);
      const v = (n as { value: number; isInt: boolean }).value;
      if (type !== "num" && !(n as { isInt: boolean }).isInt) fail(`'${s}' must be an integer`);
      if (!numeric && v < 0) fail(`a length may not be negative ('${s}')`);
      return v;
    };
    let valuePart = false;
    let i = from + 1;
    for (;;) {
      if (t[i] === "/") {
        const next = this.readPattern(i, it.start);
        const src = t.slice(i + 1, next - 1);
        if (type !== "str") fail("a pattern is only allowed on 'str'");
        if (c.pattern !== undefined) fail("at most one pattern per constraint");
        if (/[ \t\n\r\v\f"]/.test(src)) fail("a pattern may not contain whitespace or '\"'");
        if (cpLength(src) > this.limits.maxRegexLength) {
          fail(`a pattern may be at most ${this.limits.maxRegexLength} code points`);
        }
        try {
          new RegExp(`^(?:${src})$`, "u");
        } catch {
          fail("the pattern is not a valid regular expression");
        }
        c.pattern = src;
        i = next;
      } else {
        let j = i;
        while (j < it.end && t[j] !== "," && t[j] !== "]") j++;
        const part = t.slice(i, j);
        if (valuePart) fail("at most one range or set per constraint");
        valuePart = true;
        const dots = part.indexOf("..");
        if (dots >= 0) {
          const lo = part.slice(0, dots);
          const hi = part.slice(dots + 2);
          if (lo === "" && hi === "") fail("a range needs at least one bound");
          const a = lo === "" ? undefined : bound(lo);
          const b = hi === "" ? undefined : bound(hi);
          if (a !== undefined && b !== undefined && a > b) fail(`empty range ${part}`);
          if (a !== undefined) c[keys[0]] = a;
          if (b !== undefined) c[keys[1]] = b;
        } else if (part.includes("|")) {
          if (type === "num") fail("a 'num' constraint is a range, not a set");
          c[keys[2]] = part.split("|").map(bound);
        } else {
          const v = bound(part);
          c[keys[0]] = v;
          c[keys[1]] = v;
        }
        i = j;
      }
      if (t[i] === ",") i++;
      else if (t[i] === "]") return { constraint: c as Constraint, next: i + 1 };
      else fail("expected ',' or ']' in the constraint");
    }
  }

  /** Parses and validates the default literal starting at `from` (after the `=`). */
  private parseDefault(
    it: Item,
    from: number,
    type: ParamType,
    options: readonly string[] | undefined,
    constraint: Constraint | undefined,
  ): ParamDefault {
    const t = this.text;
    const fail = (m: string): never => this.fail(`default: ${m}`, it.start, it.text);
    const raw = t.slice(from, it.end);
    const asString = (): string => {
      if (raw[0] !== '"') fail("expected a string literal");
      const r = this.readString(from, it.start);
      if (r.next !== it.end) fail("unexpected text after the string");
      return r.value;
    };
    const asNumber = (): { value: number; isInt: boolean } => {
      const n = parseNumber(raw);
      if (n === undefined) fail("expected a number");
      return n as { value: number; isInt: boolean };
    };
    let value: Value;
    let meta: ParamDefault;
    switch (type) {
      case "int": {
        const n = asNumber();
        if (!n.isInt) fail("expected an integer");
        value = int(n.value);
        meta = n.value;
        break;
      }
      case "num": {
        meta = asNumber().value;
        value = num(meta);
        break;
      }
      case "bool": {
        if (raw !== "true" && raw !== "false") fail("expected true or false");
        meta = raw === "true";
        value = { tag: "bool", v: meta };
        break;
      }
      case "str":
      case "regex":
      case "charset": {
        meta = asString();
        value = str(meta);
        break;
      }
      case "choice": {
        meta = raw[0] === '"' ? asString() : raw;
        value = str(meta);
        break;
      }
      case "bytes": {
        const s = asString();
        const b = hexBytes(s);
        if (b === undefined) fail("expected a string of hex digit pairs");
        meta = s.replace(WS_RE, "").toLowerCase();
        value = bytes(b as Uint8Array);
        break;
      }
      case "toggle":
      case "key": {
        const s = asString();
        const enc = (options as readonly string[])[0] as string;
        const b = decodeEncoded(enc, s);
        if (b === undefined) fail(`not valid ${enc} text`);
        meta = { value: s, enc };
        value = bytes(b as Uint8Array);
        break;
      }
      default:
        return fail(`'${type}' parameters cannot have a default`);
    }
    try {
      validate(value, makeSlot(null, type, options, constraint), this.limits);
    } catch (e) {
      fail((e as Error).message);
    }
    return meta;
  }
}

/**
 * Parses the text between `(` and `)` of a header (spec 5.4). `pos` is the position of the first
 * character of `text`. `strict` is for public colon words; `lenient` for private words and
 * primitives (bare items anywhere, a leading `..`). Throws `E_HEADER` whose `pos` is the start of
 * the offending item (`detail.item` is its text); a missing `--` is reported at the header start.
 * `limits` supplies `maxRegexLength` for patterns and defaults.
 */
export function parseHeader(
  text: string,
  pos: SourcePos,
  mode: "strict" | "lenient",
  limits: Readonly<Limits> = DEFAULT_LIMITS,
): StackEffect {
  return new HeaderParser(text, pos, mode, limits).parse();
}

// ---------------------------------------------------------------------------------------------
// WordMeta builder (spec 5.9, 12.1, 12.2)
// ---------------------------------------------------------------------------------------------

/** A `META:` clause, or a leading declaration, in structured form. */
export type MetaClause =
  | { readonly kind: "doc" | "category" | "version"; readonly text: string }
  | { readonly kind: "param"; readonly name: string; readonly text: string }
  | { readonly kind: "alias" | "see-also"; readonly names: readonly string[] }
  | { readonly kind: "use-when"; readonly text: string }
  | { readonly kind: "link"; readonly url: string; readonly label: string | null }
  | { readonly kind: "inverse"; readonly name: string }
  | { readonly kind: "helper" };

/** One argument token of a clause as the compiler sees it: a string literal or a (possibly qualified) word. */
export type ClauseArg =
  | { readonly type: "str"; readonly value: string }
  | { readonly type: "name"; readonly text: string };

export interface WordMetaInit {
  /** Unqualified canonical name. */
  readonly name: string;
  readonly vocab: string;
  readonly kind: WordKind;
  /** From `parseHeader` (or the registry); `params` and slot docs are derived from it. */
  readonly effect: StackEffect;
  /** Default: all null. */
  readonly source?: SourceInfo;
  /** Default: public, not in `core`, at least one input (spec 5.7). */
  readonly op?: boolean;
  /** Already-set values (a primitive's `PrimitiveDef`); a later `doc`/`category`/`version` clause is then E_META. */
  readonly category?: string | null;
  readonly doc?: string | null;
  readonly version?: string;
  /** Default: none. Sorted and deduplicated by `build`. */
  readonly effects?: readonly EffectLabel[];
  /** Already-set discovery metadata (a second META: block for the same word starts from it). */
  readonly discovery?: WordDiscovery;
  /** True if `name` is already defined in the vocabulary (alias collision, E_REDEFINED). */
  readonly isNameTaken?: (name: string) => boolean;
}

const DOC_MAX = 2000;
const TEXT_MAX = 200;

/**
 * Accumulates the metadata of one word. A compiler creates one per definition with the parsed
 * header, feeds the leading `"…" doc` / `"…" category` declarations to `declare`, every `META:`
 * clause (in source order, with its position) to `clause` or `clauseFromArgs`, and finally calls
 * `build(hash)`. Every error is a `ForgeError` with `word` set to the qualified name and `pos` to
 * the position passed with the clause.
 */
export class WordMetaBuilder {
  private readonly qname: string;
  private readonly exported: boolean;
  private category: string | null;
  private doc: string | null;
  private version: string;
  private readonly isSet = { doc: false, category: false, version: false };
  private readonly paramDocs = new Map<string, string>();
  private readonly aliases: string[] = [];
  private readonly seeAlso: string[] = [];
  private useWhen: string | undefined;
  private readonly links: MetaLink[] = [];
  private inverse: string | undefined;
  private helper = false;

  constructor(private readonly init: WordMetaInit) {
    this.useWhen = init.discovery?.useWhen;
    this.links.push(...(init.discovery?.links ?? []));
    this.inverse = init.discovery?.inverse;
    this.qname = `${init.vocab}:${init.name}`;
    this.exported = !isPrivateName(init.name);
    this.category = init.category ?? null;
    this.doc = init.doc ?? null;
    this.version = init.version ?? "1";
    this.isSet.category = init.category !== undefined && init.category !== null;
    this.isSet.doc = init.doc !== undefined && init.doc !== null;
    this.isSet.version = init.version !== undefined;
  }

  private err(
    code: "E_META" | "E_NAME" | "E_REDEFINED",
    message: string,
    pos: SourcePos | null,
    detail: Record<string, unknown>,
  ): ForgeError {
    return new ForgeError({
      code,
      message: `${this.qname}: ${message}`,
      word: this.qname,
      vocab: this.init.vocab,
      pos,
      detail,
    });
  }

  private setText(kind: "doc" | "category" | "version", text: string, pos: SourcePos | null): void {
    if (this.isSet[kind])
      throw this.err("E_META", `'${kind}' is already set`, pos, { clause: kind });
    const max = kind === "doc" ? DOC_MAX : TEXT_MAX;
    if (cpLength(text) > max) {
      throw this.err("E_META", `'${kind}' is longer than ${max} code points`, pos, {
        clause: kind,
      });
    }
    this.isSet[kind] = true;
    this[kind] = text;
  }

  /** A leading `"…" doc` or `"…" category` declaration (allowed on private words). */
  declare(kind: "doc" | "category", text: string, pos: SourcePos | null = null): void {
    this.setText(kind, text, pos);
  }

  /** One `META:` clause. E_META for a private word, a repeated singular field, a bad param or see-also; E_NAME / E_REDEFINED for aliases. */
  clause(c: MetaClause, pos: SourcePos | null = null): void {
    if (!this.exported) {
      throw this.err("E_META", "a private word may not have a META: block", pos, {
        clause: c.kind,
      });
    }
    switch (c.kind) {
      case "doc":
      case "category":
      case "version":
        this.setText(c.kind, c.text, pos);
        return;
      case "param": {
        const known = this.init.effect.inputs.some((s, i) => i >= 1 && s.name === c.name);
        if (!known) {
          throw this.err("E_META", `no parameter '${c.name}'`, pos, {
            clause: "param",
            name: c.name,
          });
        }
        if (this.paramDocs.has(c.name)) {
          throw this.err("E_META", `parameter '${c.name}' is already documented`, pos, {
            clause: "param",
            name: c.name,
          });
        }
        if (cpLength(c.text) > TEXT_MAX) {
          throw this.err("E_META", `parameter doc is longer than ${TEXT_MAX} code points`, pos, {
            clause: "param",
            name: c.name,
          });
        }
        this.paramDocs.set(c.name, c.text);
        return;
      }
      case "alias":
        for (const a of c.names) {
          if (!isWordName(a) || isReservedWord(a)) {
            throw this.err("E_NAME", `'${a}' is not a valid alias name`, pos, { name: a });
          }
          if (this.aliases.includes(a)) continue;
          if (a === this.init.name || this.init.isNameTaken?.(a) === true) {
            throw this.err("E_REDEFINED", `'${a}' is already defined`, pos, { name: a });
          }
          this.aliases.push(a);
        }
        return;
      case "see-also":
        for (const n of c.names) {
          const q = this.qualify(n);
          if (q === undefined) {
            throw this.err("E_META", `'${n}' is not a valid word name`, pos, {
              clause: "see-also",
              name: n,
            });
          }
          if (!this.seeAlso.includes(q)) this.seeAlso.push(q);
        }
        return;
      case "use-when": {
        if (this.useWhen !== undefined) {
          throw this.err("E_META", "'use-when' is already set", pos, { clause: "use-when" });
        }
        const why = checkUseWhen(c.text);
        if (why !== undefined) throw this.err("E_META", why, pos, { clause: "use-when" });
        this.useWhen = c.text;
        return;
      }
      case "link": {
        const bad = (why: string): ForgeError =>
          this.err("E_META", why, pos, { clause: "link", reason: why });
        const why = checkLinkUrl(c.url) ?? (c.label === null ? undefined : checkLinkLabel(c.label));
        if (why !== undefined) throw bad(why);
        if (this.links.some((l) => l.url === c.url)) throw bad("the link URL is already listed");
        if (this.links.length >= LINKS_MAX) throw bad(`more than ${LINKS_MAX} links`);
        this.links.push({ url: c.url, label: c.label });
        return;
      }
      case "inverse": {
        if (this.inverse !== undefined) {
          throw this.err("E_META", "'inverse' is already set", pos, { clause: "inverse" });
        }
        const q = this.qualify(c.name);
        if (q === undefined) {
          throw this.err("E_META", `'${c.name}' is not a valid word name`, pos, {
            clause: "inverse",
            name: c.name,
          });
        }
        if (!q.startsWith(`${this.init.vocab}:`)) {
          throw this.err(
            "E_META",
            `'inverse' must name a word of vocabulary '${this.init.vocab}'`,
            pos,
            { clause: "inverse", name: c.name },
          );
        }
        this.inverse = q;
        return;
      }
      case "helper":
        this.helper = true;
        return;
    }
  }

  private qualify(n: string): string | undefined {
    const parts = n.split(":");
    if (parts.length === 1) return isWordName(n) ? `${this.init.vocab}:${n}` : undefined;
    const [v, w] = parts as [string, string];
    return parts.length === 2 && isVocabName(v) && isWordName(w) ? n : undefined;
  }

  /**
   * One clause as the compiler tokenised it: `keyword` is the first word, `args` the tokens before
   * the closing `;`. Wrong arity or argument kinds, and unknown keywords, are E_META.
   */
  clauseFromArgs(keyword: string, args: readonly ClauseArg[], pos: SourcePos | null = null): void {
    const bad = (why: string): never => {
      throw this.err("E_META", `META: clause '${keyword}' ${why}`, pos, { clause: keyword });
    };
    const strs = args.filter((a) => a.type === "str");
    const names = args.filter((a) => a.type === "name");
    const texts = names.map((a) => (a as { text: string }).text);
    switch (keyword) {
      case "doc":
      case "category":
      case "version":
        if (strs.length !== 1 || args.length !== 1) bad("takes exactly one string");
        return this.clause({ kind: keyword, text: (strs[0] as { value: string }).value }, pos);
      case "param":
        if (names.length !== 1 || strs.length !== 1 || args[0]?.type !== "name") {
          bad("takes a parameter name and a string");
        }
        return this.clause(
          { kind: "param", name: texts[0] as string, text: (strs[0] as { value: string }).value },
          pos,
        );
      case "alias":
      case "see-also":
        if (names.length === 0 || strs.length !== 0) bad("takes one or more names");
        return this.clause({ kind: keyword, names: texts }, pos);
      case "use-when":
        if (strs.length !== 1 || args.length !== 1) bad("takes exactly one string");
        return this.clause({ kind: "use-when", text: (strs[0] as { value: string }).value }, pos);
      case "link":
        if (strs.length < 1 || strs.length > 2 || args.length !== strs.length) {
          bad("takes a URL string and an optional label string");
        }
        return this.clause(
          {
            kind: "link",
            url: (strs[0] as { value: string }).value,
            label: strs.length === 2 ? (strs[1] as { value: string }).value : null,
          },
          pos,
        );
      case "inverse":
        if (names.length !== 1 || args.length !== 1) bad("takes exactly one name");
        return this.clause({ kind: "inverse", name: texts[0] as string }, pos);
      case "helper":
        if (args.length !== 0) bad("takes no arguments");
        return this.clause({ kind: "helper" }, pos);
      case "checks":
        throw this.err("E_META", "`checks` is reserved for a later release", pos, {
          clause: "checks",
        });
      default:
        return bad("is not a known clause");
    }
  }

  /** `{ discovery }` when any discovery member is set, else nothing (the key stays absent). */
  private discoveryMember(): { discovery: WordDiscovery } | Record<string, never> {
    const d: {
      useWhen?: string;
      links?: readonly MetaLink[];
      inverse?: string;
    } = {};
    if (this.useWhen !== undefined) d.useWhen = this.useWhen;
    if (this.links.length > 0) d.links = this.links.map((l) => ({ url: l.url, label: l.label }));
    if (this.inverse !== undefined) d.inverse = this.inverse;
    return Object.keys(d).length === 0 ? {} : { discovery: d };
  }

  /** The finished record. `hash` comes from `computeHash`. */
  build(hash: string): WordMeta {
    const { init } = this;
    const inputs = init.effect.inputs.map((s, i) => {
      const d = i >= 1 && s.name !== null ? this.paramDocs.get(s.name) : undefined;
      return d === undefined ? s : { ...s, doc: d };
    });
    const params: ParamSpec[] = [];
    inputs.forEach((s, i) => {
      if (i >= 1 && s.name !== null) {
        params.push({ ...s, name: s.name, index: i, required: s.default === undefined });
      }
    });
    return {
      name: init.name,
      vocab: init.vocab,
      qname: this.qname,
      kind: init.kind,
      exported: this.exported,
      op: this.helper
        ? false
        : (init.op ?? (this.exported && init.vocab !== "core" && init.effect.inputs.length >= 1)),
      effect: { ...init.effect, inputs },
      params,
      category: this.category,
      doc: this.doc,
      aliases: [...this.aliases],
      seeAlso: [...this.seeAlso],
      effects: [...new Set(init.effects ?? [])].sort(),
      version: this.version,
      hash,
      source: init.source ?? { unit: null, text: null, pos: null },
      ...this.discoveryMember(),
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Hash (spec 12.4)
// ---------------------------------------------------------------------------------------------

/**
 * `ownText(entry)`: `source.text` for FL words, constants and variables (`sourceText`); for a
 * primitive or intrinsic `<kind> <qname> <effect.text> <version>`.
 */
export function ownText(parts: {
  readonly kind: WordKind;
  readonly qname: string;
  readonly effectText: string;
  readonly version: string;
  readonly sourceText: string | null;
}): string {
  if (parts.kind === "primitive" || parts.kind === "intrinsic") {
    return `${parts.kind} ${parts.qname} ${parts.effectText} ${parts.version}`;
  }
  return parts.sourceText ?? "";
}

/**
 * `hex(SHA-256(UTF-8(own + "\n" + lines)))` where `lines` is `<qname> <hash>` for each distinct
 * dependency, sorted by qname in code-point order, joined by `"\n"`. `deps` must not contain the
 * word itself (pass `selfQname` to have it dropped). A word without dependencies hashes `own + "\n"`.
 */
export function computeHash(
  own: string,
  deps: readonly { readonly qname: string; readonly hash: string }[],
  selfQname?: string,
  hasher: Sha256Fn = sha256,
): string {
  const lines = deps.filter((d) => d.qname !== selfQname).map((d) => `${d.qname} ${d.hash}`);
  const sorted = [...new Set(lines)].sort(cpCompare);
  return hasher(`${own}\n${sorted.join("\n")}`);
}

// ---------------------------------------------------------------------------------------------
// help and see (spec 12.5)
// ---------------------------------------------------------------------------------------------

/** The text `help` returns for a word: lines joined by `\n` and ending with one `\n`. */
export function renderHelp(meta: WordMeta): string {
  const lines = [`${meta.qname}  ${meta.effect.text}`];
  if (meta.doc !== null && meta.doc !== "") lines.push(meta.doc);
  if (meta.category !== null && meta.category !== "") lines.push(`category: ${meta.category}`);
  const d = meta.discovery;
  if (d?.useWhen !== undefined && d.useWhen !== "") lines.push(`use when: ${d.useWhen}`);
  if (meta.aliases.length > 0) lines.push(`aliases: ${meta.aliases.join(", ")}`);
  if (meta.seeAlso.length > 0) lines.push(`see also: ${meta.seeAlso.join(", ")}`);
  if (d?.links !== undefined && d.links.length > 0) {
    const shown = d.links.map((l) => (l.label === null ? l.url : `${l.url} (${l.label})`));
    lines.push(`links: ${shown.join(", ")}`);
  }
  if (meta.effects.length > 0) lines.push(`effects: ${meta.effects.join(", ")}`);
  if (meta.params.length > 0) {
    lines.push("parameters:");
    for (const p of meta.params) {
      lines.push(`  ${slotText(p)}${p.doc ? `  -- ${p.doc}` : ""}`);
    }
  }
  return lines.join("\n") + "\n";
}

/** The text `see` returns for a word, by kind. */
export function renderSee(meta: WordMeta): string {
  if (meta.kind === "primitive" || meta.kind === "intrinsic") {
    return `\\ ${meta.kind} ${meta.qname} ${meta.effect.text}\n`;
  }
  return `${meta.source.text ?? `\\ ${meta.kind} ${meta.qname} ${meta.effect.text}`}\n`;
}
