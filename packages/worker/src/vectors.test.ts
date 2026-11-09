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

// The runner itself, against a baker that returns what the test says (the real vectors are run in
// test/vectors.test.ts).
import { describe, expect, test } from "vitest";
import { runOpVectors } from "./vectors.js";
import type { Baker, BakeResult, OpTestVector, OutputValue } from "./types.js";

const catalogue = {
  version: "0123456789abcdef",
  ops: [
    { qname: "a:one", aliases: ["uno"] },
    { qname: "a:two", aliases: [] },
  ],
};

function ok(output: OutputValue): BakeResult {
  return {
    id: 1,
    ok: true,
    output,
    steps: [],
    coercions: [],
    coercionsTruncated: false,
    warnings: [],
    stats: { elapsedMs: 0, vmSteps: 0, effects: [] },
  };
}
function err(code: string, path: string | null): BakeResult {
  return {
    ...ok({ kind: "str", text: "" }),
    ok: false,
    error: { code, message: "msg", path, word: null, detail: {} },
  } as BakeResult;
}

function bakerReturning(result: BakeResult, seen: unknown[] = []): Baker {
  return {
    hardKill: false,
    init: () => Promise.reject(new Error("unused")),
    bake: (recipe, input, options) => {
      seen.push({ recipe, input, options });
      return Promise.resolve(result);
    },
    step: () => Promise.resolve(),
    continue: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
    dispose: () => Promise.resolve(),
  };
}

const vec = (over: Partial<OpTestVector>): OpTestVector => ({
  op: "a:one",
  params: {},
  input: { value: "x", enc: "utf8" },
  expect: { value: "y", enc: "utf8" },
  ...over,
});

async function run(result: BakeResult, vectors: OpTestVector[], seen: unknown[] = []) {
  return runOpVectors({
    baker: bakerReturning(result, seen),
    catalogue,
    files: { "a.test.json": vectors },
  });
}

describe("runOpVectors", () => {
  test("builds a one-step recipe and bakes it trusted with pins ignored", async () => {
    const seen: unknown[] = [];
    const r = await run(
      ok({ kind: "str", text: "y" }),
      [vec({ params: { n: 1 }, input: { value: "6162", enc: "hex" } })],
      seen,
    );
    expect(seen[0]).toEqual({
      recipe: { forge: 1, steps: [{ kind: "op", op: "a:one", params: { n: 1 } }] },
      input: new Uint8Array([0x61, 0x62]),
      options: { trust: "trusted", pins: "ignore" },
    });
    expect(r).toMatchObject({ total: 1, passed: 1, failures: [], uncovered: ["a:two"] });
  });

  test("bytes and str outputs compare as bytes", async () => {
    const bytesOut: OutputValue = { kind: "bytes", bytes: new Uint8Array([0xff]), text: null };
    expect((await run(ok(bytesOut), [vec({ expect: { value: "ff", enc: "hex" } })])).passed).toBe(
      1,
    );
    const bad = await run(ok(bytesOut), [vec({ expect: { value: "fe", enc: "hex" } })]);
    expect(bad.failures[0]?.message).toContain("expected hex fe, got hex ff");
    const other = await run(ok({ kind: "bool", value: true }), [vec({})]);
    expect(other.failures[0]?.message).toContain("expected bytes, got a bool output");
  });

  test("expected errors: code and path", async () => {
    const run1 = (result: BakeResult, expectError: string) =>
      run(result, [vec({ expect: { error: expectError as never } })]);
    expect((await run1(err("E_COERCE", "/steps/0"), "E_COERCE")).passed).toBe(1);
    expect((await run1(err("E_RECIPE_INVALID", null), "E_RECIPE_INVALID")).passed).toBe(1);
    const wrongCode = await run1(err("E_RANGE", "/steps/0"), "E_COERCE");
    expect(wrongCode.failures[0]?.message).toContain('got E_RANGE at "/steps/0"');
    const wrongPath = await run1(err("E_COERCE", null), "E_COERCE");
    expect(wrongPath.failures).toHaveLength(1);
    const noError = await run1(ok({ kind: "str", text: "" }), "E_COERCE");
    expect(noError.failures[0]?.message).toContain("expected error E_COERCE, got a result");
  });

  test("an unexpected error is a failure that says what happened", async () => {
    const r = await run(err("E_COERCE", "/steps/0"), [vec({})]);
    expect(r.failures[0]?.message).toContain("expected a result, got error E_COERCE: msg");
  });

  test("json expectations ignore key order and match int against num", async () => {
    const out: OutputValue = {
      kind: "list",
      items: [
        {
          kind: "record",
          entries: [
            { key: "b", value: { kind: "int", text: "1" } },
            { key: "a", value: { kind: "str", text: "s" } },
          ],
          total: 2,
        },
        { kind: "num", value: 1 },
      ],
      total: 2,
    };
    const good = await run(ok(out), [vec({ expect: { json: [{ a: "s", b: 1 }, 1] } })]);
    expect(good.passed).toBe(1);
    for (const json of [
      [{ a: "s", b: 2 }, 1],
      [{ a: "s" }, 1],
      [{ a: "s", b: 1, c: 1 }, 1],
      [{ a: "s", c: 1 }, 1],
      [1, 1],
      [[], 1],
      [{ a: "s", b: 1 }],
      "x",
      null,
    ]) {
      const bad = await run(ok(out), [vec({ expect: { json } })]);
      expect(bad.failures, JSON.stringify(json)).toHaveLength(1);
    }
    const nullVsObject = await run(ok({ kind: "str", text: "x" }), [
      vec({ expect: { json: { a: 1 } } }),
    ]);
    expect(nullVsObject.failures[0]?.message).toContain("expected json");
  });

  test("unknown ops, aliases, bad inputs and bad expectations", async () => {
    const r = await run(ok({ kind: "str", text: "y" }), [
      vec({ op: "a:nope" }),
      vec({ op: "a:uno" }),
      vec({ input: { value: "zz", enc: "hex" } }),
      vec({ expect: { value: "zz", enc: "hex" } }),
      vec({ name: "named", op: "a:nope" }),
    ]);
    expect(r.total).toBe(5);
    expect(r.passed).toBe(1);
    expect(r.failures.map((f) => [f.index, f.name])).toEqual([
      [0, "a:nope"],
      [2, "a:one"],
      [3, "a:one"],
      [4, "named"],
    ]);
    expect(r.failures[0]?.message).toContain("a.test.json#0 a:nope: 'a:nope' is not an operation");
    expect(r.failures[1]?.message).toContain("bad input");
    expect(r.failures[2]?.message).toContain("bad expectation");
    expect(r.uncovered).toEqual(["a:two"]);
  });

  test("an empty file list is an empty report; files run in name order", async () => {
    const empty = await runOpVectors({
      baker: bakerReturning(err("E", null)),
      catalogue,
      files: {},
    });
    expect(empty).toEqual({ total: 0, passed: 0, failures: [], uncovered: ["a:one", "a:two"] });
    const order: string[] = [];
    const baker = bakerReturning(ok({ kind: "str", text: "y" }));
    const report = await runOpVectors({
      baker: {
        ...baker,
        bake: (rcp) => (order.push(JSON.stringify(rcp)), baker.bake(rcp, new Uint8Array())),
      },
      catalogue,
      files: { "b.test.json": [vec({ op: "a:two" })], "a.test.json": [vec({})] },
    });
    expect(order[0]).toContain("a:one");
    expect(report.uncovered).toEqual([]);
  });
});
