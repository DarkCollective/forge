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
 * Extracts the conformance suite of docs/LANGUAGE.md section 16 (the `fl-test` blocks) and the
 * `forth U-*` units of section 15 into typed test cases. Pure: no runtime is needed.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Breakpoint, EffectLabel, ErrorCode, Limits, Tag, Value } from "../../src/types.js";

/** The spec file being parsed, for error messages (parsing is synchronous). */
let currentFile = "LANGUAGE.md";

/** Thrown for a malformed block; the message names the spec file, line and the test. */
export class SpecParseError extends Error {
  readonly line: number;
  readonly testId: string | null;
  constructor(line: number, testId: string | null, message: string) {
    super(`${currentFile}:${line}${testId === null ? "" : ` (${testId})`}: ${message}`);
    this.name = "SpecParseError";
    this.line = line;
    this.testId = testId;
  }
}

export const KNOWN_DIRECTIVES = [
  "use",
  "unit",
  "unit-fails",
  "trusted",
  "run",
  "stack-in",
  "vars",
  "stack",
  "out",
  "error",
  "limits",
  "abort",
  "deny",
  "coercions",
  "warnings",
  "break",
  "hook",
  "hits",
  "hash-eq",
  "hash-ne",
  "meta",
] as const;
export type DirectiveName = (typeof KNOWN_DIRECTIVES)[number];

const ERROR_CODE_TABLE: Record<ErrorCode, true> = {
  E_LEX: true,
  E_SYNTAX: true,
  E_TOPLEVEL: true,
  E_NAME: true,
  E_HEADER: true,
  E_META: true,
  E_UNDEFINED: true,
  E_AMBIGUOUS: true,
  E_PRIVATE: true,
  E_NO_VOCAB: true,
  E_REDEFINED: true,
  E_READONLY: true,
  E_UNTRUSTED: true,
  E_NO_PRIMITIVE: true,
  E_STACK_UNDERFLOW: true,
  E_TYPE: true,
  E_COERCE: true,
  E_PARAM_INVALID: true,
  E_EFFECT: true,
  E_DIV_ZERO: true,
  E_RANGE: true,
  E_USER: true,
  E_PRIMITIVE: true,
  E_FORBIDDEN: true,
  E_LIMIT_STEPS: true,
  E_LIMIT_STACK: true,
  E_LIMIT_RETURN: true,
  E_LIMIT_VALUE: true,
  E_LIMIT_TOTAL: true,
  E_LIMIT_TIME: true,
  E_LIMIT_OUTPUT: true,
  E_LIMIT_SOURCE: true,
  E_ABORTED: true,
  E_INTERNAL: true,
};
const LIMIT_TABLE: Record<keyof Limits, true> = {
  maxSteps: true,
  maxDataDepth: true,
  maxReturnDepth: true,
  maxValueBytes: true,
  maxTotalBytes: true,
  maxIntBits: true,
  maxMillis: true,
  maxOutputBytes: true,
  maxSourceChars: true,
  maxRegexLength: true,
  maxTraceEntries: true,
};
const TAG_TABLE: Record<Tag, true> = {
  bytes: true,
  str: true,
  int: true,
  num: true,
  bool: true,
  list: true,
  quot: true,
  record: true,
  file: true,
};
const EFFECT_LABELS: readonly EffectLabel[] = ["+async", "+random", "+time"];
const DIAGNOSTIC_CODES = ["W_REDEFINED", "W_SHADOW"] as const;
export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];

/** Expected failure: `CODE key=value ...` (spec 16.1 `@error`). */
export interface ErrorExpectation {
  readonly code: ErrorCode;
  readonly line?: number;
  readonly col?: number;
  readonly word?: string;
  /** `detail.<field>=value` assertions; a list value (from `candidates`) is a string array. */
  readonly detail: Readonly<Record<string, string | string[]>>;
  /** The directive text as written, for messages. */
  readonly text: string;
}

export interface UnitSpec {
  /** Spec line of the directive. */
  readonly line: number;
  /** Source after `<<U+XXXX>>` expansion. */
  readonly source: string;
  readonly trusted: boolean;
  /** Set for `@unit-fails CODE`: the load must fail with this code. */
  readonly failsWith: ErrorCode | undefined;
  /** Expected load failure (an `@error` in a test without `@run` attaches to the last unit). */
  readonly error: ErrorExpectation | undefined;
  /** Expected diagnostic codes in order (`@warnings`), or undefined when not asserted. */
  readonly warnings: readonly DiagnosticCode[] | undefined;
}

