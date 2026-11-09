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
 * The FL compiler (spec sections 5 to 9, 10.2 and 10.3, 12.2 and 12.4): tokens to dictionary
 * changes and compiled code, staged in one DictionaryTxn.
 *
 * The compiler never executes anything. Console code becomes `ConsoleSegment`s for the VM.
 * Names are resolved once, while the body is parsed (early binding). Code generation is a separate
 * pass over the parsed items so that literal-quotation `if`/`when`/`unless`/`while`/`loop` can be
 * lowered to jumps by looking at neighbouring items (spec section 8).
 */
import { ForgeError } from "./errors.js";
import { isPrivateName } from "./dictionary.js";
import {
  WordMetaBuilder,
  computeHash,
  isReservedWord,
  isVocabName,
  isWordName,
  ownText,
  parseHeader as defaultParseHeader,
} from "./meta.js";
import { sha256 as defaultSha256 } from "./sha256.js";
import type {
  CombinatorName,
  CompileContext,
  CompileFn,
  CompileResult,
  CompiledWord,
  ConsoleSegment,
  Diagnostic,
  DictionaryTxn,
  EffectLabel,
  ErrorCode,
  FlWordEntry,
  HeaderParseFn,
  Instruction,
  IntrinsicName,
  IntrinsicWordEntry,
  ParamType,
  PrimitiveDef,
  PrimitiveWordEntry,
  Scope,
  Sha256Fn,
  SourcePos,
  StackEffect,
  StackWord,
  Token,
  Value,
  WordEntry,
  WordMeta,
} from "./types.js";
import { bool, bytes, int, num, str } from "./values.js";

// ---------------------------------------------------------------------------------------------
// Intrinsic and primitive entries (shared with the VM and the core vocabulary)
// ---------------------------------------------------------------------------------------------

/** Effect text (between the parentheses) and description of every intrinsic, from spec 13.1, 13.6, 13.7. */
const INTRINSIC_TABLE: Readonly<Record<IntrinsicName, readonly [string, string]>> = {
  dup: ["a -- a a", "duplicate the top"],
  drop: ["a --", "discard the top"],
  swap: ["a b -- b a", "exchange the top two"],
  over: ["a b -- a b a", "copy the second to the top"],
  rot: ["a b c -- b c a", "rotate the third to the top"],
  "-rot": ["a b c -- c a b", "rotate the top to third"],
  nip: ["a b -- b", "drop the second"],
  tuck: ["a b -- b a b", "copy the top below the second"],
  dup2: ["a b -- a b a b", "duplicate the top pair"],
  drop2: ["a b --", "discard the top pair"],
  depth: ["-- int", "push the number of values above the floor (before the push)"],
  clear: [".. --", "remove all values above the floor"],
  call: ["quot -- ..", "run a quotation"],
  if: ["bool quot quot -- ..", "conditional"],
  when: ["bool quot -- ..", "run if true"],
  unless: ["bool quot -- ..", "run if false"],
  times: ["n:int quot --", "repeat n times"],
  each: ["any quot --", "for each element of a list, bytes or str"],
  map: ["any quot -- any", "transform each element (bytes results must be 0..255)"],
  mapi: ["any quot -- any", "like map; the quotation sees ( elem index )"],
  filter: ["any quot -- any", "keep elements the quotation accepts"],
  reduce: ["any init quot -- acc", "fold"],
  while: ["quot quot --", "pre-test loop"],
  loop: ["quot --", "post-test loop"],
  try: ["quot quot -- ..", "run with a recovery handler"],
  fork: ["any any any quot -- any", "split, transform each piece, join (str or bytes data)"],
  ".": ["any --", "print the display form and a newline"],
  ".s": [".. -- ..", "print the stack without changing it"],
};

/** Every intrinsic name, in spec order. */
export const INTRINSIC_NAMES: readonly IntrinsicName[] = Object.freeze(
  Object.keys(INTRINSIC_TABLE) as IntrinsicName[],
);

const ZERO_POS: SourcePos = Object.freeze({ offset: 0, line: 1, col: 1 });

/** Options of the entry-building helpers. Defaults: vocabulary `core`, the in-repo parser and hasher. */
export interface EntryOptions {
  readonly vocab?: string;
  readonly parseHeader?: HeaderParseFn;
  readonly sha256?: Sha256Fn;
}

/**
 * Builds the dictionary entry of an intrinsic word (kind `intrinsic`) with its metadata, effect and
 * hash taken from the `core` table of the spec. The caller defines it (trusted) in a transaction.
 */
export function createIntrinsicEntry(
  name: IntrinsicName,
  opts: EntryOptions = {},
): IntrinsicWordEntry {
  const vocab = opts.vocab ?? "core";
  const parse = opts.parseHeader ?? defaultParseHeader;
  const hasher = opts.sha256 ?? defaultSha256;
  const [effectText, doc] = INTRINSIC_TABLE[name];
  const effect = parse(effectText, ZERO_POS, "lenient");
  const qname = `${vocab}:${name}`;
  const hash = computeHash(
    ownText({ kind: "intrinsic", qname, effectText: effect.text, version: "1", sourceText: null }),
    [],
    undefined,
    hasher,
  );
  const meta = new WordMetaBuilder({
    name,
    vocab,
    kind: "intrinsic",
    effect,
    op: false,
    doc,
  }).build(hash);
  return { kind: "intrinsic", qname, name, vocab, meta, intrinsic: name };
}

