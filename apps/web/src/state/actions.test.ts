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
import { DEFAULT_LAYOUT } from "./layout.js";
import { createActions, createAppStore, HISTORY_LIMIT } from "./actions.js";

function setup() {
  const store = createAppStore({ layout: { ...DEFAULT_LAYOUT }, theme: "system" });
  const actions = createActions(store, false);
  return { store, actions };
}

describe("recipe actions", () => {
  it("adds ops, revalidates, marks dirty and records history", () => {
    const { store, actions } = setup();
    expect(store.get().doc.dirty).toBe(false);
    const path = actions.addOp("hex:encode");
    expect(path).toBe("/steps/0");
    expect(store.get().recipe.steps).toEqual([{ kind: "op", op: "hex:encode" }]);
    expect(store.get().doc.dirty).toBe(true);
    expect(store.get().history.past).toHaveLength(1);
    // no catalogue yet: only structural checks run
    expect(store.get().issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("flags unknown ops once a catalogue is known", () => {
    const { store, actions } = setup();
    actions.addOp("nope:nope");
    actions.setCatalogue({ format: 1, version: "0".repeat(16), vocabs: [], ops: [] });
    const issues = store.get().issues;
    expect(issues.some((i) => i.code === "unknown-op" && i.path === "/steps/0/op")).toBe(true);
  });

  it("undoes and redoes, and a new edit clears redo", () => {
    const { store, actions } = setup();
    actions.addOp("a:a");
    actions.addOp("b:b");
    actions.undo();
    expect(store.get().recipe.steps).toHaveLength(1);
    actions.redo();
    expect(store.get().recipe.steps).toHaveLength(2);
    actions.undo();
    actions.addOp("c:c");
    expect(store.get().history.future).toHaveLength(0);
    actions.redo();
    expect(store.get().recipe.steps).toHaveLength(2);
  });

  it("bounds the history", () => {
    const { store, actions } = setup();
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) actions.setRecipeName(`n${i}`);
    expect(store.get().history.past.length).toBe(HISTORY_LIMIT);
  });

  it("names and clears the name", () => {
    const { store, actions } = setup();
    actions.setRecipeName("Decode");
    expect(store.get().recipe.name).toBe("Decode");
    actions.setRecipeName("");
    expect("name" in store.get().recipe).toBe(false);
  });

  it("clears the selection when its step is removed", () => {
    const { store, actions } = setup();
    actions.addOp("a:a");
    actions.addOp("b:b");
    actions.selectStep("/steps/1");
    actions.removeStep("/steps/1");
    expect(store.get().ui.selectedPath).toBeNull();
  });

  it("loadDocument replaces recipe and input, resets history and dirty", () => {
    const { store, actions } = setup();
    actions.addOp("a:a");
    actions.loadDocument({
      recipe: { forge: 1, steps: [{ kind: "op", op: "b:b" }] },
      input: new Uint8Array([1, 2]),
      inputEncoding: "hex",
      savedId: "r1",
    });
    const s = store.get();
    expect(s.history.past).toHaveLength(0);
    expect(s.doc).toEqual({ savedId: "r1", dirty: false });
    expect(s.inputs[0]?.bytes).toEqual(new Uint8Array([1, 2]));
    expect(s.inputs[0]?.encoding).toBe("hex");
  });

  it("marks a finished bake stale when the recipe or input changes", () => {
    const { store, actions } = setup();
    actions.setBake({ status: "done", result: { ok: true } as never });
    actions.addOp("a:a");
    expect(store.get().bake.stale).toBe(true);
    actions.setBake({ stale: false });
    actions.setInputBytes(store.get().activeInputId, new Uint8Array([9]));
    expect(store.get().bake.stale).toBe(true);
  });
});

describe("input tabs", () => {
  it("adds, selects and closes tabs, keeping at least one", () => {
    const { store, actions } = setup();
    const first = store.get().activeInputId;
    const second = actions.addInput();
    expect(store.get().activeInputId).toBe(second);
    actions.closeInput(second);
    expect(store.get().activeInputId).toBe(first);
    actions.closeInput(first);
    expect(store.get().inputs).toHaveLength(1);
  });
});

describe("ui actions", () => {
  it("compact tab 'console' opens the console, closing the console leaves the tab", () => {
    const { store, actions } = setup();
    actions.setCompactTab("console");
    expect(store.get().ui.consoleOpen).toBe(true);
    actions.setConsoleOpen(false);
    expect(store.get().ui.compactTab).toBe("recipe");
  });

  it("announce changes the id every time", () => {
    const { store, actions } = setup();
    actions.announce("x");
    const a = store.get().ui.announcement.id;
    actions.announce("x");
    expect(store.get().ui.announcement.id).toBe(a + 1);
  });

  it("favourites toggle and dedupe", () => {
    const { store, actions } = setup();
    actions.toggleFavourite("a:a");
    actions.toggleFavourite("b:b");
    actions.toggleFavourite("a:a");
    expect(store.get().favourites).toEqual(["b:b"]);
    actions.setFavourites(["x:x", "x:x"]);
    expect(store.get().favourites).toEqual(["x:x"]);
  });
});
