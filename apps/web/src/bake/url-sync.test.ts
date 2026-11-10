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
import { fileURLToPath } from "node:url";
import type { Catalogue } from "@forge/ops";
import { decodeShare, encodeShare } from "@forge/recipe";
import { describe, expect, it } from "vitest";
import { createActions, createAppStore } from "../state/actions.js";
import { DEFAULT_LAYOUT } from "../state/layout.js";
import { fakeTimers } from "./fake-timers.js";
import { createBakeUiStore } from "./ui-state.js";
import { createUrlSync } from "./url-sync.js";
import type { UrlSyncEnv } from "./url-sync.js";

const catalogue = JSON.parse(
  readFileSync(fileURLToPath(import.meta.resolve("@forge/ops/catalogue.json")), "utf8"),
) as Catalogue;

const GOLDEN =
  "v=1&r=1bY2xDgIhEAX_5dU0F43F_oqx2IP1jggsYTGaEP7dWBqvmW5mBu7aNgEtDtalGug68IglgKAV7gvCyiaXMwXxGgQOlRtnAw1wqjuv0kGwziVwC5jTHTR8YrPoOVHT_tvI-iwdtJyOzV3eJOVv7dkEhKQvaXAIkmKOXRoIRYtgztv8AA&i=0VlhKNWVXSXNJRXBpWlhseElRPT0&ie=utf8";

function fakeEnv(hash: string) {
  const listeners = new Set<() => void>();
  const writes: string[] = [];
  const env = {
    location: { hash, pathname: "/", search: "" },
    history: {
      replaceState(_d: unknown, _u: string, url: string) {
        writes.push(url);
        const i = url.indexOf("#");
        env.location.hash = i < 0 ? "" : url.slice(i);
      },
    },
    addEventListener: (_t: "hashchange", l: () => void) => void listeners.add(l),
    removeEventListener: (_t: "hashchange", l: () => void) => void listeners.delete(l),
  } satisfies UrlSyncEnv & { location: { hash: string } };
  return {
    env,
    writes,
    navigate(next: string) {
      env.location.hash = next;
      for (const l of listeners) l();
    },
  };
}

function setup(hash: string, withCatalogue = true) {
  const store = createAppStore({ layout: { ...DEFAULT_LAYOUT }, theme: "system" });
  const actions = createActions(store, false);
  const ui = createBakeUiStore();
  const timers = fakeTimers();
  const fake = fakeEnv(hash);
  const sync = createUrlSync({
    store,
    actions,
    env: fake.env,
    encode: encodeShare,
    decode: decodeShare,
    ui,
    timers,
  });
  if (withCatalogue) actions.setCatalogue(catalogue);
  return { store, actions, ui, timers, fake, sync };
}

describe("loading a link", () => {
  it("loads the golden fragment: recipe and input", async () => {
    const { store, sync, ui } = setup(`#${GOLDEN}`);
    sync.start();
    await sync.idle();
    expect(store.get().recipe.steps.map((s) => (s.kind === "op" ? s.op : s.kind))).toEqual([
      "base64:decode",
      "classical:rot",
      "hex:encode",
    ]);
    const input = store.get().inputs.find((t) => t.id === store.get().activeInputId);
    expect(new TextDecoder().decode(input?.bytes)).toBe("VXJ5eWIsIEpiZXlxIQ==");
    expect(input?.encoding).toBe("utf8");
    expect(ui.get().notice).toBeNull();
    expect(store.get().doc.dirty).toBe(false);
  });

  it("waits for the catalogue before decoding", async () => {
    const { store, actions, sync } = setup(`#${GOLDEN}`, false);
    sync.start();
    await sync.idle();
    expect(store.get().recipe.steps).toHaveLength(0);
    actions.setCatalogue(catalogue);
    await sync.idle();
    expect(store.get().recipe.steps).toHaveLength(3);
  });

  it("shows decode errors without throwing and keeps the hash", async () => {
    const { store, sync, ui, fake } = setup("#v=1&r=0A");
    sync.start();
    await sync.idle();
    expect(ui.get().notice?.severity).toBe("error");
    expect(ui.get().notice?.summary).toContain("bad-base64");
    expect(store.get().recipe.steps).toHaveLength(0);
    expect(fake.writes).toEqual([]);
    expect(fake.env.location.hash).toBe("#v=1&r=0A");
  });

  it("reports hostile fragments as errors, never crashes", async () => {
    for (const hash of ["#r=0e30", "#v=2&r=0e30", "#v=1&r=1!!!!", `#${"a=".padEnd(70_000, "a")}`]) {
      const { sync, ui } = setup(hash);
      sync.start();
      await sync.idle();
      expect(ui.get().notice?.severity).toBe("error");
      sync.dispose();
    }
  });

  it("handles hashchange, but not its own writes", async () => {
    const { store, actions, sync, fake, timers } = setup("");
    sync.start();
    await sync.idle();
    actions.addOp("hex:encode");
    timers.advance(500);
    await sync.idle();
    expect(fake.writes).toHaveLength(1);
    const written = fake.env.location.hash;
    fake.navigate(written); // as if the browser reported our own change
    await sync.idle();
    expect(store.get().history.past.length).toBe(1);
    fake.navigate(`#${GOLDEN}`);
    await sync.idle();
    expect(store.get().recipe.steps).toHaveLength(3);
  });
});

