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
import { readFileSync } from "node:fs";
import { validateRecipe } from "@forge/recipe";
import type { Recipe, Step } from "@forge/recipe";
import type { Catalogue } from "@forge/ops";
import { describe, expect, it } from "vitest";
import { describeIssue, paramIssues } from "./issues.js";
import { fieldIssues, ownIssues, stepLevelIssues } from "../recipe/issues.js";
import {
  firstRef,
  modeOf,
  pickerOptions,
  refName,
  registerChoices,
  valueAfterSwitchBack,
} from "./registers.js";

const catalogue = JSON.parse(
  readFileSync(new URL("../../../../packages/ops/dist/catalogue.json", import.meta.url), "utf8"),
) as Catalogue;

const reg = (name: string, steps: Step[] = [], extra: object = {}): Step =>
  ({ kind: "register", name, steps, ...extra }) as Step;
const rot = (amount: unknown, extra: object = {}): Step =>
  ({ kind: "op", op: "classical:rot", params: { amount }, ...extra }) as Step;
const fork = (steps: Step[]): Step => ({
  kind: "fork",
  split: { value: "\n", enc: "utf8" },
  join: { value: "\n", enc: "utf8" },
  steps,
});
const rec = (...steps: Step[]): Recipe => ({ forge: 1, steps });
const issuesOf = (r: Recipe) => validateRecipe(r, catalogue).issues;

describe("the register picker", () => {
  const r = rec(reg("a"), fork([reg("b"), rot(1), rot(2)]), rot(3), reg("late"));

  it("offers the registers in scope at the step, outermost first", () => {
    expect(registerChoices(r, "/steps/1/steps/1").map((c) => c.name)).toEqual(["a", "b"]);
    expect(registerChoices(r, "/steps/2").map((c) => c.name)).toEqual(["a"]);
  });
  it("offers nothing before the first register, and nothing for a path that is not a step", () => {
    expect(registerChoices(rec(rot(1), reg("a")), "/steps/0")).toEqual([]);
    expect(registerChoices(r, "/steps/99")).toEqual([]);
  });
  it("uses the step an if test belongs to", () => {
    const withIf = rec(reg("a"), {
      kind: "if",
      test: { kind: "op", op: "text:is-empty" },
      then: [],
    } as Step);
    expect(registerChoices(withIf, "/steps/1/test").map((c) => c.name)).toEqual(["a"]);
  });
  it("marks a register that feeds a key parameter as secret", () => {
    const keyed = rec(reg("k"), {
      kind: "op",
      op: "aes:encrypt",
      params: { key: { ref: "k" } },
    } as Step);
    const choices = registerChoices(keyed, "/steps/1", catalogue);
    expect(choices.map((c) => [c.name, c.secret])).toEqual([["k", true]]);
    expect(registerChoices(keyed, "/steps/1").map((c) => c.secret)).toEqual([false]);
  });
  it("keeps a stored name that is not in scope visible in the list", () => {
    const choices = registerChoices(r, "/steps/2");
    expect(pickerOptions(choices, "late")).toEqual([
      { name: "late", secret: false, inScope: false },
      { name: "a", secret: false, inScope: true },
    ]);
    expect(pickerOptions(choices, "a").map((o) => o.name)).toEqual(["a"]);
    expect(pickerOptions(choices, undefined).map((o) => o.name)).toEqual(["a"]);
  });
});

