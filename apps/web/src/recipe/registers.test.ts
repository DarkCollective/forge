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
import { getStep } from "../state/recipe-ops.js";
import { BLOCK_KINDS, defaultBlock } from "./defaults.js";
import { blockedByPosition, moveTarget } from "./move.js";
import {
  blockPlacement,
  referenceCount,
  registerNameProblem,
  renameRegister,
} from "./registers.js";

const ref = (name: string): { ref: string } => ({ ref: name });
const use = (name: string, param = "key"): Step => ({
  kind: "op",
  op: "x:use",
  params: { [param]: ref(name) },
});
const reg = (name: string, steps: Step[] = []): Step => ({ kind: "register", name, steps });
const ret: Step = { kind: "return" };
const fork = (steps: Step[]): Step => ({
  kind: "fork",
  split: { value: "\n", enc: "utf8" },
  join: { value: "\n", enc: "utf8" },
  steps,
});
const iff = (then: Step[], other: Step[] = [], test?: Step): Step =>
  ({
    kind: "if",
    test: test ?? { kind: "regex", pattern: "." },
    then,
    else: other,
  }) as Step;
const rec = (...steps: Step[]): Recipe => ({ forge: 1, steps });

describe("defaultBlock for registers and returns", () => {
  it("offers both kinds and every default is valid", () => {
    expect(BLOCK_KINDS).toContain("register");
    expect(BLOCK_KINDS).toContain("return");
    expect(defaultBlock("return")).toEqual({ kind: "return" });
  });
  it("names a new register uniquely and validly", () => {
    const r = rec(reg("value"), fork([reg("value-2")]));
    const step = defaultBlock("register", r);
    expect(step).toEqual({ kind: "register", name: "value-3", steps: [] });
    expect(REGISTER_NAME_RE.test((step as { name: string }).name)).toBe(true);
    expect(defaultBlock("register")).toEqual({ kind: "register", name: "value", steps: [] });
    const added = rec(...r.steps, step);
    expect(validateRecipe(added).issues.filter((i) => i.code === "duplicate-register")).toEqual([]);
  });
});

describe("blockPlacement", () => {
  const r = rec(
    { kind: "op", op: "a:a" },
    fork([{ kind: "op", op: "a:b" }]),
    iff([{ kind: "op", op: "a:c" }]),
    reg("x", [{ kind: "op", op: "a:d" }]),
  );
  it("goes after the selection, or at the end when nothing is selected", () => {
    expect(blockPlacement(r, "/steps/0", ret)).toEqual({ listPath: "/steps", index: 1 });
    expect(blockPlacement(r, null, ret)).toEqual({ listPath: "/steps", index: 4 });
    expect(blockPlacement(r, "/steps/9", ret)).toEqual({ listPath: "/steps", index: 4 });
  });
  it("puts a return in an if branch next to the selection", () => {
    expect(blockPlacement(r, "/steps/2/then/0", ret)).toEqual({
      listPath: "/steps/2/then",
      index: 1,
    });
  });
  it("moves a return out of a fork or register to after that block", () => {
    expect(blockPlacement(r, "/steps/1/steps/0", ret)).toEqual({ listPath: "/steps", index: 2 });
    expect(blockPlacement(r, "/steps/3/steps/0", ret)).toEqual({ listPath: "/steps", index: 4 });
  });
  it("lets a register go next to any selection", () => {
    expect(blockPlacement(r, "/steps/1/steps/0", reg("n"))).toEqual({
      listPath: "/steps/1/steps",
      index: 1,
    });
  });
});

