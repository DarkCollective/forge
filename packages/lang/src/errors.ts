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
 * ForgeError (spec section 11), the catchability rule of `try` (section 8), and secret redaction
 * (section 10.14).
 *
 * errors.ts and values.ts import each other (ForgeError needs the repr for `toJSON`; values raise
 * ForgeErrors). Both only use the other module's exports from inside functions, never while the
 * module is being evaluated, so the cycle is harmless.
 */

import type {
  ErrorCode,
  ErrorFrame,
  ForgeErrorInit,
  ForgeErrorShape,
  ParamType,
  SourcePos,
  Value,
} from "./types.js";
import { reprShort } from "./values.js";

/** The text diagnostics show instead of a secret value (spec 10.14). */
export const REDACTED = "<redacted>";

/** How many stack values and frames an error keeps (spec 11). */
export const MAX_SNAPSHOT = 16;

// Declared as a Record so that the compiler proves the list is exactly the `ErrorCode` union.
const CODE_TABLE: Record<ErrorCode, true> = {
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

/** All 34 error codes. */
export const ERROR_CODES: readonly ErrorCode[] = Object.freeze(
  Object.keys(CODE_TABLE) as ErrorCode[],
);

/**
 * True when a `try` can catch an error with this code: every code except `E_ABORTED`, every
 * `E_LIMIT_*`, `E_INTERNAL` and `E_FORBIDDEN` (spec 8, decision D19).
 */
export function isCatchable(code: ErrorCode): boolean {
  return !(
    code === "E_ABORTED" ||
    code === "E_INTERNAL" ||
    code === "E_FORBIDDEN" ||
    code.startsWith("E_LIMIT_")
  );
}

/** `code: message at line:col in word`; the position and word parts are omitted when null. */
export function formatErrorMessage(e: {
  readonly code: ErrorCode;
  readonly message: string;
  readonly pos?: SourcePos | null;
  readonly word?: string | null;
}): string {
  let s = `${e.code}: ${e.message}`;
  if (e.pos) s += ` at ${e.pos.line}:${e.pos.col}`;
  if (e.word) s += ` in ${e.word}`;
  return s;
}

// ---------------------------------------------------------------------------------------------
// Redaction (spec 10.14)
// ---------------------------------------------------------------------------------------------

const REDACTED_VALUE: Value = Object.freeze({ tag: "str", v: REDACTED });

const TAGS: ReadonlySet<string> = new Set([
  "bytes",
  "str",
  "int",
  "num",
  "bool",
  "list",
  "quot",
  "record",
  "file",
]);

function isValueLike(x: unknown): x is Value {
  if (typeof x !== "object" || x === null || !("v" in x)) return false;
  const tag = (x as { tag?: unknown }).tag;
  return typeof tag === "string" && TAGS.has(tag);
}

/** Does the value, or anything inside it, carry the secret mark? Iterative. */
function containsSecret(value: Value): boolean {
  const work: Value[] = [value];
  while (work.length > 0) {
    const x = work.pop() as Value;
    if (x.tag === "bytes") {
      if (x.secret === true) return true;
    } else if (x.tag === "list") {
      for (const item of x.v) work.push(item);
    } else if (x.tag === "record") {
      for (const item of x.v.values()) work.push(item);
    }
  }
  return false;
}

const MAX_REBUILD_DEPTH = 256;

function rebuild(value: Value, depth: number): Value {
  if (value.tag === "bytes") return value.secret === true ? REDACTED_VALUE : value;
  if (value.tag !== "list" && value.tag !== "record") return value;
  if (!containsSecret(value)) return value;
  // Pathologically deep nesting that also holds a secret: drop the whole subtree.
  if (depth >= MAX_REBUILD_DEPTH) return REDACTED_VALUE;
  if (value.tag === "list") {
    return { tag: "list", v: value.v.map((x) => rebuild(x, depth + 1)) };
  }
  const m = new Map<string, Value>();
  for (const [k, v] of value.v) m.set(k, rebuild(v, depth + 1));
  return { tag: "record", v: m };
}

/**
 * A copy of `value` safe for diagnostics: a secret `bytes` (also inside lists and records)
 * becomes the `str` `<redacted>`. Values without secrets are returned unchanged (same object).
 */
export function redactValue(value: Value): Value {
  return rebuild(value, 0);
}

/** The top (at most 16) values, bottom to top, redacted. */
export function redactSnapshot(values: readonly Value[]): Value[] {
  return values.slice(-MAX_SNAPSHOT).map(redactValue);
}

/**
 * Entry-failure redaction: `stack` holds the data stack with the word's inputs on top (deepest
 * input first); every value destined for a `key` slot is replaced by the `str` `<redacted>`,
 * whether or not it carries the secret mark. Inputs beyond the stack's depth are ignored.
 */
export function redactKeySlots(
  stack: readonly Value[],
  inputs: readonly { readonly type: ParamType }[],
): Value[] {
  const out = stack.slice();
  const base = out.length - inputs.length;
  inputs.forEach((slot, i) => {
    if (slot.type === "key" && base + i >= 0) out[base + i] = REDACTED_VALUE;
  });
  return out;
}

function redactAny(x: unknown): unknown {
  if (isValueLike(x)) return redactValue(x);
  if (Array.isArray(x)) return x.map(redactAny);
  return x;
}

/** A copy of an error `detail` in which any secret value (or array of values) is redacted. */
export function redactDetail(detail: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) out[k] = redactAny(v);
  return out;
}

