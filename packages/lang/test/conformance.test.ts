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
 * The FL conformance suite (docs/LANGUAGE.md section 16): one Vitest test per `fl-test` block, each
 * against a fresh runtime. The whole file skips while packages/lang/src/runtime.ts does not exist.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type {
  CreateRuntimeFn,
  ForgeErrorShape,
  ForgeRuntime,
  LoadResult,
  RunOptions,
  RunResult,
  Value,
} from "../src/types.js";
import { repr } from "../src/values.js";
import { createFixtures } from "./conformance/fixtures.js";
import {
  loadSpec,
  type ErrorExpectation,
  type PathSegment,
  type RunSpec,
  type TestCase,
} from "./conformance/parse.js";

/** How late a timing test's error may arrive (spec 16.1). */
const TIMING_SLACK_MS = 5000;
const DEFAULT_TIMEOUT_MS = 20_000;

const runtimeUrl = new URL("../src/runtime.ts", import.meta.url);
const runtimeAvailable = ((): boolean => {
  try {
    readFileSync(fileURLToPath(runtimeUrl.href), "utf8");
    return true;
  } catch {
    return false;
  }
})();

if (!runtimeAvailable) {
  console.warn(
    "[conformance] packages/lang/src/runtime.ts does not exist yet: the FL conformance suite is skipped.",
  );
}

const spec = loadSpec();
let createRuntime: CreateRuntimeFn;

beforeAll(async () => {
  if (!runtimeAvailable) return;
  // The specifier is a variable so that type-checking does not require the module to exist.
  const specifier = "../src/runtime.js";
  const mod = (await import(/* @vite-ignore */ specifier)) as { createRuntime: CreateRuntimeFn };
  createRuntime = mod.createRuntime;
});

// ---------------------------------------------------------------------------------------------
// Comparison helpers
// ---------------------------------------------------------------------------------------------

interface ErrorLike {
  readonly code: string;
  readonly message: string;
  readonly word?: string | null;
  readonly pos?: { readonly line: number; readonly col: number } | null;
  readonly detail?: Readonly<Record<string, unknown>>;
}

function isErrorLike(e: unknown): e is ErrorLike {
  return typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string";
}

/** The text a detail field is compared as: strings as is, scalars stringified, str Values unwrapped. */
function detailText(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(detailText);
  if (typeof x === "object" && x !== null && "tag" in x && "v" in x) {
    return detailText((x as { v: unknown }).v);
  }
  if (typeof x === "number" || typeof x === "bigint" || typeof x === "boolean") return String(x);
  return x;
}

function checkError(
  where: string,
  actual: ErrorLike,
  exp: ErrorExpectation,
  codeOnly: boolean,
): void {
  const ctx = `${where}: got ${actual.code} (${actual.message})`;
  expect(actual.code, ctx).toBe(exp.code);
  if (codeOnly) return;
  if (exp.line !== undefined) expect(actual.pos?.line, `${ctx}; line`).toBe(exp.line);
  if (exp.col !== undefined) expect(actual.pos?.col, `${ctx}; col`).toBe(exp.col);
  if (exp.word !== undefined) expect(actual.word, `${ctx}; word`).toBe(exp.word);
  for (const [field, want] of Object.entries(exp.detail)) {
    expect(detailText(actual.detail?.[field]), `${ctx}; detail.${field}`).toEqual(want);
  }
}

function formatStack(stack: readonly Value[]): string {
  return [`<${stack.length}>`, ...stack.map(repr)].join(" ");
}

function followPath(root: unknown, path: readonly PathSegment[]): unknown {
  let cur = root;
  for (const seg of path) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  return cur;
}

// ---------------------------------------------------------------------------------------------
// One test
// ---------------------------------------------------------------------------------------------

function timingLimitMs(tc: TestCase): number {
  return tc.abortMs ?? tc.limits.maxMillis ?? 0;
}

