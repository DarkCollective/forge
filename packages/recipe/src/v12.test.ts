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
// Slots (RECIPES-1.2.md sections 4, 5 and 15): the v12 corpus and the conformance cases CR201 to CR219 and
// CR253 to CR259. Ajv compiles schemas with `new Function`, which the production CSP forbids: tests only.
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, test } from "vitest";
import { fixtureFiles, fixtureText, seed, slotCatalogue } from "../test/helpers.js";
import { validateRecipe as validateV11 } from "../test/validate-v11.js";
import {
  canonicalRecipe,
  dataSourcePath,
  inputNames,
  normaliseRecipe,
  pinRecipe,
  recipeNeedsHardKill,
  recipeUsesSlots,
  recipeUsesV11,
  recipeUsesV12,
  registerInfo,
  registersInScope,
  resolveRecipe,
  validateRecipe,
} from "./index.js";
import type { CatalogueOpView, CatalogueView, Recipe, RecipeIssue } from "./index.js";
import schema from "./recipe.schema.json";

const ajv = new Ajv2020({ strict: true, allErrors: false });
const accepts = ajv.compile(schema);

type Dir = "valid" | "invalid" | "validator-only";
const dirPath = (dir: Dir): string => `corpus/v12/${dir}`;
function corpus(dir: Dir): [string, unknown][] {
  return fixtureFiles(dirPath(dir)).map((f) => [
    f.replace(/\.json$/, ""),
    JSON.parse(fixtureText(dirPath(dir), f)) as unknown,
  ]);
}
const doc = (dir: Dir, name: string): Recipe => {
  const file = fixtureFiles(dirPath(dir)).find((f) => f.startsWith(name));
  if (file === undefined) throw new Error(`no corpus file ${name}`);
  return JSON.parse(fixtureText(dirPath(dir), file)) as Recipe;
};

// --------------------------------------------------------------------------------------------
// The corpus: schema and validator agree
// --------------------------------------------------------------------------------------------

describe("the v1.2 corpus (RECIPES-1.2.md section 5.1)", () => {
  test("the corpus is not empty", () => {
    expect(corpus("valid").length).toBeGreaterThanOrEqual(10);
    expect(corpus("invalid").length).toBeGreaterThanOrEqual(6);
    expect(corpus("validator-only").length).toBeGreaterThanOrEqual(8);
  });

  test.each(corpus("valid"))("valid %s is accepted by both", (_n, d) => {
    expect(accepts(d)).toBe(true);
    const result = validateRecipe(d);
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(validateRecipe(d, slotCatalogue, { pins: "ignore" }).ok).toBe(true);
  });

  test.each(corpus("invalid"))("invalid %s is rejected by both", (_n, d) => {
    expect(accepts(d)).toBe(false);
    expect(validateRecipe(d).ok).toBe(false);
  });

  test.each(corpus("validator-only"))("%s: only the validator rejects it", (_n, d) => {
    expect(accepts(d)).toBe(true);
    expect(validateRecipe(d).ok).toBe(false);
  });

  test("a v1.1 reader refuses every recipe with slots (RECIPES-1.2.md sections 2.1 and 16)", () => {
    let slotted = 0;
    for (const dir of ["valid", "invalid", "validator-only"] as const) {
      for (const [name, d] of corpus(dir)) {
        if (!recipeUsesSlots(d as Recipe)) continue;
        slotted++;
        const result = validateV11(d);
        expect(result.ok, name).toBe(false);
        expect(
          result.issues.some(
            (i) => i.code === "unknown-field" && /\/(pipe|left|right|base|step)$/.test(i.path),
          ),
          name,
        ).toBe(true);
      }
    }
    expect(slotted).toBeGreaterThanOrEqual(25);
  });
});

// --------------------------------------------------------------------------------------------
// Conformance cases
// --------------------------------------------------------------------------------------------

