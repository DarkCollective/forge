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
import { loadBundleNode } from "@forge/ops/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConsoleClient, type ConsoleTransport } from "../fl/console-client.js";
import { createConsoleCore } from "../fl/console-core.js";
import { parseClientMessage } from "../fl/protocol.js";
import { createActions, createAppStore } from "../state/actions.js";
import { DEFAULT_LAYOUT } from "../state/layout.js";
import { createConsoleController, userUnits } from "./controller.js";

function transport(): ConsoleTransport {
  const core = createConsoleCore({ loadBundle: loadBundleNode });
  let handler: ((d: unknown) => void) | undefined;
  return {
    post(message) {
      const parsed = parseClientMessage(structuredClone(message));
      if (parsed === null) return;
      void core.handle(parsed, (m) => queueMicrotask(() => handler?.(structuredClone(m))));
    },
    onMessage: (h) => void (handler = h),
    onFailure: () => undefined,
    terminate: () => undefined,
  };
}

function setup() {
  const store = createAppStore({ layout: { ...DEFAULT_LAYOUT }, theme: "system" });
  const actions = createActions(store, false);
  const client = createConsoleClient({ createTransport: transport });
  const controller = createConsoleController({ client, store, actions, debounceMs: 5 });
  return { store, actions, client, controller };
}

const texts = (c: ReturnType<typeof setup>["controller"]): string[] =>
  c.getState().entries.map((e) => e.text);

afterEach(() => {
  vi.useRealTimers();
});

describe("console controller", () => {
  it("evaluates lines, keeps the stack, and assembles multi-line definitions", async () => {
    const { controller } = setup();
    await controller.submit("2 3 + .s");
    expect(controller.getState().stack).toEqual(["<1> 5"]);
    await controller.submit(": sq ( n:int -- int )");
    expect(controller.getState().pending).not.toBe("");
    await controller.submit("  n n * ;");
    expect(controller.getState().pending).toBe("");
    await controller.submit("7 sq");
    expect(controller.getState().stack[0]).toMatch(/49/);
    const prompts = controller
      .getState()
      .entries.filter((e) => e.kind === "input")
      .map((e) => e.prompt);
    expect(prompts).toContain("...");
    expect(controller.history.size).toBe(4);
    controller.dispose();
  });

  it("shows errors as text and leaves the stack", async () => {
    const { controller } = setup();
    await controller.submit("5");
    await controller.submit("1 0 /");
    const last = controller.getState().entries.at(-1);
    expect(last?.kind).toBe("error");
    expect(last?.text).toContain("E_DIV_ZERO");
    expect(controller.getState().stack[0]).toMatch(/5/);
    expect(controller.getState().status).toContain("E_DIV_ZERO");
    controller.dispose();
  });

  it("handles meta commands: .help, .clear, .reset", async () => {
    const { controller } = setup();
    await controller.submit("1 2");
    await controller.submit(".help");
    expect(texts(controller).some((t) => t.includes("Meta commands"))).toBe(true);
    await controller.submit(".reset");
    expect(controller.getState().stack).toEqual([]);
    await controller.submit(".clear");
    expect(controller.getState().entries).toEqual([]);
    controller.dispose();
  });

  it("changes the vocabulary through VOCAB", async () => {
    const { controller } = setup();
    await controller.submit("2");
    expect(controller.getState().vocabs).toContain("hex");
    await controller.setVocab("hex");
    expect(controller.getState().vocab).toBe("hex");
    controller.dispose();
  });

  it("publishes the catalogue with user ops and clears the user error", async () => {
    const { controller, store, actions } = setup();
    actions.setUserSource('IN: user\n: sq ( n:int -- int ) "s" doc "c" category n n * ;');
    actions.setUserError("old");
    const off = controller.attach();
    await vi.waitFor(() => {
      const c = store.get().catalogue;
      expect(c.status === "ready" && c.catalogue.ops.some((o) => o.qname === "user:sq")).toBe(true);
    });
    expect(store.get().user.error).toBeNull();
    off();
    controller.dispose();
  });

  it("reports a broken user unit through the store and keeps working", async () => {
    const { controller, store, actions } = setup();
    actions.setUserSource("IN: user\n: broken (");
    const off = controller.attach();
    await vi.waitFor(() => expect(store.get().user.error).toBeTruthy());
    await controller.submit("1 1 +");
    expect(controller.getState().stack[0]).toMatch(/2/);
    off();
    controller.dispose();
  });

  it("starts lazily when the pane opens and reloads when the user words change", async () => {
    const { controller, store, actions } = setup();
    const off = controller.attach();
    await new Promise((r) => setTimeout(r, 20));
    expect(store.get().catalogue.status).toBe("loading");
    actions.setConsoleOpen(true);
    await vi.waitFor(() =>
      expect(controller.getState().entries.some((e) => e.text === "Console ready.")).toBe(true),
    );
    actions.setUserSource('IN: user\n: tw ( n:int -- int ) "s" doc "c" category n n + ;');
    await vi.waitFor(() => {
      const c = store.get().catalogue;
      expect(c.status === "ready" && c.catalogue.ops.some((o) => o.qname === "user:tw")).toBe(true);
    });
    expect(texts(controller).some((t) => t.includes("reloaded"))).toBe(true);
    off();
    controller.dispose();
  });

  it("inspects a word", async () => {
    const { controller } = setup();
    await controller.inspect("core:dup");
    const i = controller.getState().inspector;
    expect(i.status).toBe("done");
    expect(i.meta).toContain("core:dup");
    await controller.inspect("nope:nope");
    expect(controller.getState().inspector.status).toBe("error");
    controller.dispose();
  });
});

describe("userUnits", () => {
  it("is empty for an empty source", () => {
    expect(userUnits("")).toEqual([]);
    expect(userUnits("IN: user")).toEqual([{ name: "user", source: "IN: user" }]);
  });
});
