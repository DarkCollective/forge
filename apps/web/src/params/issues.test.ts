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
import { describe, expect, it } from "vitest";
import { validateRecipe, type RecipeIssue } from "@forge/recipe";
import type { Catalogue } from "@forge/ops";
import { escapePointer, issuesForPath, paramIssues } from "./issues.js";

const issue = (path: string, code = "bad-param"): RecipeIssue =>
  ({ code, severity: "error", path, message: path }) as RecipeIssue;

describe("issuesForPath", () => {
  const all = [
    issue("/steps/1"),
    issue("/steps/1/params/a"),
    issue("/steps/10/params/a"),
    issue("/steps/1/params/a/value", "bad-encoding"),
    issue("/steps/0/params/a"),
  ];
  it("matches the path itself and descendants only", () => {
    expect(issuesForPath(all, "/steps/1").map((i) => i.path)).toEqual([
      "/steps/1",
      "/steps/1/params/a",
      "/steps/1/params/a/value",
    ]);
    expect(issuesForPath(all, "/steps/2")).toEqual([]);
  });
});

describe("paramIssues", () => {
  it("selects one parameter incl. value and enc children, not prefixes of other names", () => {
    const all = [
      issue("/steps/0/params/key"),
      issue("/steps/0/params/key/value", "bad-encoding"),
      issue("/steps/0/params/key/enc"),
      issue("/steps/0/params/keyfile"),
      issue("/steps/2/test/params/key"),
    ];
    expect(paramIssues(all, "/steps/0", "key")).toHaveLength(3);
    expect(paramIssues(all, "/steps/2/test", "key")).toHaveLength(1);
    expect(paramIssues(all, "/steps/0", "keyfile")).toHaveLength(1);
  });
  it("escapes pointer tokens", () => {
    expect(escapePointer("a/b~c")).toBe("a~1b~0c");
    expect(paramIssues([issue("/steps/0/params/a~1b")], "/steps/0", "a/b")).toHaveLength(1);
  });
});

describe("against the real validator and catalogue", () => {
  const catalogue = JSON.parse(
    readFileSync(new URL("../../../../packages/ops/dist/catalogue.json", import.meta.url), "utf8"),
  ) as Catalogue;
  const run = (steps: unknown[]) => validateRecipe({ forge: 1, steps }, catalogue).issues;

  it("an unparsable int committed as raw text lands on that field", () => {
    const issues = run([{ kind: "op", op: "classical:rot", params: { amount: "1e" } }]);
    const mine = paramIssues(issues, "/steps/0", "amount");
    expect(mine.map((i) => i.code)).toEqual(["bad-param"]);
    expect(mine[0]?.message.length).toBeGreaterThan(0);
  });
  it("an out-of-range int reports the constraint", () => {
    const issues = run([{ kind: "op", op: "classical:rot", params: { amount: 26 } }]);
    const mine = paramIssues(issues, "/steps/0", "amount");
    expect(mine).toHaveLength(1);
    expect(mine[0]?.detail?.constraint).toBe("[0..25]");
  });
  it("missing required parameters and bad regexes", () => {
    const issues = run([{ kind: "op", op: "regex:replace", params: { pattern: "(" } }]);
    expect(paramIssues(issues, "/steps/0", "pattern").map((i) => i.code)).toEqual(["bad-regex"]);
    expect(paramIssues(issues, "/steps/0", "replacement").map((i) => i.code)).toEqual([
      "missing-param",
    ]);
    expect(paramIssues(issues, "/steps/0", "flags")).toEqual([]);
  });
});