/** `severity code path k=v …`, as the cases of RECIPES-1.2.md section 15 write an issue. */
function line(i: RecipeIssue): string {
  const kv = Object.entries(i.detail ?? {})
    .filter(([, v]) => typeof v === "string")
    .map(([k, v]) => `${k}=${String(v)}`)
    .sort();
  return [i.severity, i.code, i.path, ...kv].join(" ");
}

/** Compares as sets of lines: the spec lists some cases in path order and others in pass order. */
function expectIssues(d: unknown, expected: string[], catalogue: CatalogueView | undefined): void {
  const got = validateRecipe(d, catalogue, { pins: "ignore" }).issues;
  const norm = (s: string): string => {
    const [head, ...rest] = s.split(" ");
    const [sev, code, path] = [head, rest[0], rest[1]];
    return [sev, code, path, ...rest.slice(2).sort()].join(" ");
  };
  const want = expected.map(norm).sort();
  const have = got.map((i) => line(i)).sort();
  // A spec line with no key=value pairs does not pin the detail (as `error bad-value /steps/1/pipe`).
  const cut = (s: string, w: string[]): string => {
    const key = s.split(" ").slice(0, 3).join(" ");
    return w.some((x) => x === key) ? key : s;
  };
  expect(have.map((s) => cut(s, want))).toEqual(want);
}

const inp = (tab: string, extra: Record<string, unknown> = {}) => ({
  kind: "op",
  op: "relix:input",
  params: { tab },
  ...extra,
});
const lane = (...steps: unknown[]) => ({ steps });
const R = (...steps: unknown[]) => ({ forge: 1, steps }) as unknown as Recipe;

