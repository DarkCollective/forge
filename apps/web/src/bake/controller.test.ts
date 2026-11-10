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
import { loadBundleNode } from "@forge/ops/node";
import type { Catalogue } from "@forge/ops";
import type { Recipe } from "@forge/recipe";
import { createInProcessBaker } from "@forge/worker";
import type { Baker, BakerInit } from "@forge/worker";
import { describe, expect, it } from "vitest";
import { createActions, createAppStore } from "../state/actions.js";
import { DEFAULT_LAYOUT } from "../state/layout.js";
import { createBakeController, debugOptionsFor, hasBreakpoints } from "./controller.js";
import { fakeTimers } from "./fake-timers.js";
import { createBakeUiStore } from "./ui-state.js";

const catalogue = JSON.parse(
  readFileSync(fileURLToPath(import.meta.resolve("@forge/ops/catalogue.json")), "utf8"),
) as Catalogue;

const HEX: Recipe = {
  forge: 1,
  steps: [{ kind: "op", op: "hex:encode", params: { case: "lower", delimiter: "none" } }],
};

function setup(options: { autoBake?: boolean } = {}) {
  const store = createAppStore({ layout: { ...DEFAULT_LAYOUT }, theme: "system" });
  const actions = createActions(store, false);
  const timers = fakeTimers();
  const ui = createBakeUiStore();
  const inits: BakerInit[] = [];
  const createBaker = (): Baker => {
    const inner = createInProcessBaker({ loadBundle: loadBundleNode });
    return {
      get hardKill() {
        return inner.hardKill;
      },
      init: (init) => {
        inits.push(init ?? {});
        return inner.init(init);
      },
      bake: (r, i, o) => inner.bake(r, i, o),
      step: () => inner.step(),
      continue: () => inner.continue(),
      cancel: () => inner.cancel(),
      dispose: () => inner.dispose(),
    };
  };
  const warnings: string[] = [];
  const controller = createBakeController({
    store,
    actions,
    createBaker,
    ui,
    timers,
    warn: (m) => warnings.push(m),
  });
  actions.setSetting("autoBake", options.autoBake ?? true);
  actions.setCatalogue(catalogue);
  return { store, actions, timers, ui, controller, inits, warnings };
}

function textOf(result: unknown): string | null {
  const r = result as { ok: boolean; output?: { text?: string | null } } | null;
  return r !== null && r.ok ? (r.output?.text ?? null) : null;
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("timed out");
}

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("auto-bake", () => {
  it("queues, waits for the debounce, then bakes the active input", async () => {
    const { store, actions, timers, controller } = setup();
    actions.loadDocument({ recipe: HEX });
    await controller.start();
    await controller.idle();
    // the start-up bake of the empty input
    actions.setInputBytes(store.get().activeInputId, enc("Hi"));
    expect(store.get().bake.status).toBe("queued");
    timers.advance(299);
    expect(store.get().bake.status).toBe("queued");
    timers.advance(1);
    await controller.idle();
    expect(store.get().bake.status).toBe("done");
    expect(textOf(store.get().bake.result)).toBe("4869");
    expect(store.get().bake.stale).toBe(false);
    expect(store.get().bake.elapsedMs).not.toBeNull();
    await controller.dispose();
  });

  it("does not bake on change when auto-bake is off; the Bake button does", async () => {
    const { store, actions, timers, controller } = setup({ autoBake: false });
    actions.loadDocument({ recipe: HEX });
    await controller.start();
    actions.setInputBytes(store.get().activeInputId, enc("Hi"));
    timers.advance(5000);
    await controller.idle();
    expect(store.get().bake.status).toBe("idle");
    controller.bakeNow();
    await controller.idle();
    expect(textOf(store.get().bake.result)).toBe("4869");
    await controller.dispose();
  });

  it("skips baking while the recipe has errors and shows the issues", async () => {
    const { store, actions, controller } = setup({ autoBake: false });
    actions.loadDocument({ recipe: { forge: 1, steps: [{ kind: "op", op: "nope:nope" }] } });
    await controller.start();
    controller.bakeNow();
    await controller.idle();
    const bake = store.get().bake;
    expect(bake.status).toBe("failed");
    expect(bake.result?.ok).toBe(false);
    if (bake.result !== null && !bake.result.ok) {
      expect(bake.result.error.code).toBe("E_RECIPE_INVALID");
      expect(bake.result.error.issues?.some((i) => i.code === "unknown-op")).toBe(true);
    }
    await controller.dispose();
  });

  it("a newer edit supersedes a bake in flight", async () => {
    const { store, actions, timers, controller } = setup();
    actions.loadDocument({ recipe: HEX });
    await controller.start();
    actions.setInputBytes(store.get().activeInputId, enc("a"));
    timers.advance(300);
    actions.setInputBytes(store.get().activeInputId, enc("b"));
    timers.advance(300);
    await controller.idle();
    expect(textOf(store.get().bake.result)).toBe("62");
    await controller.dispose();
  });
});

