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
import { describe, expect, test } from "vitest";
import { planTryIt } from "./try-it.js";
import { applyTryIt } from "./try-it-apply.js";
import type { TryItActions } from "./try-it-apply.js";

function fake(): { calls: string[]; a: TryItActions } {
  const calls: string[] = [];
  const a: TryItActions = {
    setInputBytes: (id, b) => calls.push(`bytes ${id} ${b.length}`),
    selectInput: (id) => calls.push(`select ${id}`),
    addInput: (name, b) => {
      calls.push(`add ${name} ${b.length}`);
      return "new1";
    },
    setInputEncoding: (id, e) => calls.push(`enc ${id} ${e}`),
    setInputEol: (id, e) => calls.push(`eol ${id} ${e}`),
    setRecipe: () => calls.push("recipe"),
  };
  return { calls, a };
}

const csv = { params: {}, input: { value: "a,b\r\n1,2\r\n", enc: "utf8" } };

describe("applyTryIt", () => {
  test("a CR LF example sets the tab's line ending, in an empty active tab", () => {
    const plan = planTryIt("csv:to-json", csv);
    if (!plan.ok) throw new Error(plan.message);
    const { calls, a } = fake();
    applyTryIt(a, [{ id: "t1", name: "Input 1", bytes: new Uint8Array() }], "t1", "Example", plan);
    expect(calls).toEqual(["bytes t1 10", "enc t1 utf8", "eol t1 crlf", "recipe"]);
  });

  test("a new tab gets the line ending too", () => {
    const plan = planTryIt("csv:to-json", csv);
    if (!plan.ok) throw new Error(plan.message);
    const { calls, a } = fake();
    applyTryIt(a, [{ id: "t1", name: "x", bytes: new Uint8Array([1]) }], "t1", "Example", plan);
    expect(calls).toEqual(["add Example 10", "enc new1 utf8", "eol new1 crlf", "recipe"]);
  });

  test("mixed line endings: the most common one, a tie goes to LF (as for a loaded file)", () => {
    const mixed = (value: string) =>
      planTryIt("x:y", { params: {}, input: { value, enc: "utf8" } });
    const a = mixed("a\r\nb\r\nc\n");
    const b = mixed("a\r\nb\n");
    if (!a.ok || !b.ok) throw new Error("plan");
    expect(a.eol).toBe("crlf");
    expect(b.eol).toBe("lf");
    expect(Array.from(b.bytes)).toEqual([97, 13, 10, 98, 10]);
  });
});
