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
import { validateRecipe } from "@forge/recipe";
import type { Recipe, RecipeIssue, Step } from "@forge/recipe";
import { describe, expect, it } from "vitest";
import { getStep, moveStep } from "../state/recipe-ops.js";
import { BLOCK_KINDS, defaultBlock } from "./defaults.js";
import { fieldIssues, issueCounts, ownIssues, stepLevelIssues } from "./issues.js";
import { moveTarget } from "./move.js";
import type { MoveKey } from "./move.js";
import { ownerOfList, pathAfterMove, stepNumber } from "./paths.js";

const op = (name: string): Step => ({ kind: "op", op: name });
const label = (s: Step | undefined): string =>
  s === undefined ? "?" : s.kind === "op" ? s.op : s.kind;

// 0:a  1:fork[ 0:b 1:c ]  2:d  3:if{ then[ e ] else[ f ] }  4:g
const recipe: Recipe = {
  forge: 1,
  steps: [
    op("t:a"),
    {
      kind: "fork",
      split: { value: "\n", enc: "utf8" },
      join: { value: "\n", enc: "utf8" },
      steps: [op("t:b"), op("t:c")],
    },
    op("t:d"),
    { kind: "if", test: { kind: "regex", pattern: "." }, then: [op("t:e")], else: [op("t:f")] },
    op("t:g"),
  ],
};

describe("stepNumber and ownerOfList", () => {
  it("numbers every level from 1", () => {
    expect(stepNumber("/steps/0")).toBe("1");
    expect(stepNumber("/steps/3/else/1")).toBe("4.2");
    expect(stepNumber("/steps/1/steps/0/steps/4")).toBe("2.1.5");
  });
  it("finds the owner of a list", () => {
    expect(ownerOfList("/steps")).toBeNull();
    expect(ownerOfList("/steps/3/then")).toBe("/steps/3");
  });
});

describe("moveTarget", () => {
  const apply = (path: string, key: MoveKey): { recipe: Recipe; to: string } | null => {
    const t = moveTarget(recipe, path, key);
    if (t === null) return null;
    const next = moveStep(recipe, path, t.listPath, t.gap);
    return { recipe: next, to: pathAfterMove(path, t.listPath, t.gap) };
  };

  it("moves among siblings", () => {
    expect(apply("/steps/2", "up")?.to).toBe("/steps/1");
    expect(label(getStep(apply("/steps/2", "up")?.recipe as Recipe, "/steps/1"))).toBe("t:d");
    expect(apply("/steps/2", "down")?.to).toBe("/steps/3");
    expect(label(getStep(apply("/steps/2", "down")?.recipe as Recipe, "/steps/3"))).toBe("t:d");
  });

  it("stops at the ends of the root list", () => {
    expect(moveTarget(recipe, "/steps/0", "up")).toBeNull();
    expect(moveTarget(recipe, "/steps/4", "down")).toBeNull();
    expect(moveTarget(recipe, "/steps/0", "out")).toBeNull();
    expect(moveTarget(recipe, "/steps/0", "in")).toBeNull();
  });

  it("moves into the container above, as its last child", () => {
    const r = apply("/steps/2", "in");
    expect(r?.to).toBe("/steps/1/steps/2");
    expect(label(getStep(r?.recipe as Recipe, "/steps/1/steps/2"))).toBe("t:d");
  });

  it("does not move into a plain op", () => {
    expect(moveTarget(recipe, "/steps/1", "in")).toBeNull();
    expect(moveTarget(recipe, "/steps/1/steps/1", "in")).toBeNull();
  });

  it("moves out after the container", () => {
    const r = apply("/steps/1/steps/0", "out");
    expect(r?.to).toBe("/steps/2");
    expect(label(getStep(r?.recipe as Recipe, "/steps/2"))).toBe("t:b");
    expect(label(getStep(r?.recipe as Recipe, "/steps/1"))).toBe("fork");
  });

  it("moves out of a nested lane to the parent list", () => {
    const r = apply("/steps/3/else/0", "out");
    expect(r?.to).toBe("/steps/4");
    expect(label(getStep(r?.recipe as Recipe, "/steps/4"))).toBe("t:f");
  });

  it("walks from the then lane to the else lane and back", () => {
    const down = apply("/steps/3/then/0", "down");
    expect(down?.to).toBe("/steps/3/else/0");
    expect(label(getStep(down?.recipe as Recipe, "/steps/3/else/0"))).toBe("t:e");
    const up = apply("/steps/3/else/0", "up");
    expect(up?.to).toBe("/steps/3/then/1");
    expect(label(getStep(up?.recipe as Recipe, "/steps/3/then/1"))).toBe("t:f");
  });

  it("creates an omitted else lane", () => {
    const noElse: Recipe = {
      forge: 1,
      steps: [{ kind: "if", test: { kind: "regex", pattern: "." }, then: [op("t:e")] }],
    };
    const t = moveTarget(noElse, "/steps/0/then/0", "down");
    expect(t).toEqual({ listPath: "/steps/0/else", gap: 0 });
    const next = moveStep(noElse, "/steps/0/then/0", "/steps/0/else", 0);
    expect(label(getStep(next, "/steps/0/else/0"))).toBe("t:e");
  });

  it("predicts the final path for every key and step", () => {
    const keys: MoveKey[] = ["up", "down", "in", "out"];
    const paths = [
      "/steps/0",
      "/steps/1",
      "/steps/1/steps/0",
      "/steps/1/steps/1",
      "/steps/2",
      "/steps/3",
      "/steps/3/then/0",
      "/steps/3/else/0",
      "/steps/4",
    ];
    for (const p of paths) {
      for (const k of keys) {
        const t = moveTarget(recipe, p, k);
        if (t === null) continue;
        const moved = moveStep(recipe, p, t.listPath, t.gap);
        const where = pathAfterMove(p, t.listPath, t.gap);
        expect(label(getStep(moved, where)), `${p} ${k}`).toBe(label(getStep(recipe, p)));
      }
    }
  });
});