/** One intrinsic entry per `IntrinsicName`, in spec order. */
export function createIntrinsicEntries(opts: EntryOptions = {}): IntrinsicWordEntry[] {
  return INTRINSIC_NAMES.map((n) => createIntrinsicEntry(n, opts));
}

/**
 * Builds the entry of a primitive from its registered definition. `def.effect` may be written with
 * or without the surrounding parentheses. The entry belongs to `def.vocab`; `opts.vocab` is ignored.
 */
export function createPrimitiveEntry(
  def: PrimitiveDef,
  opts: EntryOptions = {},
): PrimitiveWordEntry {
  const parse = opts.parseHeader ?? defaultParseHeader;
  const hasher = opts.sha256 ?? defaultSha256;
  let text = def.effect.trim();
  if (text.startsWith("(") && text.endsWith(")")) text = text.slice(1, -1);
  const effect = parse(text, ZERO_POS, "lenient");
  const qname = `${def.vocab}:${def.name}`;
  const version = def.version ?? "1";
  const hash = computeHash(
    ownText({ kind: "primitive", qname, effectText: effect.text, version, sourceText: null }),
    [],
    undefined,
    hasher,
  );
  const meta = new WordMetaBuilder({
    name: def.name,
    vocab: def.vocab,
    kind: "primitive",
    effect,
    category: def.category,
    doc: def.doc,
    version: def.version,
    effects: def.effects,
  }).build(hash);
  return { kind: "primitive", qname, name: def.name, vocab: def.vocab, meta, def, effect };
}

// ---------------------------------------------------------------------------------------------
// Parsed items
// ---------------------------------------------------------------------------------------------

type Item =
  | { readonly k: "lit"; readonly value: Value; readonly pos: SourcePos }
  | { readonly k: "local"; readonly slot: number; readonly pos: SourcePos }
  | { readonly k: "word"; readonly entry: WordEntry; readonly pos: SourcePos }
  | { readonly k: "recurse"; readonly pos: SourcePos }
  | {
      readonly k: "quot" | "list";
      readonly items: readonly Item[];
      readonly pos: SourcePos;
      readonly endPos: SourcePos;
    };

/** What the body parser and code generator need to know about the code being compiled. */
interface BodyState {
  /** Qualified name for error context, or `<console>`. */
  readonly word: string;
  readonly self: FlWordEntry | null;
  readonly locals: ReadonlyMap<string, number>;
  /** Distinct entries referenced, in order of first reference (never the word itself). */
  readonly deps: Set<WordEntry>;
}

// ---------------------------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------------------------

class Emitter {
  readonly code: Instruction[] = [];
  readonly positions: SourcePos[] = [];

  emit(ins: Instruction, pos: SourcePos): number {
    this.code.push(ins);
    this.positions.push(pos);
    return this.code.length - 1;
  }

  /** Replace an instruction emitted earlier (jump patching). */
  patch(index: number, ins: Instruction): void {
    this.code[index] = ins;
  }

  get here(): number {
    return this.code.length;
  }
}

function intrinsicOf(item: Item | undefined): IntrinsicName | undefined {
  return item !== undefined && item.k === "word" && item.entry.kind === "intrinsic"
    ? item.entry.intrinsic
    : undefined;
}

function intrinsicInstruction(name: IntrinsicName): Instruction {
  switch (name) {
    case "dup":
    case "drop":
    case "swap":
    case "over":
    case "rot":
    case "-rot":
    case "nip":
    case "tuck":
    case "dup2":
    case "drop2":
    case "depth":
    case "clear":
      return { op: "stack", word: name satisfies StackWord };
    case "if":
    case "when":
    case "unless":
    case "times":
    case "each":
    case "map":
    case "mapi":
    case "filter":
    case "reduce":
    case "while":
    case "loop":
    case "try":
    case "fork":
      return { op: "comb", name: name satisfies CombinatorName };
    case "call":
      return { op: "callq" };
    case ".":
      return { op: "print", form: "value" };
    case ".s":
      return { op: "print", form: "stack" };
  }
}

function wordInstruction(entry: WordEntry): Instruction {
  switch (entry.kind) {
    case "fl":
      return { op: "call", entry };
    case "primitive":
      return { op: "prim", entry };
    case "constant":
      return { op: "lit", value: entry.value };
    case "variable":
      return entry.role === "get" ? { op: "varGet", entry } : { op: "varSet", entry };
    case "intrinsic":
      return intrinsicInstruction(entry.intrinsic);
  }
}

/**
 * Tries to lower a combinator whose quotation arguments are literal quotations starting at
 * `items[i]` (spec 8, "Lowering"). Returns the number of items consumed, or 0.
 */