describe("validation cases CR201 to CR215 (RECIPES-1.2.md section 15.2)", () => {
  test("CR201, CR202, CR203 are valid", () => {
    for (const name of ["cr201", "cr202", "cr203"]) {
      expectIssues(doc("valid", name), [], slotCatalogue);
      expectIssues(doc("valid", name), [], undefined);
    }
  });

  test("CR204 no pipe after other steps is a warning", () => {
    expectIssues(
      doc("valid", "cr204"),
      ["warning unused-pipe /steps/1 op=relix:union"],
      slotCatalogue,
    );
    expectIssues(doc("valid", "cr204"), ["warning unused-pipe /steps/1 op=relix:union"], undefined);
  });

  test("CR205 the piped slot must be absent", () => {
    expectIssues(
      doc("invalid", "cr205"),
      ["error bad-slot /steps/1/left reason=piped-slot-present slot=left op=relix:union"],
      slotCatalogue,
    );
  });

  test("CR206 a slot that must be present is absent", () => {
    expectIssues(
      doc("invalid", "cr206"),
      [
        "error missing-slot /steps/0/right slot=right reason=absent",
        "error missing-slot /steps/2/right slot=right reason=absent",
      ],
      slotCatalogue,
    );
  });

  test("CR207 a binary op with no slot keys needs the catalogue to be told", () => {
    const d = R({ kind: "op", op: "relix:theta-join", params: { on: "a = b" } });
    expectIssues(
      d,
      ["error missing-slot /steps/0 reason=no-slots op=relix:theta-join"],
      slotCatalogue,
    );
    expectIssues(d, [], undefined);
  });

  test("CR208 a lane needs an enabled step that is not a comment", () => {
    expectIssues(
      doc("validator-only", "cr208"),
      [
        "error missing-slot /steps/1/right slot=right reason=empty",
        "error missing-slot /steps/2/right slot=right reason=empty",
      ],
      slotCatalogue,
    );
  });

  test("CR209 slot keys on a unary op, CR210 the slot parameter in params", () => {
    const d = R(
      {
        kind: "op",
        op: "relix:select",
        params: { cond: "a = 1" },
        pipe: "left",
        right: lane(inp("b")),
      },
      {
        kind: "op",
        op: "relix:theta-join",
        params: { on: "a = b", right: "orders" },
        pipe: "left",
        right: lane(inp("b")),
      },
    );
    expectIssues(
      d,
      [
        "error bad-slot /steps/0/pipe reason=not-slot-op op=relix:select",
        "error bad-slot /steps/1/params/right reason=slot-in-params op=relix:theta-join slot=right",
      ],
      slotCatalogue,
    );
  });

  test("CR211 pipe that is not left, right or base; a slot that is not an object", () => {
    const d = R(
      { kind: "op", op: "relix:union", pipe: "up", right: lane(inp("b")) },
      { kind: "op", op: "relix:union", pipe: 1, right: lane(inp("b")) },
      { kind: "op", op: "relix:union", pipe: "left", right: [] },
      { kind: "op", op: "relix:union", pipe: "left", right: "orders" },
    );
    const got = validateRecipe(d, slotCatalogue).issues.map((i) => `${i.code} ${i.path}`);
    expect(got).toEqual([
      "bad-value /steps/0/pipe",
      "type /steps/1/pipe",
      "type /steps/2/right",
      "type /steps/3/right",
    ]);
  });

  test("CR212 a slot with no steps, and with an extra key", () => {
    const d = R(
      { kind: "op", op: "relix:union", pipe: "left", right: {} },
      { kind: "op", op: "relix:union", pipe: "left", right: { steps: [inp("b")], name: "x" } },
    );
    expectIssues(
      d,
      ["error required /steps/0/right/steps", "error unknown-field /steps/1/right/name"],
      slotCatalogue,
    );
  });

  test("CR213 a return in a lane is bad-position; a return after the join is valid", () => {
    expectIssues(
      doc("validator-only", "cr213-"),
      [
        "error bad-position /steps/1/right/steps/1 kind=return container=/steps/1 containerKind=op slot=right",
      ],
      slotCatalogue,
    );
    expectIssues(doc("valid", "cr213a"), [], slotCatalogue);
    // an `if` inside a lane does not make a return valid
    expectIssues(
      doc("validator-only", "cr213c"),
      [
        "error bad-position /steps/1/right/steps/1/then/0 kind=return container=/steps/1 containerKind=op slot=right",
      ],
      slotCatalogue,
    );
  });

  test("CR214 registers and lanes: visibility", () => {
    expectIssues(
      doc("validator-only", "cr214"),
      ["error unknown-register /steps/3/params/cond/ref register=inner reason=out-of-scope"],
      slotCatalogue,
    );
  });

  test("CR215 two lanes may reuse a name; a name visible at the step may not be bound in a lane", () => {
    expectIssues(
      doc("validator-only", "cr215"),
      [
        "error duplicate-register /steps/1/right/steps/1/name register=x first=/steps/0",
        "warning unused-pipe /steps/1 op=relix:union",
      ],
      slotCatalogue,
    );
  });

  test("CR217 slot keys in an op test are unknown fields", () => {
    expectIssues(
      doc("invalid", "cr217"),
      ["error unknown-field /steps/0/test/pipe", "error unknown-field /steps/0/test/right"],
      undefined,
    );
  });

  test("CR218 a disabled slot step is still checked", () => {
    expectIssues(
      doc("validator-only", "cr218"),
      ["error missing-slot /steps/1/right slot=right reason=empty"],
      slotCatalogue,
    );
  });
});