describe("the Value / Register switch", () => {
  it("tells the two modes apart by shape", () => {
    expect(modeOf({ ref: "a" })).toBe("register");
    expect(modeOf({ value: "a", enc: "utf8" })).toBe("value");
    expect(modeOf(3)).toBe("value");
    expect(modeOf(undefined)).toBe("value");
    expect(refName({ ref: "a" })).toBe("a");
    expect(refName("a")).toBeUndefined();
  });
  it("switches to the nearest register, or nothing when there is none", () => {
    expect(firstRef([])).toBeUndefined();
    const choices = registerChoices(rec(reg("a"), reg("b"), rot(1)), "/steps/2");
    expect(firstRef(choices)).toEqual({ ref: "b" });
  });
  it("switches back to the last value, or to the default", () => {
    expect(valueAfterSwitchBack(7)).toBe(7);
    expect(valueAfterSwitchBack({ value: "ab", enc: "hex" })).toEqual({ value: "ab", enc: "hex" });
    expect(valueAfterSwitchBack(undefined)).toBeUndefined();
    expect(valueAfterSwitchBack({ ref: "a" })).toBeUndefined();
  });
  it("a reference skips the static constraint check (it is checked when the recipe runs)", () => {
    const bad = issuesOf(rec(rot(99)));
    expect(paramIssues(bad, "/steps/0", "amount").length).toBeGreaterThan(0);
    const viaRef = issuesOf(rec(reg("n"), rot({ ref: "n" }, {})));
    expect(viaRef.filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("issue mapping of the register and return codes", () => {
  const find = (r: Recipe, code: string) => {
    const hit = issuesOf(r).find((i) => i.code === code);
    expect(hit, code).toBeDefined();
    return hit as NonNullable<typeof hit>;
  };

  it("unknown-register lands on the parameter, with a message for each reason", () => {
    const cases: [string, Recipe][] = [
      ["not-defined", rec(rot({ ref: "nope" }))],
      ["not-yet-defined", rec(rot({ ref: "a" }), reg("a"))],
      ["out-of-scope", rec(fork([reg("a")]), rot({ ref: "a" }))],
      ["disabled", rec(reg("a", [], { disabled: true }), rot({ ref: "a" }))],
    ];
    const seen = new Set<string>();
    for (const [reason, r] of cases) {
      const issue = find(r, "unknown-register");
      expect(issue.detail?.["reason"], reason).toBe(reason);
      const path = r.steps.findIndex((s) => s.kind === "op");
      expect(issue.path).toBe(`/steps/${path}/params/amount/ref`);
      expect(paramIssues([issue], `/steps/${path}`, "amount")).toHaveLength(1);
      const text = describeIssue(issue);
      expect(text, reason).toContain('"');
      expect(text).not.toBe(issue.message);
      seen.add(text);
    }
    expect(seen.size).toBe(4);
  });

  it("unknown-register in the op test of an if lands on that parameter", () => {
    const r = rec({
      kind: "if",
      test: { kind: "op", op: "luhn:validate", params: { radix: { ref: "q" } } },
      then: [],
    } as Step);
    const issue = issuesOf(r).find((i) => i.code === "unknown-register");
    expect(issue?.path).toBe("/steps/0/test/params/radix/ref");
    expect(paramIssues(issuesOf(r), "/steps/0/test", "radix").map((i) => i.code)).toContain(
      "unknown-register",
    );
  });

  it("duplicate-register shows on the name field of the register card, not at step level", () => {
    const r = rec(reg("a"), reg("a"));
    const issue = find(r, "duplicate-register");
    expect(issue.path).toBe("/steps/1/name");
    expect(fieldIssues(issuesOf(r), "/steps/1", "name")).toHaveLength(1);
    expect(stepLevelIssues(issuesOf(r), "/steps/1")).toEqual([]);
    expect(describeIssue(issue)).toContain("step 1");
    expect(describeIssue(issue)).toContain("another name");
  });

  it("bad-position shows on the return card, with the container named", () => {
    const r = rec(fork([{ kind: "return" }]));
    const issue = find(r, "bad-position");
    expect(issue.path).toBe("/steps/0/steps/0");
    expect(stepLevelIssues(issuesOf(r), "/steps/0/steps/0").map((i) => i.code)).toEqual([
      "bad-position",
    ]);
    const text = describeIssue(issue);
    expect(text).toContain("Fork step 1");
    expect(text).toContain("branches of an If");
  });

  it("unreachable-step is a warning on the first step after the return", () => {
    const r = rec({ kind: "return" }, rot(1), rot(2));
    const issue = find(r, "unreachable-step");
    expect(issue.severity).toBe("warning");
    expect(issue.path).toBe("/steps/1");
    expect(ownIssues(issuesOf(r), "/steps/1").map((i) => i.code)).toContain("unreachable-step");
    expect(describeIssue(issue)).toContain("Return at step 1");
  });

  it("leaves the validator's text for every other code", () => {
    const issue = issuesOf(rec(rot(99)))[0];
    expect(issue).toBeDefined();
    expect(describeIssue(issue as NonNullable<typeof issue>)).toBe(issue?.message);
  });
});