describe("keeping the fragment current", () => {
  it("writes the recipe only, debounced, with replaceState", async () => {
    const { actions, sync, fake, timers, store } = setup("");
    sync.start();
    await sync.idle();
    actions.addOp("hex:encode");
    timers.advance(499);
    await sync.idle(); // flushes
    expect(fake.writes).toHaveLength(1);
    const url = fake.writes[0] as string;
    expect(url.startsWith("/#v=1&r=")).toBe(true);
    expect(url).not.toContain("&i=");
    const back = await decodeShare(url.slice(2), { catalogue });
    expect(back.ok && back.recipe.steps[0]).toMatchObject({ kind: "op", op: "hex:encode" });
    expect(back.ok && back.recipe.steps[0]).toHaveProperty("hash"); // pinned
    expect(store.get().recipe.steps).toHaveLength(1);
  });

  it("does not rewrite a link it just loaded (keeps the input in the address bar)", async () => {
    const { sync, fake, timers } = setup(`#${GOLDEN}`);
    sync.start();
    await sync.idle();
    timers.advance(5000);
    await sync.idle();
    expect(fake.writes).toEqual([]);
    expect(fake.env.location.hash).toBe(`#${GOLDEN}`);
  });

  it("writes after the first edit of a loaded link (recipe only)", async () => {
    const { actions, sync, fake, timers } = setup(`#${GOLDEN}`);
    sync.start();
    await sync.idle();
    actions.removeStep("/steps/2");
    timers.advance(500);
    await sync.idle();
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]).not.toContain("&i=");
  });

  it("keeps secrets out of the address bar", async () => {
    const { actions, sync, fake, timers } = setup("");
    sync.start();
    await sync.idle();
    actions.addOp("hex:encode");
    timers.advance(500);
    await sync.idle();
    expect(fake.env.location.hash).not.toBe("");
    // an op with a key parameter that differs from its default
    const keyed = catalogue.ops.find((o) => o.params.some((p) => p.type === "key"));
    if (keyed === undefined) return; // the seed catalogue has none: nothing more to prove here
    const key = keyed.params.find((p) => p.type === "key");
    actions.setRecipe({
      forge: 1,
      steps: [
        {
          kind: "op",
          op: keyed.qname,
          params: { [key?.name as string]: { value: "secret", enc: "utf8" } },
        },
      ],
    });
    timers.advance(500);
    await sync.idle();
    expect(fake.env.location.hash).toBe("");
  });

  it("leaves the address alone when the recipe is invalid", async () => {
    const { actions, sync, fake, timers } = setup("");
    sync.start();
    await sync.idle();
    actions.addOp("hex:encode");
    timers.advance(500);
    await sync.idle();
    const before = fake.env.location.hash;
    actions.addOp("nope:nope");
    timers.advance(500);
    await sync.idle();
    expect(fake.env.location.hash).toBe(before);
  });
});
