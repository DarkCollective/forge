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
 * The inverse of the compiler (RECIPES.md section 6): a restricted line parser from the canonical text form to
 * recipe JSON. It never calls the FL compiler or runtime: `read()` tokenises one line at a time, an explicit stack
 * holds the open containers, and the assembled recipe goes through `validateRecipe` and `canonicalRecipe`.
 * Text from a user is data; only compiler output is ever loaded.
 */
import { read } from "@forge/lang";
import type { SourcePos, Token } from "@forge/lang";
import { DISABLED_PREFIX, HEADER_LINE } from "./compile.js";
import { hexEncode, utf8Encode } from "./encoding.js";
import { clip } from "./limits.js";
import { canonicalRecipe } from "./normalise.js";
import { opIndex } from "./opindex.js";
import type { OpIndex } from "./opindex.js";
import { validateRecipe } from "./validate.js";
import { RECIPE_LIMITS } from "./types.js";
import type {
  CatalogueView,
  Encoded,
  ParamValue,
  RecipeIssue,
  RecipeIssueCode,
  ValidationResult,
} from "./types.js";

type Obj = Record<string, unknown>;

const HASH_RE = /^[0-9a-f]{64}$/;
const WORD_OPEN_RE = /^: (\S+) \( bytes -- any \)\s*$/;
const META_RE = /^\\ (name|description|catalogue) (.*)$/s;
const CLOSERS: ReadonlySet<string> = new Set([
  "fork",
  "recipe:section",
  "recipe:branch",
  "recipe:repeat",
  "recipe:settle",
]);

/** A parser issue, thrown to stop at the first problem. Only `parseRecipeText` catches it. */
class Stop extends Error {
  constructor(readonly issue: RecipeIssue) {
    super(issue.message);
  }
}

function stop(
  code: RecipeIssueCode,
  path: string,
  message: string,
  line: number,
  col: number,
  extra?: Record<string, unknown>,
): never {
  throw new Stop({
    code,
    severity: "error",
    path,
    message,
    detail: { ...extra, line, col },
  });
}

/** `bad-value` with `constraint: "block structure"`. */
function structure(path: string, message: string, line: number, col: number): never {
  return stop("bad-value", path, message, line, col, { constraint: "block structure" });
}

