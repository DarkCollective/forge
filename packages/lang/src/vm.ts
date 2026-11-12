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
 * The FL virtual machine (spec section 10): runs the console segments the compiler produced.
 *
 * One `Machine` per run. The run loop is a single `async` method with a synchronous inner loop that
 * only awaits real thenables (async primitives, hooks) and the periodic macrotask yield, so a
 * primitive that returns a plain value costs no microtask (spec 10.4).
 *
 * Return-stack model. The return stack holds `ActFrame`s (a `word` or a `quot` activation, each with
 * its own code, ip and locals) and the bookkeeping frames `LoopFrame` (combinator state), `TryFrame`,
 * and the list/mark frames of `listOpen` and `dmark`. `cur` is always the topmost activation; the
 * instruction registers (`code`, `ip`, `locals`) are loaded from it. A frame pushed by a combinator
 * is `driven`: when it returns, control goes to the loop or try frame beneath it instead of
 * straight back to the caller. Whenever a new activation is pushed, the caller's ip has already
 * been saved into its frame.
 *
 * Errors are JS exceptions (`ForgeError`) raised anywhere while an instruction runs; the catch in
 * `execute` enriches them with the machine state at the point of failure (which is intact, because
 * every instruction mutates its registers last) and hands catchable ones to the innermost
 * protecting `try`.
 */
import {
  ForgeError,
  MAX_FRAMES,
  isCatchable,
  redactKeySlots,
  redactSnapshot,
  redactValue,
} from "./errors.js";
import { callPrimitive } from "./primitives.js";
import { DEFAULT_LIMITS } from "./types.js";
import { Collector, emitOutsideCollect } from "./vm-collect.js";
import { retainMemo } from "./vm-memo.js";
import type { MemoBuild } from "./vm-memo.js";
import { checkCaseList, checkCondList, sortByKeys } from "./vm-select.js";
import type {
  CombinatorName,
  CoercionRecord,
  CompiledWord,
  ConsoleSegment,
  MemoSlot,
  EffectLabel,
  ErrorCode,
  ErrorFrame,
  FlWordEntry,
  Instruction,
  Limits,
  PrimitiveContext,
  PrimitiveWordEntry,
  Quotation,
  RunOptions,
  RunResult,
  SourcePos,
  StackSlot,
  StackWord,
  TraceEntry,
  Value,
  VarStore,
  VmRunFn,
} from "./types.js";
import {
  codePoints,
  coerceTracked,
  display,
  equals,
  markSecret,
  reprShort,
  runtimeTypeOf,
  sizeOf,
  validate,
} from "./values.js";

// The package builds against ES2022 only; these are the host globals the VM needs.
declare const performance: { now(): number };
declare function setTimeout(callback: () => void, ms: number): unknown;
declare function clearTimeout(handle: unknown): void;

const K_WORD = 0;
const K_QUOT = 1;
const K_LOOP = 2;
const K_TRY = 3;
const K_LIST = 4;
const K_MARK = 5;

const EMPTY: readonly Value[] = Object.freeze([]);
/** Placeholder quotation of a `cond` frame, which takes its quotations from its list. */
const EMPTY_QUOT = null as unknown as Quotation;
const NO_ARGS: readonly Value[] = Object.freeze([]);
const MAX_TIMER = 2 ** 31 - 1;
const DEFAULT_YIELD_EVERY = 131_072;

// ---------------------------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------------------------

/** A running word or quotation. `ip` is the saved return address while a callee runs. */
class ActFrame {
  readonly code: readonly Instruction[];
  ip: number;
  constructor(
    readonly k: 0 | 1,
    readonly word: CompiledWord,
    ip: number,
    readonly locals: readonly Value[],
    readonly base: number,
    readonly savedFloor: number,
    readonly caller: ActFrame | null,
    readonly driven: boolean,
  ) {
    this.code = word.code;
    this.ip = ip;
  }
  /** Set on the frame of a `MEMO:` word being built; its result is cached at `ret`. */
  memo: MemoBuild | null = null;
}

/** Combinator state (`times each map mapi filter reduce while loop fork`). */
type LoopComb =
  | "times"
  | "each"
  | "map"
  | "mapi"
  | "filter"
  | "reduce"
  | "while"
  | "loop"
  | "fork"
  | "cond"
  | "sort-by"
  | "find"
  | "any?"
  | "all?"
  | "collect"
  | "collect-bytes"
  | "collect-str";

class LoopFrame {
  readonly k = K_LOOP;
  q2: Quotation | null = null;
  /** Data depth before the current iteration pushed anything. */
  d = 0;
  i = 0;
  n = 0;
  /** `while`: 1 while the condition runs, 2 while the body runs. */
  phase = 0;
  list: readonly Value[] | null = null;
  bytes: Uint8Array | null = null;
  cps: number[] | null = null;
  outList: Value[] = [];
  outNums: number[] = [];
  acc: Value | null = null;
  forkStr = false;
  forkJoin: string | Uint8Array = "";
  pieces: (string | Uint8Array)[] = [];
  forkOut: (string | Uint8Array)[] = [];
  /** `collect*`: the accumulator, and the collector frame that was innermost before this one. */
  coll: Collector | null = null;
  prevColl: LoopFrame | null = null;
  constructor(
    readonly comb: LoopComb,
    readonly owner: ActFrame,
    readonly q: Quotation,
  ) {}
}

class TryFrame {
  readonly k = K_TRY;
  /** False once the handler runs: an error in the handler is not caught by this try. */
  protectedBody = true;
  constructor(
    readonly owner: ActFrame,
    readonly handler: Quotation,
    /** Data depth at entry: the floor of the body, and the snapshot to restore. */
    readonly depth: number,
    readonly savedFloor: number,
  ) {}
}

/** The frame of `listOpen` (`K_LIST`) and `dmark` (`K_MARK`). */
class MarkFrame {
  constructor(
    readonly k: 4 | 5,
    readonly depth: number,
  ) {}
}

type Frame = ActFrame | LoopFrame | TryFrame | MarkFrame;

/** What an interrupted await resolves to (abort or deadline). */
class Interrupt {
  constructor(readonly error: ForgeError) {}
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

function isThenable(x: unknown): x is PromiseLike<unknown> {
  return (
    (typeof x === "object" || typeof x === "function") &&
    x !== null &&
    typeof (x as { then?: unknown }).then === "function"
  );
}

/** UTF-8 length of a JS string (a lone surrogate counts as the 3-byte replacement character). */
function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d < 0xe000) {
        n += 4;
        i++;
      } else n += 3;
    } else n += 3;
  }
  return n;
}

/** Size used by the value and total limits, with a fast path for the common small values. */
function sizeFast(v: Value): number {
  switch (v.tag) {
    case "int":
      return typeof v.v === "number" ? 8 : sizeOf(v);
    case "num":
      return 8;
    case "bool":
      return 1;
    case "str":
      return 2 * v.v.length;
    case "bytes":
      return v.v.byteLength;
    default:
      return sizeOf(v);
  }
}

function fromCodePoints(cps: readonly number[]): string {
  let out = "";
  for (let i = 0; i < cps.length; i += 8192) {
    out += String.fromCodePoint(...cps.slice(i, i + 8192));
  }
  return out;
}