describe("renaming a register", () => {
  it("rejects names that do not fit the pattern", () => {
    expect(registerNameProblem("iv")).toBe("");
    expect(registerNameProblem("a-b2")).toBe("");
    expect(registerNameProblem("")).not.toBe("");
    expect(registerNameProblem("Iv")).not.toBe("");
    expect(registerNameProblem("1a")).not.toBe("");
    expect(registerNameProblem("a_b")).not.toBe("");
    expect(registerNameProblem("a".repeat(33))).toMatch(/32/);
  });

  it("re-points the references that resolve to it, and only those", () => {
    const r = rec(
      reg("iv"),
      use("iv"),
      fork([reg("iv-inner"), use("iv", "other")]),
      iff([use("iv")], [], { kind: "op", op: "x:is", params: { key: ref("iv") } } as never),
      use("other"),
    );
    const out = renameRegister(r, "/steps/0", "nonce");
    expect(out.clash).toBe(false);
    expect(out.updated).toBe(4);
    expect((getStep(out.recipe, "/steps/0") as { name: string }).name).toBe("nonce");
    expect(JSON.stringify(out.recipe)).not.toContain('"iv"');
    expect(JSON.stringify(out.recipe)).toContain('"ref":"other"');
    const unknown = validateRecipe(out.recipe).issues.filter((i) => i.code === "unknown-register");
    expect(unknown.map((u) => u.detail?.["register"])).toEqual(["other"]);
  });

  it("leaves a reference to another register of the same name alone", () => {
    const r = rec(
      fork([reg("iv"), use("iv")]),
      iff([reg("iv"), use("iv")], [reg("iv"), use("iv")]),
    );
    const out = renameRegister(r, "/steps/1/then/0", "k");
    expect(out.updated).toBe(1);
    expect(getStep(out.recipe, "/steps/1/then/1")).toEqual(use("k"));
    expect(getStep(out.recipe, "/steps/1/else/1")).toEqual(use("iv"));
    expect(getStep(out.recipe, "/steps/0/steps/1")).toEqual(use("iv"));
  });

  it("does not touch references when the new name is already visible", () => {
    const r = rec(reg("a"), reg("b"), use("b"));
    const out = renameRegister(r, "/steps/1", "a");
    expect(out.clash).toBe(true);
    expect(out.updated).toBe(0);
    expect((getStep(out.recipe, "/steps/1") as { name: string }).name).toBe("a");
    const codes = validateRecipe(out.recipe).issues.map((i) => i.code);
    expect(codes).toContain("duplicate-register");
  });

  it("is a no-op for the same name or for a step that is not a register", () => {
    const r = rec(reg("a"), use("a"));
    expect(renameRegister(r, "/steps/0", "a").recipe).toBe(r);
    expect(renameRegister(r, "/steps/1", "z").recipe).toBe(r);
    expect(renameRegister(r, "/steps/7", "z").recipe).toBe(r);
  });

  it("counts the references to a register", () => {
    const r = rec(reg("a"), use("a"), fork([use("a")]), reg("b"), use("a"));
    expect(referenceCount(r, "/steps/0")).toBe(3);
    expect(referenceCount(r, "/steps/3")).toBe(0);
    expect(referenceCount(r, "/steps/1")).toBe(0);
  });
});

describe("moving a return by keyboard", () => {
  const r = rec(
    { kind: "op", op: "a:a" },
    reg("x"),
    ret,
    iff([{ kind: "op", op: "a:b" }], [ret]),
    fork([{ kind: "op", op: "a:c" }]),
    ret,
  );
  it("cannot enter the register above, a fork above, or leave an if into one", () => {
    expect(moveTarget(r, "/steps/2", "in")).toBeNull();
    expect(blockedByPosition(r, "/steps/2", "in")).toBe(true);
    expect(moveTarget(r, "/steps/5", "in")).toBeNull();
    expect(blockedByPosition(r, "/steps/5", "in")).toBe(true);
  });
  it("can enter the if above and move among siblings", () => {
    const into = moveTarget(rec({ kind: "op", op: "a:a" }, iff([]), ret), "/steps/2", "in");
    expect(into).toEqual({ listPath: "/steps/1/then", gap: 0 });
    expect(moveTarget(r, "/steps/2", "up")).toEqual({ listPath: "/steps", gap: 1 });
    expect(blockedByPosition(r, "/steps/2", "up")).toBe(false);
  });
  it("lets a return leave an if to the root and a register move anywhere", () => {
    expect(moveTarget(r, "/steps/3/else/0", "out")).toEqual({ listPath: "/steps", gap: 4 });
    expect(moveTarget(r, "/steps/1", "in")).toBeNull(); // the op above is not a container
    const q = rec(fork([]), reg("x"));
    expect(moveTarget(q, "/steps/1", "in")).toEqual({ listPath: "/steps/0/steps", gap: 0 });
  });
  it("has nothing to announce when the key has no effect at all", () => {
    expect(blockedByPosition(r, "/steps/0", "up")).toBe(false);
  });
});
