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
import { describe, expect, it } from "vitest";
import { createConsoleCore } from "./console-core.js";
import type { WorkerMessage } from "./protocol.js";

const USER = `IN: user
: sq ( n:int -- int ) "square" doc "Mine" category n n * ;
`;

type Req =
  | { type: "init"; units: { name: string; source: string }[] }
  | { type: "run"; source: string }
  | { type: "reset" }
  | { type: "inspect"; qname: string };

function harness() {
  const core = createConsoleCore({ loadBundle: loadBundleNode });
  const out: WorkerMessage[] = [];
  let id = 0;
  const send = async <T extends WorkerMessage["type"]>(
    message: Req,
    type: T,
  ): Promise<Extract<WorkerMessage, { type: T }>> => {
    const before = out.length;
    await core.handle({ ...message, id: ++id }, (m) => out.push(m));
    const found = out.slice(before).find((m) => m.type === type);
    if (!found) throw new Error(`no ${type} in ${JSON.stringify(out.slice(before))}`);
    return found as Extract<WorkerMessage, { type: T }>;
  };
  return { core, out, send };
}

describe("console core", () => {
  it("builds a catalogue that includes user ops", async () => {
    const { send } = harness();
    const ready = await send({ type: "init", units: [{ name: "user", source: USER }] }, "ready");
    expect(ready.catalogue.ops.some((o) => o.qname === "user:sq")).toBe(true);
    expect(ready.vocab).toBe("user");
    expect(ready.vocabs).toContain("core");
  });

  it("keeps the stack between lines and shows it with .s", async () => {
    const { send } = harness();
    await send({ type: "init", units: [] }, "ready");
    const a = await send({ type: "run", source: "2 3 +" }, "result");
    expect(a.ok).toBe(true);
    expect(a.stack).toEqual(["<1> 5"]);
    const b = await send({ type: "run", source: "10 *" }, "result");
    expect(b.stack).toEqual(["<1> 50"]);
  });

  it("uses a definition on the next line and leaves the stack alone on an error", async () => {
    const { send } = harness();
    await send({ type: "init", units: [] }, "ready");
    const def = await send({ type: "run", source: ": sq ( n:int -- int ) n n * ;" }, "result");
    expect(def.ok).toBe(true);
    const r = await send({ type: "run", source: "7 sq" }, "result");
    expect(r.stack).toEqual(["<1> 49"]);
    const bad = await send({ type: "run", source: "1 0 /" }, "result");
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe("E_DIV_ZERO");
    expect(bad.error?.message).toContain("E_DIV_ZERO");
    expect(bad.stack).toEqual(["<1> 49"]);
  });

  it("reports a missing stack-effect header as an error", async () => {
    const { send } = harness();
    await send({ type: "init", units: [] }, "ready");
    const r = await send({ type: "run", source: ": sq dup * ;" }, "result");
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("E_HEADER");
  });

  it("stops a runaway loop with a step limit and recovers", async () => {
    const core = createConsoleCore({ loadBundle: loadBundleNode, limits: { maxSteps: 100_000 } });
    const out: WorkerMessage[] = [];
    const post = (m: WorkerMessage): void => void out.push(m);
    await core.handle({ type: "init", id: 1, units: [] }, post);
    await core.handle({ type: "run", id: 2, source: "[ true ] [ ] while" }, post);
    const looped = out.find((m) => m.type === "result");
    expect(looped).toMatchObject({ ok: false, error: { code: "E_LIMIT_STEPS" } });
    await core.handle({ type: "run", id: 3, source: "1 1 +" }, post);
    expect(out[out.length - 1]).toMatchObject({ ok: true, stack: ["<1> 2"] });
  });

  it("changes the current vocabulary with VOCAB", async () => {
    const { send } = harness();
    await send({ type: "init", units: [] }, "ready");
    const r = await send({ type: "run", source: "VOCAB hex" }, "result");
    expect(r.vocab).toBe("hex");
  });

  it("resets the session but keeps the user words", async () => {
    const { send } = harness();
    await send({ type: "init", units: [{ name: "user", source: USER }] }, "ready");
    await send({ type: "run", source: "VOCAB hex 4 5" }, "result");
    const done = await send({ type: "reset" }, "reset-done");
    expect(done.vocab).toBe("user");
    const r = await send({ type: "run", source: "3 sq" }, "result");
    expect(r.stack).toEqual(["<1> 9"]);
  });

  it("falls back to a runtime without a broken user unit and reports the error", async () => {
    const { send, out } = harness();
    const ready = await send(
      { type: "init", units: [{ name: "user", source: "IN: user\n: broken (" }] },
      "ready",
    );
    expect(out.find((m) => m.type === "init-error")).toBeDefined();
    expect(ready.catalogue.ops.length).toBeGreaterThan(0);
    expect(ready.catalogue.ops.some((o) => o.vocab === "user")).toBe(false);
    const r = await send({ type: "run", source: "1 2 +" }, "result");
    expect(r.ok).toBe(true);
  });

  it("refuses a user unit that defines into a bundled vocabulary", async () => {
    const { send, out } = harness();
    await send(
      { type: "init", units: [{ name: "user", source: "IN: hex\n: x ( -- ) ;" }] },
      "ready",
    );
    expect(out.find((m) => m.type === "init-error")).toBeDefined();
  });

  it("inspects a word: metadata, help and source as text", async () => {
    const { send } = harness();
    await send({ type: "init", units: [{ name: "user", source: USER }] }, "ready");
    const r = await send({ type: "inspect", qname: "user:sq" }, "inspect-result");
    expect(r.ok).toBe(true);
    expect(r.meta).toContain("qname: user:sq");
    expect(r.source).toContain("n n *");
    const unknown = await send({ type: "inspect", qname: "nope:nope" }, "inspect-result");
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toBeTruthy();
  });
});
