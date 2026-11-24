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
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onViewersChanged, registerViewer, resetViewers } from "../io/viewers.js";
import type { ExtOutput } from "../io/viewers.js";
import { dataFactsAtEnd, sameFacts } from "../ops/fit.js";
import { createStore } from "./store.js";
import { StoreController } from "./store-controller.js";

function fakeHost(): ReactiveControllerHost & {
  updates: number;
  controllers: ReactiveController[];
} {
  const host = {
    updates: 0,
    controllers: [] as ReactiveController[],
    addController(c: ReactiveController) {
      host.controllers.push(c);
    },
    removeController() {},
    requestUpdate() {
      host.updates += 1;
    },
    updateComplete: Promise.resolve(true),
  };
  return host;
}

afterEach(() => resetViewers());

describe("StoreController.refresh", () => {
  it("reads a value the store cannot see change, and re-renders only when it differs", () => {
    const store = createStore({ n: 1 });
    let outside = "a";
    const host = fakeHost();
    const c = new StoreController(host, store, (s) => `${s.n}${outside}`);
    expect(c.value).toBe("1a");
    c.refresh();
    expect(host.updates).toBe(0);
    outside = "b";
    c.refresh();
    expect(c.value).toBe("1b");
    expect(host.updates).toBe(1);
  });

  it("uses the equality it was given", () => {
    const store = createStore({ n: 1 });
    let outside = 1;
    const host = fakeHost();
    const c = new StoreController(
      host,
      store,
      () => ({ v: outside }),
      (a, b) => a.v === b.v,
    );
    c.refresh();
    expect(host.updates).toBe(0);
    outside = 2;
    c.refresh();
    expect(host.updates).toBe(1);
    expect(c.value).toEqual({ v: 2 });
  });

  it("brings the shape of a table in when its viewer arrives (the stale Data here line)", () => {
    const table = {
      kind: "ext",
      extKind: "table",
      text: "",
    } as unknown as ExtOutput;
    const state = {
      recipe: { steps: [] } as never,
      bake: { result: { ok: true, output: table }, stale: false } as never,
    };
    const store = createStore(state);
    const host = fakeHost();
    const facts = new StoreController(
      host,
      store,
      (s) => dataFactsAtEnd({ recipe: s.recipe, bake: s.bake, ops: null }),
      sameFacts,
    );
    const stop = onViewersChanged(() => facts.refresh());
    expect(facts.value.shape).toBeUndefined();
    // The lazy viewer arrives: the store is untouched, the facts are not recomputed until `refresh`.
    registerViewer({
      kind: "table",
      noun: "table",
      summary: () => "4 columns, 250 rows",
    } as never);
    expect(facts.value.shape).toBe("4 columns, 250 rows");
    expect(host.updates).toBe(1);
    stop();
    vi.restoreAllMocks();
  });
});