export interface CoercionExpectation {
  readonly word: string;
  readonly slot: number;
  readonly from: Tag;
  readonly to: Tag;
}

export interface RunSpec {
  readonly line: number;
  readonly source: string;
  /** Expected output, or undefined when `@out` is absent. */
  readonly out: string | undefined;
  /** Expected final stack in `.s` format, or undefined. */
  readonly stack: string | undefined;
  readonly error: ErrorExpectation | undefined;
  readonly coercions: readonly CoercionExpectation[] | undefined;
}

export type PathSegment = string | number;

export interface MetaExpectation {
  readonly line: number;
  readonly qname: string;
  readonly path: readonly PathSegment[];
  readonly pathText: string;
  readonly expected: unknown;
}

export interface TestCase {
  readonly id: number;
  /** `C01`. */
  readonly label: string;
  readonly title: string;
  /** `C01 integer addition`: the Vitest test name. */
  readonly name: string;
  /** Spec line of the opening fence. */
  readonly line: number;
  readonly uses: readonly string[];
  readonly units: readonly UnitSpec[];
  readonly runs: readonly RunSpec[];
  /** Initial data stack of the first run (`@stack-in`), or undefined. */
  readonly stackIn: readonly Value[] | undefined;
  readonly sharedVars: boolean;
  readonly limits: Partial<Limits>;
  readonly abortMs: number | undefined;
  readonly deny: readonly EffectLabel[];
  readonly breakpoints: readonly Breakpoint[];
  readonly hook: "record" | "stop" | undefined;
  readonly hits: readonly string[] | undefined;
  readonly hashEq: readonly (readonly [string, string])[];
  readonly hashNe: readonly (readonly [string, string])[];
  readonly meta: readonly MetaExpectation[];
  /** Distinct directive names used, in first-use order. */
  readonly directives: readonly DirectiveName[];
  /** True for tests that assert only the error code and race the clock (`@abort`, `maxMillis`). */
  readonly timing: boolean;
}

export interface Spec {
  readonly cases: readonly TestCase[];
  /** Units from `forth U-*` code blocks, by name (e.g. `U-rot`). */
  readonly units: ReadonlyMap<string, string>;
}

// ---------------------------------------------------------------------------------------------
// Block extraction
// ---------------------------------------------------------------------------------------------

interface RawBlock {
  /** 1-based line of the opening fence. */
  readonly line: number;
  readonly lines: readonly string[];
}

function extractFences(markdown: string): { tests: RawBlock[]; units: Map<string, RawBlock> } {
  const all = markdown.split(/\r?\n/);
  const tests: RawBlock[] = [];
  const units = new Map<string, RawBlock>();
  let i = 0;
  while (i < all.length) {
    const open = /^```(.*)$/.exec(all[i] ?? "");
    if (open === null) {
      i++;
      continue;
    }
    const info = (open[1] ?? "").trim();
    const start = i;
    const body: string[] = [];
    i++;
    for (;;) {
      if (i >= all.length) {
        throw new SpecParseError(start + 1, null, `unterminated code fence (info "${info}")`);
      }
      const l = all[i] ?? "";
      i++;
      if (/^```\s*$/.test(l)) break;
      body.push(l);
    }
    const block: RawBlock = { line: start + 1, lines: body };
    if (info === "fl-test") {
      tests.push(block);
    } else if (/^fl-test\b/i.test(info) || /^fl[_-]?test/i.test(info)) {
      throw new SpecParseError(start + 1, null, `suspicious fence info string "${info}"`);
    } else {
      const u = /^forth (U-\S+)$/.exec(info);
      if (u !== null) {
        const name = u[1] as string;
        if (units.has(name)) {
          throw new SpecParseError(start + 1, null, `duplicate unit block "${name}"`);
        }
        units.set(name, block);
      }
    }
  }
  return { tests, units };
}

// ---------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------

interface Section {
  readonly name: DirectiveName;
  /** Spec line of the directive. */
  readonly line: number;
  /** Text after the directive name on its own line ("" when none). */
  readonly arg: string;
  /** Lines following it up to the next directive. */
  readonly body: readonly string[];
}

const KNOWN: ReadonlySet<string> = new Set(KNOWN_DIRECTIVES);