function lower(em: Emitter, items: readonly Item[], i: number, self: FlWordEntry | null): number {
  const a = items[i];
  if (a === undefined || a.k !== "quot") return 0;
  const b = items[i + 1];
  const c = items[i + 2];
  if (b !== undefined && b.k === "quot" && c !== undefined) {
    const third = intrinsicOf(c);
    if (third === "if") {
      // cond [ A ] [ B ] if  ->  jumpf L1 ; A ; jump L2 ; L1: B ; L2:
      const jf = em.emit({ op: "jumpf", target: 0 }, c.pos);
      genItems(em, a.items, self);
      const j = em.emit({ op: "jump", target: 0 }, c.pos);
      em.patch(jf, { op: "jumpf", target: em.here });
      genItems(em, b.items, self);
      em.patch(j, { op: "jump", target: em.here });
      return 3;
    }
    if (third === "while") {
      // [ C ] [ B ] while  ->  L0: dmark ; C ; dcheck 1 ; jumpf L1 ; dmark ; B ; dcheck 0 ; jump L0 ; L1:
      const l0 = em.here;
      em.emit({ op: "dmark" }, c.pos);
      genItems(em, a.items, self);
      em.emit({ op: "dcheck", delta: 1 }, c.pos);
      const jf = em.emit({ op: "jumpf", target: 0 }, c.pos);
      em.emit({ op: "dmark" }, c.pos);
      genItems(em, b.items, self);
      em.emit({ op: "dcheck", delta: 0 }, c.pos);
      em.emit({ op: "jump", target: l0 }, c.pos);
      em.patch(jf, { op: "jumpf", target: em.here });
      return 3;
    }
  }
  const second = intrinsicOf(b);
  if (b === undefined || second === undefined) return 0;
  if (second === "when") {
    const jf = em.emit({ op: "jumpf", target: 0 }, b.pos);
    genItems(em, a.items, self);
    em.patch(jf, { op: "jumpf", target: em.here });
    return 2;
  }
  if (second === "unless") {
    // jumpf L1 ; jump L2 ; L1: A ; L2:
    const jf = em.emit({ op: "jumpf", target: 0 }, b.pos);
    const j = em.emit({ op: "jump", target: 0 }, b.pos);
    em.patch(jf, { op: "jumpf", target: em.here });
    genItems(em, a.items, self);
    em.patch(j, { op: "jump", target: em.here });
    return 2;
  }
  if (second === "loop") {
    // [ B ] loop  ->  L0: dmark ; B ; dcheck 1 ; jumpf L1 ; jump L0 ; L1:
    const l0 = em.here;
    em.emit({ op: "dmark" }, b.pos);
    genItems(em, a.items, self);
    em.emit({ op: "dcheck", delta: 1 }, b.pos);
    const jf = em.emit({ op: "jumpf", target: 0 }, b.pos);
    em.emit({ op: "jump", target: l0 }, b.pos);
    em.patch(jf, { op: "jumpf", target: em.here });
    return 2;
  }
  return 0;
}

