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
import { describe, expect, it, vi } from "vitest";
import { createStore } from "./store.js";

describe("createStore", () => {
  it("merges patches and replaces state immutably", () => {
    const store = createStore({ a: 1, b: { n: 1 } });
    const before = store.get();
    store.set({ a: 2 });
    expect(store.get()).toEqual({ a: 2, b: { n: 1 } });
    expect(store.get()).not.toBe(before);
    expect(store.get().b).toBe(before.b);
  });

  it("accepts an updater function", () => {
    const store = createStore({ n: 1 });
    store.set((s) => ({ n: s.n + 1 }));
    expect(store.get().n).toBe(2);
  });

  it("notifies synchronously with the previous state, and only when something changed", () => {
    const store = createStore({ a: 1, b: 1 });
    const listener = vi.fn();
    store.subscribe(listener);
    store.set({ a: 1 });
    expect(listener).not.toHaveBeenCalled();
    store.set({ a: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]).toEqual([
      { a: 2, b: 1 },
      { a: 1, b: 1 },
    ]);
  });

  it("unsubscribes", () => {
    const store = createStore({ a: 1 });
    const listener = vi.fn();
    const off = store.subscribe(listener);
    off();
    store.set({ a: 2 });
    expect(listener).not.toHaveBeenCalled();
  });

  it("select fires only when the selected value changes", () => {
    const store = createStore({ a: 1, b: 1 });
    const seen: number[] = [];
    store.select(
      (s) => s.a,
      (v) => seen.push(v),
    );
    store.set({ b: 2 });
    store.set({ a: 5 });
    store.set({ b: 3 });
    expect(seen).toEqual([5]);
  });

  it("select supports immediate and custom equality", () => {
    const store = createStore({ list: [1, 2] });
    const seen: number[][] = [];
    store.select(
      (s) => s.list,
      (v) => seen.push(v),
      { immediate: true, equals: (a, b) => a.length === b.length },
    );
    store.set({ list: [3, 4] });
    store.set({ list: [3, 4, 5] });
    expect(seen).toEqual([
      [1, 2],
      [3, 4, 5],
    ]);
  });

  it("lets a listener unsubscribe another during notification without skipping errors", () => {
    const store = createStore({ a: 1 });
    const second = vi.fn();
    let off2 = (): void => undefined;
    store.subscribe(() => off2());
    off2 = store.subscribe(second);
    store.set({ a: 2 });
    expect(second).toHaveBeenCalledTimes(1); // the snapshot of listeners was taken before the call
  });
});