async function runOne(
  rt: ForgeRuntime,
  tc: TestCase,
  run: RunSpec,
  index: number,
  state: { stack: readonly Value[]; vars: Map<string, Value>; hits: string[]; stopped: boolean },
): Promise<RunResult> {
  const where = `${tc.label} run ${index + 1}`;
  const abort = tc.abortMs === undefined ? undefined : new AbortController();
  const opts: RunOptions = {
    ...(abort === undefined ? {} : { signal: abort.signal }),
    stack: state.stack,
    vars: tc.sharedVars ? state.vars : new Map<string, Value>(),
    limits: tc.limits,
    deny: tc.deny,
    ...(tc.breakpoints.length > 0 ? { breakpoints: tc.breakpoints } : {}),
    ...(tc.hook === undefined
      ? {}
      : {
          onStep: (e) => {
            if (!e.breakpoint) return undefined;
            if (tc.hook === "stop") {
              if (!state.stopped) {
                state.stopped = true;
                return "stop";
              }
              return undefined;
            }
            state.hits.push(`${e.word} ${e.ip} ${e.op}`);
            return undefined;
          },
        }),
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (abort !== undefined && tc.abortMs !== undefined) {
    timer = setTimeout(() => abort.abort(), tc.abortMs);
  }
  const started = performance.now();
  let result: RunResult;
  try {
    result = await rt.run(run.source, opts);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  const elapsed = performance.now() - started;

  if (tc.timing) {
    expect(result.ok, `${where}: a timing test must not finish normally`).toBe(false);
    expect(
      elapsed,
      `${where}: the error arrived ${Math.round(elapsed)} ms after the start`,
    ).toBeLessThanOrEqual(timingLimitMs(tc) + TIMING_SLACK_MS);
  }

  if (run.error !== undefined) {
    expect(result.ok, `${where}: expected failure ${run.error.text}`).toBe(false);
    if (!result.ok) checkError(where, result.error as ForgeErrorShape, run.error, tc.timing);
    // With an error expected, @out is what ran before it; an absent @out means nothing ran.
    if (!tc.timing) expect(result.output, `${where}: output before the error`).toBe(run.out ?? "");
  } else {
    if (!result.ok) {
      throw new Error(`${where}: unexpected failure ${result.error.code}: ${result.error.message}`);
    }
    if (run.out !== undefined) expect(result.output, `${where}: output`).toBe(run.out);
  }
  if (run.stack !== undefined) expect(formatStack(result.stack), `${where}: stack`).toBe(run.stack);
  if (run.coercions !== undefined) {
    expect(
      result.coercions.map((c) => ({ word: c.word, slot: c.slot, from: c.from, to: c.to })),
      `${where}: coercions`,
    ).toEqual(run.coercions);
  }
  return result;
}

async function execute(tc: TestCase): Promise<void> {
  const fixtures = createFixtures();
  const rt = createRuntime({ primitives: fixtures.bound });
  for (const def of fixtures.unbound) rt.registry.define(def);

  for (const name of tc.uses) {
    const source = spec.units.get(name);
    if (source === undefined) throw new Error(`${tc.label}: unit ${name} was not extracted`);
    rt.load(source, { trusted: false });
  }

  tc.units.forEach((unit, i) => {
    const where = `${tc.label} unit ${i + 1}`;
    let loaded: LoadResult | undefined;
    let thrown: unknown;
    try {
      loaded = rt.load(unit.source, { trusted: unit.trusted });
    } catch (e) {
      thrown = e;
    }
    const expected = unit.failsWith !== undefined || unit.error !== undefined;
    if (expected) {
      const want = unit.error ?? {
        code: unit.failsWith as ErrorExpectation["code"],
        detail: {},
        text: String(unit.failsWith),
      };
      expect(thrown, `${where}: load() should have thrown ${want.text}`).toBeDefined();
      if (!isErrorLike(thrown)) throw thrown;
      checkError(where, thrown, want, false);
      return;
    }
    if (thrown !== undefined) throw thrown;
    if (unit.warnings !== undefined) {
      expect(
        (loaded as LoadResult).warnings.map((w) => w.code),
        `${where}: warnings`,
      ).toEqual(unit.warnings);
    }
  });

  for (const m of tc.meta) {
    const actual = followPath(rt.meta(m.qname), m.path);
    expect(actual, `${tc.label} meta ${m.qname} ${m.pathText}`).toEqual(m.expected);
  }
  for (const [a, b] of tc.hashEq) {
    expect(rt.meta(a).hash, `${tc.label}: hash of ${a} equals hash of ${b}`).toBe(rt.meta(b).hash);
  }
  for (const [a, b] of tc.hashNe) {
    expect(rt.meta(a).hash, `${tc.label}: hash of ${a} differs from hash of ${b}`).not.toBe(
      rt.meta(b).hash,
    );
  }

  const state = {
    stack: tc.stackIn ?? ([] as readonly Value[]),
    vars: new Map<string, Value>(),
    hits: [] as string[],
    stopped: false,
  };
  for (const [i, run] of tc.runs.entries()) {
    const result = await runOne(rt, tc, run, i, state);
    state.stack = result.stack; // the final stack of one run is the initial stack of the next
  }
  if (tc.hits !== undefined) expect(state.hits, `${tc.label}: breakpoint hits`).toEqual(tc.hits);
  expect(fixtures.violations, `${tc.label}: fixture aliasing violations`).toEqual([]);
}

describe.skipIf(!runtimeAvailable)(
  runtimeAvailable
    ? "FL conformance (LANGUAGE.md section 16)"
    : "FL conformance SKIPPED: packages/lang/src/runtime.ts does not exist yet",
  () => {
    for (const tc of spec.cases) {
      const timeout = DEFAULT_TIMEOUT_MS + (tc.timing ? timingLimitMs(tc) + TIMING_SLACK_MS : 0);
      it(tc.name, { timeout }, async () => {
        await execute(tc);
      });
    }
  },
);
