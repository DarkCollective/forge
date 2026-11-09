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
 * The reference validator (RECIPES.md section 3.7). Hand-written: the production CSP forbids `new Function`,
 * so a schema compiler cannot run in the page. `recipe.schema.json` is its executable specification and the
 * tests check that both agree on every structural question.
 *
 * Untrusted input is walked iteratively first (`prewalk`), so the recursion here is bounded by `maxDepth`.
 * Only own data properties are read; accessors are reported, never invoked.
 */
import type { Constraint, ParamSpec } from "@forge/lang";
import { hexDecode, tryDecodeEncoded } from "./encoding.js";
import { MAX_ISSUES, clip, codePointLength, echo, hasLoneSurrogate, prewalk } from "./limits.js";
import { opIndex } from "./opindex.js";
import type { OpIndex } from "./opindex.js";
import { childPointer } from "./pointer.js";
import { RECIPE_LIMITS, STEP_KINDS } from "./types.js";
import type {
  CatalogueView,
  IssueSeverity,
  PinPolicy,
  Recipe,
  RecipeIssue,
  RecipeIssueCode,
  ValidateOptions,
  ValidationResult,
} from "./types.js";

const QNAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}:[^\s:]{1,128}$/u;
const MAX_QNAME_CHARS = 193;
const PARAM_NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const CATALOGUE_ID_RE = /^[0-9a-f]{16}$/;
const FLAGS_RE = /^[ims]*$/;
const CANONICAL_INT_RE = /^-?(0|[1-9][0-9]*)$/;
const ENCODINGS: readonly string[] = ["utf8", "hex", "latin1", "base64"];
const SECTION_ENCODINGS: readonly string[] = ["utf8", "latin1"];

const ROOT_FIELDS = new Set(["forge", "name", "description", "catalogue", "steps"]);
const COMMON = ["disabled", "breakpoint", "note"] as const;
const OP_FIELDS = new Set(["kind", "op", "params", "hash", ...COMMON]);
const FORK_FIELDS = new Set(["kind", "split", "join", "steps", ...COMMON]);
const SUBSECTION_FIELDS = new Set(["kind", "pattern", "flags", "encoding", "steps", ...COMMON]);
const IF_FIELDS = new Set(["kind", "test", "then", "else", ...COMMON]);
const REPEAT_FIELDS = new Set(["kind", "times", "until", "max", "steps", ...COMMON]);
const COMMENT_FIELDS = new Set(["kind", "text"]);
const REGEX_TEST_FIELDS = new Set(["kind", "pattern", "flags", "encoding"]);
const OP_TEST_FIELDS = new Set(["kind", "op", "params", "hash"]);
const ENCODED_FIELDS = new Set(["value", "enc"]);

interface Ctx {
  readonly issues: RecipeIssue[];
  errors: number;
  /** Set when the walk must stop: the issue cap or the step cap was hit. */
  done: boolean;
  steps: number;
  readonly catalogue: CatalogueView | undefined;
  readonly index: OpIndex | undefined;
  readonly pins: PinPolicy;
}

function add(
  ctx: Ctx,
  code: RecipeIssueCode,
  severity: IssueSeverity,
  path: string,
  message: string,
  detail?: Record<string, unknown>,
): void {
  if (ctx.done) return;
  if (ctx.issues.length >= MAX_ISSUES) {
    ctx.issues.push({
      code: "limit",
      severity: "error",
      path,
      message: `more than ${MAX_ISSUES} issues; the rest are not reported`,
      detail: { limit: "maxIssues", max: MAX_ISSUES },
    });
    ctx.errors++;
    ctx.done = true;
    return;
  }
  ctx.issues.push(
    detail === undefined
      ? { code, severity, path, message }
      : { code, severity, path, message, detail },
  );
  if (severity === "error") ctx.errors++;
}

function err(
  ctx: Ctx,
  code: RecipeIssueCode,
  path: string,
  message: string,
  detail?: Record<string, unknown>,
): void {
  add(ctx, code, "error", path, message, detail);
}

function typeIssue(ctx: Ctx, path: string, expected: string): void {
  err(ctx, "type", path, `expected ${expected}`, { expected });
}

function badValue(ctx: Ctx, path: string, constraint: string, message: string): void {
  err(ctx, "bad-value", path, message, { constraint });
}

// ---------------------------------------------------------------------------------------------
// Reading values without running user code
// ---------------------------------------------------------------------------------------------