function splitBytes(data: Uint8Array, sep: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  const m = sep.length;
  let start = 0;
  let i = 0;
  while (i <= data.length - m) {
    let j = 0;
    while (j < m && data[i + j] === sep[j]) j++;
    if (j === m) {
      out.push(data.slice(start, i));
      i += m;
      start = i;
    } else {
      i++;
    }
  }
  out.push(data.slice(start));
  return out;
}

function joinBytes(parts: readonly Uint8Array[], sep: Uint8Array): Uint8Array {
  let total = sep.length * Math.max(0, parts.length - 1);
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  parts.forEach((p, idx) => {
    if (idx > 0) {
      out.set(sep, at);
      at += sep.length;
    }
    out.set(p, at);
    at += p.length;
  });
  return out;
}

function typeError(expected: string, actual: string, extra: Record<string, unknown> = {}) {
  return new ForgeError({
    code: "E_TYPE",
    message: `expected ${expected}, got ${actual}`,
    detail: { expected, actual, ...extra },
  });
}

function limitError(code: ErrorCode, what: string, limit: number, value: number): ForgeError {
  return new ForgeError({
    code,
    message: `${what} limit of ${limit} exceeded (${value})`,
    detail: { limit, value },
  });
}

function internalError(message: string): ForgeError {
  return new ForgeError({ code: "E_INTERNAL", message });
}

function tagMatches(type: StackSlot["type"], tag: Value["tag"]): boolean {
  const rt = runtimeTypeOf(type);
  if (rt === "any") return true;
  if (rt === "number") return tag === "int" || tag === "num";
  return rt === tag;
}

function isValidCodePoint(n: number): boolean {
  return n >= 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff);
}

/** The error-record value for one `detail` entry (spec 8, `try`). */
function detailValue(x: unknown): Value {
  if (typeof x === "string") return { tag: "str", v: x };
  if (typeof x === "boolean") return { tag: "bool", v: x };
  if (typeof x === "bigint") return { tag: "int", v: x };
  if (typeof x === "number") {
    if (Number.isInteger(x)) return { tag: "int", v: x };
    if (Number.isFinite(x)) return { tag: "num", v: x };
    return { tag: "str", v: String(x) };
  }
  if (Array.isArray(x) && x.every((e) => typeof e === "string")) {
    return { tag: "list", v: (x as string[]).map((e) => ({ tag: "str", v: e }) as Value) };
  }
  if (typeof x === "object" && x !== null && "tag" in x && "v" in x) {
    return { tag: "str", v: reprShort(redactValue(x as Value)) };
  }
  if (Array.isArray(x)) {
    return { tag: "str", v: `[${x.map((e) => String(detailValue(e).v)).join(", ")}]` };
  }
  return { tag: "str", v: String(x) };
}

function errorRecord(err: ForgeError): Value {
  const detail = new Map<string, Value>();
  for (const [k, v] of Object.entries(err.detail)) detail.set(k, detailValue(v));
  return {
    tag: "record",
    v: new Map<string, Value>([
      ["code", { tag: "str", v: err.code }],
      ["message", { tag: "str", v: err.message }],
      ["word", { tag: "str", v: err.word as string }],
      ["vocab", { tag: "str", v: err.vocab as string }],
      ["detail", { tag: "record", v: detail }],
    ]),
  };
}

// ---------------------------------------------------------------------------------------------
// The machine
// ---------------------------------------------------------------------------------------------

class Machine {
  // Data and return stacks, and the instruction registers.
  readonly ds: Value[];
  readonly rs: Frame[] = [];
  private cur!: ActFrame;
  private started = false;
  private code: readonly Instruction[] = [];
  private ip = 0;
  private locals: readonly Value[] = EMPTY;
  private floor = 0;

  // Counters and results.
  private steps = 0;
  private totalBytes = 0;
  private outputBytes = 0;
  private output = "";
  private readonly coercions: CoercionRecord[] = [];
  private readonly effects = new Set<EffectLabel>();
  private readonly trace: TraceEntry[] | null;
  private truncated = false;

  // Limits and cadence.
  private readonly limits: Readonly<Limits>;
  private readonly maxSteps: number;
  private readonly maxData: number;
  private readonly maxRet: number;
  private readonly maxValue: number;
  private readonly maxTotal: number;
  private readonly maxOut: number;
  private readonly maxTrace: number;
  private readonly yieldEvery: number;
  private nextPoll = 1024;
  private nextYield: number;
  private nextCheck: number;

  // Time and cancellation.
  private readonly t0: number;
  private deadline: number;
  private readonly signal: RunOptions["signal"];
  private readonly flag: Int32Array | undefined;

  // Hooks.
  private readonly onStep: RunOptions["onStep"];
  private readonly stepAll: boolean;
  private readonly bps: Map<string, Set<number>> | null;
  private bpSet: Set<number> | null = null;
  private readonly hooked: boolean;
  private readonly deny: ReadonlySet<EffectLabel> | null;
  private readonly vars: VarStore;
  private pctx!: PrimitiveContext;
  private segCurrent = "user";
  /** The innermost active `collect*` frame, or null (LANGUAGE-0.2.md section 10). */
  private collFrame: LoopFrame | null = null;

  constructor(private readonly opts: RunOptions) {
    this.limits = { ...DEFAULT_LIMITS, ...opts.limits };
    const l = this.limits;
    this.maxSteps = l.maxSteps;
    this.maxData = l.maxDataDepth;
    this.maxRet = l.maxReturnDepth;
    this.maxValue = l.maxValueBytes;
    this.maxTotal = l.maxTotalBytes;
    this.maxOut = l.maxOutputBytes;
    this.maxTrace = l.maxTraceEntries;
    this.yieldEvery =
      opts.yieldEvery === undefined
        ? DEFAULT_YIELD_EVERY
        : opts.yieldEvery > 0
          ? opts.yieldEvery
          : 0;
    this.nextYield = this.yieldEvery > 0 ? this.yieldEvery : Infinity;
    this.nextCheck = Math.min(this.nextPoll, this.nextYield, this.maxSteps + 1);
    this.t0 = performance.now();
    this.deadline = this.t0 + l.maxMillis;
    this.signal = opts.signal;
    this.flag = opts.abortFlag;
    this.ds = opts.stack === undefined ? [] : [...opts.stack];
    this.vars = opts.vars ?? new Map();
    this.trace = opts.trace === true ? [] : null;
    this.onStep = opts.onStep;
    this.stepAll = opts.stepAll === true;
    const bps = opts.breakpoints ?? [];
    if (bps.length > 0) {
      this.bps = new Map();
      for (const b of bps) {
        const set = this.bps.get(b.word) ?? new Set<number>();
        set.add(b.ip ?? 0);
        this.bps.set(b.word, set);
      }
    } else {
      this.bps = null;
    }
    this.hooked = this.onStep !== undefined && (this.stepAll || this.bps !== null);
    this.deny = opts.deny !== undefined && opts.deny.length > 0 ? new Set(opts.deny) : null;
  }

  // ---- entry point ----------------------------------------------------------------------------