/** Replaces `<<U+XXXX>>` by that code point. */
export function expandEscapes(text: string): string {
  return text.replace(/<<U\+([0-9A-Fa-f]+)>>/g, (m, hex: string) => {
    const cp = parseInt(hex, 16);
    if (hex.length > 6 || cp > 0x10ffff) throw new RangeError(`code point out of range in ${m}`);
    return String.fromCodePoint(cp);
  });
}

// ---------------------------------------------------------------------------------------------
// Literal tokens of @stack-in
// ---------------------------------------------------------------------------------------------

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  n: "\n",
  r: "\r",
  t: "\t",
  "0": "\0",
  "\\": "\\",
  '"': '"',
  "'": "'",
};

/** Decodes the escape starting at `s[i]` (just after the backslash); returns text and next index. */
function readEscape(s: string, i: number): [string, number] {
  const c = s[i];
  if (c === undefined) throw new Error("dangling backslash");
  const simple = SIMPLE_ESCAPES[c];
  if (simple !== undefined) return [simple, i + 1];
  if (c === "x") {
    const h = s.slice(i + 1, i + 3);
    if (!/^[0-9a-fA-F]{2}$/.test(h)) throw new Error("bad \\x escape");
    return [String.fromCharCode(parseInt(h, 16)), i + 3];
  }
  if (c === "u") {
    const m = /^\{([0-9a-fA-F]{1,6})\}/.exec(s.slice(i + 1));
    if (m === null) throw new Error("bad \\u escape");
    const cp = parseInt(m[1] as string, 16);
    if (cp > 0x10ffff) throw new Error("code point out of range");
    return [String.fromCodePoint(cp), i + 1 + m[0].length];
  }
  throw new Error(`unknown escape \\${c}`);
}

function intValue(n: bigint): Value {
  const safe = n >= BigInt(Number.MIN_SAFE_INTEGER) && n <= BigInt(Number.MAX_SAFE_INTEGER);
  return { tag: "int", v: safe ? Number(n) : n };
}