function isPlainObject(v: unknown): v is object {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

/** The own data properties of an object, as a `Map` (so `__proto__` is just a key). Null, with an issue, if not an object. */
function fieldsOf(ctx: Ctx, value: unknown, path: string): Map<string, unknown> | null {
  if (!isPlainObject(value)) {
    typeIssue(ctx, path, "an object");
    return null;
  }
  const fields = new Map<string, unknown>();
  for (const key of Object.keys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (d === undefined || !("value" in d)) {
      typeIssue(ctx, childPointer(path, key), "a data property");
    } else {
      fields.set(key, d.value);
    }
  }
  return fields;
}

/** Stands for an array element that could not be read (already reported). */
const UNREADABLE: unique symbol = Symbol("unreadable");

/** The elements of an array, read as data properties. Null, with an issue, if not an array. */
function elementsOf(ctx: Ctx, value: unknown, path: string): unknown[] | null {
  if (!Array.isArray(value)) {
    typeIssue(ctx, path, "an array");
    return null;
  }
  const out: unknown[] = [];
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, i);
    if (d === undefined || !("value" in d)) {
      typeIssue(ctx, childPointer(path, i), "a data property");
      out.push(UNREADABLE);
    } else {
      out.push(d.value);
    }
  }
  return out;
}

/** `unknown-field` for every key not in `allowed`, `required` for every missing name in `required`. */
function checkFields(
  ctx: Ctx,
  fields: Map<string, unknown>,
  path: string,
  allowed: ReadonlySet<string>,
  required: readonly string[],
): void {
  for (const key of fields.keys()) {
    if (!allowed.has(key)) {
      err(ctx, "unknown-field", childPointer(path, key), `unknown field '${clip(key, 40)}'`, {
        field: clip(key, 40),
      });
    }
  }
  for (const name of required) {
    if (!fields.has(name)) {
      err(ctx, "required", childPointer(path, name), `missing required field '${name}'`, {
        field: name,
      });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Structural checks of single values
// ---------------------------------------------------------------------------------------------

/** A string of at most `max` code points without lone surrogates. */
function checkString(ctx: Ctx, v: unknown, path: string, max?: number): v is string {
  if (typeof v !== "string") {
    typeIssue(ctx, path, "a string");
    return false;
  }
  if (hasLoneSurrogate(v)) {
    badValue(ctx, path, "well-formed UTF-16", "the string contains a lone surrogate");
    return false;
  }
  if (max !== undefined && codePointLength(v) > max) {
    badValue(ctx, path, `maxLength ${max}`, `the string is longer than ${max} characters`);
    return false;
  }
  return true;
}

function checkBoolean(ctx: Ctx, v: unknown, path: string): void {
  if (typeof v !== "boolean") typeIssue(ctx, path, "a boolean");
}

function checkCommon(ctx: Ctx, fields: Map<string, unknown>, path: string): void {
  if (fields.has("disabled")) checkBoolean(ctx, fields.get("disabled"), `${path}/disabled`);
  if (fields.has("breakpoint")) checkBoolean(ctx, fields.get("breakpoint"), `${path}/breakpoint`);
  if (fields.has("note")) {
    checkString(ctx, fields.get("note"), `${path}/note`, RECIPE_LIMITS.maxNoteChars);
  }
}

function checkMatches(
  ctx: Ctx,
  v: unknown,
  path: string,
  re: RegExp,
  constraint: string,
  max: number,
): void {
  if (!checkString(ctx, v, path)) return;
  if (codePointLength(v) > max || !re.test(v)) {
    badValue(ctx, path, constraint, `the value does not match ${constraint}`);
  }
}

function checkQname(ctx: Ctx, v: unknown, path: string): boolean {
  const before = ctx.errors;
  checkMatches(ctx, v, path, QNAME_RE, "pattern vocab:word", MAX_QNAME_CHARS);
  return ctx.errors === before;
}

function checkEnum(ctx: Ctx, v: unknown, path: string, options: readonly string[]): v is string {
  if (typeof v !== "string") {
    typeIssue(ctx, path, "a string");
    return false;
  }
  if (!options.includes(v)) {
    badValue(ctx, path, `enum ${options.join("|")}`, `not one of ${options.join(", ")}`);
    return false;
  }
  return true;
}

/** A regex source: at most 1024 code points and it must compile (`bad-regex`). */
function checkRegexSource(ctx: Ctx, v: unknown, path: string): boolean {
  if (!checkString(ctx, v, path)) return false;
  if (codePointLength(v) > RECIPE_LIMITS.maxRegexChars) {
    err(
      ctx,
      "bad-regex",
      path,
      `the pattern is longer than ${RECIPE_LIMITS.maxRegexChars} characters`,
      {
        reason: "too long",
      },
    );
    return false;
  }
  try {
    new RegExp(v, "u");
  } catch (e) {
    const reason = clip(e instanceof Error ? e.message : "does not compile");
    err(ctx, "bad-regex", path, "the pattern does not compile", { reason });
    return false;
  }
  return true;
}

function checkFlags(ctx: Ctx, v: unknown, path: string): void {
  if (typeof v !== "string") {
    typeIssue(ctx, path, "a string");
  } else if (v.length > 3) {
    badValue(ctx, path, "maxLength 3", "at most three flags");
  } else if (!FLAGS_RE.test(v)) {
    badValue(ctx, path, "pattern ^[ims]*$", "flags are any of i, m, s");
  }
}

function checkInteger(ctx: Ctx, v: unknown, path: string, min: number, max: number): void {
  if (typeof v !== "number" || !Number.isInteger(v)) {
    typeIssue(ctx, path, "an integer");
  } else if (v < min || v > max) {
    badValue(ctx, path, `[${min}..${max}]`, `must be between ${min} and ${max}`);
  }
}

/** An `{ value, enc }` object: shape, encoding name and the syntax of `value` for `enc`. */
function checkEncoded(ctx: Ctx, v: unknown, path: string, separator: boolean): void {
  const fields = fieldsOf(ctx, v, path);
  if (fields === null) return;
  checkFields(ctx, fields, path, ENCODED_FIELDS, ["value", "enc"]);
  const value = fields.get("value");
  const enc = fields.get("enc");
  let valueOk = false;
  if (fields.has("value")) {
    if (typeof value !== "string") typeIssue(ctx, `${path}/value`, "a string");
    else if (separator && value === "") {
      badValue(ctx, `${path}/value`, "minLength 1", "a separator must not be empty");
    } else valueOk = true;
  }
  const encOk = fields.has("enc") && checkEnum(ctx, enc, `${path}/enc`, ENCODINGS);
  if (valueOk && encOk) {
    const bytes = tryDecodeEncoded(value as string, enc as "utf8");
    if (bytes === null) {
      err(ctx, "bad-encoding", `${path}/value`, `the value is not valid ${String(enc)}`, {
        enc,
      });
    } else if (separator && bytes.length === 0) {
      badValue(ctx, `${path}/value`, "non-empty separator", "the separator decodes to no bytes");
    }
  }
}

/** Structural check of one parameter value: number, string, boolean or an encoded object. */
function checkParamShape(ctx: Ctx, v: unknown, path: string): void {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) typeIssue(ctx, path, "a finite number");
  } else if (typeof v === "string") {
    if (hasLoneSurrogate(v)) {
      badValue(ctx, path, "well-formed UTF-16", "the string contains a lone surrogate");
    }
  } else if (typeof v === "boolean") {
    // always fine
  } else if (isPlainObject(v)) {
    checkEncoded(ctx, v, path, false);
  } else {
    typeIssue(ctx, path, "a number, string, boolean or {value, enc} object");
  }
}

/** The `params` object. Names that break the name pattern are reported here only when there is no catalogue. */
function checkParams(ctx: Ctx, v: unknown, path: string): Map<string, unknown> | null {
  const params = fieldsOf(ctx, v, path);
  if (params === null) return null;
  if (params.size > RECIPE_LIMITS.maxParamsPerStep) {
    err(ctx, "limit", path, `more than ${RECIPE_LIMITS.maxParamsPerStep} parameters`, {
      limit: "maxParamsPerStep",
      max: RECIPE_LIMITS.maxParamsPerStep,
    });
  }
  for (const [key, value] of params) {
    const keyPath = childPointer(path, key);
    if (!PARAM_NAME_RE.test(key)) {
      // With a catalogue the check against the op reports it as an unknown parameter.
      if (ctx.index === undefined) {
        badValue(ctx, keyPath, "propertyNames pattern", "not a valid parameter name");
      }
      continue;
    }
    checkParamShape(ctx, value, keyPath);
  }
  return params;
}

function checkHash(ctx: Ctx, v: unknown, path: string): void {
  if (typeof v !== "string") typeIssue(ctx, path, "a string");
  else if (!HASH_RE.test(v)) {
    badValue(ctx, path, "pattern ^[0-9a-f]{64}$", "a pin is 64 lowercase hex digits");
  }
}

// ---------------------------------------------------------------------------------------------
// Catalogue checks
// ---------------------------------------------------------------------------------------------

/** Canonical constraint text, as `constraintText` of `@forge/lang` writes it. */
function constraintText(c: Constraint): string {
  const bounds = (min: number | undefined, max: number | undefined): string => {
    if (min !== undefined && max !== undefined) return min === max ? `${min}` : `${min}..${max}`;
    if (min !== undefined) return `${min}..`;
    return max !== undefined ? `..${max}` : "";
  };
  const parts = [
    c.oneOf !== undefined ? c.oneOf.join("|") : bounds(c.min, c.max),
    c.lengthOneOf !== undefined ? c.lengthOneOf.join("|") : bounds(c.minLength, c.maxLength),
    c.pattern !== undefined ? `/${c.pattern}/` : "",
  ].filter((p) => p !== "");
  return parts.length === 0 ? "" : `[${parts.join(",")}]`;
}

function compareIntToBound(v: number | bigint, bound: number): number {
  if (typeof v === "number") return v < bound ? -1 : v > bound ? 1 : 0;
  if (!Number.isInteger(bound)) {
    const n = Number(v);
    return n < bound ? -1 : n > bound ? 1 : 0;
  }
  const b = BigInt(bound);
  return v < b ? -1 : v > b ? 1 : 0;
}

function intViolates(v: number | bigint, c: Constraint): boolean {
  if (c.min !== undefined && compareIntToBound(v, c.min) < 0) return true;
  if (c.max !== undefined && compareIntToBound(v, c.max) > 0) return true;
  return (
    c.oneOf !== undefined &&
    !c.oneOf.some((x) => Number.isInteger(x) && compareIntToBound(v, x) === 0)
  );
}

function numViolates(v: number, c: Constraint): boolean {
  if (c.min !== undefined && v < c.min) return true;
  if (c.max !== undefined && v > c.max) return true;
  return c.oneOf !== undefined && !c.oneOf.includes(v);
}

function lengthViolates(n: number, c: Constraint): boolean {
  if (c.minLength !== undefined && n < c.minLength) return true;
  if (c.maxLength !== undefined && n > c.maxLength) return true;
  return c.lengthOneOf !== undefined && !c.lengthOneOf.includes(n);
}

function hasRepeatedCodePoint(s: string): boolean {
  const seen = new Set<string>();
  for (const ch of s) {
    if (seen.has(ch)) return true;
    seen.add(ch);
  }
  return false;
}

/** Checks one parameter value against its `ParamSpec` (RECIPES.md section 3.4). */
function checkParamValue(ctx: Ctx, spec: ParamSpec, v: unknown, path: string): void {
  const name = clip(spec.name, 40);
  const bad = (reason: string, constraint?: string): void => {
    err(ctx, "bad-param", path, `parameter '${name}': ${reason}`, {
      param: name,
      reason,
      ...(constraint === undefined ? {} : { constraint }),
    });
  };
  const c = spec.constraint;
  const lengthCheck = (n: number): void => {
    if (c !== undefined && lengthViolates(n, c)) bad("length is out of range", constraintText(c));
  };
  switch (spec.type) {
    case "int": {
      let n: number | bigint;
      if (typeof v === "number") {
        if (!Number.isSafeInteger(v)) return bad("not a safe integer; use a decimal string");
        n = v;
      } else if (typeof v === "string") {
        if (!CANONICAL_INT_RE.test(v) || v === "-0") return bad("not a canonical decimal integer");
        n = BigInt(v);
      } else return bad("expected an integer");
      if (c !== undefined && intViolates(n, c)) bad("violates the constraint", constraintText(c));
      return;
    }
    case "num":
    case "number":
      if (typeof v !== "number" || !Number.isFinite(v)) return bad("expected a finite number");
      if (c !== undefined && numViolates(v, c)) bad("violates the constraint", constraintText(c));
      return;
    case "bool":
      if (typeof v !== "boolean") bad("expected true or false");
      return;
    case "str":
      if (typeof v !== "string") return bad("expected a string");
      lengthCheck(codePointLength(v));
      return;
    case "choice":
      if (typeof v !== "string") return bad("expected a string");
      if (spec.options === undefined || !spec.options.includes(v)) bad("not an option");
      return;
    case "charset":
      if (typeof v !== "string") return bad("expected a string");
      if (v === "") return bad("a charset is not empty");
      if (hasRepeatedCodePoint(v)) return bad("a charset has no repeated character");
      lengthCheck(codePointLength(v));
      return;
    case "regex":
      if (typeof v !== "string") return bad("expected a string");
      if (checkRegexSource(ctx, v, path)) lengthCheck(codePointLength(v));
      return;
    case "bytes": {
      if (typeof v !== "string") return bad("expected a hex string");
      const bytes = hexDecode(v);
      if (bytes === null) return bad("not a hex string");
      lengthCheck(bytes.length);
      return;
    }
    case "toggle":
    case "key": {
      if (!isPlainObject(v)) return bad("expected a {value, enc} object");
      const { value, enc } = v as { value: string; enc: "utf8" };
      if (!(spec.options ?? ENCODINGS).includes(enc)) return bad("enc is not allowed here");
      const bytes = tryDecodeEncoded(value, enc);
      if (bytes !== null) lengthCheck(bytes.length);
      return;
    }
    default:
      bad("unsupported parameter type");
  }
}

function checkOpAgainstCatalogue(
  ctx: Ctx,
  index: OpIndex,
  opName: string,
  params: Map<string, unknown> | null,
  hash: unknown,
  path: string,
  isTest: boolean,
): void {
  const entry = index.find(opName);
  const opPath = `${path}/op`;
  if (entry === undefined) {
    err(ctx, "unknown-op", opPath, `unknown operation '${clip(opName, 60)}'`, { op: clip(opName) });
    return;
  }
  const op = entry.op;
  if (entry.alias) {
    add(ctx, "alias-used", "warning", opPath, `'${clip(opName, 60)}' is an alias of ${op.qname}`, {
      op: clip(opName),
      canonical: op.qname,
    });
  }
  if (isTest && op.output !== "bool") {
    err(ctx, "not-predicate", opPath, `${op.qname} does not return a bool`, {
      op: op.qname,
      output: op.output,
    });
  }
  const specs = new Map<string, ParamSpec>();
  for (const spec of op.params) specs.set(spec.name, spec);
  if (params !== null) {
    for (const [key, value] of params) {
      const keyPath = childPointer(`${path}/params`, key);
      const spec = specs.get(key);
      if (spec === undefined) {
        err(ctx, "unknown-param", keyPath, `${op.qname} has no parameter '${clip(key, 40)}'`, {
          param: clip(key, 40),
        });
      } else {
        checkParamValue(ctx, spec, value, keyPath);
      }
    }
  }
  for (const spec of op.params) {
    if (spec.required && (params === null || !params.has(spec.name))) {
      err(
        ctx,
        "missing-param",
        childPointer(`${path}/params`, spec.name),
        `missing parameter '${spec.name}'`,
        {
          param: spec.name,
        },
      );
    }
  }
  if (typeof hash === "string" && ctx.pins !== "ignore" && hash !== op.hash) {
    add(
      ctx,
      "hash-mismatch",
      ctx.pins === "strict" ? "error" : "warning",
      `${path}/hash`,
      `the pin of ${op.qname} differs from the catalogue`,
      { expected: op.hash, actual: hash },
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------

/** An op step (`isTest` false) or the op test of an `if`; the fields are already known to be allowed. */
function validateOpLike(
  ctx: Ctx,
  fields: Map<string, unknown>,
  path: string,
  isTest: boolean,
  before: number,
): void {
  let opOk = false;
  if (fields.has("op")) opOk = checkQname(ctx, fields.get("op"), `${path}/op`);
  const params = fields.has("params")
    ? checkParams(ctx, fields.get("params"), `${path}/params`)
    : null;
  if (fields.has("hash")) checkHash(ctx, fields.get("hash"), `${path}/hash`);
  if (ctx.index !== undefined && ctx.errors === before && opOk) {
    checkOpAgainstCatalogue(
      ctx,
      ctx.index,
      fields.get("op") as string,
      params,
      fields.get("hash"),
      path,
      isTest,
    );
  }
}

function validateSteps(ctx: Ctx, value: unknown, path: string, depth: number): void {
  const list = elementsOf(ctx, value, path);
  if (list === null) return;
  for (let i = 0; i < list.length && !ctx.done; i++) {
    if (list[i] !== UNREADABLE) validateStep(ctx, list[i], childPointer(path, i), depth);
  }
}

function validateIfTest(ctx: Ctx, value: unknown, path: string): void {
  const fields = fieldsOf(ctx, value, path);
  if (fields === null) return;
  const kind = fields.get("kind");
  if (kind === "regex") {
    checkFields(ctx, fields, path, REGEX_TEST_FIELDS, ["kind", "pattern"]);
    if (fields.has("pattern")) checkRegexSource(ctx, fields.get("pattern"), `${path}/pattern`);
    if (fields.has("flags")) checkFlags(ctx, fields.get("flags"), `${path}/flags`);
    if (fields.has("encoding")) {
      checkEnum(ctx, fields.get("encoding"), `${path}/encoding`, SECTION_ENCODINGS);
    }
  } else if (kind === "op") {
    const before = ctx.errors;
    checkFields(ctx, fields, path, OP_TEST_FIELDS, ["kind", "op"]);
    validateOpLike(ctx, fields, path, true, before);
  } else {
    err(ctx, "bad-kind", `${path}/kind`, "a test is a regex or an op", { value: echo(kind) });
  }
}

function validateStep(ctx: Ctx, value: unknown, path: string, depth: number): void {
  if (++ctx.steps > RECIPE_LIMITS.maxSteps) {
    err(ctx, "limit", path, `more than ${RECIPE_LIMITS.maxSteps} steps`, {
      limit: "maxSteps",
      max: RECIPE_LIMITS.maxSteps,
    });
    ctx.done = true;
    return;
  }
  if (depth > RECIPE_LIMITS.maxDepth) {
    err(ctx, "limit", path, `steps are nested deeper than ${RECIPE_LIMITS.maxDepth}`, {
      limit: "maxDepth",
      max: RECIPE_LIMITS.maxDepth,
    });
    return;
  }
  const fields = fieldsOf(ctx, value, path);
  if (fields === null) return;
  const kind = fields.get("kind");
  if (typeof kind !== "string" || !(STEP_KINDS as readonly string[]).includes(kind)) {
    err(
      ctx,
      "bad-kind",
      `${path}/kind`,
      "kind is not one of op, fork, subsection, if, repeat, comment",
      {
        ...(fields.has("kind") ? { value: echo(kind) } : {}),
      },
    );
    return;
  }
  switch (kind) {
    case "op": {
      const before = ctx.errors;
      checkFields(ctx, fields, path, OP_FIELDS, ["kind", "op"]);
      checkCommon(ctx, fields, path);
      validateOpLike(ctx, fields, path, false, before);
      return;
    }
    case "fork":
      checkFields(ctx, fields, path, FORK_FIELDS, ["kind", "split", "join", "steps"]);
      checkCommon(ctx, fields, path);
      if (fields.has("split")) checkEncoded(ctx, fields.get("split"), `${path}/split`, true);
      if (fields.has("join")) checkEncoded(ctx, fields.get("join"), `${path}/join`, false);
      if (fields.has("steps")) validateSteps(ctx, fields.get("steps"), `${path}/steps`, depth + 1);
      return;
    case "subsection":
      checkFields(ctx, fields, path, SUBSECTION_FIELDS, ["kind", "pattern", "steps"]);
      checkCommon(ctx, fields, path);
      if (fields.has("pattern")) checkRegexSource(ctx, fields.get("pattern"), `${path}/pattern`);
      if (fields.has("flags")) checkFlags(ctx, fields.get("flags"), `${path}/flags`);
      if (fields.has("encoding")) {
        checkEnum(ctx, fields.get("encoding"), `${path}/encoding`, SECTION_ENCODINGS);
      }
      if (fields.has("steps")) validateSteps(ctx, fields.get("steps"), `${path}/steps`, depth + 1);
      return;
    case "if":
      checkFields(ctx, fields, path, IF_FIELDS, ["kind", "test", "then"]);
      checkCommon(ctx, fields, path);
      if (fields.has("test")) validateIfTest(ctx, fields.get("test"), `${path}/test`);
      if (fields.has("then")) validateSteps(ctx, fields.get("then"), `${path}/then`, depth + 1);
      if (fields.has("else")) validateSteps(ctx, fields.get("else"), `${path}/else`, depth + 1);
      return;
    case "repeat": {
      checkFields(ctx, fields, path, REPEAT_FIELDS, ["kind", "steps"]);
      checkCommon(ctx, fields, path);
      const hasTimes = fields.has("times");
      const hasUntil = fields.has("until");
      if (hasTimes) {
        checkInteger(ctx, fields.get("times"), `${path}/times`, 1, RECIPE_LIMITS.maxRepeat);
      }
      if (hasUntil && fields.get("until") !== "stable") {
        badValue(ctx, `${path}/until`, 'const "stable"', 'until must be "stable"');
      }
      if (fields.has("max")) {
        checkInteger(ctx, fields.get("max"), `${path}/max`, 1, RECIPE_LIMITS.maxRepeat);
      }
      if (hasTimes === hasUntil) {
        err(ctx, "exclusive", path, "a repeat has exactly one of times and until");
      } else if (fields.has("max") && !hasUntil) {
        err(ctx, "exclusive", `${path}/max`, "max goes with until");
      }
      if (fields.has("steps")) validateSteps(ctx, fields.get("steps"), `${path}/steps`, depth + 1);
      return;
    }
    default:
      // comment
      checkFields(ctx, fields, path, COMMENT_FIELDS, ["kind", "text"]);
      if (fields.has("text")) {
        checkString(ctx, fields.get("text"), `${path}/text`, RECIPE_LIMITS.maxCommentChars);
      }
  }
}

// ---------------------------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------------------------

function validateRoot(ctx: Ctx, input: unknown): void {
  const fields = fieldsOf(ctx, input, "");
  if (fields === null) return;
  checkFields(ctx, fields, "", ROOT_FIELDS, []);
  if (!fields.has("forge")) {
    err(ctx, "required", "/forge", "missing required field 'forge'", { field: "forge" });
  } else if (fields.get("forge") !== 1) {
    err(ctx, "bad-version", "/forge", "forge must be the integer 1", {
      value: echo(fields.get("forge")),
    });
  }
  if (fields.has("name")) checkString(ctx, fields.get("name"), "/name", RECIPE_LIMITS.maxNameChars);
  if (fields.has("description")) {
    checkString(ctx, fields.get("description"), "/description", RECIPE_LIMITS.maxDescriptionChars);
  }
  if (fields.has("catalogue")) {
    const before = ctx.errors;
    checkMatches(
      ctx,
      fields.get("catalogue"),
      "/catalogue",
      CATALOGUE_ID_RE,
      "pattern ^[0-9a-f]{16}$",
      16,
    );
    const id = fields.get("catalogue");
    if (ctx.errors === before && ctx.catalogue !== undefined && id !== ctx.catalogue.version) {
      add(
        ctx,
        "catalogue-mismatch",
        "warning",
        "/catalogue",
        "the recipe was made with another catalogue",
        {
          recipe: id,
          current: ctx.catalogue.version,
        },
      );
    }
  }
  if (!fields.has("steps")) {
    err(ctx, "required", "/steps", "missing required field 'steps'", { field: "steps" });
  } else {
    validateSteps(ctx, fields.get("steps"), "/steps", 1);
  }
}

/**
 * Structural validation, plus catalogue checks when a catalogue is given. Never throws.
 * `ok` is true iff no issue is an error; `recipe` is then the input itself, typed.
 */
export function validateRecipe(
  input: unknown,
  catalogue?: CatalogueView,
  options?: ValidateOptions,
): ValidationResult {
  const ctx: Ctx = {
    issues: [],
    errors: 0,
    done: false,
    steps: 0,
    catalogue,
    index: catalogue === undefined ? undefined : opIndex(catalogue),
    pins: options?.pins ?? "warn",
  };
  try {
    const failure = prewalk(input);
    if (failure !== null) {
      const detail: Record<string, unknown> = { limit: failure.limit };
      if (failure.max !== undefined) detail.max = failure.max;
      err(ctx, "limit", "", `the document exceeds a limit (${failure.limit})`, detail);
    } else {
      validateRoot(ctx, input);
    }
  } catch {
    // A hostile object (a throwing Proxy, say) must not escape.
    ctx.issues.length = 0;
    ctx.errors = 1;
    ctx.issues.push({
      code: "type",
      severity: "error",
      path: "",
      message: "the input could not be read",
      detail: { expected: "plain JSON data" },
    });
  }
  return ctx.errors === 0
    ? { ok: true, recipe: input as Recipe, issues: ctx.issues }
    : { ok: false, issues: ctx.issues };
}