describe("debugging", () => {
  const TWO: Recipe = {
    forge: 1,
    steps: [
      {
        kind: "op",
        op: "hex:encode",
        params: { case: "lower", delimiter: "none" },
        breakpoint: true,
      },
      { kind: "op", op: "hex:decode" },
    ],
  };

  it("pauses at a breakpoint, shows the data, continues to the end", async () => {
    const { store, actions, controller } = setup({ autoBake: false });
    actions.loadDocument({ recipe: TWO });
    actions.setInputBytes(store.get().activeInputId, enc("Hi"));
    await controller.start();
    controller.bakeNow();
    await until(() => store.get().bake.status === "paused");
    const paused = store.get().bake.paused;
    expect(paused?.path).toBe("/steps/0");
    expect(paused?.reason).toBe("breakpoint");
    expect(paused?.data).toMatchObject({ kind: "bytes", text: "Hi" });
    expect(store.get().ui.selectedPath).toBe("/steps/0");
    controller.continue();
    await controller.idle();
    expect(store.get().bake.status).toBe("done");
    expect(textOf(store.get().bake.result)).toBe("Hi");
    expect(store.get().bake.paused).toBeNull();
    await controller.dispose();
  });

  it("starts paused in debug mode and steps through", async () => {
    const { store, actions, ui, controller } = setup({ autoBake: false });
    actions.loadDocument({ recipe: HEX });
    actions.setInputBytes(store.get().activeInputId, enc("Hi"));
    ui.set({ debug: true, startPaused: true });
    await controller.start();
    controller.bakeNow();
    await until(() => store.get().bake.status === "paused");
    expect(store.get().bake.paused?.reason).toBe("start");
    controller.step();
    await controller.idle();
    expect(store.get().bake.status).toBe("done");
    await controller.dispose();
  });

  it("cancels a paused bake", async () => {
    const { store, actions, controller } = setup({ autoBake: false });
    actions.loadDocument({ recipe: TWO });
    await controller.start();
    controller.bakeNow();
    await until(() => store.get().bake.status === "paused");
    controller.cancel();
    await controller.idle();
    expect(store.get().bake.status).toBe("cancelled");
    expect(store.get().bake.paused).toBeNull();
    await controller.dispose();
  });

  it("decides the debug option", () => {
    expect(hasBreakpoints(TWO.steps)).toBe(true);
    expect(hasBreakpoints(HEX.steps)).toBe(false);
    expect(
      hasBreakpoints([
        { kind: "op", op: "x:y", breakpoint: true, disabled: true },
        { kind: "repeat", times: 2, steps: [{ kind: "op", op: "x:y", breakpoint: true }] },
      ]),
    ).toBe(true);
    expect(debugOptionsFor(HEX, { debug: false, startPaused: false })).toBeUndefined();
    expect(debugOptionsFor(TWO, { debug: false, startPaused: false })).toEqual({});
    expect(debugOptionsFor(HEX, { debug: true, startPaused: true })).toEqual({ startPaused: true });
  });
});

describe("user words", () => {
  it("initialises the baker with the user unit and re-initialises when it changes", async () => {
    const { store, actions, controller, inits } = setup({ autoBake: false });
    await controller.start();
    expect(inits[0]).toEqual({ vocabs: "all", units: [] });
    const source = "IN: user\n";
    actions.setUserSource(source);
    await controller.idle();
    expect(inits.at(-1)).toEqual({ vocabs: "all", units: [{ name: "user", source }] });
    expect(store.get().user.error).toBeNull();
    await controller.dispose();
  });

  it("reports a unit that fails to load and keeps baking without it", async () => {
    const { store, actions, controller, inits } = setup({ autoBake: false });
    actions.loadDocument({ recipe: HEX });
    actions.setInputBytes(store.get().activeInputId, enc("Hi"));
    await controller.start();
    actions.setUserSource("IN: user\n: broken ( -- \n");
    await controller.idle();
    expect(store.get().user.error).not.toBeNull();
    expect(inits.at(-1)).toEqual({ vocabs: "all" });
    controller.bakeNow();
    await controller.idle();
    expect(textOf(store.get().bake.result)).toBe("4869");
    await controller.dispose();
  });
});