  async run(segments: readonly ConsoleSegment[]): Promise<RunResult> {
    let error: ForgeError | null = null;
    try {
      if (this.ds.length > this.maxData) {
        throw limitError("E_LIMIT_STACK", "data stack depth", this.maxData, this.ds.length);
      }
      for (const seg of segments) {
        this.begin(seg);
        await this.execute();
      }
    } catch (e) {
      error = this.enrich(e);
    }
    const base = {
      stack: this.ds.slice(),
      output: this.output,
      steps: this.steps,
      elapsedMs: performance.now() - this.t0,
      coercions: this.coercions,
      effects: [...this.effects].sort(),
      ...(this.trace !== null ? { trace: this.trace } : {}),
      ...(this.truncated ? { traceTruncated: true } : {}),
    };
    return error === null ? { ok: true, ...base } : { ok: false, error, ...base };
  }

  /** Starts a segment as a `word` frame with base 0, sharing the data stack. */
  private begin(seg: ConsoleSegment): void {
    this.segCurrent = seg.scope.current;
    this.pctx = { signal: this.signal, limits: this.limits, scope: seg.scope };
    if (this.maxRet < 1) throw limitError("E_LIMIT_RETURN", "return stack depth", this.maxRet, 1);
    this.rs.length = 0;
    this.collFrame = null;
    const f = new ActFrame(K_WORD, seg.code, 0, EMPTY, 0, 0, null, false);
    this.rs.push(f);
    this.cur = f;
    this.floor = 0;
    this.started = true;
    this.loadCur();
  }

  private loadCur(): void {
    const f = this.cur;
    this.code = f.code;
    this.ip = f.ip;
    this.locals = f.locals;
    this.bpSet = this.bps === null ? null : (this.bps.get(f.word.qname) ?? null);
  }

  /** Runs the current segment to completion, recovering from caught errors. */
  private async execute(): Promise<void> {
    for (;;) {
      try {
        this.poll();
        await this.hot();
        return;
      } catch (e) {
        const err = this.enrich(e);
        const tf = isCatchable(err.code) ? this.findTry() : null;
        if (tf === null) throw err;
        this.recover(tf, err);
      }
    }
  }

  // ---- the run loop ---------------------------------------------------------------------------

