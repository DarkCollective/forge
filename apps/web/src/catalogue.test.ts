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
import type { Catalogue } from "@forge/ops";
import { loadCatalogue } from "./catalogue.js";
import { DEFAULT_LAYOUT } from "./state/layout.js";
import { createActions, createAppStore } from "./state/actions.js";

const make = (version: string, _ops?: string[]): Catalogue =>
  ({
    format: 1,
    version,
    vocabs: [],
    ops: [],
  }) as unknown as Catalogue;

function setup() {
  const store = createAppStore({ layout: { ...DEFAULT_LAYOUT }, theme: "system" });
  return { store, actions: createActions(store, false) };
}

const versionOf = (store: ReturnType<typeof setup>["store"]): string | undefined => {
  const c = store.get().catalogue;
  return c.status === "ready" ? c.catalogue.version : undefined;
};

describe("loadCatalogue ordering", () => {
  it("publishes the static catalogue when nothing else has", async () => {
    const { store, actions } = setup();
    await loadCatalogue(actions, store, async () => make("static", ["a:b"]));
    expect(versionOf(store)).toBe("static");
  });

  it("does not overwrite a catalogue the console worker published during the fetch", async () => {
    const { store, actions } = setup();
    await loadCatalogue(actions, store, async () => {
      actions.setCatalogue(make("worker", ["a:b", "user:sq"]));
      return make("static", ["a:b"]);
    });
    expect(versionOf(store)).toBe("worker");
  });

  it("lets the worker catalogue replace the static one afterwards", async () => {
    const { store, actions } = setup();
    await loadCatalogue(actions, store, async () => make("static", ["a:b"]));
    actions.setCatalogue(make("worker", ["a:b", "user:sq"]));
    expect(versionOf(store)).toBe("worker");
  });

  it("a failed fetch does not replace a ready catalogue with an error", async () => {
    const { store, actions } = setup();
    await loadCatalogue(actions, store, async () => {
      actions.setCatalogue(make("worker", []));
      throw new Error("HTTP 500");
    });
    expect(store.get().catalogue.status).toBe("ready");
  });

  it("reports an error when the fetch fails and nothing else is ready", async () => {
    const { store, actions } = setup();
    await loadCatalogue(actions, store, async () => {
      throw new Error("HTTP 500");
    });
    expect(store.get().catalogue).toEqual({ status: "error", message: "HTTP 500" });
  });
});
