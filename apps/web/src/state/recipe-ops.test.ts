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
import { REGISTER_NAME_RE, validateRecipe } from "@forge/recipe";
import type { Recipe, Step } from "@forge/recipe";
import { describe, expect, it } from "vitest";
import {
  canPlace,
  childLists,
  containsReturn,
  countSteps,
  duplicateStep,
  getStep,
  insertStep,
  listAllowsReturn,
  moveStep,
  patchStep,
  removeStep,
  setParam,
  splitStepPath,
  uniqueRegisterName,
} from "./recipe-ops.js";

const op = (name: string): Step => ({ kind: "op", op: name });
const names = (steps: readonly Step[]): string[] =>
  steps.map((s) => (s.kind === "op" ? s.op : s.kind));

const base: Recipe = {
  forge: 1,
  steps: [
    op("a:a"),
    {
      kind: "fork",
      split: { value: "\n", enc: "utf8" },
      join: { value: "\n", enc: "utf8" },
      steps: [op("b:b")],
    },
    { kind: "if", test: { kind: "regex", pattern: "x" }, then: [op("c:c")] },
    op("d:d"),
  ],
};

describe("recipe-ops", () => {
  it("reads steps by path", () => {
    expect(getStep(base, "/steps/0")).toEqual(op("a:a"));
    expect(getStep(base, "/steps/1/steps/0")).toEqual(op("b:b"));
    expect(getStep(base, "/steps/9")).toBeUndefined();
    expect(splitStepPath("/steps/2/then/1")).toEqual({ listPath: "/steps/2/then", index: 1 });
  });

  it("inserts at a position, into containers, and creates an omitted else", () => {
    let r = insertStep(base, "/steps", 1, op("x:x"));
    expect(names(r.steps)).toEqual(["a:a", "x:x", "fork", "if", "d:d"]);
    expect(names(base.steps)).toEqual(["a:a", "fork", "if", "d:d"]); // immutable
    r = insertStep(base, "/steps/1/steps", 99, op("x:x"));
    expect(names((r.steps[1] as Extract<Step, { kind: "fork" }>).steps)).toEqual(["b:b", "x:x"]);
    r = insertStep(base, "/steps/2/else", 0, op("e:e"));
    expect(names((r.steps[2] as Extract<Step, { kind: "if" }>).else ?? [])).toEqual(["e:e"]);
    expect(() => insertStep(base, "/steps/0", 0, op("x:x"))).toThrow(RangeError);
  });

  it("removes", () => {
    expect(names(removeStep(base, "/steps/0").steps)).toEqual(["fork", "if", "d:d"]);
    const r = removeStep(base, "/steps/1/steps/0");
    expect((r.steps[1] as Extract<Step, { kind: "fork" }>).steps).toEqual([]);
    expect(() => removeStep(base, "/steps/7")).toThrow(RangeError);
  });

  it("moves within a list using pre-move gap indexes", () => {
    // a b c d: move a to the gap before d (index 3) -> b c a d
    const r = moveStep(
      { forge: 1, steps: [op("a:a"), op("b:b"), op("c:c"), op("d:d")] },
      "/steps/0",
      "/steps",
      3,
    );
    expect(names(r.steps)).toEqual(["b:b", "c:c", "a:a", "d:d"]);
    // move d to the front
    const r2 = moveStep(
      { forge: 1, steps: [op("a:a"), op("b:b"), op("c:c"), op("d:d")] },
      "/steps/3",
      "/steps",
      0,
    );
    expect(names(r2.steps)).toEqual(["d:d", "a:a", "b:b", "c:c"]);
    // moving to its own position is a no-op
    const r3 = moveStep(base, "/steps/0", "/steps", 1);
    expect(names(r3.steps)).toEqual(names(base.steps));
  });

  it("moves across containers and fixes shifted sibling indexes", () => {
    // move step 0 into the fork (index 1 before the move, index 0 after)
    const r = moveStep(base, "/steps/0", "/steps/1/steps", 0);
    expect(names(r.steps)).toEqual(["fork", "if", "d:d"]);
    expect(names((r.steps[0] as Extract<Step, { kind: "fork" }>).steps)).toEqual(["a:a", "b:b"]);
    // move a nested step out
    const out = moveStep(base, "/steps/1/steps/0", "/steps", 4);
    expect(names(out.steps)).toEqual(["a:a", "fork", "if", "d:d", "b:b"]);
  });

  it("refuses to move a step into itself", () => {
    expect(moveStep(base, "/steps/1", "/steps/1/steps", 0)).toBe(base);
  });

  it("duplicates deeply", () => {
    const r = duplicateStep(base, "/steps/1");
    expect(names(r.steps)).toEqual(["a:a", "fork", "fork", "if", "d:d"]);
    expect(r.steps[1]).toEqual(r.steps[2]);
    expect(r.steps[1]).not.toBe(r.steps[2]);
  });

  it("patches, deleting keys set to undefined", () => {
    let r = patchStep(base, "/steps/0", { disabled: true, note: "hi" });
    expect(getStep(r, "/steps/0")).toEqual({ kind: "op", op: "a:a", disabled: true, note: "hi" });
    r = patchStep(r, "/steps/0", { disabled: undefined });
    expect(getStep(r, "/steps/0")).toEqual({ kind: "op", op: "a:a", note: "hi" });
  });

  it("sets and clears parameters, also on an if test", () => {
    let r = setParam(base, "/steps/0", "amount", 5);
    expect(getStep(r, "/steps/0")).toEqual({ kind: "op", op: "a:a", params: { amount: 5 } });
    r = setParam(r, "/steps/0", "amount", undefined);
    expect(getStep(r, "/steps/0")).toEqual({ kind: "op", op: "a:a" });
    const withTest: Recipe = {
      forge: 1,
      steps: [{ kind: "if", test: { kind: "op", op: "t:t" }, then: [] }],
    };
    r = setParam(withTest, "/steps/0/test", "p", "v");
    expect((r.steps[0] as Extract<Step, { kind: "if" }>).test).toEqual({
      kind: "op",
      op: "t:t",
      params: { p: "v" },
    });
  });

  it("lists child lists and counts steps", () => {
    const fork = base.steps[1] as Step;
    expect(childLists(fork, "/steps/1").map((c) => c.path)).toEqual(["/steps/1/steps"]);
    const iff = base.steps[2] as Step;
    expect(childLists(iff, "/steps/2").map((c) => c.path)).toEqual([
      "/steps/2/then",
      "/steps/2/else",
    ]);
    expect(childLists(base.steps[0] as Step, "/steps/0")).toEqual([]);
    expect(countSteps(base.steps)).toBe(6);
  });

  it("does not follow prototype keys", () => {
    expect(() => patchStep(base, "/steps/__proto__", { x: 1 })).toThrow(RangeError);
    expect(getStep(base, "/steps/0/__proto__")).toBeUndefined();
  });
});