  private async hot(): Promise<void> {
    const ds = this.ds;
    for (;;) {
      const at = this.ip;
      const ins = this.code[at];
      if (ins === undefined) throw internalError("instruction pointer left the code");
      this.ip = at + 1;
      if (++this.steps >= this.nextCheck && this.checkpoint()) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        this.poll();
      }
      if (this.hooked) {
        const hit = this.bpSet !== null && this.bpSet.has(at);
        if (this.stepAll || hit) {
          let r = this.callHook(at, ins.op, hit);
          if (isThenable(r)) r = await this.awaitHook(r);
          if (r === "stop") {
            throw new ForgeError({ code: "E_ABORTED", message: "stopped by hook" });
          }
        }
      }
      if (this.trace !== null) this.record(at, ins.op);

      switch (ins.op) {
        case "lit":
          ds.push(ins.value);
          if (ds.length > this.maxData) this.dataLimit();
          break;
        case "local":
          ds.push(this.locals[ins.slot] as Value);
          if (ds.length > this.maxData) this.dataLimit();
          break;
        case "call":
          this.doCall(ins.entry);
          break;
        case "memo":
          this.doMemo(ins.entry);
          break;
        case "ret":
          if (this.doRet()) return;
          break;
        case "prim": {
          const entry = ins.entry;
          let r = this.primCall(entry);
          if (!Array.isArray(r)) {
            this.poll();
            r = await this.interruptible(r, true);
            this.poll();
          }
          this.primFinish(entry, r);
          break;
        }
        case "stack":
          this.stackWord(ins.word);
          break;
        case "jumpf": {
          if (ds.length - this.floor < 1) this.underflow(1);
          const b = ds[ds.length - 1] as Value;
          if (b.tag !== "bool") {
            throw typeError("bool", b.tag, { where: "condition" });
          }
          ds.pop();
          if (!b.v) this.ip = ins.target;
          break;
        }
        case "jump":
          this.ip = ins.target;
          break;
        case "quot":
          ds.push({
            tag: "quot",
            v:
              ins.own === true
                ? { code: this.cur.word, start: this.ip, env: this.locals, own: true }
                : { code: this.cur.word, start: this.ip, env: this.locals },
          });
          if (ds.length > this.maxData) this.dataLimit();
          this.ip = ins.end;
          break;
        case "callq": {
          if (ds.length - this.floor < 1) this.underflow(1);
          const q = this.peekQuot(0);
          ds.pop();
          this.cur.ip = this.ip;
          this.pushQuot(q, this.cur, false);
          break;
        }
        case "comb":
          this.cur.ip = this.ip;
          this.comb(ins.name);
          break;
        case "varGet": {
          const e = ins.entry;
          ds.push(this.vars.get(e.varId) ?? e.initial);
          if (ds.length > this.maxData) this.dataLimit();
          break;
        }
        case "varSet": {
          const e = ins.entry;
          if (ds.length - this.floor < 1) this.underflow(1);
          const v = ds[ds.length - 1] as Value;
          const want = (this.vars.get(e.varId) ?? e.initial).tag;
          if (v.tag !== want) throw typeError(want, v.tag, { where: "variable" });
          ds.pop();
          this.vars.set(e.varId, v);
          break;
        }
        case "bind":
          if (ds.length - this.floor < 1) this.underflow(1);
          (this.locals as Value[])[ins.slot] = ds.pop() as Value;
          break;
        case "exit":
          for (let k = ins.marks; k > 0; k--) {
            const m = this.rs.pop();
            if (m === undefined || m.k !== K_MARK) throw internalError("exit without dmark");
          }
          if (this.doRet()) return;
          break;
        case "emit":
          this.emitItem(ins.all);
          break;
        case "dmark":
          this.pushMark(new MarkFrame(K_MARK, ds.length));
          break;
        case "dcheck": {
          const m = this.rs.pop();
          if (m === undefined || m.k !== K_MARK) throw internalError("dcheck without dmark");
          if (ds.length !== m.depth + ins.delta) {
            throw new ForgeError({
              code: "E_EFFECT",
              message: `loop body left ${ds.length - m.depth} values, expected ${ins.delta}`,
              detail: { expected: ins.delta, actual: ds.length - m.depth },
            });
          }
          break;
        }
        case "listOpen":
          this.pushMark(new MarkFrame(K_LIST, ds.length));
          break;
        case "listClose":
          this.listClose();
          break;
        case "print":
          this.print(ins.form);
          break;
      }
    }
  }

  // ---- errors ---------------------------------------------------------------------------------

  /** Adds the machine state at the point of failure to an error (fields already set are kept). */
  private enrich(e: unknown): ForgeError {
    const err =
      e instanceof ForgeError
        ? e
        : new ForgeError({
            code: "E_INTERNAL",
            message: `internal error: ${e instanceof Error ? e.message : String(e)}`,
            cause: e,
          });
    const ds = this.ds;
    const snapshot =
      err.stackSnapshot.length > 0 ? err.stackSnapshot : redactSnapshot(ds.slice(-16));
    if (!this.started) return err.with({ step: err.step ?? this.steps, stackSnapshot: snapshot });
    const cur = this.cur;
    const ip = this.ip - 1;
    const all: ErrorFrame[] = [];
    for (let i = this.rs.length - 1; i >= 0; i--) {
      const f = this.rs[i] as Frame;
      if (f.k === K_WORD || f.k === K_QUOT) {
        all.push({ word: f.word.qname, ip: f === cur ? ip : f.ip - 1 });
      }
    }
    // Keep the 32 innermost and the 32 outermost frames when there are more than 64.
    const half = MAX_FRAMES / 2;
    const frames =
      all.length <= MAX_FRAMES ? all : [...all.slice(0, half), ...all.slice(all.length - half)];
    const framesSkipped = all.length - frames.length;
    const qname = cur.word.qname;
    const colon = qname.indexOf(":");
    const wordName = err.word ?? qname;
    const vocab = err.vocab ?? (colon > 0 ? qname.slice(0, colon) : this.segCurrent);
    return err.with({
      word: wordName,
      vocab,
      step: err.step ?? this.steps,
      ip: err.ip ?? (ip >= 0 ? ip : null),
      pos: err.pos ?? cur.word.positions[ip] ?? null,
      stackSnapshot: snapshot,
      frames,
      framesSkipped,
    });
  }

  private findTry(): TryFrame | null {
    for (let i = this.rs.length - 1; i >= 0; i--) {
      const f = this.rs[i] as Frame;
      if (f.k === K_TRY && f.protectedBody) return f;
    }
    return null;
  }

  /** Unwinds to `tf`, restores its data stack, pushes the error record and runs the handler. */
  private recover(tf: TryFrame, err: ForgeError): void {
    this.rs.length = this.rs.lastIndexOf(tf) + 1;
    this.collFrame = this.nearestCollector();
    tf.protectedBody = false;
    // The values below the try's floor cannot have been touched, so restoring the snapshot is
    // the same as truncating to the depth recorded at entry.
    this.ds.length = tf.depth;
    this.floor = tf.depth;
    this.cur = tf.owner;
    this.loadCur();
    this.ds.push(errorRecord(err));
    this.pushQuot(tf.handler, tf.owner, true);
  }

  /** The innermost `collect*` frame left on the return stack (after an unwind). */
  private nearestCollector(): LoopFrame | null {
    for (let i = this.rs.length - 1; i >= 0; i--) {
      const f = this.rs[i] as Frame;
      if (f.k === K_LOOP && f.coll !== null) return f;
      // A memo build hides the collectors of its callers.
      if (f.k === K_WORD && f.memo !== null) return null;
    }
    return null;
  }

  /** `emit` and `emit-all`: add the top of the stack to the innermost collector. */
  private emitItem(all: boolean): void {
    const ds = this.ds;
    if (ds.length - this.floor < 1) this.underflow(1);
    const cf = this.collFrame;
    if (cf === null) throw emitOutsideCollect();
    const v = ds[ds.length - 1] as Value;
    if (all) (cf.coll as Collector).addAll(v);
    else (cf.coll as Collector).add(v);
    ds.pop();
  }

  private underflow(needed: number): never {
    const available = this.ds.length - this.floor;
    throw new ForgeError({
      code: "E_STACK_UNDERFLOW",
      message: `stack underflow: needed ${needed}, available ${available}`,
      detail: { needed, available },
    });
  }

  private dataLimit(): never {
    throw limitError("E_LIMIT_STACK", "data stack depth", this.maxData, this.ds.length);
  }

  private retLimit(): never {
    throw limitError("E_LIMIT_RETURN", "return stack depth", this.maxRet, this.rs.length + 1);
  }

  // ---- limits, cancellation, time -------------------------------------------------------------

  /** Slow path of the step counter: returns true when the VM should yield to the event loop. */
  private checkpoint(): boolean {
    if (this.steps > this.maxSteps) {
      throw limitError("E_LIMIT_STEPS", "step", this.maxSteps, this.steps);
    }
    if (this.steps >= this.nextPoll) {
      this.poll();
      this.nextPoll = this.steps - (this.steps % 1024) + 1024;
    }
    let yieldDue = false;
    if (this.steps >= this.nextYield) {
      yieldDue = true;
      this.nextYield = this.steps + this.yieldEvery;
    }
    this.nextCheck = Math.min(this.nextPoll, this.nextYield, this.maxSteps + 1);
    return yieldDue;
  }

  /** Abort signal, abort flag and wall-clock deadline. */
  private poll(): void {
    if (
      this.signal?.aborted === true ||
      (this.flag !== undefined && Atomics.load(this.flag, 0) !== 0)
    ) {
      throw new ForgeError({ code: "E_ABORTED", message: "aborted" });
    }
    if (performance.now() > this.deadline) throw this.timeError();
  }

  private timeError(): ForgeError {
    return limitError(
      "E_LIMIT_TIME",
      "wall-clock",
      this.limits.maxMillis,
      Math.round(performance.now() - this.t0),
    );
  }

  /** One extra step for a combinator iteration. */
  private chargeStep(): void {
    if (++this.steps > this.maxSteps) {
      throw limitError("E_LIMIT_STEPS", "step", this.maxSteps, this.steps);
    }
  }

  /**
   * Awaits `p` against the abort signal and, if `withDeadline`, the wall-clock deadline. The waits
   * are created and released per await, so a run with millions of async calls accumulates nothing.
   */
  private async interruptible<T>(p: PromiseLike<T>, withDeadline: boolean): Promise<T> {
    const signal = this.signal;
    const waits: PromiseLike<T | Interrupt>[] = [p];
    let timer: unknown;
    let onAbort: (() => void) | undefined;
    if (signal !== undefined) {
      waits.push(
        new Promise<Interrupt>((resolve) => {
          onAbort = (): void => {
            resolve(new Interrupt(new ForgeError({ code: "E_ABORTED", message: "aborted" })));
          };
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }),
      );
    }
    if (withDeadline) {
      waits.push(
        new Promise<Interrupt>((resolve) => {
          const ms = Math.min(MAX_TIMER, Math.max(0, this.deadline - performance.now()));
          timer = setTimeout(() => resolve(new Interrupt(this.timeError())), ms);
        }),
      );
    }
    try {
      const r = await Promise.race(waits);
      if (r instanceof Interrupt) throw r.error;
      return r;
    } finally {
      clearTimeout(timer);
      if (signal !== undefined && onAbort !== undefined) {
        signal.removeEventListener("abort", onAbort);
      }
    }
  }

  // ---- hooks and trace ------------------------------------------------------------------------

  private callHook(at: number, op: Instruction["op"], breakpoint: boolean) {
    const cur = this.cur;
    return (this.onStep as NonNullable<RunOptions["onStep"]>)({
      step: this.steps,
      word: cur.word.qname,
      ip: at,
      op,
      pos: cur.word.positions[at] as SourcePos,
      stack: this.ds,
      returnDepth: this.rs.length,
      breakpoint,
    });
  }

  /** Awaits a hook's promise. Abort still wins; the time spent paused is not charged to the deadline. */
  private async awaitHook(p: PromiseLike<void | "stop">): Promise<void | "stop"> {
    const t = performance.now();
    try {
      return await this.interruptible(p, false);
    } finally {
      this.deadline += performance.now() - t;
    }
  }

  private record(at: number, op: Instruction["op"]): void {
    const trace = this.trace as TraceEntry[];
    if (trace.length >= this.maxTrace) {
      this.truncated = true;
      return;
    }
    trace.push({
      step: this.steps,
      word: this.cur.word.qname,
      ip: at,
      op,
      depth: this.ds.length,
      stack: redactSnapshot(this.ds.slice(-16)),
    });
  }

  private addCoercion(rec: Omit<CoercionRecord, "step">): void {
    if (this.coercions.length >= this.maxTrace) {
      this.truncated = true;
      return;
    }
    this.coercions.push({ step: this.steps, ...rec });
  }

  // ---- metering and output --------------------------------------------------------------------

  private meter(v: Value): void {
    const size = sizeFast(v);
    if (size > this.maxValue) {
      throw limitError("E_LIMIT_VALUE", "value size", this.maxValue, size);
    }
    this.totalBytes += size;
    if (this.totalBytes > this.maxTotal) {
      throw limitError("E_LIMIT_TOTAL", "total allocation", this.maxTotal, this.totalBytes);
    }
  }

  private emit(text: string): void {
    const total = this.outputBytes + utf8Length(text);
    if (total > this.maxOut) {
      throw limitError("E_LIMIT_OUTPUT", "output", this.maxOut, total);
    }
    this.outputBytes = total;
    this.output += text;
  }

  private print(form: "value" | "stack"): void {
    const ds = this.ds;
    if (form === "value") {
      if (ds.length - this.floor < 1) this.underflow(1);
      this.emit(display(ds[ds.length - 1] as Value) + "\n");
      ds.pop();
      return;
    }
    let s = `<${ds.length}>`;
    for (const v of ds) s += " " + reprShort(v);
    this.emit(s + "\n");
  }

  // ---- stack words ----------------------------------------------------------------------------

  private stackWord(w: StackWord): void {
    const ds = this.ds;
    const len = ds.length;
    const avail = len - this.floor;
    switch (w) {
      case "dup":
        if (avail < 1) this.underflow(1);
        ds.push(ds[len - 1] as Value);
        break;
      case "drop":
        if (avail < 1) this.underflow(1);
        ds.pop();
        break;
      case "swap": {
        if (avail < 2) this.underflow(2);
        const a = ds[len - 2] as Value;
        ds[len - 2] = ds[len - 1] as Value;
        ds[len - 1] = a;
        break;
      }
      case "over":
        if (avail < 2) this.underflow(2);
        ds.push(ds[len - 2] as Value);
        break;
      case "rot": {
        if (avail < 3) this.underflow(3);
        const a = ds[len - 3] as Value;
        ds[len - 3] = ds[len - 2] as Value;
        ds[len - 2] = ds[len - 1] as Value;
        ds[len - 1] = a;
        break;
      }
      case "-rot": {
        if (avail < 3) this.underflow(3);
        const c = ds[len - 1] as Value;
        ds[len - 1] = ds[len - 2] as Value;
        ds[len - 2] = ds[len - 3] as Value;
        ds[len - 3] = c;
        break;
      }
      case "nip":
        if (avail < 2) this.underflow(2);
        ds[len - 2] = ds[len - 1] as Value;
        ds.pop();
        break;
      case "tuck": {
        if (avail < 2) this.underflow(2);
        const a = ds[len - 2] as Value;
        const b = ds[len - 1] as Value;
        ds[len - 2] = b;
        ds[len - 1] = a;
        ds.push(b);
        break;
      }
      case "dup2":
        if (avail < 2) this.underflow(2);
        ds.push(ds[len - 2] as Value, ds[len - 1] as Value);
        break;
      case "drop2":
        if (avail < 2) this.underflow(2);
        ds.length = len - 2;
        break;
      case "depth":
        ds.push({ tag: "int", v: avail });
        break;
      case "clear":
        ds.length = this.floor;
        break;
    }
    if (ds.length > this.maxData) this.dataLimit();
  }

  // ---- word entry and exit (spec 10.5) --------------------------------------------------------

  /** Coerces, validates and (for `key` slots) marks the inputs in place, deepest first. */
  private bindInputs(
    inputs: readonly StackSlot[],
    start: number,
    qname: string,
    vocab: string,
  ): void {
    const ds = this.ds;
    try {
      for (let i = 0; i < inputs.length; i++) {
        const slot = inputs[i] as StackSlot;
        let v = ds[start + i] as Value;
        if (slot.type !== "any") {
          const r = coerceTracked(v, slot.type, slot.name ?? i);
          if (r.coercion !== null) {
            this.addCoercion({
              word: qname,
              slot: i,
              name: slot.name,
              from: r.coercion.from,
              to: r.coercion.to,
            });
          }
          v = r.value;
        }
        if (slot.type === "key") v = markSecret(v);
        if (
          slot.constraint !== undefined ||
          slot.type === "choice" ||
          slot.type === "regex" ||
          slot.type === "charset"
        ) {
          validate(v, slot, this.limits, i);
        }
        ds[start + i] = v;
      }
    } catch (e) {
      const err = e as ForgeError;
      const tail = ds.slice(Math.max(0, ds.length - Math.max(inputs.length, 16)));
      throw err.with({
        word: qname,
        vocab,
        stackSnapshot: redactKeySlots(tail, inputs),
      });
    }
  }

  private doCall(entry: FlWordEntry): void {
    const word = entry.code;
    if (word === null) throw internalError(`word ${entry.qname} is not compiled`);
    const inputs = word.effect.inputs;
    const n = inputs.length;
    const ds = this.ds;
    const avail = ds.length - this.floor;
    if (avail < n) {
      throw new ForgeError({
        code: "E_STACK_UNDERFLOW",
        message: `stack underflow: ${entry.qname} needs ${n}, available ${avail}`,
        word: entry.qname,
        vocab: entry.vocab,
        detail: { needed: n, available: avail },
      });
    }
    const start = ds.length - n;
    if (n > 0) this.bindInputs(inputs, start, entry.qname, entry.vocab);
    if (this.rs.length >= this.maxRet) this.retLimit();

    let locals: readonly Value[] = EMPTY;
    if (word.nlocals > 0) {
      const made = new Array<Value>(word.nlocals);
      for (let j = 0; j < word.namedInputs.length; j++) {
        made[j] = ds[start + (word.namedInputs[j] as number)] as Value;
      }
      locals = made;
      const anon = word.anonInputs;
      const keep = anon.map((i) => ds[start + i] as Value);
      ds.length = start;
      for (const v of keep) ds.push(v);
    }
    const frame = new ActFrame(K_WORD, word, 0, locals, start, this.floor, this.cur, false);
    this.cur.ip = this.ip;
    this.floor = start;
    this.rs.push(frame);
    this.cur = frame;
    this.loadCur();
  }

  /**
   * `memo` (LANGUAGE-0.2.md section 9): pushes the cached value of a `MEMO:` word, or, on the first
   * use, calls its body in this run (same limits, steps and deadline) and caches the result at `ret`.
   */
  private doMemo(entry: FlWordEntry): void {
    const slot = entry.memo as MemoSlot;
    const hit = slot.value;
    if (hit !== undefined) {
      // The value exists already, so nothing is metered; but a value built under a larger limit
      // must not exceed this run's per-value limit.
      if (slot.bytes > this.maxValue) {
        throw limitError("E_LIMIT_VALUE", "value size", this.maxValue, slot.bytes);
      }
      this.ds.push(hit);
      if (this.ds.length > this.maxData) this.dataLimit();
      return;
    }
    this.doCall(entry);
    // The body cannot emit into the caller's collector: a hit would not repeat the emission.
    this.cur.memo = { entry, savedCollector: this.collFrame };
    this.collFrame = null;
  }

  /** The body of a memo word returned its checked result: cache it and leave the caller's collector. */
  private memoDone(f: ActFrame): void {
    const build = f.memo as MemoBuild;
    this.collFrame = build.savedCollector as LoopFrame | null;
    retainMemo(build.entry.memo as MemoSlot, this.ds[this.ds.length - 1] as Value);
  }

  /** `ret`. Returns true when the segment's own frame returned. */
  private doRet(): boolean {
    const f = this.cur;
    const rs = this.rs;
    const ds = this.ds;
    if (f.k === K_WORD) {
      const eff = f.word.effect;
      const outs = eff.outputs;
      const have = ds.length - f.base;
      if (!eff.unchecked && have !== outs.length) {
        throw new ForgeError({
          code: "E_EFFECT",
          message: `${f.word.qname} left ${have} values, its effect declares ${outs.length}`,
          detail: { expected: outs.length, actual: have },
        });
      }
      if (have >= outs.length) {
        for (let j = 0; j < outs.length; j++) {
          const slot = outs[j] as StackSlot;
          const v = ds[ds.length - outs.length + j] as Value;
          if (!tagMatches(slot.type, v.tag)) {
            throw typeError(slot.type, v.tag, { where: "output", param: slot.name ?? j });
          }
        }
      }
      if (f.memo !== null) this.memoDone(f);
    }
    if (rs[rs.length - 1] !== f) throw internalError("return stack out of balance");
    rs.pop();
    if (f.k === K_WORD) this.floor = f.savedFloor;
    if (f.caller === null) return true;
    this.cur = f.caller;
    this.loadCur();
    if (f.driven) {
      const top = rs[rs.length - 1] as Frame;
      if (top.k === K_LOOP) {
        this.advance(top, true);
      } else {
        // The body (or the handler) of a try finished.
        rs.pop();
        this.floor = (top as TryFrame).savedFloor;
      }
    }
    return false;
  }

  // ---- primitives -----------------------------------------------------------------------------

  private primCall(entry: PrimitiveWordEntry): Value[] | Promise<Value[]> {
    const def = entry.def;
    const effs = def.effects;
    if (effs !== undefined && this.deny !== null) {
      for (const label of effs) {
        if (this.deny.has(label)) {
          throw new ForgeError({
            code: "E_FORBIDDEN",
            message: `${entry.qname} has the denied effect ${label}`,
            word: entry.qname,
            vocab: entry.vocab,
            detail: { effect: label },
          });
        }
      }
    }
    const inputs = entry.effect.inputs;
    const n = inputs.length;
    const ds = this.ds;
    const avail = ds.length - this.floor;
    if (avail < n) {
      throw new ForgeError({
        code: "E_STACK_UNDERFLOW",
        message: `stack underflow: ${entry.qname} needs ${n}, available ${avail}`,
        word: entry.qname,
        vocab: entry.vocab,
        detail: { needed: n, available: avail },
      });
    }
    const start = ds.length - n;
    if (n > 0) this.bindInputs(inputs, start, entry.qname, entry.vocab);
    if (effs !== undefined) for (const label of effs) this.effects.add(label);
    return callPrimitive(def, n === 0 ? NO_ARGS : ds.slice(start), this.pctx);
  }

  private primFinish(entry: PrimitiveWordEntry, results: readonly Value[]): void {
    const ds = this.ds;
    for (const v of results) this.meter(v);
    ds.length -= entry.effect.inputs.length;
    for (const v of results) ds.push(v);
    if (ds.length > this.maxData) this.dataLimit();
  }

  // ---- quotations and combinators -------------------------------------------------------------

  /** The quotation `k` places below the top, without popping (operands are validated first). */
  private peekQuot(k: number): Quotation {
    const v = this.ds[this.ds.length - 1 - k] as Value;
    if (v.tag !== "quot") throw typeError("quot", v.tag);
    return v.v;
  }

  /** The `bool` `k` places below the top, without popping. */
  private peekBool(k: number): boolean {
    const v = this.ds[this.ds.length - 1 - k] as Value;
    if (v.tag !== "bool") throw typeError("bool", v.tag, { where: "condition" });
    return v.v;
  }

  private pushMark(f: MarkFrame): void {
    if (this.rs.length >= this.maxRet) this.retLimit();
    this.rs.push(f);
  }

  /** Pushes an activation of `q`. The caller's ip must already be saved. */
  private pushQuot(q: Quotation, caller: ActFrame, driven: boolean): void {
    if (this.rs.length >= this.maxRet) this.retLimit();
    // A quotation that binds a local runs on a copy of its environment (LANGUAGE-0.2.md section 8).
    const env = q.own === true ? q.env.slice() : q.env;
    const f = new ActFrame(K_QUOT, q.code, q.start, env, 0, 0, caller, driven);
    this.rs.push(f);
    this.cur = f;
    this.loadCur();
  }

  private listClose(): void {
    const ds = this.ds;
    const m = this.rs.pop();
    if (m === undefined || m.k !== K_LIST) throw internalError("listClose without listOpen");
    if (ds.length < m.depth) {
      throw new ForgeError({
        code: "E_STACK_UNDERFLOW",
        message: "stack underflow inside a list literal",
        detail: { needed: m.depth - this.floor, available: ds.length - this.floor },
      });
    }
    const v: Value = { tag: "list", v: ds.splice(m.depth) };
    this.meter(v);
    ds.push(v);
    if (ds.length > this.maxData) this.dataLimit();
  }

  private comb(name: CombinatorName): void {
    const ds = this.ds;
    const cur = this.cur;
    const avail = ds.length - this.floor;
    switch (name) {
      case "if": {
        if (avail < 3) this.underflow(3);
        const no = this.peekQuot(0);
        const yes = this.peekQuot(1);
        const b = this.peekBool(2);
        ds.length -= 3;
        this.pushQuot(b ? yes : no, cur, false);
        return;
      }
      case "when":
      case "unless": {
        if (avail < 2) this.underflow(2);
        const q = this.peekQuot(0);
        const b = this.peekBool(1);
        ds.length -= 2;
        if (b === (name === "when")) this.pushQuot(q, cur, false);
        return;
      }
      case "times": {
        if (avail < 2) this.underflow(2);
        const q = this.peekQuot(0);
        const nv = ds[ds.length - 2] as Value;
        if (nv.tag !== "int") throw typeError("int", nv.tag);
        const count = typeof nv.v === "bigint" ? (nv.v < 0n ? -1 : Infinity) : nv.v;
        if (count < 0) {
          throw new ForgeError({ code: "E_RANGE", message: "negative count for times" });
        }
        ds.length -= 2;
        const lf = new LoopFrame("times", cur, q);
        lf.n = count;
        this.startLoop(lf);
        return;
      }
      case "each":
      case "map":
      case "mapi":
      case "filter": {
        if (avail < 2) this.underflow(2);
        const lf = new LoopFrame(name, cur, this.peekQuot(0));
        this.takeSeq(lf, 1);
        ds.length -= 2;
        this.startLoop(lf);
        return;
      }
      case "reduce": {
        if (avail < 3) this.underflow(3);
        const lf = new LoopFrame("reduce", cur, this.peekQuot(0));
        this.takeSeq(lf, 2);
        lf.acc = ds[ds.length - 2] as Value;
        ds.length -= 3;
        this.startLoop(lf);
        return;
      }
      case "while": {
        if (avail < 2) this.underflow(2);
        const body = this.peekQuot(0);
        const lf = new LoopFrame("while", cur, this.peekQuot(1));
        lf.q2 = body;
        ds.length -= 2;
        this.startLoop(lf);
        return;
      }
      case "loop": {
        if (avail < 1) this.underflow(1);
        const lf = new LoopFrame("loop", cur, this.peekQuot(0));
        ds.length -= 1;
        this.startLoop(lf);
        return;
      }
      case "try": {
        if (avail < 2) this.underflow(2);
        const handler = this.peekQuot(0);
        const body = this.peekQuot(1);
        if (this.rs.length + 2 > this.maxRet) this.retLimit();
        ds.length -= 2;
        const tf = new TryFrame(cur, handler, ds.length, this.floor);
        this.rs.push(tf);
        this.floor = tf.depth;
        this.pushQuot(body, cur, true);
        return;
      }
      case "cond": {
        if (avail < 1) this.underflow(1);
        const lf = new LoopFrame("cond", cur, EMPTY_QUOT);
        lf.list = checkCondList(ds[ds.length - 1] as Value);
        lf.n = lf.list.length;
        ds.length -= 1;
        this.startLoop(lf);
        return;
      }
      case "case": {
        if (avail < 2) this.underflow(2);
        const items = checkCaseList(ds[ds.length - 1] as Value);
        const key = ds[ds.length - 2] as Value;
        const pairs = items.length >> 1;
        let action: Value | undefined;
        for (let i = 0; i < pairs; i++) {
          this.chargeStep();
          if (equals(key, items[2 * i] as Value)) {
            action = items[2 * i + 1];
            break;
          }
        }
        if (action === undefined && items.length % 2 === 1) action = items[items.length - 1];
        if (action === undefined) {
          throw new ForgeError({
            code: "E_RANGE",
            message: "case: no value matches and there is no default",
          });
        }
        ds.length -= 2;
        this.pushQuot((action as Value & { tag: "quot" }).v, cur, false);
        return;
      }
      case "sort-by": {
        if (avail < 2) this.underflow(2);
        const lf = new LoopFrame("sort-by", cur, this.peekQuot(0));
        const l = ds[ds.length - 2] as Value;
        if (l.tag !== "list") throw typeError("list", l.tag);
        lf.list = l.v;
        lf.n = l.v.length;
        ds.length -= 2;
        this.startLoop(lf);
        return;
      }
      case "find":
      case "any?":
      case "all?": {
        if (avail < 2) this.underflow(2);
        const lf = new LoopFrame(name, cur, this.peekQuot(0));
        this.takeSeq(lf, 1);
        ds.length -= 2;
        this.startLoop(lf);
        return;
      }
      case "collect":
      case "collect-bytes":
      case "collect-str": {
        if (avail < 1) this.underflow(1);
        const lf = new LoopFrame(name, cur, this.peekQuot(0));
        lf.coll = new Collector(name, this.maxValue);
        ds.length -= 1;
        this.startLoop(lf);
        return;
      }
      case "fork": {
        if (avail < 4) this.underflow(4);
        const lf = new LoopFrame("fork", cur, this.peekQuot(0));
        this.takeFork(lf);
        ds.length -= 4;
        this.startLoop(lf);
        return;
      }
    }
  }

  /** Reads the sequence operand `k` places below the top into the loop frame (it is popped by the caller). */
  private takeSeq(lf: LoopFrame, k: number): void {
    const s = this.ds[this.ds.length - 1 - k] as Value;
    switch (s.tag) {
      case "list":
        lf.list = s.v;
        lf.n = s.v.length;
        break;
      case "bytes":
        lf.bytes = s.v;
        lf.n = s.v.length;
        break;
      case "str":
        lf.cps = codePoints(s.v);
        lf.n = lf.cps.length;
        break;
      default:
        throw typeError("list, bytes or str", s.tag);
    }
  }

  /** Reads and coerces the `data sep join` operands of `fork` (below the quotation) and splits the data. */
  private takeFork(lf: LoopFrame): void {
    const ds = this.ds;
    const data = ds[ds.length - 4] as Value;
    if (data.tag !== "str" && data.tag !== "bytes") {
      throw typeError("str or bytes", data.tag, { param: "data" });
    }
    const as = (v: Value, param: string): string | Uint8Array => {
      if (v.tag !== "str" && v.tag !== "bytes") {
        throw typeError("str or bytes", v.tag, { param });
      }
      return coerceTracked(v, data.tag, param).value.v as string | Uint8Array;
    };
    const s = as(ds[ds.length - 3] as Value, "sep");
    const j = as(ds[ds.length - 2] as Value, "join");
    if (s.length === 0) {
      throw new ForgeError({ code: "E_RANGE", message: "fork separator must not be empty" });
    }
    lf.forkJoin = j;
    if (data.tag === "str") {
      lf.forkStr = true;
      lf.pieces = (data.v as string).split(s as string);
    } else {
      lf.pieces = splitBytes(data.v as Uint8Array, s as Uint8Array);
    }
    lf.n = lf.pieces.length;
  }

  private startLoop(lf: LoopFrame): void {
    if (this.rs.length >= this.maxRet) this.retLimit();
    this.rs.push(lf);
    this.advance(lf, false);
  }

  private checkDelta(d: number, delta: number): void {
    const actual = this.ds.length - d;
    if (actual !== delta) {
      throw new ForgeError({
        code: "E_EFFECT",
        message: `loop body left ${actual} values, expected ${delta}`,
        detail: { expected: delta, actual },
      });
    }
  }

  /** Pops a bool left by a loop condition or body (the depth was already checked). */
  private popBool(): boolean {
    const ds = this.ds;
    const b = ds[ds.length - 1] as Value;
    if (b.tag !== "bool") throw typeError("bool", b.tag, { where: "condition" });
    ds.pop();
    return b.v;
  }

  private elem(lf: LoopFrame, i: number): Value {
    if (lf.list !== null) return lf.list[i] as Value;
    if (lf.bytes !== null) return { tag: "int", v: lf.bytes[i] as number };
    return { tag: "int", v: (lf.cps as number[])[i] as number };
  }

  /** Starts the next iteration's quotation (one extra step). */
  private iterate(lf: LoopFrame, q: Quotation = lf.q): void {
    this.chargeStep();
    this.pushQuot(q, lf.owner, true);
  }

  private endLoop(lf: LoopFrame, result: Value | null): void {
    this.rs.pop();
    // The operands popped by the combinator leave room for its result.
    if (result !== null) this.ds.push(result);
  }

  /** The element result of a `map`/`mapi` body, stored according to the sequence kind. */
  private collectMap(lf: LoopFrame): void {
    const ds = this.ds;
    const v = ds[ds.length - 1] as Value;
    if (lf.list !== null) {
      lf.outList.push(v);
    } else {
      if (v.tag !== "int") throw typeError("int", v.tag, { where: "map result" });
      const n = v.v;
      const ok =
        typeof n === "number" && (lf.bytes !== null ? n >= 0 && n <= 255 : isValidCodePoint(n));
      if (!ok) {
        throw new ForgeError({
          code: "E_RANGE",
          message:
            lf.bytes !== null
              ? `map result ${String(n)} is not a byte`
              : `map result ${String(n)} is not a code point`,
        });
      }
      lf.outNums.push(n);
    }
    ds.pop();
  }

  private buildSeq(lf: LoopFrame): Value {
    let v: Value;
    if (lf.list !== null) v = { tag: "list", v: lf.outList };
    else if (lf.bytes !== null) v = { tag: "bytes", v: Uint8Array.from(lf.outNums) };
    else v = { tag: "str", v: fromCodePoints(lf.outNums) };
    this.meter(v);
    return v;
  }

  /**
   * Runs one state-machine step of a combinator: `returned` is true when the iteration's
   * quotation has just returned. Either starts the next iteration (pushing a driven quotation
   * frame) or finishes the combinator (popping its frame).
   */
  private advance(lf: LoopFrame, returned: boolean): void {
    const ds = this.ds;
    switch (lf.comb) {
      case "times":
        if (returned) this.checkDelta(lf.d, 0);
        if (lf.i >= lf.n) return this.endLoop(lf, null);
        lf.i++;
        lf.d = ds.length;
        return this.iterate(lf);
      case "each":
        if (returned) this.checkDelta(lf.d, 0);
        if (lf.i >= lf.n) return this.endLoop(lf, null);
        lf.d = ds.length;
        ds.push(this.elem(lf, lf.i++));
        return this.iterate(lf);
      case "map":
      case "mapi":
        if (returned) {
          this.checkDelta(lf.d, 1);
          this.collectMap(lf);
        }
        if (lf.i >= lf.n) return this.endLoop(lf, this.buildSeq(lf));
        lf.d = ds.length;
        ds.push(this.elem(lf, lf.i));
        if (lf.comb === "mapi") ds.push({ tag: "int", v: lf.i });
        lf.i++;
        return this.iterate(lf);
      case "filter":
        if (returned) {
          this.checkDelta(lf.d, 1);
          if (this.popBool()) {
            const at = lf.i - 1;
            if (lf.list !== null) lf.outList.push(lf.list[at] as Value);
            else
              lf.outNums.push(
                (lf.bytes !== null ? lf.bytes[at] : (lf.cps as number[])[at]) as number,
              );
          }
        }
        if (lf.i >= lf.n) return this.endLoop(lf, this.buildSeq(lf));
        lf.d = ds.length;
        ds.push(this.elem(lf, lf.i++));
        return this.iterate(lf);
      case "reduce":
        if (returned) {
          this.checkDelta(lf.d, 1);
          lf.acc = ds.pop() as Value;
        }
        if (lf.i >= lf.n) return this.endLoop(lf, lf.acc);
        lf.d = ds.length;
        ds.push(lf.acc as Value, this.elem(lf, lf.i++));
        return this.iterate(lf);
      case "while":
        if (returned) {
          if (lf.phase === 1) {
            this.checkDelta(lf.d, 1);
            if (!this.popBool()) return this.endLoop(lf, null);
            lf.phase = 2;
            lf.d = ds.length;
            return this.pushQuot(lf.q2 as Quotation, lf.owner, true);
          }
          this.checkDelta(lf.d, 0);
        }
        lf.phase = 1;
        lf.d = ds.length;
        return this.iterate(lf);
      case "loop":
        if (returned) {
          this.checkDelta(lf.d, 1);
          if (!this.popBool()) return this.endLoop(lf, null);
        }
        lf.d = ds.length;
        return this.iterate(lf);
      case "cond": {
        const items = lf.list as readonly Value[];
        if (returned) {
          this.checkDelta(lf.d, 1);
          if (this.popBool()) {
            const action = items[lf.i + 1] as Value & { tag: "quot" };
            this.rs.pop();
            return this.pushQuot(action.v, lf.owner, false);
          }
          lf.i += 2;
        }
        if (lf.i >= lf.n) {
          throw new ForgeError({
            code: "E_RANGE",
            message: "cond: no test is true and there is no default",
          });
        }
        if (lf.i === lf.n - 1) {
          this.rs.pop();
          return this.pushQuot((items[lf.i] as Value & { tag: "quot" }).v, lf.owner, false);
        }
        lf.d = ds.length;
        return this.iterate(lf, (items[lf.i] as Value & { tag: "quot" }).v);
      }
      case "sort-by":
        if (returned) {
          this.checkDelta(lf.d, 1);
          lf.outList.push(ds.pop() as Value);
        }
        if (lf.i >= lf.n) {
          const v: Value = { tag: "list", v: sortByKeys(lf.list as readonly Value[], lf.outList) };
          this.meter(v);
          return this.endLoop(lf, v);
        }
        lf.d = ds.length;
        ds.push(this.elem(lf, lf.i++));
        return this.iterate(lf);
      case "find":
      case "any?":
      case "all?":
        if (returned) {
          this.checkDelta(lf.d, 1);
          const hit = this.popBool();
          if (lf.comb === "all?" ? !hit : hit) {
            if (lf.comb === "find") return this.endLoop(lf, { tag: "int", v: lf.i - 1 });
            return this.endLoop(lf, { tag: "bool", v: lf.comb === "any?" });
          }
        }
        if (lf.i >= lf.n) {
          if (lf.comb === "find") return this.endLoop(lf, { tag: "int", v: -1 });
          return this.endLoop(lf, { tag: "bool", v: lf.comb === "all?" });
        }
        lf.d = ds.length;
        ds.push(this.elem(lf, lf.i++));
        return this.iterate(lf);
      case "collect":
      case "collect-bytes":
      case "collect-str":
        if (returned) {
          this.checkDelta(lf.d, 0);
          this.collFrame = lf.prevColl;
          const v = (lf.coll as Collector).finish();
          this.meter(v);
          return this.endLoop(lf, v);
        }
        lf.prevColl = this.collFrame;
        this.collFrame = lf;
        lf.d = ds.length;
        return this.iterate(lf);
      case "fork":
        if (returned) {
          this.checkDelta(lf.d, 1);
          const top = ds[ds.length - 1] as Value;
          const r = coerceTracked(top, lf.forkStr ? "str" : "bytes", "fork result").value;
          lf.forkOut.push(r.v as string | Uint8Array);
          ds.pop();
        }
        if (lf.i >= lf.n) return this.endLoop(lf, this.buildFork(lf));
        lf.d = ds.length;
        {
          const p = lf.pieces[lf.i++] as string | Uint8Array;
          ds.push(
            lf.forkStr ? { tag: "str", v: p as string } : { tag: "bytes", v: p as Uint8Array },
          );
        }
        return this.iterate(lf);
    }
  }

  private buildFork(lf: LoopFrame): Value {
    const v: Value = lf.forkStr
      ? { tag: "str", v: (lf.forkOut as string[]).join(lf.forkJoin as string) }
      : { tag: "bytes", v: joinBytes(lf.forkOut as Uint8Array[], lf.forkJoin as Uint8Array) };
    this.meter(v);
    return v;
  }
}

/** Runs console segments in order on one data stack and returns the `RunResult` (spec 10). */
export const runVm: VmRunFn = (segments, opts = {}) => new Machine(opts).run(segments);