/** Parses the literal tokens of `@stack-in` (spec 2: ints, floats, strings, chars, bytes, bool). */
export function parseStackIn(text: string): Value[] {
  const out: Value[] = [];
  let i = 0;
  const isSpace = (c: string): boolean => /\s/.test(c);
  while (i < text.length) {
    const c = text[i] as string;
    if (isSpace(c)) {
      i++;
    } else if (c === '"') {
      let s = "";
      i++;
      for (;;) {
        const d = text[i];
        if (d === undefined) throw new Error("unterminated string");
        if (d === '"') {
          i++;
          break;
        }
        if (d === "\\") {
          const [t, j] = readEscape(text, i + 1);
          s += t;
          i = j;
        } else {
          s += d;
          i++;
        }
      }
      out.push({ tag: "str", v: s });
    } else if (c === "'") {
      let ch: string;
      i++;
      if (text[i] === "\\") {
        const [t, j] = readEscape(text, i + 1);
        ch = t;
        i = j;
      } else {
        const cp = text.codePointAt(i);
        if (cp === undefined) throw new Error("unterminated char");
        ch = String.fromCodePoint(cp);
        i += ch.length;
      }
      if (text[i] !== "'") throw new Error("unterminated char literal");
      i++;
      out.push({ tag: "int", v: ch.codePointAt(0) as number });
    } else if (
      text.startsWith("#[", i) &&
      (text[i + 2] === undefined || isSpace(text[i + 2] as string))
    ) {
      const end = text.indexOf("]", i);
      if (end < 0) throw new Error("unterminated byte array");
      const bytes = text
        .slice(i + 2, end)
        .split(/\s+/)
        .filter((t) => t !== "")
        .map((t) => {
          if (!/^[0-9a-fA-F]{1,2}$/.test(t)) throw new Error(`bad byte "${t}"`);
          return parseInt(t, 16);
        });
      out.push({ tag: "bytes", v: Uint8Array.from(bytes) });
      i = end + 1;
    } else {
      let j = i;
      while (j < text.length && !isSpace(text[j] as string)) j++;
      const tok = text.slice(i, j);
      i = j;
      if (tok === "true" || tok === "false") {
        out.push({ tag: "bool", v: tok === "true" });
        continue;
      }
      const m = /^([+-]?)(0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*)$/.exec(tok);
      if (m !== null) {
        const mag = BigInt(
          (m[2] as string).replace(/_/g, "").replace(/^0B/, "0b").replace(/^0X/, "0x"),
        );
        out.push(intValue(m[1] === "-" ? -mag : mag));
        continue;
      }
      if (/^[+-]?(\d[\d_]*\.\d[\d_]*([eE][+-]?\d+)?|\d[\d_]*[eE][+-]?\d+)$/.test(tok)) {
        out.push({ tag: "num", v: Number(tok.replace(/_/g, "")) });
        continue;
      }
      throw new Error(`not a literal token: ${tok}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Directive payload parsers
// ---------------------------------------------------------------------------------------------

type Fail = (line: number, message: string) => never;

/** Argument line plus body lines, blank lines removed (for directives with scalar payloads). */
function payloadLines(s: Section): string[] {
  const lines = s.arg === "" ? [...s.body] : [s.arg, ...s.body];
  return lines.map((l) => l.trim()).filter((l) => l !== "");
}

function asErrorCode(text: string, line: number, fail: Fail): ErrorCode {
  if (!Object.prototype.hasOwnProperty.call(ERROR_CODE_TABLE, text)) {
    return fail(line, `unknown error code "${text}"`);
  }
  return text as ErrorCode;
}

function parseErrorExpectation(s: Section, fail: Fail): ErrorExpectation {
  const lines = payloadLines(s);
  if (lines.length !== 1) {
    return fail(s.line, `@error needs exactly one "CODE key=value ..." line, got ${lines.length}`);
  }
  const text = lines[0] as string;
  const [codeText = "", ...rest] = text.split(/\s+/);
  const code = asErrorCode(codeText, s.line, fail);
  let line: number | undefined;
  let col: number | undefined;
  let word: string | undefined;
  const detail: Record<string, string | string[]> = {};
  for (const item of rest) {
    const eq = item.indexOf("=");
    if (eq <= 0) return fail(s.line, `@error assertion "${item}" is not key=value`);
    const key = item.slice(0, eq);
    const value = item.slice(eq + 1);
    if (key === "line" || key === "col") {
      if (!/^\d+$/.test(value))
        return fail(s.line, `@error ${key}= needs a number, got "${value}"`);
      if (key === "line") line = Number(value);
      else col = Number(value);
    } else if (key === "word") {
      word = value;
    } else if (key === "candidates" || key.startsWith("detail.")) {
      // §16.1 writes `candidates=`; the tests write `detail.candidates=`. Both mean detail.candidates.
      const field = key === "candidates" ? key : key.slice("detail.".length);
      if (field === "") return fail(s.line, `@error assertion "${item}" has an empty detail field`);
      detail[field] = field === "candidates" ? value.split(",") : value;
    } else {
      return fail(s.line, `unknown @error assertion key "${key}"`);
    }
  }
  return {
    code,
    ...(line === undefined ? {} : { line }),
    ...(col === undefined ? {} : { col }),
    ...(word === undefined ? {} : { word }),
    detail,
    text,
  };
}

function parseMetaPath(text: string): PathSegment[] | undefined {
  const out: PathSegment[] = [];
  let rest = text;
  let first = true;
  while (rest !== "") {
    let m: RegExpExecArray | null;
    if ((m = /^\[(\d+)\]/.exec(rest)) !== null) {
      out.push(Number(m[1]));
    } else if ((m = (first ? /^([A-Za-z_]\w*)/ : /^\.([A-Za-z_]\w*)/).exec(rest)) !== null) {
      out.push(m[1] as string);
    } else {
      return undefined;
    }
    rest = rest.slice(m[0].length);
    first = false;
  }
  return out;
}

function parseMeta(s: Section, fail: Fail): MetaExpectation[] {
  const out: MetaExpectation[] = [];
  s.body.forEach((raw, k) => {
    if (raw.trim() === "") return;
    const line = s.line + 1 + k;
    const sep = raw.indexOf(" = ");
    if (sep < 0) return fail(line, `@meta line has no " = ": ${raw}`);
    const lhs = raw.slice(0, sep).trim();
    const rhs = raw.slice(sep + 3);
    const m = /^(\S+)(?:\s+(\S+))?$/.exec(lhs);
    if (m === null) return fail(line, `@meta line needs "<qname> <path> = <json>": ${raw}`);
    const pathText = m[2] ?? "";
    const path = parseMetaPath(pathText);
    if (path === undefined)
      return fail(line, `@meta path "${pathText}" is not a dotted/indexed path`);
    let expected: unknown;
    try {
      expected = JSON.parse(rhs);
    } catch {
      return fail(line, `@meta value is not valid JSON: ${rhs}`);
    }
    out.push({ line, qname: m[1] as string, path, pathText, expected });
  });
  if (out.length === 0) return fail(s.line, "@meta has no lines");
  return out;
}

function parsePairs(s: Section, fail: Fail): [string, string] {
  const toks = payloadLines(s)
    .join(" ")
    .split(/\s+/)
    .filter((t) => t !== "");
  if (toks.length !== 2) return fail(s.line, `@${s.name} needs exactly two qualified names`);
  return [toks[0] as string, toks[1] as string];
}

// ---------------------------------------------------------------------------------------------
// Block parsing
// ---------------------------------------------------------------------------------------------

function splitSections(block: RawBlock, fail: Fail): { title: string; sections: Section[] } {
  const first = block.lines[0];
  if (first === undefined) return fail(block.line, "empty fl-test block");
  const sections: Section[] = [];
  let cur: { name: DirectiveName; line: number; arg: string; body: string[] } | undefined;
  for (let k = 1; k < block.lines.length; k++) {
    const text = block.lines[k] as string;
    const line = block.line + 1 + k;
    if (text.startsWith("@")) {
      const m = /^@([a-z][a-z-]*)(?:[ \t]+(.*))?$/.exec(text.trimEnd());
      if (m === null) return fail(line, `malformed directive line: ${text}`);
      const name = m[1] as string;
      if (!KNOWN.has(name)) return fail(line, `unknown directive @${name}`);
      cur = { name: name as DirectiveName, line, arg: (m[2] ?? "").trim(), body: [] };
      sections.push(cur);
    } else if (cur === undefined) {
      if (text.trim() !== "") return fail(line, `text before the first directive: ${text}`);
    } else {
      cur.body.push(text);
    }
  }
  return { title: first, sections };
}

function parseBlock(block: RawBlock, unitNames: ReadonlySet<string>): TestCase {
  let label: string | null = null;
  const fail: Fail = (line, message) => {
    throw new SpecParseError(line, label, message);
  };
  const tm = /^# (C(\d+)) (\S.*)$/.exec(block.lines[0] ?? "");
  if (tm === null) {
    return fail(
      block.line + 1,
      `first line must be "# C<number> <title>", got "${block.lines[0] ?? ""}"`,
    );
  }
  label = tm[1] as string;
  const id = Number(tm[2]);
  const title = (tm[3] as string).trim();
  const { sections } = splitSections(block, fail);

  const expand = (s: Section, text: string): string => {
    try {
      return expandEscapes(text);
    } catch (e) {
      return fail(s.line, e instanceof Error ? e.message : String(e));
    }
  };
  const noArg = (s: Section): void => {
    if (s.arg !== "") fail(s.line, `@${s.name} takes no text on its directive line`);
  };
  const source = (s: Section): string => {
    noArg(s);
    const text = s.body.join("\n");
    if (text.trim() === "") fail(s.line, `@${s.name} has no source`);
    return expand(s, text);
  };

  const uses: string[] = [];
  interface MutUnit {
    line: number;
    source: string;
    trusted: boolean;
    failsWith: ErrorCode | undefined;
    error: ErrorExpectation | undefined;
    warnings: DiagnosticCode[] | undefined;
  }
  interface MutRun {
    line: number;
    source: string;
    out: string | undefined;
    stack: string | undefined;
    error: ErrorExpectation | undefined;
    coercions: CoercionExpectation[] | undefined;
  }
  const units: MutUnit[] = [];
  const runs: MutRun[] = [];
  let stackIn: Value[] | undefined;
  let sharedVars = false;
  const limits: Partial<Record<keyof Limits, number>> = {};
  let abortMs: number | undefined;
  const deny: EffectLabel[] = [];
  const breakpoints: Breakpoint[] = [];
  let hook: "record" | "stop" | undefined;
  let hits: string[] | undefined;
  const hashEq: [string, string][] = [];
  const hashNe: [string, string][] = [];
  const meta: MetaExpectation[] = [];
  const used: DirectiveName[] = [];
  let loadError: Section | undefined;

  const once = (seen: unknown, s: Section): void => {
    if (seen !== undefined) fail(s.line, `@${s.name} appears more than once`);
  };

  for (const s of sections) {
    if (!used.includes(s.name)) used.push(s.name);
    const lastUnit = units[units.length - 1];
    const lastRun = runs[runs.length - 1];
    switch (s.name) {
      case "use": {
        const names = payloadLines(s);
        if (names.length !== 1) return fail(s.line, "@use needs exactly one unit name");
        const name = names[0] as string;
        if (!unitNames.has(name)) return fail(s.line, `@use names unknown unit "${name}"`);
        uses.push(name);
        break;
      }
      case "unit":
        units.push({
          line: s.line,
          source: source(s),
          trusted: false,
          failsWith: undefined,
          error: undefined,
          warnings: undefined,
        });
        break;
      case "unit-fails": {
        const code = asErrorCode(s.arg, s.line, fail);
        const text = s.body.join("\n");
        if (text.trim() === "") return fail(s.line, "@unit-fails has no source");
        units.push({
          line: s.line,
          source: expand(s, text),
          trusted: false,
          failsWith: code,
          error: undefined,
          warnings: undefined,
        });
        break;
      }
      case "trusted":
        if (payloadLines(s).length > 0) return fail(s.line, "@trusted takes no text");
        if (lastUnit === undefined) return fail(s.line, "@trusted has no preceding @unit");
        lastUnit.trusted = true;
        break;
      case "run":
        runs.push({
          line: s.line,
          source: source(s),
          out: undefined,
          stack: undefined,
          error: undefined,
          coercions: undefined,
        });
        break;
      case "stack-in": {
        once(stackIn, s);
        noArg(s);
        try {
          stackIn = parseStackIn(expand(s, s.body.join("\n")));
        } catch (e) {
          return fail(s.line, `@stack-in: ${e instanceof Error ? e.message : String(e)}`);
        }
        break;
      }
      case "vars": {
        const v = payloadLines(s);
        if (v.length !== 1 || v[0] !== "shared")
          return fail(s.line, '@vars must be "@vars shared"');
        sharedVars = true;
        break;
      }
      case "stack": {
        if (lastRun === undefined) return fail(s.line, "@stack before any @run");
        once(lastRun.stack, s);
        const v = payloadLines(s);
        if (v.length !== 1) return fail(s.line, "@stack needs exactly one line");
        lastRun.stack = v[0] as string;
        break;
      }
      case "out": {
        if (lastRun === undefined) return fail(s.line, "@out before any @run");
        once(lastRun.out, s);
        noArg(s);
        lastRun.out = s.body.length === 0 ? "" : s.body.join("\n") + "\n";
        break;
      }
      case "error": {
        if (runs.length === 0) {
          // No @run: the failure is expected from the last unit's load().
          if (lastUnit === undefined) return fail(s.line, "@error with neither @run nor @unit");
          if (loadError !== undefined) return fail(s.line, "@error appears more than once");
          if (lastUnit.failsWith !== undefined) {
            return fail(
              s.line,
              "@error cannot follow @unit-fails (the unit is already expected to fail)",
            );
          }
          loadError = s;
          lastUnit.error = parseErrorExpectation(s, fail);
        } else {
          const r = lastRun as MutRun;
          once(r.error, s);
          r.error = parseErrorExpectation(s, fail);
        }
        break;
      }
      case "limits": {
        const toks = payloadLines(s)
          .join(" ")
          .split(/\s+/)
          .filter((t) => t !== "");
        if (toks.length === 0) return fail(s.line, "@limits has no name=value pairs");
        for (const t of toks) {
          const m = /^([A-Za-z]+)=(\d+)$/.exec(t);
          if (m === null) return fail(s.line, `@limits item "${t}" is not name=value`);
          const key = m[1] as string;
          if (!Object.prototype.hasOwnProperty.call(LIMIT_TABLE, key)) {
            return fail(s.line, `@limits names unknown limit "${key}"`);
          }
          const n = Number(m[2]);
          if (!Number.isSafeInteger(n))
            return fail(s.line, `@limits value "${m[2]}" is not a safe integer`);
          limits[key as keyof Limits] = n;
        }
        break;
      }
      case "abort": {
        once(abortMs, s);
        const v = payloadLines(s);
        const m = v.length === 1 ? /^(\d+)ms$/.exec(v[0] as string) : null;
        if (m === null) return fail(s.line, '@abort needs "<n>ms"');
        abortMs = Number(m[1]);
        break;
      }
      case "deny": {
        const toks = payloadLines(s)
          .join(" ")
          .split(/\s+/)
          .filter((t) => t !== "");
        if (toks.length === 0) return fail(s.line, "@deny has no labels");
        for (const t of toks) {
          if (!(EFFECT_LABELS as readonly string[]).includes(t)) {
            return fail(s.line, `@deny names unknown effect label "${t}"`);
          }
          deny.push(t as EffectLabel);
        }
        break;
      }
      case "coercions": {
        if (lastRun === undefined) return fail(s.line, "@coercions before any @run");
        once(lastRun.coercions, s);
        const list: CoercionExpectation[] = [];
        for (const l of payloadLines(s)) {
          const f = l.split(/\s+/);
          const [word, slot, from, to] = f;
          if (f.length !== 4 || !/^\d+$/.test(slot as string)) {
            return fail(s.line, `@coercions line needs "word slot from to": ${l}`);
          }
          for (const t of [from, to]) {
            if (!Object.prototype.hasOwnProperty.call(TAG_TABLE, t as string)) {
              return fail(s.line, `@coercions has unknown tag "${t}"`);
            }
          }
          list.push({ word: word as string, slot: Number(slot), from: from as Tag, to: to as Tag });
        }
        lastRun.coercions = list;
        break;
      }
      case "warnings": {
        if (lastUnit === undefined) return fail(s.line, "@warnings before any @unit");
        once(lastUnit.warnings, s);
        const list: DiagnosticCode[] = [];
        for (const l of payloadLines(s)) {
          if (!(DIAGNOSTIC_CODES as readonly string[]).includes(l)) {
            return fail(s.line, `@warnings names unknown diagnostic "${l}"`);
          }
          list.push(l as DiagnosticCode);
        }
        lastUnit.warnings = list;
        break;
      }
      case "break": {
        const ls = payloadLines(s);
        if (ls.length === 0) return fail(s.line, "@break has no breakpoint");
        for (const l of ls) {
          const m = /^(\S+)(?:\s+(\d+))?$/.exec(l);
          if (m === null) return fail(s.line, `@break needs "<qname>" or "<qname> <ip>": ${l}`);
          breakpoints.push(
            m[2] === undefined
              ? { word: m[1] as string }
              : { word: m[1] as string, ip: Number(m[2]) },
          );
        }
        break;
      }
      case "hook": {
        once(hook, s);
        const v = payloadLines(s);
        if (v.length !== 1 || (v[0] !== "record" && v[0] !== "stop")) {
          return fail(s.line, '@hook must be "record" or "stop"');
        }
        hook = v[0];
        break;
      }
      case "hits": {
        once(hits, s);
        const list = payloadLines(s);
        for (const l of list) {
          if (!/^\S+ \d+ \S+$/.test(l.replace(/\s+/g, " "))) {
            return fail(s.line, `@hits line needs "<word> <ip> <op>": ${l}`);
          }
        }
        hits = list.map((l) => l.replace(/\s+/g, " "));
        break;
      }
      case "hash-eq":
        hashEq.push(parsePairs(s, fail));
        break;
      case "hash-ne":
        hashNe.push(parsePairs(s, fail));
        break;
      case "meta":
        noArg(s);
        meta.push(...parseMeta(s, fail));
        break;
    }
  }

  // Cross-section rules.
  if (runs.length === 0 && units.length === 0 && uses.length === 0) {
    return fail(block.line, "test has no @run, @unit or @use");
  }
  if (stackIn !== undefined && runs.length === 0) return fail(block.line, "@stack-in without @run");
  if (hook !== undefined && breakpoints.length === 0)
    return fail(block.line, "@hook without @break");
  if (breakpoints.length > 0 && hook === undefined) return fail(block.line, "@break without @hook");
  if (hits !== undefined && hook !== "record")
    return fail(block.line, "@hits requires @hook record");
  if (runs.length === 0 && (abortMs !== undefined || deny.length > 0 || breakpoints.length > 0)) {
    return fail(block.line, "@abort/@deny/@break only affect runs, but the test has no @run");
  }
  return {
    id,
    label,
    title,
    name: `${label} ${title}`,
    line: block.line,
    uses,
    units: units.map((u) => ({ ...u })),
    runs: runs.map((r) => ({ ...r })),
    stackIn,
    sharedVars,
    limits,
    abortMs,
    deny,
    breakpoints,
    hook,
    hits,
    hashEq,
    hashNe,
    meta,
    directives: used,
    timing: abortMs !== undefined || limits.maxMillis !== undefined,
  };
}

/**
 * Parses one spec text. Throws SpecParseError at the first malformed block. `file` names the
 * document in error messages. Blocks fenced `fl-proposed` (or anything but `fl-test`) are ignored.
 */
export function parseSpec(markdown: string, file = "LANGUAGE.md"): Spec {
  const previous = currentFile;
  currentFile = file;
  try {
    const { tests, units } = extractFences(markdown);
    const unitText = new Map<string, string>();
    for (const [name, block] of units) unitText.set(name, block.lines.join("\n") + "\n");
    const names = new Set(unitText.keys());
    return { cases: tests.map((b) => parseBlock(b, names)), units: unitText };
  } finally {
    currentFile = previous;
  }
}

/**
 * Parses several spec documents into one suite (cases in document order). Case ids and unit names
 * must be unique across the documents; a duplicate fails with a message naming both files.
 */
export function parseSpecs(
  docs: readonly { readonly file: string; readonly text: string }[],
): Spec {
  const cases: TestCase[] = [];
  const units = new Map<string, string>();
  const caseFile = new Map<number, string>();
  const unitFile = new Map<string, string>();
  for (const doc of docs) {
    const spec = parseSpec(doc.text, doc.file);
    for (const c of spec.cases) {
      const other = caseFile.get(c.id);
      if (other !== undefined) {
        throw new SpecParseError(
          0,
          c.label,
          `duplicate case id ${c.label}: already defined in ${other}, again in ${doc.file}`,
        );
      }
      caseFile.set(c.id, doc.file);
      cases.push(c);
    }
    for (const [name, text] of spec.units) {
      const other = unitFile.get(name);
      if (other !== undefined) {
        throw new SpecParseError(
          0,
          null,
          `duplicate unit block "${name}": already defined in ${other}, again in ${doc.file}`,
        );
      }
      unitFile.set(name, doc.file);
      units.set(name, text);
    }
  }
  return { cases, units };
}

/** Every `@directive` name that appears at the start of a line inside fl-test blocks (raw scan). */
export function scanDirectiveNames(markdown: string): Set<string> {
  const names = new Set<string>();
  for (const b of extractFences(markdown).tests) {
    for (const l of b.lines) {
      const m = /^@([^\s]*)/.exec(l);
      if (m !== null) names.add(m[1] as string);
    }
  }
  return names;
}

export function specPath(): string {
  return fileURLToPath(new URL("../../../../docs/LANGUAGE.md", import.meta.url).href);
}

/** The spec documents that carry `fl-test` blocks, in reading order. */
export function specDocPaths(): readonly { readonly file: string; readonly path: string }[] {
  return [
    { file: "LANGUAGE.md", path: specPath() },
    {
      file: "LANGUAGE-0.2.md",
      path: fileURLToPath(new URL("../../../../docs/LANGUAGE-0.2.md", import.meta.url).href),
    },
  ];
}

/** The text of LANGUAGE.md alone. */
export function readSpec(): string {
  return readFileSync(specPath(), "utf8");
}

/** The suite: `fl-test` blocks of LANGUAGE.md and LANGUAGE-0.2.md as one. */
export function loadSpec(): Spec {
  return parseSpecs(
    specDocPaths().map(({ file, path }) => ({ file, text: readFileSync(path, "utf8") })),
  );
}

/** True when the case asserts something beyond "succeeds" (spec 16.1 allows the latter, rarely). */
export function hasExpectation(tc: TestCase): boolean {
  return (
    tc.runs.some(
      (r) =>
        r.out !== undefined ||
        r.stack !== undefined ||
        r.error !== undefined ||
        r.coercions !== undefined,
    ) ||
    tc.units.some(
      (u) => u.error !== undefined || u.failsWith !== undefined || u.warnings !== undefined,
    ) ||
    tc.meta.length > 0 ||
    tc.hashEq.length > 0 ||
    tc.hashNe.length > 0 ||
    tc.hits !== undefined
  );
}
