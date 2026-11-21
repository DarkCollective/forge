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
import { describe, expect, it } from "vitest";
import type { Recipe, Step } from "@forge/recipe";
import { canDropOn, deepElementsFromPoint } from "./dnd.js";

interface Root {
  elementsFromPoint(x: number, y: number): unknown[];
}
const el = (name: string, shadowRoot: Root | null = null) => ({ name, shadowRoot });

describe("deepElementsFromPoint", () => {
  it("looks through shadow roots, innermost first", () => {
    const inner = el("inner");
    const shadow: Root = { elementsFromPoint: () => [inner] };
    const host = el("host", shadow);
    const doc: Root = { elementsFromPoint: () => [host] };
    expect(deepElementsFromPoint(0, 0, doc as unknown as Document)).toEqual([inner, host]);
  });

  it("terminates when a shadow root reports its own host (Chromium)", () => {
    const shadow: Root = { elementsFromPoint: () => [] };
    const host = el("host", shadow);
    shadow.elementsFromPoint = () => [host];
    const doc: Root = { elementsFromPoint: () => [host] };
    expect(deepElementsFromPoint(0, 0, doc as unknown as Document)).toEqual([host]);
  });

  it("lists each element once", () => {
    const a = el("a");
    const shadow: Root = { elementsFromPoint: () => [a] };
    const host = el("host", shadow);
    const doc: Root = { elementsFromPoint: () => [a, host, a] };
    expect(deepElementsFromPoint(0, 0, doc as unknown as Document)).toEqual([a, host]);
  });
});

describe("canDropOn (where a Return may be dropped)", () => {
  const fork: Step = {
    kind: "fork",
    split: { value: "\n", enc: "utf8" },
    join: { value: "\n", enc: "utf8" },
    steps: [],
  };
  const recipe: Recipe = {
    forge: 1,
    steps: [
      { kind: "return" },
      fork,
      { kind: "register", name: "x", steps: [] },
      {
        kind: "if",
        test: { kind: "regex", pattern: "." },
        then: [{ kind: "if", test: { kind: "regex", pattern: "." }, then: [] }],
        else: [],
      },
      { kind: "repeat", times: 2, steps: [] },
      { kind: "subsection", pattern: ".", steps: [] },
    ],
  };
  const ret = { type: "step", path: "/steps/0" } as const;

  it("offers the root and if branches at any depth", () => {
    expect(canDropOn(recipe, ret, "/steps")).toBe(true);
    expect(canDropOn(recipe, ret, "/steps/3/then")).toBe(true);
    expect(canDropOn(recipe, ret, "/steps/3/else")).toBe(true);
    expect(canDropOn(recipe, ret, "/steps/3/then/0/then")).toBe(true);
  });

  it("does not offer fork, subsection, repeat or register children", () => {
    for (const list of ["/steps/1/steps", "/steps/2/steps", "/steps/4/steps", "/steps/5/steps"]) {
      expect(canDropOn(recipe, ret, list), list).toBe(false);
    }
  });

  it("offers every list to an operation and to a register", () => {
    for (const list of ["/steps", "/steps/1/steps", "/steps/2/steps", "/steps/3/then"]) {
      expect(canDropOn(recipe, { type: "op", op: "a:b" }, list)).toBe(true);
      expect(canDropOn(recipe, { type: "step", path: "/steps/2" }, list)).toBe(
        list !== "/steps/2/steps",
      );
    }
  });

  it("does not offer a step its own children", () => {
    expect(canDropOn(recipe, { type: "step", path: "/steps/1" }, "/steps/1/steps")).toBe(false);
  });

  it("keeps a block that holds a return out of non-if containers", () => {
    expect(canDropOn(recipe, { type: "step", path: "/steps/3" }, "/steps/1/steps")).toBe(true);
    const holder: Recipe = {
      forge: 1,
      steps: [
        { kind: "if", test: { kind: "regex", pattern: "." }, then: [{ kind: "return" }] },
        fork,
      ],
    };
    expect(canDropOn(holder, { type: "step", path: "/steps/0" }, "/steps/1/steps")).toBe(false);
    expect(canDropOn(holder, { type: "step", path: "/steps/0" }, "/steps")).toBe(true);
  });
});