describe("limits CR216 and CR219 (RECIPES-1.2.md section 5.5)", () => {
  const nest = (levels: number): Recipe => {
    let inner: unknown = inp("a");
    for (let i = 0; i < levels; i++) {
      inner = { kind: "op", op: "relix:union", left: lane(inner), right: lane(inp("b")) };
    }
    return R(inner);
  };
  const jsonDepth = (v: unknown): number =>
    typeof v !== "object" || v === null
      ? 0
      : 1 + Math.max(0, ...Object.values(v).map((x) => jsonDepth(x)));

  test("CR216 container depth counts a lane as a level, as a fork's children are", () => {
    // Root list is depth 1, so seven nested slot steps put the innermost lane's step at depth 8.
    const ok = nest(7);
    expectIssues(ok, [], slotCatalogue);
    expect(jsonDepth(ok)).toBeLessThan(64);
    const tooDeep = validateRecipe(nest(8), slotCatalogue).issues;
    expect(tooDeep.length).toBeGreaterThan(0);
    expect(tooDeep.every((i) => i.code === "limit" && i.detail?.["limit"] === "maxDepth")).toBe(
      true,
    );
  });

  test("CR219 steps in lanes count toward 500", () => {
    const many = (n: number): Recipe =>
      R({
        kind: "op",
        op: "relix:union",
        left: lane(...Array.from({ length: 250 }, () => inp("a"))),
        right: lane(...Array.from({ length: n }, () => inp("b"))),
      });
    // 1 + 250 + 249 = 500
    expect(validateRecipe(many(249), slotCatalogue).ok).toBe(true);
    const r = validateRecipe(many(250), slotCatalogue);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "limit" && i.detail?.["limit"] === "maxSteps")).toBe(
      true,
    );
  });
});

const fixAt = (extra: Record<string, unknown>) => ({
  kind: "op",
  op: "relix:fix",
  params: { name: "R" },
  ...extra,
});
const recur = { kind: "op", op: "relix:recur", params: { name: "R" } };

describe("base-and-step cases CR253 to CR259 (RECIPES-1.2.md section 15.2)", () => {
  test("CR253 relix:fix with pipe base and a step lane", () => {
    expectIssues(doc("valid", "cr253"), [], slotCatalogue);
  });

  test("CR254 a lane in both slots: fine as a first step, a warning after other steps", () => {
    expectIssues(doc("valid", "cr254-"), [], slotCatalogue);
    expectIssues(
      doc("valid", "cr254b"),
      ["warning unused-pipe /steps/1 op=relix:fix"],
      slotCatalogue,
    );
  });

  test("CR255 pipe step; the other family's keys on a slot op", () => {
    const d = R(
      inp("a"),
      fixAt({ pipe: "step", base: lane(inp("a")) }),
      { kind: "op", op: "relix:union", pipe: "base", step: lane(inp("b")) },
      fixAt({ pipe: "left", right: lane(inp("b")) }),
    );
    expectIssues(
      d,
      [
        "error bad-value /steps/1/pipe",
        "error bad-slot /steps/2/pipe reason=wrong-slots op=relix:union expected=left,right",
        "error bad-slot /steps/3/pipe reason=wrong-slots op=relix:fix expected=base,step",
      ],
      slotCatalogue,
    );
  });

  test("CR256 a base-and-step op needs its lanes", () => {
    const d = R(
      inp("a"),
      fixAt({ pipe: "base" }),
      fixAt({}),
      fixAt({ pipe: "base", step: lane() }),
    );
    expectIssues(
      d,
      [
        "error missing-slot /steps/1/step slot=step reason=absent",
        "error missing-slot /steps/2 reason=no-slots op=relix:fix",
        "error missing-slot /steps/3/step slot=step reason=empty",
      ],
      slotCatalogue,
    );
  });

  test("CR257 keys of both families; the piped base also present; step in params", () => {
    const d = R(
      inp("a"),
      fixAt({ left: lane(inp("a")), step: lane(inp("b")) }),
      fixAt({ pipe: "base", base: lane(inp("a")), step: lane(inp("b")) }),
      {
        kind: "op",
        op: "relix:fix",
        params: { name: "R", step: "x" },
        pipe: "base",
        step: lane(inp("b")),
      },
    );
    expectIssues(
      d,
      [
        "error bad-slot /steps/1 reason=mixed-slots op=relix:fix",
        "error bad-slot /steps/2/base reason=piped-slot-present slot=base op=relix:fix",
        "error bad-slot /steps/3/params/step reason=slot-in-params op=relix:fix slot=step",
      ],
      slotCatalogue,
    );
  });

  test("CR258 relix:recur is valid only inside a step lane, at any depth", () => {
    const expected = [
      "error bad-position /steps/0 kind=relix:recur reason=outside-step-slot",
      "warning unused-pipe /steps/1 op=relix:fix",
      "error bad-position /steps/1/base/steps/0 kind=relix:recur reason=outside-step-slot",
    ];
    const d = doc("validator-only", "cr258-");
    expectIssues(d, expected, slotCatalogue);
    expectIssues(d, expected, undefined);
    expectIssues(
      doc("validator-only", "cr258b"),
      ["error bad-position /steps/0 kind=relix:recur reason=outside-step-slot"],
      undefined,
    );
    expectIssues(doc("valid", "cr258a"), [], slotCatalogue);
  });

  test("CR259 a return in a step lane is bad-position; registers are visible in both lanes", () => {
    expectIssues(
      doc("validator-only", "cr259-"),
      [
        "error bad-position /steps/1/step/steps/1 kind=return container=/steps/1 containerKind=op slot=step",
      ],
      slotCatalogue,
    );
    expectIssues(
      doc("valid", "cr259a"),
      ["warning unused-pipe /steps/1 op=relix:fix"],
      slotCatalogue,
    );
    expectIssues(
      doc("validator-only", "cr259c"),
      [
        "error unknown-register /steps/0/step/steps/1/params/cond/ref register=only reason=out-of-scope",
      ],
      slotCatalogue,
    );
    void recur;
  });

  test("a slot op in the catalogue with an unknown slot name has no slots", () => {
    const odd: CatalogueView = {
      version: "0000000000000000",
      ops: [
        {
          ...(slotCatalogue.ops.find((o) => o.qname === "relix:union") as CatalogueOpView),
          slot: "other",
        },
      ],
    };
    const issues = validateRecipe(
      R({ kind: "op", op: "relix:union", pipe: "left", right: lane(inp("b")) }),
      odd,
    ).issues;
    expect(issues.map((x) => line(x))).toContain(
      "error bad-slot /steps/0/pipe op=relix:union reason=not-slot-op",
    );
  });
});