function genItems(em: Emitter, items: readonly Item[], self: FlWordEntry | null): void {
  let i = 0;
  while (i < items.length) {
    const used = lower(em, items, i, self);
    if (used > 0) {
      i += used;
      continue;
    }
    const it = items[i] as Item;
    i++;
    switch (it.k) {
      case "lit":
        em.emit({ op: "lit", value: it.value }, it.pos);
        break;
      case "local":
        em.emit({ op: "local", slot: it.slot }, it.pos);
        break;
      case "word":
        em.emit(wordInstruction(it.entry), it.pos);
        break;
      case "recurse":
        // `self` is non-null: the parser only produces `recurse` inside a colon definition.
        em.emit({ op: "call", entry: self as FlWordEntry }, it.pos);
        break;
      case "quot": {
        const q = em.emit({ op: "quot", end: 0 }, it.pos);
        genItems(em, it.items, self);
        em.emit({ op: "ret" }, it.endPos);
        em.patch(q, { op: "quot", end: em.here });
        break;
      }
      case "list":
        em.emit({ op: "listOpen" }, it.pos);
        genItems(em, it.items, self);
        em.emit({ op: "listClose" }, it.endPos);
        break;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

type WordToken = Extract<Token, { kind: "word" }>;

/** Nesting depth of `[ ]` / `{ }` beyond which compilation stops (keeps recursion bounded). */
const MAX_NESTING = 256;

const WS = " \t\n\r\v\f";

/** Items of a header text with their source positions (whitespace at depth 0 separates items). */
function headerItems(text: string, base: SourcePos): { text: string; pos: SourcePos }[] {
  const out: { text: string; pos: SourcePos }[] = [];
  let { offset, line, col } = base;
  const advance = (k: number): void => {
    const c = text[k];
    offset++;
    if (c === "\n" || (c === "\r" && text[k + 1] !== "\n")) {
      line++;
      col = 1;
    } else {
      col++;
    }
  };
  let i = 0;
  while (i < text.length) {
    if (WS.includes(text[i] as string)) {
      advance(i++);
      continue;
    }
    const start = i;
    const pos: SourcePos = { offset, line, col };
    let depth = 0;
    let inStr = false;
    while (i < text.length) {
      const c = text[i] as string;
      if (inStr) {
        if (c === "\\" && i + 1 < text.length) {
          advance(i++);
        } else if (c === '"') {
          inStr = false;
        }
      } else if (c === '"') {
        inStr = true;
      } else if (c === "\\" && i + 1 < text.length) {
        // An escaped character (for example `\[` in a pattern) never opens or closes a group.
        advance(i++);
      } else if (c === "[" || c === "{") {
        depth++;
      } else if ((c === "]" || c === "}") && depth > 0) {
        depth--;
      } else if (depth === 0 && WS.includes(c)) {
        break;
      }
      advance(i++);
    }
    out.push({ text: text.slice(start, i), pos });
  }
  return out;
}

function literalValue(t: Token): Value | undefined {
  switch (t.kind) {
    case "int":
    case "char":
      return int(t.value);
    case "float":
      return num(t.value);
    case "str":
      return str(t.value);
    case "bytes":
      return bytes(t.value);
    case "bool":
      return bool(t.value);
    default:
      return undefined;
  }
}

function uniq(xs: readonly string[]): string[] {
  return [...new Set(xs)];
}

/** Counter behind `VariableWordEntry.varId` (`qname#k`); unique for the life of the process. */
let nextVarSerial = 1;

const CONSOLE_WORD = "<console>";

// ---------------------------------------------------------------------------------------------
// The compiler
// ---------------------------------------------------------------------------------------------

class Compiler {
  private readonly tokens: readonly Token[];
  private idx = 0;
  private readonly txn: DictionaryTxn;
  private scope: Scope;
  private readonly mode: "unit" | "console";
  private readonly warnings: Diagnostic[] = [];
  private readonly defined: string[] = [];
  private readonly segments: ConsoleSegment[] = [];
  /** `vocab\0name` keys defined or aliased by this unit (E_REDEFINED in unit mode). */
  private readonly claimed = new Set<string>();
  /** Latest staged metadata of entries edited by META: in this input. */
  private readonly pendingMeta = new Map<WordEntry, WordMeta>();
  private seg: { items: Item[]; st: BodyState; end: SourcePos } | null = null;
  private consoleEffect: StackEffect | null = null;

  constructor(
    tokens: readonly Token[],
    private readonly source: string,
    private readonly ctx: CompileContext,
  ) {
    const last = tokens[tokens.length - 1];
    if (last !== undefined && last.kind === "eof") {
      this.tokens = tokens;
    } else {
      const end = last?.end ?? ZERO_POS;
      this.tokens = [...tokens, { kind: "eof", text: "", pos: end, end }];
    }
    this.txn = ctx.dictionary.begin();
    this.scope = { current: ctx.scope.current, using: [...ctx.scope.using] };
    this.mode = ctx.mode;
  }

  run(): CompileResult {
    try {
      this.program();
    } catch (e) {
      this.txn.rollback();
      throw e;
    }
    return {
      txn: this.txn,
      defined: this.defined,
      warnings: this.warnings,
      scope: this.scope,
      segments: this.segments,
    };
  }

  // ---- token cursor -------------------------------------------------------------------------

  private peek(ahead = 0): Token {
    return this.tokens[Math.min(this.idx + ahead, this.tokens.length - 1)] as Token;
  }

  private next(): Token {
    const t = this.peek();
    if (t.kind !== "eof") this.idx++;
    return t;
  }

  private lastEnd(): SourcePos {
    return (this.tokens[this.idx - 1] as Token).end;
  }

  // ---- errors -------------------------------------------------------------------------------

  private fail(
    code: ErrorCode,
    message: string,
    pos: SourcePos | null,
    word: string | null = null,
    detail: Record<string, unknown> = {},
  ): never {
    throw new ForgeError({
      code,
      message,
      word,
      vocab: this.scope.current,
      pos,
      detail,
    });
  }

  /** Run `fn`; a ForgeError it throws gains `pos`, `word` and `vocab` where it has none. */
  private locate<T>(fn: () => T, pos: SourcePos | null, word: string | null): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof ForgeError) {
        throw e.with({
          pos: e.pos ?? pos,
          word: e.word ?? word,
          vocab: e.vocab ?? this.scope.current,
        });
      }
      throw e;
    }
  }

  private syntax(t: Token, expected: string, word: string | null = null): never {
    const what = t.kind === "eof" ? "end of input" : `'${t.text}'`;
    return this.fail("E_SYNTAX", `unexpected ${what}; expected ${expected}`, t.pos, word, {
      expected,
    });
  }

  /** The name operand of a defining form: E_SYNTAX at end of input, E_NAME for anything unusable. */
  private nameOperand(what: string): WordToken {
    const t = this.next();
    if (t.kind === "eof") this.syntax(t, `a name after ${what}`);
    if (t.kind !== "word" || !isWordName(t.text) || isReservedWord(t.text)) {
      this.fail("E_NAME", `'${t.text}' is not a valid word name`, t.pos, null, { name: t.text });
    }
    return t as WordToken;
  }

  private vocabOperand(what: string): WordToken {
    const t = this.next();
    if (t.kind === "eof") this.syntax(t, `a vocabulary name after ${what}`);
    if (t.kind !== "word" || !isVocabName(t.text)) {
      this.fail("E_NAME", `'${t.text}' is not a valid vocabulary name`, t.pos, null, {
        name: t.text,
      });
    }
    return t as WordToken;
  }

  private assertWritable(vocab: string, pos: SourcePos, word: string | null): void {
    if (this.ctx.trusted) return;
    if (vocab === "core" || this.txn.vocab(vocab)?.readonly === true) {
      this.fail("E_READONLY", `vocabulary '${vocab}' is read-only`, pos, word, { vocab });
    }
  }

  /** Records a definition of `vocab:name`; E_REDEFINED if the unit already defined it. */
  private claim(vocab: string, name: string, pos: SourcePos): void {
    const key = `${vocab}\0${name}`;
    if (this.mode === "unit" && this.claimed.has(key)) {
      this.fail(
        "E_REDEFINED",
        `'${vocab}:${name}' is already defined in this unit`,
        pos,
        `${vocab}:${name}`,
        { name, vocab },
      );
    }
    this.claimed.add(key);
  }

  private defineEntry(entry: WordEntry, pos: SourcePos): void {
    const replaced = this.locate(
      () =>
        this.txn.define(entry, {
          trusted: this.ctx.trusted,
          allowRedefine: this.mode === "console",
        }),
      pos,
      entry.qname,
    );
    if (replaced !== undefined) {
      this.warnings.push({
        code: "W_REDEFINED",
        message: `'${entry.qname}' redefines an existing word; earlier callers keep the old one`,
        qname: entry.qname,
        pos,
      });
    }
    this.defined.push(entry.qname);
  }

  // ---- top level ----------------------------------------------------------------------------

  private program(): void {
    for (;;) {
      const t = this.peek();
      if (t.kind === "eof") {
        this.flush();
        return;
      }
      if (t.kind === "word") {
        switch (t.text) {
          case ":":
            this.flush();
            this.colon();
            continue;
          case "IN:":
            this.flush();
            this.inForm();
            continue;
          case "VOCAB":
            if (this.mode === "unit") {
              this.fail(
                "E_SYNTAX",
                "VOCAB is only available at the console; use IN:",
                t.pos,
                null,
                {
                  expected: "IN:",
                },
              );
            }
            this.flush();
            this.inForm();
            continue;
          case "USING:":
            this.flush();
            this.using();
            continue;
          case "META:":
            this.flush();
            this.metaForm();
            continue;
          case "PRIMITIVE":
            this.flush();
            this.primitive();
            continue;
          case "CONSTANT":
          case "VARIABLE":
            this.syntax(t, "a single literal before CONSTANT or VARIABLE");
        }
      }
      const follower = this.peek(1);
      if (
        literalValue(t) !== undefined &&
        follower.kind === "word" &&
        (follower.text === "CONSTANT" || follower.text === "VARIABLE")
      ) {
        this.flush();
        this.constOrVar();
        continue;
      }
      if (this.mode === "unit") this.topLevelError(t);
      this.consoleItem();
    }
  }

  private topLevelError(t: Token): never {
    if (
      t.kind === "rbracket" ||
      t.kind === "rbrace" ||
      t.kind === "header" ||
      (t.kind === "word" && t.text === ";")
    ) {
      return this.syntax(t, "a definition or form");
    }
    return this.fail(
      "E_TOPLEVEL",
      `executable code '${t.text}' is not allowed in a source unit`,
      t.pos,
    );
  }

  // ---- console segments ---------------------------------------------------------------------

  private consoleItem(): void {
    if (this.seg === null) {
      this.seg = {
        items: [],
        st: { word: CONSOLE_WORD, self: null, locals: new Map(), deps: new Set() },
        end: this.peek().pos,
      };
    }
    this.seg.items.push(this.parseItem(this.seg.st, 0));
    this.seg.end = this.lastEnd();
  }

  private flush(): void {
    const seg = this.seg;
    if (seg === null) return;
    this.seg = null;
    const em = new Emitter();
    genItems(em, seg.items, null);
    em.emit({ op: "ret" }, seg.end);
    const code: CompiledWord = {
      qname: CONSOLE_WORD,
      effect: (this.consoleEffect ??= this.ctx.parseHeader("-- ..", ZERO_POS, "lenient")),
      localNames: [],
      namedInputs: [],
      anonInputs: [],
      nlocals: 0,
      code: em.code,
      positions: em.positions,
      effects: this.labelsOf(seg.st.deps),
      deps: [...seg.st.deps],
    };
    this.segments.push({
      code,
      scope: { current: this.scope.current, using: [...this.scope.using] },
    });
  }

  // ---- IN: / VOCAB / USING: -----------------------------------------------------------------

  private inForm(): void {
    const kw = this.next();
    const t = this.vocabOperand(kw.text);
    this.assertWritable(t.text, t.pos, null);
    this.locate(() => this.txn.ensureVocab(t.text), t.pos, null);
    this.scope = { current: t.text, using: this.scope.using };
  }

  private using(): void {
    this.next();
    const names = [...this.scope.using];
    for (;;) {
      const t = this.peek();
      if (t.kind === "eof") this.syntax(t, "';' to end USING:");
      this.next();
      if (t.kind === "word" && t.text === ";") break;
      if (t.kind !== "word" || !isVocabName(t.text)) {
        this.fail("E_NAME", `'${t.text}' is not a valid vocabulary name`, t.pos, null, {
          name: t.text,
        });
      }
      if (t.text === "core") continue;
      if (this.txn.vocab(t.text) === undefined) {
        this.fail("E_NO_VOCAB", `no such vocabulary '${t.text}'`, t.pos, null, { vocab: t.text });
      }
      if (!names.includes(t.text)) names.push(t.text);
    }
    this.scope = { current: this.scope.current, using: names };
  }

  // ---- colon definitions --------------------------------------------------------------------

  private colon(): void {
    const colon = this.next();
    const nameTok = this.nameOperand("':'");
    const name = nameTok.text;
    const vocab = this.scope.current;
    const qname = `${vocab}:${name}`;
    this.assertWritable(vocab, nameTok.pos, qname);
    this.claim(vocab, name, nameTok.pos);

    const h = this.next();
    if (h.kind !== "header") {
      this.fail("E_HEADER", `missing stack-effect header for '${name}'`, h.pos, qname, {
        item: h.text,
      });
    }
    const header = h as Extract<Token, { kind: "header" }>;
    const effect = this.locate(
      () =>
        this.ctx.parseHeader(
          header.headerText,
          header.headerTextPos,
          isPrivateName(name) ? "lenient" : "strict",
        ),
      header.pos,
      qname,
    );

    // Locals: named inputs, in declaration order (spec 7).
    const locals = new Map<string, number>();
    const localNames: string[] = [];
    const namedInputs: number[] = [];
    const anonInputs: number[] = [];
    const items = headerItems(header.headerText, header.headerTextPos);
    const sep = items.findIndex((x) => x.text === "--");
    const inItems = items.slice(0, sep < 0 ? items.length : sep).filter((x) => x.text !== "..");
    effect.inputs.forEach((slot, i) => {
      if (slot.name === null) {
        anonInputs.push(i);
        return;
      }
      locals.set(slot.name, localNames.length);
      localNames.push(slot.name);
      namedInputs.push(i);
      const pos =
        inItems.length === effect.inputs.length
          ? (inItems[i] as { pos: SourcePos }).pos
          : header.pos;
      if (this.isVisible(slot.name)) {
        this.warnings.push({
          code: "W_SHADOW",
          message: `local '${slot.name}' shadows a word of the same name in ${qname}`,
          qname,
          pos,
        });
      }
    });

    // Leading declarations are validated now (token order) by a probe builder and replayed below.
    const probe = new WordMetaBuilder({ name, vocab, kind: "fl", effect });
    const decls: { kind: "doc" | "category"; text: string }[] = [];
    for (;;) {
      const a = this.peek();
      const b = this.peek(1);
      if (a.kind === "str" && b.kind === "word" && (b.text === "doc" || b.text === "category")) {
        probe.declare(b.text, a.value, a.pos);
        decls.push({ kind: b.text, text: a.value });
        this.next();
        this.next();
      } else {
        break;
      }
    }

    const self: FlWordEntry = { kind: "fl", qname, name, vocab, meta: probe.build(""), code: null };
    const st: BodyState = { word: qname, self, locals, deps: new Set() };
    const { items: body, end } = this.parseSeq(st, "semi", 0);

    const em = new Emitter();
    genItems(em, body, self);
    em.emit({ op: "ret" }, end.pos);

    const labels = this.labelsOf(st.deps);
    const deps = [...st.deps];
    const sourceText = this.source.slice(colon.pos.offset, end.end.offset);
    const hash = computeHash(
      ownText({
        kind: "fl",
        qname,
        effectText: effect.text,
        version: "1",
        sourceText,
      }),
      deps.map((d) => ({ qname: d.qname, hash: d.meta.hash })),
      qname,
      this.ctx.sha256,
    );
    const built = new WordMetaBuilder({
      name,
      vocab,
      kind: "fl",
      effect,
      source: { unit: this.ctx.unit, text: sourceText, pos: colon.pos },
      effects: labels,
    });
    for (const d of decls) built.declare(d.kind, d.text);
    self.meta = built.build(hash);
    self.code = {
      qname,
      effect,
      localNames,
      namedInputs,
      anonInputs,
      nlocals: localNames.length,
      code: em.code,
      positions: em.positions,
      effects: labels,
      deps,
    };
    this.defineEntry(self, nameTok.pos);
  }

  /** Is `name` a word visible by unqualified lookup (spec 6.2 steps 2 to 4)? */
  private isVisible(name: string): boolean {
    try {
      this.txn.resolve(name, this.scope);
      return true;
    } catch (e) {
      return e instanceof ForgeError && e.code === "E_AMBIGUOUS";
    }
  }

  /** Sorted union of the effect labels of the referenced entries (spec 10.10). */
  private labelsOf(deps: ReadonlySet<WordEntry>): EffectLabel[] {
    const labels = new Set<EffectLabel>();
    for (const d of deps) {
      for (const l of d.meta.effects) labels.add(l);
      if (d.kind === "primitive") for (const l of d.def.effects ?? []) labels.add(l);
    }
    return [...labels].sort();
  }

  // ---- bodies -------------------------------------------------------------------------------

  /** Parses items up to the closing token (`;` for a colon body, `]`, `}`) and consumes it. */
  private parseSeq(
    st: BodyState,
    close: "semi" | "rbracket" | "rbrace",
    depth: number,
  ): { items: Item[]; end: Token } {
    const items: Item[] = [];
    for (;;) {
      const t = this.peek();
      if (t.kind === "eof") {
        this.syntax(t, close === "semi" ? "';'" : close === "rbracket" ? "']'" : "'}'", st.word);
      }
      if (
        (close === "semi" && t.kind === "word" && t.text === ";") ||
        (close === "rbracket" && t.kind === "rbracket") ||
        (close === "rbrace" && t.kind === "rbrace")
      ) {
        this.next();
        return { items, end: t };
      }
      items.push(this.parseItem(st, depth));
    }
  }

  private parseItem(st: BodyState, depth: number): Item {
    const t = this.next();
    const lit = literalValue(t);
    if (lit !== undefined) return { k: "lit", value: lit, pos: t.pos };
    switch (t.kind) {
      case "word":
        return this.wordItem(t, st);
      case "qword": {
        const entry = this.locate(
          () => this.txn.resolveQualified(t.vocab, t.name, this.scope.current),
          t.pos,
          st.word,
        );
        st.deps.add(entry);
        return { k: "word", entry, pos: t.pos };
      }
      case "lbracket":
      case "lbrace": {
        if (depth >= MAX_NESTING) {
          this.fail("E_SYNTAX", `nesting deeper than ${MAX_NESTING} levels`, t.pos, st.word, {
            expected: "shallower nesting",
          });
        }
        const isQuot = t.kind === "lbracket";
        const { items, end } = this.parseSeq(st, isQuot ? "rbracket" : "rbrace", depth + 1);
        return { k: isQuot ? "quot" : "list", items, pos: t.pos, endPos: end.pos };
      }
      default:
        // `]` and `}` with no opener, a stray header, or end of input.
        return this.syntax(t, "a word, literal, '[' or '{'", st.word);
    }
  }

  private wordItem(t: WordToken, st: BodyState): Item {
    if (t.text === "recurse") {
      if (st.self === null) {
        return this.syntax(t, "'recurse' only inside a colon definition", st.word);
      }
      return { k: "recurse", pos: t.pos };
    }
    if (isReservedWord(t.text)) {
      return this.syntax(t, "a word (not a defining keyword)", st.word);
    }
    const slot = st.locals.get(t.text);
    if (slot !== undefined) return { k: "local", slot, pos: t.pos };
    const entry = this.locate(() => this.txn.resolve(t.text, this.scope), t.pos, st.word);
    st.deps.add(entry);
    return { k: "word", entry, pos: t.pos };
  }

  // ---- CONSTANT and VARIABLE ----------------------------------------------------------------

  private constOrVar(): void {
    const litTok = this.next();
    const value = literalValue(litTok) as Value;
    const kw = this.next();
    const isVar = kw.text === "VARIABLE";
    const nameTok = this.nameOperand(kw.text);
    const name = nameTok.text;
    const vocab = this.scope.current;
    const setter = `${name}!`;
    if (isVar && !isWordName(setter)) {
      this.fail("E_NAME", `'${setter}' is not a valid word name`, nameTok.pos, null, {
        name: setter,
      });
    }
    this.assertWritable(vocab, nameTok.pos, `${vocab}:${name}`);
    this.claim(vocab, name, nameTok.pos);
    if (isVar) this.claim(vocab, setter, nameTok.pos);

    const type = value.tag as ParamType;
    const sourceText = this.source.slice(litTok.pos.offset, nameTok.end.offset);
    const source = { unit: this.ctx.unit, text: sourceText, pos: litTok.pos };
    const parse = (text: string): StackEffect => this.ctx.parseHeader(text, nameTok.pos, "lenient");
    const entryMeta = (n: string, kind: "constant" | "variable", effect: StackEffect): WordMeta =>
      new WordMetaBuilder({ name: n, vocab, kind, effect, source }).build(
        computeHash(
          ownText({
            kind,
            qname: `${vocab}:${n}`,
            effectText: effect.text,
            version: "1",
            sourceText,
          }),
          [],
          undefined,
          this.ctx.sha256,
        ),
      );
    const getEffect = parse(`-- ${type}`);

    if (!isVar) {
      this.defineEntry(
        {
          kind: "constant",
          qname: `${vocab}:${name}`,
          name,
          vocab,
          meta: entryMeta(name, "constant", getEffect),
          value,
        },
        nameTok.pos,
      );
      return;
    }
    const varId = `${vocab}:${name}#${nextVarSerial++}`;
    this.defineEntry(
      {
        kind: "variable",
        qname: `${vocab}:${name}`,
        name,
        vocab,
        meta: entryMeta(name, "variable", getEffect),
        role: "get",
        varId,
        initial: value,
      },
      nameTok.pos,
    );
    this.defineEntry(
      {
        kind: "variable",
        qname: `${vocab}:${setter}`,
        name: setter,
        vocab,
        meta: entryMeta(setter, "variable", parse(`${type} --`)),
        role: "set",
        varId,
        initial: value,
      },
      nameTok.pos,
    );
  }

  // ---- PRIMITIVE ----------------------------------------------------------------------------

  private primitive(): void {
    const kw = this.next();
    if (!this.ctx.trusted) {
      this.fail("E_UNTRUSTED", "PRIMITIVE is only allowed in a trusted load", kw.pos);
    }
    const nameTok = this.nameOperand("PRIMITIVE");
    const vocab = this.scope.current;
    const def = this.ctx.registry.get(vocab, nameTok.text);
    if (def === undefined) {
      this.fail(
        "E_NO_PRIMITIVE",
        `no primitive registered as '${vocab}:${nameTok.text}'`,
        nameTok.pos,
        `${vocab}:${nameTok.text}`,
        { name: nameTok.text, vocab },
      );
    }
    this.claim(vocab, nameTok.text, nameTok.pos);
    const entry = this.locate(
      () =>
        createPrimitiveEntry(def, { parseHeader: this.ctx.parseHeader, sha256: this.ctx.sha256 }),
      nameTok.pos,
      `${vocab}:${nameTok.text}`,
    );
    this.defineEntry(entry, nameTok.pos);
  }

  // ---- META: --------------------------------------------------------------------------------

  private metaForm(): void {
    this.next();
    const nameTok = this.next();
    if (nameTok.kind !== "word" || isReservedWord(nameTok.text) || !isWordName(nameTok.text)) {
      this.syntax(nameTok, "a word name after META:");
    }
    const name = (nameTok as WordToken).text;
    const vocab = this.scope.current;
    const qname = `${vocab}:${name}`;
    const entry = this.txn.vocab(vocab)?.words.get(name);
    if (entry === undefined) {
      this.fail("E_META", `META: for undefined word '${qname}'`, nameTok.pos, qname, {
        clause: "META:",
        name,
      });
    }
    if (isPrivateName(name)) {
      this.fail(
        "E_META",
        `private word '${qname}' may not have a META: block`,
        nameTok.pos,
        qname,
        {
          clause: "META:",
          name,
        },
      );
    }
    this.assertWritable(vocab, nameTok.pos, qname);

    const base = this.pendingMeta.get(entry) ?? entry.meta;
    const builder = new WordMetaBuilder({
      name: base.name,
      vocab: base.vocab,
      kind: base.kind,
      effect: base.effect,
      source: base.source,
      op: base.op,
      category: base.category,
      doc: base.doc,
      // "1" is also the default, so an explicit earlier "1" cannot be told apart and stays settable.
      version: base.version === "1" ? undefined : base.version,
      effects: base.effects,
      isNameTaken: (n) => this.txn.vocab(base.vocab)?.words.has(n) === true,
    });
    for (const p of base.params) {
      if (p.doc !== undefined) builder.clause({ kind: "param", name: p.name, text: p.doc });
    }

    for (;;) {
      const kw = this.next();
      if (kw.kind === "eof") this.syntax(kw, "';' to end META:", qname);
      if (kw.kind === "word" && kw.text === ";") break;
      if (kw.kind !== "word") {
        this.fail("E_META", `'${kw.text}' is not a META: clause`, kw.pos, qname, {
          clause: kw.text,
        });
      }
      const args: ({ type: "str"; value: string } | { type: "name"; text: string })[] = [];
      for (;;) {
        const a = this.next();
        if (a.kind === "eof") this.syntax(a, "';' to end the clause", qname);
        if (a.kind === "word" && a.text === ";") break;
        if (a.kind === "str") args.push({ type: "str", value: a.value });
        else if (a.kind === "word" || a.kind === "qword" || kw.text === "alias") {
          // Any token in an alias position is a candidate name; the builder rejects bad ones (E_NAME).
          args.push({ type: "name", text: a.text });
        } else {
          this.fail("E_META", `'${a.text}' is not valid in a META: clause`, a.pos, qname, {
            clause: kw.text,
          });
        }
      }
      builder.clauseFromArgs(kw.text, args, kw.pos);
    }

    const built = builder.build(base.hash);
    const meta: WordMeta = {
      ...built,
      aliases: uniq([...base.aliases, ...built.aliases]),
      seeAlso: uniq([...base.seeAlso, ...built.seeAlso]),
    };
    for (const a of built.aliases) {
      this.claimed.add(`${base.vocab}\0${a}`);
      this.locate(() => this.txn.alias(entry, a), nameTok.pos, qname);
      this.defined.push(`${base.vocab}:${a}`);
    }
    this.txn.stageMeta(entry, meta);
    this.pendingMeta.set(entry, meta);
  }
}

/**
 * Compiles `tokens` (from `read(source)`) inside one new `DictionaryTxn`. On success the txn is
 * returned uncommitted; on failure it is rolled back here and the ForgeError is rethrown, so the
 * caller has nothing to clean up. Nothing is executed.
 */
export const compile: CompileFn = (tokens, source, ctx) => new Compiler(tokens, source, ctx).run();
