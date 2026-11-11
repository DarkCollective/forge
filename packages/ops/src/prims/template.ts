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
 * template primitive: the renderer behind `template:render`, a documented subset of Handlebars written for Forge.
 * CyberChef's Template renders with the Handlebars library, which compiles a template to JavaScript source and
 * runs it with `new Function`; that is code execution, and it does not run under the strict CSP of the bake
 * Worker. This module parses the template into a tree and walks the tree against the value, so no code is
 * generated or run, and the data and the template can come from anyone.
 *
 * Why not FL: the renderer needs a parser with nesting, a scope stack and the white-space rules of Handlebars;
 * written over the bare FL loop (5.5 VM steps a character, before any state, see json.ts) a 64 KiB template would
 * use more than the default step limit before it started to render. It is a private primitive.
 *
 * The subset (everything else is E_COERCE naming the line and column):
 *  - text, `{{path}}` (HTML-escaped: & < > " ' ` = become entities, as Handlebars does), `{{{path}}}` and
 *    `{{& path}}` (not escaped), comments `{{! ... }}` and `{{!-- ... --}}`, `\{{` for a literal `{{`;
 *  - paths: `a.b.c` and `a/b/c`, `this`, `.`, `../parent`, `a.[odd key]`, list indexes (`items.[0]`)
 *    and `length` of a list or string, `@root`, `@index`, `@key`, `@first`, `@last` (and `@../index` for the
 *    enclosing loop); only own properties of the data are read. A missing value is the empty string;
 *  - literals as helper arguments: "text", 'text', numbers, true, false, null, undefined;
 *  - blocks `{{#if x}}...{{else if y}}...{{else}}...{{/if}}`, `unless`, `each` (lists and objects, with `{{else}}`
 *    for the empty case, `as |item index|` block parameters), `with`, `lookup` (inline or as `(lookup a b)`), and
 *    Mustache sections for any other name (`{{#name}}`: a list is looped over, `true` keeps the context, an
 *    object or other value becomes the context, a false or missing value renders the `{{else}}` part) and
 *    inverted sections (`{{^name}}...{{/name}}`);
 *  - white-space control `{{~x~}}` and Handlebars' rule that a block tag or a comment alone on its line removes
 *    that line (the "standalone" rule), implemented from the algorithm of its WhitespaceControl;
 *  - `if` takes `includeZero=true` as its one named argument.
 * Not in the subset (E_COERCE): partials `{{> x}}`, decorators, raw blocks `{{{{x}}}}`, custom and unknown
 * helpers (`{{foo bar}}` is "missing helper"), `log`, other named arguments, `@level` and data frames beyond the
 * list above, and Handlebars' compat and strict modes.
 *
 * Output text: a string as it is, an integer as its digits, a float as JavaScript prints it (1.0 is 1), true and
 * false, null and a missing value as nothing, a list as its items joined with commas (JavaScript's Array
 * toString), an object as `[object Object]`.
 *
 * Bounds. The template may nest blocks 100 deep (E_LIMIT_VALUE); a render may do 5,000,000 steps (a node
 * rendered, a loop iteration, a path segment read: E_LIMIT_STEPS), so `{{#each a}}{{#each a}}...` over big lists
 * stops; the output is held to `ctx.limits.maxValueBytes` while it grows (E_LIMIT_VALUE).
 */
import { ForgeError, definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef, Value } from "@forge/lang";
import { isNullValue } from "../json-js.js";
import { limitFailure } from "../prim-util.js";

const { int, str, bool } = valueHelpers;

/** Deepest nesting of blocks in a template. */
export const MAX_BLOCK_DEPTH = 100;
/** Steps a render may take. */
export const MAX_STEPS = 5_000_000;

type V = Value | undefined;

// ---------------------------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------------------------

function fail(src: string, at: number, reason: string): never {
  let line = 1;
  let col = 1;
  for (let k = 0; k < at && k < src.length; k++) {
    if (src.charCodeAt(k) === 0x0a) {
      line++;
      col = 1;
    } else col++;
  }
  throw new ForgeError({
    code: "E_COERCE",
    message: `cannot render template: ${reason} at line ${line}, column ${col}`,
    detail: { from: "str", to: "template", reason, line, column: col },
  });
}

// ---------------------------------------------------------------------------------------------
// syntax tree
// ---------------------------------------------------------------------------------------------

interface Strip {
  open: boolean;
  close: boolean;
}

interface Path {
  t: "path";
  data: boolean;
  depth: number; // number of ../
  parts: string[]; // [] for this / .
  at: number;
}
interface Literal {
  t: "lit";
  value: V;
}
interface Sub {
  t: "sub";
  helper: string;
  params: Expr[];
  at: number;
}
type Expr = Path | Literal | Sub;

interface Call {
  head: Expr; // a path (the helper or property name) or a literal
  params: Expr[];
  hash: Map<string, Expr>;
  blockParams: string[] | undefined;
  at: number;
}

interface Content {
  t: "content";
  value: string;
  original: string;
  ls: boolean;
  rs: boolean;
}
interface Mustache {
  t: "mustache";
  call: Call;
  raw: boolean;
  strip: Strip;
}
interface Comment {
  t: "comment";
  strip: Strip;
}
interface Block {
  t: "block";
  call: Call;
  program: Program | undefined;
  inverse: Program | undefined;
  openStrip: Strip;
  inverseStrip: Strip | undefined;
  closeStrip: Strip;
}
type Node = Content | Mustache | Comment | Block;
interface Program {
  body: Node[];
  chained: boolean;
}

// ---------------------------------------------------------------------------------------------
// tokens
// ---------------------------------------------------------------------------------------------

type Tok =
  | { k: "content"; text: string; at: number }
  | { k: "comment"; strip: Strip; at: number }
  | {
      k: "open" | "openInverted" | "close" | "else" | "mustache" | "raw";
      inner: string;
      strip: Strip;
      at: number;
      innerAt: number;
    };

/** Splits the template into content, comments and mustaches (their inner text still unparsed). */
function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let text = "";
  let textAt = 0;
  const flush = (): void => {
    if (text !== "") toks.push({ k: "content", text, at: textAt });
    text = "";
  };
  const n = src.length;
  while (i < n) {
    const j = src.indexOf("{{", i);
    if (j < 0) {
      if (text === "") textAt = i;
      text += src.slice(i);
      break;
    }
    // escapes: \{{ is a literal {{ ; \\{{ is a backslash and a mustache
    if (j > 0 && src.charCodeAt(j - 1) === 0x5c) {
      if (j > 1 && src.charCodeAt(j - 2) === 0x5c) {
        if (text === "") textAt = i;
        text += src.slice(i, j - 1);
        i = j;
      } else {
        if (text === "") textAt = i;
        text += src.slice(i, j - 1);
        // the literal {{ ; what follows is scanned as ordinary text
        text += "{{";
        i = j + 2;
        continue;
      }
    } else {
      if (text === "") textAt = i;
      text += src.slice(i, j);
      i = j;
    }
    // a mustache starts at i
    flush();
    const at = i;
    if (src.startsWith("{{{{", i)) fail(src, at, "raw blocks {{{{x}}}} are not supported");
    let p = i + 2;
    let openTilde = false;
    if (src[p] === "~") {
      openTilde = true;
      p++;
    }
    const c = src[p];
    // comments
    if (c === "!") {
      let closeTilde: boolean;
      let after: number;
      if (src.startsWith("!--", p)) {
        const re = /--(~?)\}\}/g;
        re.lastIndex = p + 3;
        const m = re.exec(src);
        if (m === null) fail(src, at, "unterminated comment");
        closeTilde = m[1] === "~";
        after = m.index + m[0].length;
      } else {
        const e = src.indexOf("}}", p);
        if (e < 0) fail(src, at, "unterminated comment");
        closeTilde = src[e - 1] === "~";
        after = e + 2;
      }
      toks.push({ k: "comment", strip: { open: openTilde, close: closeTilde }, at });
      i = after;
      continue;
    }
    // triple mustache {{{ ... }}}
    if (c === "{") {
      const e = src.indexOf("}}}", p + 1);
      if (e < 0) fail(src, at, "unterminated {{{");
      let inner = src.slice(p + 1, e);
      let closeTilde = false;
      if (inner.endsWith("~")) {
        closeTilde = true;
        inner = inner.slice(0, -1);
      }
      toks.push({
        k: "raw",
        inner,
        strip: { open: openTilde, close: closeTilde },
        at,
        innerAt: p + 1,
      });
      i = e + 3;
      continue;
    }
    const e = findClose(src, p);
    if (e < 0) fail(src, at, "unterminated mustache");
    let inner = src.slice(p, e);
    let closeTilde = false;
    if (inner.endsWith("~")) {
      closeTilde = true;
      inner = inner.slice(0, -1);
    }
    const strip = { open: openTilde, close: closeTilde };
    i = e + 2;
    const trimmed = inner.trimStart();
    const lead = inner.length - trimmed.length;
    const innerAt = p + lead;
    const first = trimmed[0];
    if (first === "#") {
      const rest = trimmed.slice(1);
      if (rest.startsWith(">")) fail(src, at, "partial blocks are not supported");
      if (rest.startsWith("*")) fail(src, at, "decorators are not supported");
      toks.push({ k: "open", inner: rest, strip, at, innerAt: innerAt + 1 });
    } else if (first === "/") {
      toks.push({ k: "close", inner: trimmed.slice(1), strip, at, innerAt: innerAt + 1 });
    } else if (first === "^") {
      const rest = trimmed.slice(1).trim();
      if (rest === "") toks.push({ k: "else", inner: "", strip, at, innerAt: innerAt + 1 });
      else
        toks.push({ k: "openInverted", inner: trimmed.slice(1), strip, at, innerAt: innerAt + 1 });
    } else if (first === ">") {
      fail(src, at, "partials {{> x}} are not supported");
    } else if (first === "*") {
      fail(src, at, "decorators are not supported");
    } else if (trimmed === "else" || /^else\s/.test(trimmed)) {
      toks.push({ k: "else", inner: trimmed.slice(4), strip, at, innerAt: innerAt + 4 });
    } else if (first === "&") {
      toks.push({ k: "raw", inner: trimmed.slice(1), strip, at, innerAt: innerAt + 1 });
    } else {
      toks.push({ k: "mustache", inner: trimmed, strip, at, innerAt });
    }
  }
  flush();
  return toks;
}