// --------------------------------------------------------------------------------------------
// Normal form, resolve, pin, scope and helpers
// --------------------------------------------------------------------------------------------

describe("slots in normalise, resolve, pin and the scope helpers", () => {
  test("CR229 the key order of a slot step; the slot parameter is not made explicit", () => {
    const d = doc("valid", "cr229");
    const out = JSON.stringify(normaliseRecipe(d));
    expect(out).toBe(
      '{"forge":1,"steps":[{"kind":"op","op":"relix:theta-join","params":{"on":"a = b"},"pipe":"left","right":{"steps":[{"kind":"op","op":"relix:input","params":{"tab":"b"}}]},"note":"join"}]}',
    );
    const canon = canonicalRecipe(d, slotCatalogue);
    const join = canon.steps[0] as { params: Record<string, unknown> };
    expect(Object.keys(join.params)).toEqual(["on"]);
    // the lane's steps are resolved too: relix:input gets its defaults
    const inner = (canon.steps[0] as unknown as { right: { steps: { params: unknown }[] } }).right
      .steps[0];
    expect(inner?.params).toEqual({ tab: "b", format: "csv", header: true });
    // idempotent
    expect(canonicalRecipe(canon, slotCatalogue)).toEqual(canon);
  });

  test("CR230 an ext string is kept as written", () => {
    const d = R({ kind: "op", op: "relix:select", params: { cond: "age>30" } });
    expect(JSON.stringify(normaliseRecipe(d))).toContain("age>30");
  });

  test("an op with only the slot parameter has no params after resolve", () => {
    const d = R({
      kind: "op",
      op: "relix:union",
      left: lane(inp("a")),
      right: lane(inp("b")),
      params: {},
    });
    const out = resolveRecipe(d, slotCatalogue).steps[0] as unknown as Record<string, unknown>;
    expect(out["params"]).toBeUndefined();
  });

  test("pinRecipe pins the ops inside lanes", () => {
    const pinned = pinRecipe(doc("valid", "cr201"), slotCatalogue);
    const join = pinned.steps[4] as unknown as {
      hash?: string;
      right: { steps: { hash?: string }[] };
    };
    expect(join.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(join.right.steps.map((s) => s.hash?.length)).toEqual([64, 64]);
    // the slot step keeps its slot keys, in the canonical order
    expect(Object.keys(join)).toEqual(["kind", "op", "params", "hash", "pipe", "right"]);
  });

  test("registersInScope and registerInfo see lanes", () => {
    const d = doc("validator-only", "cr214");
    expect(registerInfo(d, slotCatalogue).map((r) => `${r.name}@${r.path}`)).toEqual([
      "min-age@/steps/1",
      "inner@/steps/2/right/steps/1",
    ]);
    // visible in the step's own params and in its lane
    expect(registersInScope(d, "/steps/2", slotCatalogue).map((r) => r.name)).toEqual(["min-age"]);
    expect(registersInScope(d, "/steps/2/right/steps/0").map((r) => r.name)).toEqual(["min-age"]);
    // a path that ends at a lane is the position after its last step
    expect(registersInScope(d, "/steps/2/right/steps").map((r) => r.name)).toEqual([
      "min-age",
      "inner",
    ]);
    // not visible after the slot step
    expect(registersInScope(d, "/steps/3").map((r) => r.name)).toEqual(["min-age"]);
  });

  test("recipeUsesV11 looks into lanes; slots alone are not 1.1", () => {
    expect(recipeUsesV11(doc("valid", "cr201"))).toBe(false);
    expect(recipeUsesV11(doc("valid", "cr259a"))).toBe(true);
    expect(recipeUsesV11(doc("validator-only", "cr213-"))).toBe(true);
  });

  test("recipeNeedsHardKill recurses into lanes and skips disabled steps", () => {
    const cat: CatalogueView = {
      version: slotCatalogue.version,
      ops: [
        ...slotCatalogue.ops,
        {
          ...(slotCatalogue.ops.find((o) => o.qname === "text:upper") as CatalogueOpView),
          qname: "x:hard",
          needsHardKill: true,
        },
      ],
    };
    const hard = { kind: "op", op: "x:hard" };
    const withLane = (inner: unknown) =>
      R({ kind: "op", op: "relix:union", pipe: "left", right: lane(inner) });
    expect(recipeNeedsHardKill(withLane(hard), cat)).toBe(true);
    expect(recipeNeedsHardKill(withLane({ ...hard, disabled: true }), cat)).toBe(false);
    expect(recipeNeedsHardKill(withLane(inp("b")), cat)).toBe(false);
    expect(
      recipeNeedsHardKill(
        R({ kind: "op", op: "relix:union", disabled: true, left: lane(hard), right: lane(hard) }),
        cat,
      ),
    ).toBe(false);
  });

  test("recipeUsesSlots", () => {
    expect(recipeUsesSlots(doc("valid", "cr201"))).toBe(true);
    expect(
      recipeUsesSlots(
        R({
          kind: "fork",
          split: { value: "x", enc: "utf8" },
          join: { value: "", enc: "utf8" },
          steps: [{ kind: "op", op: "a:b", pipe: "left", right: lane() }],
        }),
      ),
    ).toBe(true);
    expect(recipeUsesSlots(R({ kind: "op", op: "a:b" }))).toBe(false);
  });

  test("inputNames lists enabled literal tabs in document order, lanes included (CR262)", () => {
    expect(inputNames(doc("valid", "cr201"))).toEqual([
      { name: "orders.b64", path: "/steps/0" },
      { name: "customers.csv", path: "/steps/4/right/steps/0" },
    ]);
    expect(inputNames(doc("valid", "cr262")).map((n) => n.name)).toEqual([
      "orders.b64",
      "customers.csv",
    ]);
    const d = R(
      inp({ ref: "t" } as never),
      inp("off", { disabled: true }),
      {
        kind: "op",
        op: "union:x",
        disabled: true,
        left: lane(inp("inside")),
        right: lane(inp("x")),
      },
      { kind: "op", op: "input:tab", params: { tab: "bytes.bin" } },
    );
    expect(inputNames(d)).toEqual([{ name: "bytes.bin", path: "/steps/3" }]);
  });

  test("recipeUsesV12", () => {
    expect(recipeUsesV12(doc("valid", "cr201"))).toBe(true);
    expect(recipeUsesV12(doc("valid", "cr262"))).toBe(true);
    // a recipe that only reads a tab with input:tab is v1.2
    expect(recipeUsesV12(R({ kind: "op", op: "input:tab", params: { tab: "a" } }))).toBe(true);
    const plain = R({ kind: "op", op: "text:upper" });
    expect(recipeUsesV12(plain)).toBe(false);
    expect(recipeUsesV12(plain, { catalogue: seed })).toBe(false);
    // an ext parameter with a value, given a catalogue that marks it
    const extCat: CatalogueView = {
      version: seed.version,
      ops: [
        {
          qname: "t:x",
          aliases: [],
          input: "str",
          output: "str",
          params: [{ name: "e", type: "ext", kind: "k", required: false, index: 1 }],
          hash: "a".repeat(64),
          needsHardKill: false,
        },
      ],
    };
    expect(recipeUsesV12(R({ kind: "op", op: "t:x" }), { catalogue: extCat })).toBe(false);
    expect(
      recipeUsesV12(R({ kind: "op", op: "t:x", params: { e: "q" } }), { catalogue: extCat }),
    ).toBe(true);
    expect(recipeUsesV12(R({ kind: "op", op: "t:x", params: { e: "q" } }))).toBe(false);
    // an op in a pack vocabulary
    const packs = { vocabs: new Map([["t", "pack-t"]]) };
    expect(recipeUsesV12(R({ kind: "op", op: "t:x" }), { packs })).toBe(true);
    expect(recipeUsesV12(plain, { packs })).toBe(false);
  });

  test("dataSourcePath", () => {
    const d = doc("valid", "cr201"); // 0 input:tab, 1 decode, 2 parse, 3 select, 4 join{right lane}, 5 group, 6 sort
    expect(dataSourcePath(d, "/steps/0")).toBeNull();
    expect(dataSourcePath(d, "/steps/3")).toBe("/steps/2");
    expect(dataSourcePath(d, "/steps/4")).toBe("/steps/3");
    expect(dataSourcePath(d, "/steps/4/params/on")).toBe("/steps/3");
    // the first step of a lane reads the data entering the slot step
    expect(dataSourcePath(d, "/steps/4/right/steps/0")).toBe("/steps/3");
    expect(dataSourcePath(d, "/steps/4/right/steps/1")).toBe("/steps/4/right/steps/0");
    expect(dataSourcePath(d, "/steps/5")).toBe("/steps/4");
    expect(dataSourcePath(d, "/steps/9")).toBeNull();
    expect(dataSourcePath(d, "/nope")).toBeNull();
    // comments, registers and disabled steps are skipped; branches read what enters the if
    const e = R(
      inp("a"),
      { kind: "register", name: "r", steps: [] },
      { kind: "comment", text: "x" },
      { kind: "op", op: "a:off", disabled: true },
      {
        kind: "if",
        test: { kind: "regex", pattern: "x" },
        then: [{ kind: "op", op: "a:t" }],
        else: [
          { kind: "op", op: "a:e1" },
          { kind: "op", op: "a:e2" },
        ],
      },
    );
    expect(dataSourcePath(e, "/steps/4")).toBe("/steps/0");
    expect(dataSourcePath(e, "/steps/4/then/0")).toBe("/steps/0");
    expect(dataSourcePath(e, "/steps/4/else/1")).toBe("/steps/4/else/0");
  });
});