// ---------------------------------------------------------------------------------------------
// ForgeError
// ---------------------------------------------------------------------------------------------

function jsonable(x: unknown): unknown {
  if (isValueLike(x)) return reprShort(x);
  if (typeof x === "bigint") return x.toString();
  if (Array.isArray(x)) return x.map(jsonable);
  return x;
}

export class ForgeError extends Error implements ForgeErrorShape {
  override readonly name = "ForgeError" as const;
  readonly code: ErrorCode;
  readonly word: string | null;
  readonly vocab: string | null;
  readonly step: number | null;
  readonly ip: number | null;
  readonly pos: SourcePos | null;
  readonly stackSnapshot: readonly Value[];
  readonly frames: readonly ErrorFrame[];
  readonly detail: Readonly<Record<string, unknown>>;

  /**
   * Missing fields default as in types.ts. `stackSnapshot` keeps only the top 16 values and
   * `frames` the first 16; secret values in the snapshot and detail are redacted here, so no
   * ForgeError ever holds one.
   */
  constructor(init: ForgeErrorInit) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.code = init.code;
    this.word = init.word ?? null;
    this.vocab = init.vocab ?? null;
    this.step = init.step ?? null;
    this.ip = init.ip ?? null;
    this.pos = init.pos ?? null;
    this.stackSnapshot = redactSnapshot(init.stackSnapshot ?? []);
    this.frames = (init.frames ?? []).slice(0, MAX_SNAPSHOT);
    this.detail = redactDetail(init.detail ?? {});
  }

  /** A new error equal to this one except for the given fields (to add run context). */
  with(patch: Partial<ForgeErrorInit>): ForgeError {
    return new ForgeError({
      code: this.code,
      message: this.message,
      word: this.word,
      vocab: this.vocab,
      step: this.step,
      ip: this.ip,
      pos: this.pos,
      stackSnapshot: this.stackSnapshot,
      frames: this.frames,
      detail: this.detail,
      ...(this.cause !== undefined ? { cause: this.cause } : {}),
      ...patch,
    });
  }

  /** `code: message at line:col in word`. */
  override toString(): string {
    return formatErrorMessage(this);
  }

  /** All fields; values are replaced by their `.s` reprs (cut to 80 code points). */
  toJSON(): Record<string, unknown> {
    const json: Record<string, unknown> = {
      name: this.name,
      code: this.code,
      message: this.message,
      word: this.word,
      vocab: this.vocab,
      step: this.step,
      ip: this.ip,
      pos: this.pos,
      stackSnapshot: this.stackSnapshot.map((v) => reprShort(v)),
      frames: this.frames.map((f) => ({ word: f.word, ip: f.ip })),
      detail: Object.fromEntries(Object.entries(this.detail).map(([k, v]) => [k, jsonable(v)])),
    };
    if (this.cause !== undefined) {
      json.cause = this.cause instanceof Error ? this.cause.message : String(this.cause);
    }
    return json;
  }
}

/** True for a ForgeError, including one from another realm (matched by name and code). */
export function isForgeError(x: unknown): x is ForgeErrorShape {
  if (x instanceof ForgeError) return true;
  return (
    x instanceof Error &&
    x.name === "ForgeError" &&
    typeof (x as unknown as { code?: unknown }).code === "string" &&
    Object.hasOwn(CODE_TABLE, (x as unknown as { code: string }).code)
  );
}

/** Can `try` catch this error? Non-ForgeErrors are never catchable here (the VM wraps them first). */
export function isCatchableError(x: unknown): boolean {
  return isForgeError(x) && isCatchable(x.code);
}