/** The index of the `}}` that ends the mustache whose inner text starts at `from` (string literals may hold `}}`). */
function findClose(src: string, from: number): number {
  let i = from;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'") {
      let k = i + 1;
      while (k < n && src[k] !== c) {
        if (src[k] === "\\" && k + 1 < n) k++;
        k++;
      }
      i = k + 1;
      continue;
    }
    if (c === "[") {
      const k = src.indexOf("]", i);
      if (k < 0) return -1;
      i = k + 1;
      continue;
    }
    if (c === "}" && src[i + 1] === "}") return i;
    i++;
  }
  return -1;
}

// ---------------------------------------------------------------------------------------------
// expressions
// ---------------------------------------------------------------------------------------------

const ID_STOP = /[\s!"#%&'()*+,./;<=>@[\\\]^`{|}~]/;

class ExprParser {
  private p = 0;
  constructor(
    private readonly s: string,
    private readonly src: string,
    private readonly base: number,
  ) {}

  private err(reason: string): never {
    return fail(this.src, this.base + this.p, reason);
  }

  private ws(): void {
    while (this.p < this.s.length && /\s/.test(this.s[this.p] as string)) this.p++;
  }

  atEnd(): boolean {
    this.ws();
    return this.p >= this.s.length;
  }

  /** callExpr: head params* hash* blockParams? */
  call(): Call {
    this.ws();
    const at = this.base + this.p;
    const head = this.primary();
    const params: Expr[] = [];
    const hash = new Map<string, Expr>();
    let blockParams: string[] | undefined;
    for (;;) {
      this.ws();
      if (this.p >= this.s.length || this.s[this.p] === ")") break;
      // as |a b|
      if (/^as\s*\|/.test(this.s.slice(this.p))) {
        this.p = this.s.indexOf("|", this.p) + 1;
        blockParams = [];
        for (;;) {
          this.ws();
          if (this.s[this.p] === "|") {
            this.p++;
            break;
          }
          const name = this.id();
          if (name === "") this.err("a block parameter name was expected");
          blockParams.push(name);
        }
        continue;
      }
      // hash pair?
      const m = /^([^\s!"#%&'()*+,./;<=>@[\\\]^`{|}~]+)\s*=(?!=)/.exec(this.s.slice(this.p));
      if (m !== null) {
        this.p += m[0].length;
        this.ws();
        hash.set(m[1] as string, this.primary());
        continue;
      }
      if (hash.size > 0) this.err("a positional argument cannot follow a named argument");
      params.push(this.primary());
    }
    return { head, params, hash, blockParams, at };
  }

  private id(): string {
    let k = this.p;
    while (k < this.s.length && !ID_STOP.test(this.s[k] as string)) k++;
    const out = this.s.slice(this.p, k);
    this.p = k;
    return out;
  }

  private primary(): Expr {
    this.ws();
    const c = this.s[this.p];
    const at = this.base + this.p;
    if (c === undefined) return this.err("an expression was expected");
    if (c === "(") {
      this.p++;
      const inner = this.call();
      this.ws();
      if (this.s[this.p] !== ")") this.err("')' was expected");
      this.p++;
      if (
        inner.head.t !== "path" ||
        inner.head.data ||
        inner.head.depth > 0 ||
        inner.head.parts.length !== 1
      ) {
        this.err("a subexpression must start with a helper name");
      }
      if (inner.hash.size > 0) this.err("named arguments are not supported in a subexpression");
      return { t: "sub", helper: inner.head.parts[0] as string, params: inner.params, at };
    }
    if (c === '"' || c === "'") {
      let k = this.p + 1;
      let out = "";
      while (k < this.s.length && this.s[k] !== c) {
        if (this.s[k] === "\\" && this.s[k + 1] === c) {
          out += c;
          k += 2;
        } else out += this.s[k++];
      }
      if (k >= this.s.length) this.err("unterminated string");
      this.p = k + 1;
      return { t: "lit", value: str(out) };
    }
    // number
    const num = /^-?\d+(?:\.\d+)?(?![^\s)|}=~])/.exec(this.s.slice(this.p));
    if (num !== null) {
      this.p += num[0].length;
      const text = num[0];
      return {
        t: "lit",
        value: /\./.test(text) ? valueHelpers.num(Number(text)) : int(BigInt(text)),
      };
    }
    return this.path();
  }

  private path(): Path {
    const at = this.base + this.p;
    let data = false;
    if (this.s[this.p] === "@") {
      data = true;
      this.p++;
    }
    let depth = 0;
    const parts: string[] = [];
    let first = true;
    for (;;) {
      // ../ or ./ prefixes
      if (first && this.s.startsWith("..", this.p)) {
        this.p += 2;
        depth++;
        if (this.s[this.p] === "/") {
          this.p++;
          continue;
        }
        break;
      }
      if (
        first &&
        this.s[this.p] === "." &&
        (this.s[this.p + 1] === "/" || ID_STOP.test(this.s[this.p + 1] ?? " ") === true)
      ) {
        // "." alone is this; "./x" is this.x
        this.p++;
        if (this.s[this.p] === "/") {
          this.p++;
          first = false;
          continue;
        }
        break;
      }
      let seg: string;
      if (this.s[this.p] === "[") {
        const k = this.s.indexOf("]", this.p);
        if (k < 0) this.err("']' was expected");
        seg = this.s.slice(this.p + 1, k);
        this.p = k + 1;
      } else {
        seg = this.id();
        if (!first && /^\d+$/.test(seg))
          this.err("a number cannot follow a separator in a path: write items.[0]");
        if (seg === "") {
          if (first && !data)
            this.err(`unexpected character '${this.s[this.p] ?? ""}' in the expression`);
          if (first && data) this.err("a name was expected after @");
          this.err("a name was expected after the separator");
        }
      }
      if (!(first && seg === "this" && !data)) parts.push(seg);
      first = false;
      const sep = this.s[this.p];
      if (sep === "." || sep === "/") {
        this.p++;
        continue;
      }
      break;
    }
    // a bare keyword is a literal only when it stands alone (checked by the caller through Path parts)
    return { t: "path", data, depth, parts, at };
  }
}

function literalKeyword(p: Path): Literal | undefined {
  if (p.data || p.depth > 0 || p.parts.length !== 1) return undefined;
  switch (p.parts[0]) {
    case "true":
      return { t: "lit", value: bool(true) };
    case "false":
      return { t: "lit", value: bool(false) };
    case "null":
      return { t: "lit", value: { tag: "record", v: new Map([["\udfffnull", bool(true)]]) } };
    case "undefined":
      return { t: "lit", value: undefined };
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------------------------
// parser
// ---------------------------------------------------------------------------------------------

const HELPERS = new Set(["if", "unless", "each", "with", "lookup"]);

function parseCall(tok: { inner: string; innerAt: number }, src: string): Call {
  const ep = new ExprParser(tok.inner, src, tok.innerAt);
  if (ep.atEnd()) fail(src, tok.innerAt, "an expression was expected");
  const call = ep.call();
  if (!ep.atEnd()) fail(src, tok.innerAt, "unexpected text in the expression");
  // a literal in head position is a name to look up ({{"a b"}}, {{true}}, {{1}})
  if (call.head.t === "lit" && call.head.value !== undefined) {
    const hv = call.head.value;
    if (hv.tag === "str" || hv.tag === "int" || hv.tag === "num") {
      call.head = { t: "path", data: false, depth: 0, parts: [String(hv.v)], at: call.at };
    }
  }
  call.params = call.params.map((p) => (p.t === "path" ? (literalKeyword(p) ?? p) : p));
  for (const [k, v] of call.hash) call.hash.set(k, v.t === "path" ? (literalKeyword(v) ?? v) : v);
  return call;
}

function parseTemplate(src: string): Program {
  const toks = tokenize(src);
  let ti = 0;

  function content(text: string): Content {
    return { t: "content", value: text, original: text, ls: false, rs: false };
  }

  /** The nodes up to a close or else token (left unread), or the end. */
  function program(depth: number): Program {
    const body: Node[] = [];
    while (ti < toks.length) {
      const tk = toks[ti] as Tok;
      switch (tk.k) {
        case "content":
          body.push(content(tk.text));
          ti++;
          break;
        case "comment":
          body.push({ t: "comment", strip: tk.strip });
          ti++;
          break;
        case "mustache":
        case "raw": {
          ti++;
          const call = parseCall(tk, src);
          body.push({ t: "mustache", call, raw: tk.k === "raw", strip: tk.strip });
          break;
        }
        case "open":
        case "openInverted": {
          ti++;
          if (depth >= MAX_BLOCK_DEPTH) {
            throw new ForgeError({
              code: "E_LIMIT_VALUE",
              message: `the template nests blocks deeper than ${MAX_BLOCK_DEPTH} levels`,
              detail: { limit: "templateDepth", max: MAX_BLOCK_DEPTH },
            });
          }
          body.push(block(tk, tk.k === "openInverted", depth, false));
          break;
        }
        case "close":
        case "else":
          return { body, chained: false };
      }
    }
    return { body, chained: false };
  }

  /** A block whose open token has been read; reads its parts and (unless chained) its close token. */
  function block(
    open: Extract<Tok, { inner: string }>,
    inverted: boolean,
    depth: number,
    chained: boolean,
  ): Block {
    const call = parseCall(open, src);
    const name = call.head.t === "path" ? call.head.parts.join(".") : "";
    const prog = program(depth + 1);
    let inverse: Program | undefined;
    let inverseStrip: Strip | undefined;
    const next = toks[ti];
    if (next === undefined) fail(src, open.at, `the block ${name} is not closed`);
    if (next.k === "else") {
      ti++;
      inverseStrip = next.strip;
      if (next.inner.trim() !== "") {
        // {{else if x}}: the inverse is a block of its own, closed by the same {{/name}}
        inverse = { body: [block(next, false, depth + 1, true)], chained: true };
      } else {
        inverse = program(depth + 1);
      }
    }
    const b: Block = {
      t: "block",
      call,
      program: inverted ? inverse : prog,
      inverse: inverted ? prog : inverse,
      openStrip: open.strip,
      inverseStrip,
      closeStrip: { open: false, close: false },
    };
    if (!chained) {
      const close = toks[ti];
      if (close === undefined) fail(src, open.at, `the block ${name} is not closed`);
      if (close.k === "else") fail(src, close.at, "{{else}} appears twice in the block");
      if (close.k !== "close") fail(src, close.at, "unexpected token");
      ti++;
      const closeName = close.inner.trim();
      if (closeName !== name) fail(src, close.at, `${name} doesn't match ${closeName}`);
      // the close tag's strip belongs to the block and to every block of its else-if chain
      let cur: Block = b;
      for (;;) {
        cur.closeStrip = close.strip;
        const inv: Program | undefined = cur.inverse;
        if (inv !== undefined && inv.chained) cur = inv.body[0] as Block;
        else break;
      }
    }
    return b;
  }

  // top level: stray close or else tokens are errors
  const root: Program = { body: [], chained: false };
  while (ti < toks.length) {
    const part = program(0);
    root.body.push(...part.body);
    const tk = toks[ti];
    if (tk !== undefined) {
      if (tk.k === "close") fail(src, tk.at, `unexpected close tag {{/${tk.inner.trim()}}}`);
      fail(src, tk.at, "{{else}} outside a block");
    }
  }
  return root;
}

// ---------------------------------------------------------------------------------------------
// white-space control (Handlebars' WhitespaceControl)
// ---------------------------------------------------------------------------------------------

interface StripInfo {
  open?: boolean;
  close?: boolean;
  openStandalone?: boolean;
  closeStandalone?: boolean;
  inlineStandalone?: boolean;
}

function isPrevWhitespace(body: Node[], i: number | undefined, isRoot: boolean): boolean {
  const at = i === undefined ? body.length : i;
  const prev = body[at - 1];
  const sibling = body[at - 2];
  if (prev === undefined) return isRoot;
  if (prev.t === "content") {
    return (sibling !== undefined || !isRoot ? /\r?\n\s*?$/ : /(^|\r?\n)\s*?$/).test(prev.original);
  }
  return false;
}

function isNextWhitespace(body: Node[], i: number | undefined, isRoot: boolean): boolean {
  const at = i === undefined ? -1 : i;
  const next = body[at + 1];
  const sibling = body[at + 2];
  if (next === undefined) return isRoot;
  if (next.t === "content") {
    return (sibling !== undefined || !isRoot ? /^\s*?\r?\n/ : /^\s*?(\r?\n|$)/).test(next.original);
  }
  return false;
}

function omitRight(body: Node[], i: number | null, multiple: boolean): void {
  const current = body[i === null ? 0 : i + 1];
  if (current === undefined || current.t !== "content" || (!multiple && current.rs)) return;
  const original = current.value;
  current.value = current.value.replace(multiple ? /^\s+/ : /^[ \t]*\r?\n?/, "");
  current.rs = current.value !== original;
}

function omitLeft(body: Node[], i: number | null, multiple: boolean): boolean {
  const current = body[i === null ? body.length - 1 : i - 1];
  if (current === undefined || current.t !== "content" || (!multiple && current.ls)) return false;
  const original = current.value;
  current.value = current.value.replace(multiple ? /\s+$/ : /[ \t]+$/, "");
  current.ls = current.value !== original;
  return current.ls;
}

function stripWhitespace(root: Program): void {
  let rootSeen = false;

  function acceptProgram(program: Program | undefined): void {
    if (program === undefined) return;
    const isRoot = !rootSeen;
    rootSeen = true;
    const body = program.body;
    for (let i = 0; i < body.length; i++) {
      const current = body[i] as Node;
      const strip = acceptNode(current);
      if (strip === undefined) continue;
      const prevWs = isPrevWhitespace(body, i, isRoot);
      const nextWs = isNextWhitespace(body, i, isRoot);
      const openStandalone = strip.openStandalone === true && prevWs;
      const closeStandalone = strip.closeStandalone === true && nextWs;
      const inlineStandalone = strip.inlineStandalone === true && prevWs && nextWs;
      if (strip.close === true) omitRight(body, i, true);
      if (strip.open === true) omitLeft(body, i, true);
      if (inlineStandalone) {
        omitRight(body, i, false);
        omitLeft(body, i, false);
      }
      if (openStandalone && current.t === "block") {
        omitRight((current.program ?? current.inverse)?.body ?? [], null, false);
        omitLeft(body, i, false);
      }
      if (closeStandalone && current.t === "block") {
        omitRight(body, i, false);
        omitLeft((current.inverse ?? current.program)?.body ?? [], null, false);
      }
    }
  }

  function acceptNode(node: Node): StripInfo | undefined {
    switch (node.t) {
      case "content":
        return undefined;
      case "mustache":
        return node.strip;
      case "comment":
        return { inlineStandalone: true, open: node.strip.open, close: node.strip.close };
      case "block":
        return acceptBlock(node);
    }
  }

  function acceptBlock(block: Block): StripInfo {
    acceptProgram(block.program);
    acceptProgram(block.inverse);
    const program = (block.program ?? block.inverse) as Program;
    const inverse = block.program !== undefined ? block.inverse : undefined;
    let firstInverse = inverse;
    let lastInverse = inverse;
    if (inverse !== undefined && inverse.chained) {
      firstInverse = (inverse.body[0] as Block).program;
      while (lastInverse !== undefined && lastInverse.chained) {
        lastInverse = (lastInverse.body[lastInverse.body.length - 1] as Block).program;
      }
    }
    const strip: StripInfo = {
      open: block.openStrip.open,
      close: block.closeStrip.close,
      openStandalone: isNextWhitespace(program.body, undefined, false),
      closeStandalone: isPrevWhitespace((firstInverse ?? program).body, undefined, false),
    };
    if (block.openStrip.close) omitRight(program.body, null, true);
    if (inverse !== undefined && firstInverse !== undefined && lastInverse !== undefined) {
      const inverseStrip = block.inverseStrip as Strip;
      if (inverseStrip.open) omitLeft(program.body, null, true);
      if (inverseStrip.close) omitRight(firstInverse.body, null, true);
      if (block.closeStrip.open) omitLeft(lastInverse.body, null, true);
      if (
        isPrevWhitespace(program.body, undefined, false) &&
        isNextWhitespace(firstInverse.body, undefined, false)
      ) {
        omitLeft(program.body, null, false);
        omitRight(firstInverse.body, null, false);
      }
    } else if (block.closeStrip.open) {
      omitLeft(program.body, null, true);
    }
    return strip;
  }

  acceptProgram(root);
}

// ---------------------------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------------------------

interface Frame {
  index?: number;
  key?: string;
  first?: boolean;
  last?: boolean;
  parent: Frame | undefined;
  root: V;
}

interface Scope {
  contexts: V[]; // contexts[0] is the current one
  frame: Frame;
  params: { names: string[]; values: V[] }[];
}

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
  "`": "&#x60;",
  "=": "&#x3D;",
};

function escapeHtml(s: string): string {
  return /[&<>"'`=]/.test(s) ? s.replace(/[&<>"'`=]/g, (c) => ESCAPES[c] as string) : s;
}

function isNil(v: V): v is undefined {
  return v === undefined || isNullValue(v);
}

/** JavaScript's String() of a value as Handlebars prints it. */
function toText(v: V): string {
  if (v === undefined) return "";
  switch (v.tag) {
    case "str":
      return v.v as string;
    case "int":
      return String(v.v);
    case "num":
      return String(v.v);
    case "bool":
      return (v.v as boolean) ? "true" : "false";
    case "list":
      return (v.v as readonly Value[]).map((x) => (isNil(x) ? "" : toText(x))).join(",");
    case "record":
      return isNullValue(v) ? "" : "[object Object]";
    default:
      return "";
  }
}

/** Handlebars' `if` test: false, nil, 0, "" and the empty list are falsy. */
function truthy(v: V, includeZero: boolean): boolean {
  if (isNil(v)) return false;
  switch (v.tag) {
    case "bool":
      return v.v as boolean;
    case "int":
      return includeZero || (v.v !== 0 && v.v !== 0n);
    case "num":
      return includeZero || (v.v as number) !== 0;
    case "str":
      return (v.v as string) !== "";
    case "list":
      return (v.v as readonly Value[]).length > 0;
    default:
      return true;
  }
}

/** Handlebars' isEmpty (used by `with`): nil, false, "" and the empty list, but not 0. */
function isEmptyValue(v: V): boolean {
  if (isNil(v)) return true;
  switch (v.tag) {
    case "bool":
      return !(v.v as boolean);
    case "str":
      return (v.v as string) === "";
    case "list":
      return (v.v as readonly Value[]).length === 0;
    default:
      return false;
  }
}

/** The keys of an object in JavaScript's order: array indexes ascending, then the rest as written. */
function jsKeys(m: ReadonlyMap<string, Value>): string[] {
  const idx: string[] = [];
  const rest: string[] = [];
  for (const k of m.keys()) {
    if (/^(?:0|[1-9]\d{0,8})$/.test(k)) idx.push(k);
    else rest.push(k);
  }
  idx.sort((a, b) => Number(a) - Number(b));
  return idx.concat(rest);
}

function renderTemplate(root: Program, data: Value, ctx: PrimitiveContext, src: string): string {
  const max = ctx.limits.maxValueBytes;
  let steps = 0;
  const parts: string[] = [];
  let outLen = 0;

  const tick = (): void => {
    if (++steps > MAX_STEPS) {
      throw new ForgeError({
        code: "E_LIMIT_STEPS",
        message: `the template needed more than ${MAX_STEPS} render steps`,
        detail: { limit: "templateSteps", max: MAX_STEPS },
      });
    }
  };
  const emit = (s: string): void => {
    if (s === "") return;
    parts.push(s);
    outLen += s.length;
    if (outLen * 2 > max) throw limitFailure("maxValueBytes", max, outLen * 2, "rendered template");
  };

  function lookupProp(parent: V, name: string): V {
    tick();
    if (isNil(parent)) return undefined;
    switch (parent.tag) {
      case "record":
        return (parent.v as ReadonlyMap<string, Value>).get(name);
      case "list": {
        const items = parent.v as readonly Value[];
        if (name === "length") return int(items.length);
        if (/^(?:0|[1-9]\d{0,15})$/.test(name)) return items[Number(name)];
        return undefined;
      }
      case "str":
        return name === "length" ? int((parent.v as string).length) : undefined;
      default:
        return undefined;
    }
  }

  function evalPath(p: Path, scope: Scope): V {
    if (p.data) {
      let fr: Frame | undefined = scope.frame;
      for (let d = 0; d < p.depth && fr !== undefined; d++) fr = fr.parent;
      if (fr === undefined) return undefined;
      const name = p.parts[0] as string;
      let v: V;
      switch (name) {
        case "root":
          v = fr.root;
          break;
        case "index":
          v = fr.index === undefined ? undefined : int(fr.index);
          break;
        case "key":
          v = fr.key === undefined ? undefined : str(fr.key);
          break;
        case "first":
          v = fr.first === undefined ? undefined : bool(fr.first);
          break;
        case "last":
          v = fr.last === undefined ? undefined : bool(fr.last);
          break;
        default:
          fail(src, p.at, `the data variable @${name} is not supported`);
      }
      for (let k = 1; k < p.parts.length; k++) v = lookupProp(v, p.parts[k] as string);
      return v;
    }
    let v: V;
    let from = 0;
    if (p.depth > 0) {
      if (p.depth >= scope.contexts.length) return undefined;
      v = scope.contexts[p.depth];
    } else if (p.parts.length > 0) {
      // a block parameter shadows the context
      const first = p.parts[0] as string;
      let found = false;
      v = undefined;
      for (const bp of scope.params) {
        const at = bp.names.indexOf(first);
        if (at >= 0) {
          v = bp.values[at];
          found = true;
          break;
        }
      }
      if (found) from = 1;
      else v = scope.contexts[0];
    } else {
      v = scope.contexts[0];
    }
    for (let k = from; k < p.parts.length; k++) v = lookupProp(v, p.parts[k] as string);
    return v;
  }

  function evalExpr(e: Expr, scope: Scope): V {
    tick();
    switch (e.t) {
      case "lit":
        return e.value;
      case "path":
        return evalPath(e, scope);
      case "sub": {
        if (e.helper !== "lookup") fail(src, e.at, `missing helper: ${e.helper}`);
        if (e.params.length !== 2) fail(src, e.at, "lookup takes two arguments");
        return doLookup(evalExpr(e.params[0] as Expr, scope), evalExpr(e.params[1] as Expr, scope));
      }
    }
  }

  function doLookup(obj: V, key: V): V {
    if (isNil(obj)) return undefined;
    if (key === undefined) return undefined;
    if (key.tag === "int" || key.tag === "str") return lookupProp(obj, String(key.v));
    return undefined;
  }

  function withContext(
    scope: Scope,
    context: V,
    frame: Frame | undefined,
    params?: { names: string[]; values: V[] },
  ): Scope {
    const contexts = context === scope.contexts[0] ? scope.contexts : [context, ...scope.contexts];
    return {
      contexts,
      frame: frame ?? scope.frame,
      params: params === undefined ? scope.params : [params, ...scope.params],
    };
  }

  function renderProgram(p: Program | undefined, scope: Scope): void {
    if (p === undefined) return;
    for (const node of p.body) {
      tick();
      switch (node.t) {
        case "content":
          emit(node.value);
          break;
        case "comment":
          break;
        case "mustache": {
          const text = mustacheText(node, scope);
          emit(node.raw ? text : escapeHtml(text));
          break;
        }
        case "block":
          renderBlock(node, scope);
          break;
      }
    }
  }

  function mustacheText(m: Mustache, scope: Scope): string {
    const c = m.call;
    if (c.head.t === "path" && c.head.depth === 0 && !c.head.data && c.head.parts.length === 1) {
      const name = c.head.parts[0] as string;
      if (name === "lookup" && (c.params.length > 0 || c.hash.size > 0)) {
        if (c.params.length !== 2) fail(src, c.at, "lookup takes two arguments");
        return toText(
          doLookup(evalExpr(c.params[0] as Expr, scope), evalExpr(c.params[1] as Expr, scope)),
        );
      }
      if (c.params.length > 0 || c.hash.size > 0) {
        fail(src, c.at, `missing helper: ${name}`);
      }
      if (HELPERS.has(name) && name !== "lookup")
        fail(src, c.at, `${name} is a block helper: use {{#${name} ...}}`);
    } else if (c.params.length > 0 || c.hash.size > 0) {
      fail(src, c.at, "missing helper");
    }
    return toText(evalExpr(c.head, scope));
  }

  function renderBlock(b: Block, scope: Scope): void {
    const c = b.call;
    const fn = b.program;
    const inverse = b.inverse;
    if (c.head.t === "path" && !c.head.data && c.head.depth === 0 && c.head.parts.length === 1) {
      const name = c.head.parts[0] as string;
      if (HELPERS.has(name) && (c.params.length > 0 || name === "if" || name === "unless")) {
        helperBlock(name, b, scope);
        return;
      }
      if (HELPERS.has(name) && name !== "lookup") fail(src, c.at, `${name} needs an argument`);
      if (c.params.length > 0 || c.hash.size > 0) fail(src, c.at, `missing helper: ${name}`);
    } else if (c.params.length > 0 || c.hash.size > 0) {
      fail(src, c.at, "missing helper");
    }
    // a Mustache section: blockHelperMissing
    const value = evalExpr(c.head, scope);
    if (value !== undefined && value.tag === "bool" && value.v === true) {
      renderProgram(fn, scope);
    } else if (isNil(value) || (value.tag === "bool" && value.v === false)) {
      renderProgram(inverse, scope);
    } else if (value.tag === "list") {
      if ((value.v as readonly Value[]).length > 0)
        eachBlock(value, fn, inverse, scope, c.blockParams);
      else renderProgram(inverse, scope);
    } else {
      renderProgram(
        fn,
        withContext(scope, value, undefined, blockParamsFor(c.blockParams, [value])),
      );
    }
  }

  function blockParamsFor(names: string[] | undefined, values: V[]) {
    return names === undefined ? undefined : { names, values };
  }

  function helperBlock(name: string, b: Block, scope: Scope): void {
    const c = b.call;
    const fn = b.program;
    const inverse = b.inverse;
    for (const k of c.hash.keys()) {
      if (!(name === "if" && k === "includeZero"))
        fail(src, c.at, `the named argument ${k} is not supported by ${name}`);
    }
    switch (name) {
      case "if":
      case "unless": {
        if (c.params.length !== 1) fail(src, c.at, `#${name} requires exactly one argument`);
        const includeZero =
          name === "if" &&
          c.hash.has("includeZero") &&
          truthy(evalExpr(c.hash.get("includeZero") as Expr, scope), false);
        let ok = truthy(evalExpr(c.params[0] as Expr, scope), includeZero);
        if (name === "unless") ok = !ok;
        renderProgram(ok ? fn : inverse, scope);
        return;
      }
      case "with": {
        if (c.params.length !== 1) fail(src, c.at, "#with requires exactly one argument");
        const v = evalExpr(c.params[0] as Expr, scope);
        if (!isEmptyValue(v)) {
          renderProgram(fn, withContext(scope, v, undefined, blockParamsFor(c.blockParams, [v])));
        } else renderProgram(inverse, scope);
        return;
      }
      case "each": {
        if (c.params.length !== 1) fail(src, c.at, "#each requires an argument");
        const v = evalExpr(c.params[0] as Expr, scope);
        eachBlock(v, fn, inverse, scope, c.blockParams);
        return;
      }
      default:
        fail(src, c.at, `#${name} must be used as an inline helper`);
    }
  }

  function eachBlock(
    v: V,
    fn: Program | undefined,
    inverse: Program | undefined,
    scope: Scope,
    names: string[] | undefined,
  ): void {
    if (v !== undefined && v.tag === "list") {
      const items = v.v as readonly Value[];
      if (items.length === 0) {
        renderProgram(inverse, scope);
        return;
      }
      for (let i = 0; i < items.length; i++) {
        tick();
        const item = items[i] as Value;
        const frame: Frame = {
          index: i,
          first: i === 0,
          last: i === items.length - 1,
          parent: scope.frame,
          root: scope.frame.root,
        };
        renderProgram(fn, withContext(scope, item, frame, blockParamsFor(names, [item, int(i)])));
      }
      return;
    }
    if (v !== undefined && v.tag === "record" && !isNullValue(v)) {
      const m = v.v as ReadonlyMap<string, Value>;
      const keys = jsKeys(m);
      if (keys.length === 0) {
        renderProgram(inverse, scope);
        return;
      }
      for (let i = 0; i < keys.length; i++) {
        tick();
        const k = keys[i] as string;
        const item = m.get(k) as Value;
        const frame: Frame = {
          index: i,
          key: k,
          first: i === 0,
          last: i === keys.length - 1,
          parent: scope.frame,
          root: scope.frame.root,
        };
        renderProgram(fn, withContext(scope, item, frame, blockParamsFor(names, [item, str(k)])));
      }
      return;
    }
    renderProgram(inverse, scope);
  }

  const rootFrame: Frame = { parent: undefined, root: data };
  renderProgram(root, { contexts: [data], frame: rootFrame, params: [] });
  return parts.join("");
}

function render(data: Value, template: string, ctx: PrimitiveContext): string {
  const tree = parseTemplate(template);
  stripWhitespace(tree);
  return renderTemplate(tree, data, ctx, template);
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("template", "_render", "( value:any template:str -- str )", render, {
    doc: "Private. Render a Handlebars-style template (a documented subset: variables, if/unless/each/with/lookup, Mustache sections, comments, white-space control) against a JSON value. Output of {{x}} is HTML-escaped. No code is generated or run. A syntax error or an unsupported feature is E_COERCE with the line and column; blocks nested deeper than 100 and output past the value limit are E_LIMIT_VALUE; more than 5,000,000 render steps is E_LIMIT_STEPS.",
  }),
];