describe("returns and registers", () => {
  const ret: Step = { kind: "return" };
  const reg = (name: string, steps: Step[] = []): Step => ({ kind: "register", name, steps });
  const fork = (steps: Step[]): Step => ({
    kind: "fork",
    split: { value: "\n", enc: "utf8" },
    join: { value: "\n", enc: "utf8" },
    steps,
  });
  const iff = (then: Step[], other?: Step[]): Step => ({
    kind: "if",
    test: { kind: "regex", pattern: "x" },
    then,
    ...(other === undefined ? {} : { else: other }),
  });

  it("allows a return in the root list and in if branches at any depth, and nowhere else", () => {
    for (const ok of [
      "/steps",
      "/steps/1/then",
      "/steps/1/else",
      "/steps/2/then/0/else",
      "/steps/0/then/3/then/1/else",
    ]) {
      expect(listAllowsReturn(ok), ok).toBe(true);
    }
    for (const bad of [
      "/steps/1/steps",
      "/steps/1/then/0/steps",
      "/steps/0/steps/2/then",
      "/steps/1/steps/0/else",
      "/steps/1",
      "/other",
    ]) {
      expect(listAllowsReturn(bad), bad).toBe(false);
    }
  });

  it("knows which blocks hold a return", () => {
    expect(containsReturn(ret)).toBe(true);
    expect(containsReturn(iff([op("a:a"), ret]))).toBe(true);
    expect(containsReturn(fork([iff([ret])]))).toBe(true);
    expect(containsReturn(iff([op("a:a")], [reg("x")]))).toBe(false);
  });

  it("canPlace refuses a return, or a block holding one, outside the valid lists", () => {
    expect(canPlace(ret, "/steps")).toBe(true);
    expect(canPlace(ret, "/steps/1/then")).toBe(true);
    expect(canPlace(ret, "/steps/1/steps")).toBe(false);
    expect(canPlace(iff([ret]), "/steps/0/steps")).toBe(false);
    expect(canPlace(op("a:a"), "/steps/0/steps")).toBe(true);
    expect(canPlace(reg("x"), "/steps/0/steps")).toBe(true);
  });

  it("moveStep leaves the recipe unchanged when a return would land in a fork, a register or a repeat", () => {
    const r: Recipe = {
      forge: 1,
      steps: [ret, fork([]), reg("x"), { kind: "repeat", times: 2, steps: [] }, iff([])],
    };
    expect(moveStep(r, "/steps/0", "/steps/1/steps", 0)).toBe(r);
    expect(moveStep(r, "/steps/0", "/steps/2/steps", 0)).toBe(r);
    expect(moveStep(r, "/steps/0", "/steps/3/steps", 0)).toBe(r);
    const ok = moveStep(r, "/steps/0", "/steps/4/then", 0);
    expect(ok).not.toBe(r);
    expect(getStep(ok, "/steps/3/then/0")?.kind).toBe("return");
  });

  it("moveStep also refuses an if that holds a return, but moves a register anywhere", () => {
    const r: Recipe = { forge: 1, steps: [iff([ret]), fork([]), reg("x")] };
    expect(moveStep(r, "/steps/0", "/steps/1/steps", 0)).toBe(r);
    const m = moveStep(r, "/steps/2", "/steps/1/steps", 0);
    expect(getStep(m, "/steps/1/steps/0")?.kind).toBe("register");
  });

  it("childLists gives a register its steps", () => {
    const step = reg("x", [op("a:a")]);
    expect(childLists(step, "/steps/0").map((l) => l.path)).toEqual(["/steps/0/steps"]);
    expect(childLists(ret, "/steps/0")).toEqual([]);
  });

  it("generates unique register names: value, value-2, ...", () => {
    expect(uniqueRegisterName({ forge: 1, steps: [] })).toBe("value");
    const one: Recipe = { forge: 1, steps: [reg("value")] };
    expect(uniqueRegisterName(one)).toBe("value-2");
    const nested: Recipe = {
      forge: 1,
      steps: [reg("value"), fork([reg("value-2", [reg("value-3")])])],
    };
    expect(uniqueRegisterName(nested)).toBe("value-4");
    expect(uniqueRegisterName(nested, "iv")).toBe("iv");
  });

  it("keeps generated names within 32 characters and valid", () => {
    const long = "a".repeat(32);
    const name = uniqueRegisterName({ forge: 1, steps: [reg(long)] }, long);
    expect(name).toHaveLength(32);
    expect(name.endsWith("-2")).toBe(true);
    expect(REGISTER_NAME_RE.test(name)).toBe(true);
  });

  it("duplicating a register gives the copy a free name", () => {
    const r: Recipe = { forge: 1, steps: [reg("iv", [op("a:a")])] };
    const d = duplicateStep(r, "/steps/0");
    expect((getStep(d, "/steps/1") as { name: string }).name).toBe("iv-2");
    expect((getStep(d, "/steps/0") as { name: string }).name).toBe("iv");
    expect(validateRecipe(d).issues.filter((i) => i.code === "duplicate-register")).toEqual([]);
  });
});
