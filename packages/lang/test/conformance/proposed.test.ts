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
 * The `fl-proposed` blocks of docs/LANGUAGE-0.3.md: always parsed and validated, run only when
 * opted in (proposed.ts, README.md). With nothing opted in this file runs no proposed case.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { CreateRuntimeFn, PrimitiveDef } from "../../src/types.js";
import { createRuntime } from "../../src/runtime.js";
import { loadExtApi, supportedExtPrimitives } from "./ext-support.js";
import { loadProposed, loadSpec } from "./parse.js";
import { parseSelection, selectProposed, SelectionError } from "./proposed.js";
import { DEFAULT_TIMEOUT_MS, TIMING_SLACK_MS, executeCase, timingLimitMs } from "./run.js";

const spec = loadProposed();
const proposed = spec.proposed;

describe("the fl-proposed blocks of LANGUAGE-0.3.md parse", () => {
  it("finds 192 cases, all in C401 to C594, each once", () => {
    const ids = proposed.map((c) => c.id);
    expect(proposed).toHaveLength(192);
    expect(new Set(ids).size).toBe(192);
    expect(Math.min(...ids)).toBe(401);
    expect(Math.max(...ids)).toBe(594);
    expect(proposed.every((c) => c.proposed)).toBe(true);
  });

  it("keeps them out of the suite, and the suite at 317 cases", () => {
    expect(spec.cases).toHaveLength(317);
    expect(spec.cases.some((c) => c.proposed)).toBe(false);
    expect(loadSpec().proposed).toHaveLength(0);
  });

  it("does not share an id with the suite", () => {
    const suite = new Set(spec.cases.map((c) => c.id));
    expect(proposed.filter((c) => suite.has(c.id))).toEqual([]);
  });

  it("uses @call in C585 to C587 and the other conventions of section 3", () => {
    const calls = proposed.filter((c) => c.runs.some((r) => r.call !== undefined));
    expect(calls.map((c) => c.label)).toEqual(["C585", "C586", "C587"]);
    expect(proposed.some((c) => c.deny.includes("+media"))).toBe(true);
    expect(proposed.some((c) => c.runs.some((r) => r.coercions?.some((x) => x.to === "ext")))).toBe(
      true,
    );
    expect(proposed.filter((c) => c.meta.length > 0).length).toBeGreaterThan(0);
  });
});

describe("opting in", () => {
  it("selects nothing by default", () => {
    expect(selectProposed(proposed, "", [])).toEqual([]);
  });

  it("selects by id, range and all", () => {
    const labels = (env: string) => selectProposed(proposed, env, []).map((c) => c.label);
    expect(labels("C585")).toEqual(["C585"]);
    expect(labels("C585-C587")).toEqual(["C585", "C586", "C587"]);
    expect(labels("C585 C587")).toEqual(["C585", "C587"]);
    expect(labels("all")).toHaveLength(192);
    expect(selectProposed(proposed, "C585", ["C587"]).map((c) => c.label)).toEqual([
      "C585",
      "C587",
    ]);
  });

  it("rejects a bad selection instead of running nothing", () => {
    expect(() => parseSelection("X1")).toThrow(SelectionError);
    expect(() => parseSelection("C9-C1")).toThrow(/empty range/);
    expect(() => selectProposed(proposed, "C999", [])).toThrow(/not in LANGUAGE-0.3.md/);
  });
});

const selected = selectProposed(proposed);

describe.skipIf(selected.length === 0)("the opted-in fl-proposed cases", () => {
  let create: CreateRuntimeFn;
  let extra: readonly PrimitiveDef[] = [];
  beforeAll(async () => {
    create = createRuntime;
    extra = supportedExtPrimitives(create, await loadExtApi()).accepted;
  });
  for (const tc of selected) {
    const timeout = DEFAULT_TIMEOUT_MS + (tc.timing ? timingLimitMs(tc) + TIMING_SLACK_MS : 0);
    it(tc.name, { timeout }, async () => {
      await executeCase(create, spec.units, tc, extra);
    });
  }
});