describe("pathAfterMove", () => {
  it("shifts a target list below a later sibling", () => {
    // Move step 0 into the fork at index 1: the fork becomes index 0.
    expect(pathAfterMove("/steps/0", "/steps/1/steps", 2)).toBe("/steps/0/steps/2");
  });
});

describe("defaultBlock", () => {
  it("produces valid steps", () => {
    for (const kind of BLOCK_KINDS) {
      const r = validateRecipe({ forge: 1, steps: [defaultBlock(kind)] });
      expect(r.ok, kind).toBe(true);
    }
  });
});

describe("issue selection", () => {
  const issue = (path: string, severity: "error" | "warning" = "error"): RecipeIssue => ({
    code: "bad-value",
    severity,
    path,
    message: path,
  });
  const issues = [
    issue("/steps/1"),
    issue("/steps/1/split/value"),
    issue("/steps/1/params/x"),
    issue("/steps/1/steps/0", "warning"),
    issue("/steps/1/steps/0/params/y"),
    issue("/steps/10"),
  ];

  it("keeps a step's own issues apart from its children's", () => {
    expect(ownIssues(issues, "/steps/1").map((i) => i.path)).toEqual([
      "/steps/1",
      "/steps/1/split/value",
      "/steps/1/params/x",
    ]);
  });
  it("does not confuse /steps/1 with /steps/10", () => {
    expect(issueCounts(issues, "/steps/10")).toEqual({ errors: 1, warnings: 0 });
  });
  it("counts the whole subtree", () => {
    expect(issueCounts(issues, "/steps/1")).toEqual({ errors: 4, warnings: 1 });
  });
  it("maps fields and leaves step-level ones", () => {
    expect(fieldIssues(issues, "/steps/1", "split")).toHaveLength(1);
    expect(stepLevelIssues(issues, "/steps/1").map((i) => i.path)).toEqual(["/steps/1"]);
  });
});