/** A JSON string literal that is the whole of `s` (surrounding spaces allowed), or null. */
function jsonString(s: string): string | null {
  if (!s.startsWith('"')) return null;
  try {
    const v: unknown = JSON.parse(s);
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/** Index just after the JSON string that starts at `from`, or -1. */
function jsonStringEnd(s: string, from: number): number {
  if (s[from] !== '"') return -1;
  for (let i = from + 1; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") i++;
    else if (c === '"') return i + 1;
  }
  return -1;
}

interface Anns {
  pin?: string;
  breakpoint?: boolean;
  note?: string;
}

/** The trailing annotation comment `  \ @pin=<hash> @break @note="..."`, or null when it is malformed. */
function parseAnns(tail: string): Anns | null {
  if (tail.trim() === "") return {};
  if (!tail.startsWith("  \\ ")) return null;
  const out: Anns = {};
  let s = tail.slice(4);
  const eat = (): void => {
    if (s.startsWith(" ")) s = s.slice(1);
  };
  if (s.startsWith("@pin=")) {
    const hash = s.slice(5, 69);
    if (!HASH_RE.test(hash)) return null;
    out.pin = hash;
    s = s.slice(69);
    if (s !== "" && !s.startsWith(" ")) return null;
    eat();
  }
  if (s.startsWith("@break")) {
    out.breakpoint = true;
    s = s.slice(6);
    if (s !== "" && !s.startsWith(" ")) return null;
    eat();
  }
  if (s.startsWith("@note=")) {
    const end = jsonStringEnd(s, 6);
    if (end < 0) return null;
    const note = jsonString(s.slice(6, end));
    if (note === null) return null;
    out.note = note;
    s = s.slice(end);
  }
  return s.trim() === "" ? out : null;
}

// ---------------------------------------------------------------------------------------------
// Literal groups
// ---------------------------------------------------------------------------------------------

interface Group {
  readonly kind: "int" | "float" | "bool" | "bytes" | "str";
  readonly value: number | bigint | boolean | string | Uint8Array;
  readonly helper?: "latin1" | "base64";
}

/** Literal groups, or null if a token is not one (or a helper word follows something but a string). */
function groupsOf(tokens: readonly Token[]): Group[] | null {
  const groups: Group[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as Token;
    switch (t.kind) {
      case "int":
        groups.push({ kind: "int", value: t.value });
        break;
      case "float":
        groups.push({ kind: "float", value: t.value });
        break;
      case "bool":
        groups.push({ kind: "bool", value: t.value });
        break;
      case "bytes":
        groups.push({ kind: "bytes", value: t.value });
        break;
      case "str": {
        const next = tokens[i + 1];
        if (next !== undefined && next.kind === "qword" && next.vocab === "recipe") {
          if (next.name === "latin1" || next.name === "base64") {
            groups.push({ kind: "str", value: t.value, helper: next.name });
            i++;
            break;
          }
        }
        groups.push({ kind: "str", value: t.value });
        break;
      }
      default:
        return null;
    }
  }
  return groups;
}

function toEncoded(g: Group): Encoded | null {
  if (g.kind === "str") return { value: g.value as string, enc: g.helper ?? "utf8" };
  if (g.kind === "bytes") return { value: hexEncode(g.value as Uint8Array), enc: "hex" };
  return null;
}

/** The JSON value of a parameter from its literal group; null when the group is of the wrong kind. */
function paramFromGroup(type: string, g: Group): ParamValue | null {
  const plain = g.helper === undefined;
  switch (type) {
    case "int":
    case "number":
      if (g.kind === "int")
        return typeof g.value === "bigint" ? g.value.toString() : (g.value as number);
      return type === "number" && g.kind === "float" ? (g.value as number) : null;
    case "num":
      return g.kind === "float" ? (g.value as number) : null;
    case "bool":
      return g.kind === "bool" ? (g.value as boolean) : null;
    case "bytes":
      return g.kind === "bytes" ? hexEncode(g.value as Uint8Array) : null;
    case "toggle":
    case "key":
      return toEncoded(g);
    default:
      return g.kind === "str" && plain ? (g.value as string) : null;
  }
}

// ---------------------------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------------------------

interface Frame {
  readonly level: number;
  readonly atoms: readonly Token[];
  readonly anns: Anns;
  readonly path: string;
  readonly line: number;
  readonly col: number;
  readonly isIf: boolean;
  inElse: boolean;
  hasElse: boolean;
  readonly then: Obj[];
  readonly other: Obj[];
}

/** Builds an op step from the tokens of an op line (or the inside of an op test). */
function opFromTokens(
  toks: readonly Token[],
  idx2: OpIndex,
  stepPath: string,
  line: number,
  column: number,
): Obj {
  const name = toks[toks.length - 1] as Token;
  if (name.kind !== "qword") {
    return stop("bad-value", stepPath, "an op line ends with a qualified name", line, column);
  }
  const entry = idx2.find(name.text);
  if (entry === undefined) {
    return stop(
      "unknown-op",
      stepPath,
      `unknown operation '${clip(name.text, 60)}'`,
      line,
      column,
      {
        op: clip(name.text),
      },
    );
  }
  const groups = groupsOf(toks.slice(0, -1));
  if (groups === null) {
    return stop(
      "bad-value",
      stepPath,
      "only literals may come before the operation name",
      line,
      column,
    );
  }
  const specs = entry.op.params;
  if (groups.length !== specs.length) {
    return stop(
      "bad-param",
      stepPath,
      `expected ${specs.length} parameter value(s), found ${groups.length}`,
      line,
      column,
    );
  }
  const step: Obj = { kind: "op", op: name.text };
  if (specs.length > 0) {
    step.params = Object.fromEntries(
      specs.map((spec, i) => {
        const value = paramFromGroup(spec.type, groups[i] as Group);
        if (value === null) {
          stop(
            "bad-param",
            stepPath,
            `parameter '${clip(spec.name, 40)}' has a literal of the wrong kind`,
            line,
            column,
            {
              param: clip(spec.name, 40),
            },
          );
        }
        return [spec.name, value];
      }),
    );
  }
  return step;
}

/** Builds a container step from its frame at the close line, by the closing word. */
function complete(
  f: Frame,
  closer: string,
  idx2: OpIndex,
  parentLvl: number,
  line: number,
  column: number,
): Obj {
  const bad = (message: string): never => stop("bad-value", f.path, message, f.line, f.col);
  const step: Obj = {};
  const finish = (): Obj => {
    if (f.level > parentLvl) step.disabled = true;
    if (f.anns.breakpoint === true) step.breakpoint = true;
    if (f.anns.note !== undefined) step.note = f.anns.note;
    return step;
  };
  const noPin = (): void => {
    if (f.anns.pin !== undefined) bad("a pin on this line has nothing to pin");
  };
  if (f.isIf !== (closer === "recipe:branch")) {
    return structure(f.path, "the closing word does not match the open line", line, column);
  }
  switch (closer) {
    case "fork": {
      noPin();
      const groups = groupsOf(f.atoms);
      const parts = groups === null ? [] : groups.map(toEncoded);
      if (parts.length !== 2 || parts.includes(null)) bad("fork takes a separator and a joiner");
      step.kind = "fork";
      step.split = parts[0];
      step.join = parts[1];
      step.steps = f.then;
      return finish();
    }
    case "recipe:section": {
      noPin();
      const groups = groupsOf(f.atoms);
      const ok =
        groups !== null &&
        groups.length === 3 &&
        groups.every((g) => g.kind === "str" && g.helper === undefined);
      if (!ok) bad("a subsection takes a pattern, flags and an encoding");
      const [pattern, flags, encoding] = (groups as Group[]).map((g) => g.value as string) as [
        string,
        string,
        string,
      ];
      if (encoding !== "utf8" && encoding !== "latin1") bad("the encoding must be utf8 or latin1");
      step.kind = "subsection";
      step.pattern = pattern;
      step.flags = flags;
      step.encoding = encoding;
      step.steps = f.then;
      return finish();
    }
    case "recipe:branch": {
      if (!f.hasElse) bad("an if block needs its ] [ line");
      const inner = f.atoms.slice(1, -1);
      if (
        f.atoms[f.atoms.length - 1]?.kind !== "rbracket" ||
        inner.some((t) => t.kind === "lbracket" || t.kind === "rbracket")
      ) {
        bad("the test is one quotation");
      }
      const m = inner[3];
      if (inner.length === 4 && m?.kind === "qword" && m.text === "recipe:matches") {
        noPin();
        const groups = groupsOf(inner.slice(0, 3));
        const ok =
          groups !== null && groups.every((g) => g.kind === "str" && g.helper === undefined);
        if (!ok) bad("a regex test takes a pattern, flags and an encoding");
        const [pattern, flags, encoding] = (groups as Group[]).map((g) => g.value as string) as [
          string,
          string,
          string,
        ];
        if (encoding !== "utf8" && encoding !== "latin1")
          bad("the encoding must be utf8 or latin1");
        step.kind = "if";
        step.test = { kind: "regex", pattern, flags, encoding };
      } else {
        const test = opFromTokens(inner, idx2, `${f.path}/test`, f.line, f.col);
        if (f.anns.pin !== undefined) test.hash = f.anns.pin;
        step.kind = "if";
        step.test = test;
      }
      step.then = f.then;
      if (f.other.length > 0) step.else = f.other;
      return finish();
    }
    default: {
      // recipe:repeat and recipe:settle
      noPin();
      const n = f.atoms.length === 1 ? (f.atoms[0] as Token) : undefined;
      if (n === undefined || n.kind !== "int" || typeof n.value !== "number") {
        bad("expected one integer");
      }
      step.kind = "repeat";
      if (closer === "recipe:repeat") step.times = (n as { value: number }).value;
      else {
        step.until = "stable";
        step.max = (n as { value: number }).value;
      }
      step.steps = f.then;
      return finish();
    }
  }
}

function parse(text: string, catalogue: CatalogueView): ValidationResult {
  const index = opIndex(catalogue);
  const positions = new Map<string, { line: number; col: number }>([["", { line: 1, col: 1 }]]);

  if (
    text.length > RECIPE_LIMITS.maxJsonBytes ||
    utf8Encode(text).length > RECIPE_LIMITS.maxJsonBytes
  ) {
    stop("limit", "", "the text is too large", 1, 1, {
      limit: "maxJsonBytes",
      max: RECIPE_LIMITS.maxJsonBytes,
    });
  }
  const lines = text.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  lines.forEach((l, i) => {
    const cr = l.indexOf("\r");
    if (cr >= 0) stop("bad-value", "", "a bare CR is not a line break here", i + 1, cr + 1);
  });

  // Frame: header, meta lines, the word line.
  const head = lines[0] as string;
  if (head !== HEADER_LINE) {
    if (/^\\ forge-recipe \S+$/.test(head)) {
      stop("bad-version", "", "the text format version must be 1", 1, 1, { value: clip(head, 40) });
    }
    stop("required", "", "the text must start with the line \\ forge-recipe 1", 1, 1, {
      field: "header",
    });
  }
  const meta: Obj = {};
  let at = 1;
  for (; at < lines.length; at++) {
    const m = META_RE.exec(lines[at] as string);
    if (m === null) break;
    const key = m[1] as string;
    const value = jsonString(m[2] as string);
    if (value === null) stop("bad-value", "", `\\ ${key} needs a JSON string`, at + 1, 1);
    if (Object.hasOwn(meta, key)) stop("bad-value", "", `\\ ${key} appears twice`, at + 1, 1);
    meta[key] = value;
  }
  if (!WORD_OPEN_RE.test(lines[at] ?? "")) {
    stop("required", "", "expected the line : word ( bytes -- any )", at + 1, 1, { field: "word" });
  }
  const bodyStart = at + 1;
  let close = -1;
  for (let i = bodyStart; i < lines.length; i++) {
    if (lines[i] === ";") {
      close = i;
      break;
    }
  }
  if (close < 0)
    stop("required", "", "the text must end with a line ;", lines.length, 1, { field: ";" });
  for (let i = close + 1; i < lines.length; i++) {
    if ((lines[i] as string).trim() !== "") {
      stop("unknown-field", "", "nothing may follow the line ;", i + 1, 1);
    }
  }

  // Body.
  const root: Obj[] = [];
  const stack: Frame[] = [];
  let stepCount = 0;
  const level0 = (): number => (stack.length === 0 ? 0 : (stack[stack.length - 1] as Frame).level);
  const listOf = (): Obj[] => {
    const top = stack[stack.length - 1];
    if (top === undefined) return root;
    return top.inElse ? top.other : top.then;
  };
  const nextPath = (): string => {
    const top = stack[stack.length - 1];
    const list = listOf();
    if (top === undefined) return `/steps/${list.length}`;
    const key = top.isIf ? (top.inElse ? "else" : "then") : "steps";
    return `${top.path}/${key}/${list.length}`;
  };
  /** Counts a new step against the limits, and returns its path. */
  const begin = (line: number, col: number): string => {
    const path = nextPath();
    if (stack.length + 1 > RECIPE_LIMITS.maxDepth) {
      stop("limit", path, "steps are nested too deeply", line, col, {
        limit: "maxDepth",
        max: RECIPE_LIMITS.maxDepth,
      });
    }
    if (++stepCount > RECIPE_LIMITS.maxSteps) {
      stop("limit", path, "too many steps", line, col, {
        limit: "maxSteps",
        max: RECIPE_LIMITS.maxSteps,
      });
    }
    positions.set(path, { line, col });
    return path;
  };

  for (let idx = bodyStart; idx < close; idx++) {
    const lineNo = idx + 1;
    const raw = lines[idx] as string;
    let rest = raw.replace(/^ +/, "");
    if (rest === "") continue;
    let level = 0;
    while (rest.startsWith(DISABLED_PREFIX)) {
      rest = rest.slice(DISABLED_PREFIX.length);
      level++;
    }
    const col = raw.length - rest.length + 1;
    const here = nextPath();
    const parentLevel = level0();

    // 1. a comment step
    if (rest.startsWith("\\ # ")) {
      const value = jsonString(rest.slice(4));
      if (value === null)
        stop("bad-value", here, "a comment step holds one JSON string", lineNo, col);
      if (level !== parentLevel)
        structure(here, "a comment has the level of its container", lineNo, col);
      begin(lineNo, col);
      listOf().push({ kind: "comment", text: value });
      continue;
    }

    // 2. tokens and tail
    let tokens: Token[];
    try {
      tokens = read(rest);
    } catch (e) {
      const pos = (e as { pos?: SourcePos | null }).pos;
      const message = e instanceof Error ? e.message : "lexical error";
      return stop(
        "bad-value",
        here,
        `lexical error: ${clip(message, 60)}`,
        lineNo,
        col + (pos ? pos.col - 1 : 0),
      );
    }
    tokens.pop(); // eof
    const last = tokens[tokens.length - 1];
    if (last === undefined) stop("bad-value", here, "not a recognised line", lineNo, col);
    const anns = parseAnns(rest.slice(last.end.offset));
    if (anns === null) stop("bad-value", here, "malformed annotation comment", lineNo, col);
    const first = tokens[0] as Token;
    const noAnns = (): void => {
      if (anns.pin !== undefined || anns.breakpoint !== undefined || anns.note !== undefined) {
        stop(
          "bad-value",
          here,
          "only op lines and container open lines carry annotations",
          lineNo,
          col,
        );
      }
    };

    // 3. an else line
    if (tokens.length === 2 && first.kind === "rbracket" && last.kind === "lbracket") {
      noAnns();
      const frame = stack[stack.length - 1];
      if (frame === undefined) structure(here, "else line outside a block", lineNo, col);
      if (frame.level !== level) structure(frame.path, "wrong level on an else line", lineNo, col);
      if (!frame.isIf || frame.hasElse) structure(frame.path, "unexpected else line", lineNo, col);
      frame.inElse = true;
      frame.hasElse = true;
      continue;
    }

    // 4. a close line
    if (first.kind === "rbracket") {
      noAnns();
      const closer = tokens.length === 2 ? last : undefined;
      if (
        closer === undefined ||
        (closer.kind !== "word" && closer.kind !== "qword") ||
        !CLOSERS.has(closer.text)
      ) {
        stop(
          "bad-value",
          here,
          "expected ] followed by fork, recipe:section, recipe:branch, recipe:repeat or recipe:settle",
          lineNo,
          col,
        );
      }
      const frame = stack.pop();
      if (frame === undefined) structure(here, "close line without an open line", lineNo, col);
      if (frame.level !== level) structure(frame.path, "wrong level on a close line", lineNo, col);
      const step = complete(frame, closer.text, index, level0(), lineNo, col);
      const parentList = listOf();
      parentList.push(step);
      continue;
    }

    // 5. a container open line
    if (
      first.kind === "qword" &&
      first.text === "recipe:as-bytes" &&
      tokens.length >= 2 &&
      last.kind === "lbracket"
    ) {
      if (level !== parentLevel && level !== parentLevel + 1) {
        structure(here, "wrong level on an open line", lineNo, col);
      }
      const path = begin(lineNo, col);
      const atoms = tokens.slice(1, -1);
      stack.push({
        level,
        atoms,
        anns,
        path,
        line: lineNo,
        col,
        isIf: atoms[0]?.kind === "lbracket",
        inElse: false,
        hasElse: false,
        then: [],
        other: [],
      });
      continue;
    }

    // 6. an op line
    if (level !== parentLevel && level !== parentLevel + 1) {
      structure(here, "wrong level on a step line", lineNo, col);
    }
    const path = begin(lineNo, col);
    const step = opFromTokens(tokens, index, path, lineNo, col);
    if (anns.pin !== undefined) step.hash = anns.pin;
    if (anns.breakpoint === true) step.breakpoint = true;
    if (anns.note !== undefined) step.note = anns.note;
    if (level > parentLevel) step.disabled = true;
    listOf().push(step);
  }

  const open = stack[stack.length - 1];
  if (open !== undefined) structure(open.path, "a block is never closed", open.line, open.col);

  const recipe: Obj = { forge: 1 };
  for (const key of ["name", "description", "catalogue"]) {
    if (Object.hasOwn(meta, key)) recipe[key] = meta[key];
  }
  recipe.steps = root;

  const checked = validateRecipe(recipe, catalogue);
  const locate = (issue: RecipeIssue): RecipeIssue => {
    let p = issue.path;
    for (;;) {
      const found = positions.get(p);
      if (found !== undefined) {
        return { ...issue, detail: { ...issue.detail, line: found.line, col: found.col } };
      }
      p = p.slice(0, p.lastIndexOf("/"));
    }
  };
  const issues = checked.issues.map(locate);
  if (!checked.ok) return { ok: false, issues };
  return { ok: true, recipe: canonicalRecipe(checked.recipe, catalogue), issues };
}

/**
 * Parses the canonical text form back to canonical recipe JSON. Never throws and never executes the text.
 * Every issue carries `detail.line` and `detail.col`.
 */
export function parseRecipeText(text: string, catalogue: CatalogueView): ValidationResult {
  try {
    return parse(String(text), catalogue);
  } catch (e) {
    if (e instanceof Stop) return { ok: false, issues: [e.issue] };
    return {
      ok: false,
      issues: [
        {
          code: "bad-value",
          severity: "error",
          path: "",
          message: "the text could not be parsed",
          detail: { constraint: "parser", line: 1, col: 1 },
        },
      ],
    };
  }
}
