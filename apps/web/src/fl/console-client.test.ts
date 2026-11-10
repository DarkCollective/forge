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
import { createConsoleClient, type ConsoleTransport, type InitResult } from "./console-client.js";
import { createConsoleCore } from "./console-core.js";
import { parseClientMessage, type ClientMessage } from "./protocol.js";

interface Fake extends ConsoleTransport {
  terminated: boolean;
  /** Messages the page posted, for assertions. */
  sent: ClientMessage[];
  deliver(data: unknown): void;
  fail(message: string): void;
}

/** A transport that runs the real core in-process; `hang` makes it swallow `run` requests. */
function inProcess(opts: { hang?: boolean } = {}): Fake {
  const core = createConsoleCore({ loadBundle: loadBundleNode });
  let handler: ((data: unknown) => void) | undefined;
  let failure: ((m: string) => void) | undefined;
  const t: Fake = {
    terminated: false,
    sent: [],
    post(message) {
      t.sent.push(message);
      // Structured clone, as postMessage would do, then the worker's own validation.
      const parsed = parseClientMessage(structuredClone(message));
      if (parsed === null || t.terminated) return;
      if (opts.hang === true && parsed.type === "run") return;
      void core.handle(parsed, (m) => {
        if (!t.terminated) queueMicrotask(() => handler?.(structuredClone(m)));
      });
    },
    onMessage(h) {
      handler = h;
    },
    onFailure(h) {
      failure = h;
    },
    terminate() {
      t.terminated = true;
    },
    deliver: (data) => handler?.(data),
    fail: (m) => failure?.(m),
  };
  return t;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("console client", () => {
  it("initialises, runs lines with a persistent stack, and resets", async () => {
    const t = inProcess();
    const client = createConsoleClient({ createTransport: () => t });
    const init = await client.init([]);
    expect(init.userError).toBeNull();
    expect(init.catalogue.format).toBe(1);
    const a = await client.run("2 3 + ");
    expect(a).toMatchObject({ kind: "result", ok: true, stack: ["<1> 5"] });
    const b = await client.run("dup *");
    expect(b).toMatchObject({ kind: "result", stack: ["<1> 25"] });
    await client.reset();
    expect(await client.run("1")).toMatchObject({ stack: ["<1> 1"] });
    client.dispose();
    expect(t.terminated).toBe(true);
  });

  it("starts lazily on the first request and passes the user units", async () => {
    const t = inProcess();
    const client = createConsoleClient({ createTransport: () => t });
    await client.init([
      { name: "user", source: 'IN: user\n: sq ( n:int -- int ) "s" doc "c" category n n * ;' },
    ]);
    const r = await client.run("6 sq");
    expect(r).toMatchObject({ kind: "result", ok: true, stack: ["<1> 36"] });
  });

  it("reports the user unit's load error and still gives a catalogue", async () => {
    const client = createConsoleClient({ createTransport: () => inProcess() });
    const init = await client.init([{ name: "user", source: "IN: user\n: broken (" }]);
    expect(init.userError).toBeTruthy();
    expect(init.catalogue.ops.length).toBeGreaterThan(0);
  });

  it("kills and restarts the worker when a run exceeds the watchdog", async () => {
    vi.useFakeTimers();
    const transports: Fake[] = [];
    const restarts: InitResult[] = [];
    const client = createConsoleClient({
      createTransport: () => {
        const t = inProcess({ hang: transports.length === 0 });
        transports.push(t);
        return t;
      },
      runTimeoutMs: 1000,
      onRestart: (r) => restarts.push(r),
    });
    const init = client.init([]);
    await vi.advanceTimersByTimeAsync(0);
    await init;
    const pending = client.run("[ true ] [ ] while");
    await vi.advanceTimersByTimeAsync(1001);
    const outcome = await pending;
    expect(outcome).toMatchObject({ kind: "killed", reason: "timeout" });
    expect(outcome.kind === "killed" && outcome.message).toContain("session");
    expect(transports[0]?.terminated).toBe(true);
    // The replacement worker comes up on its own and the console is usable again.
    vi.useRealTimers();
    await vi.waitFor(() => expect(restarts).toHaveLength(1));
    expect(await client.run("1 1 +")).toMatchObject({ kind: "result", ok: true, stack: ["<1> 2"] });
    expect(transports).toHaveLength(2);
    client.dispose();
  });

  it("stop() kills a run in flight on demand", async () => {
    const transports: Fake[] = [];
    const client = createConsoleClient({
      createTransport: () => {
        const t = inProcess({ hang: transports.length === 0 });
        transports.push(t);
        return t;
      },
    });
    await client.init([]);
    const pending = client.run("[ true ] [ ] while");
    await vi.waitFor(() => expect(transports[0]?.sent.some((m) => m.type === "run")).toBe(true));
    client.stop();
    expect(await pending).toMatchObject({ kind: "killed", reason: "stopped" });
    expect(await client.run("4")).toMatchObject({ kind: "result", stack: ["<1> 4"] });
    client.dispose();
  });

  it("treats a malformed worker message as a crash and recovers on the next request", async () => {
    const transports: Fake[] = [];
    const client = createConsoleClient({
      createTransport: () => {
        const t = inProcess();
        transports.push(t);
        return t;
      },
    });
    await client.init([]);
    const t0 = transports[0] as Fake;
    t0.deliver({ type: "result", id: "x" });
    expect(t0.terminated).toBe(true);
    expect(await client.run("7")).toMatchObject({ kind: "result", ok: true, stack: ["<1> 7"] });
    expect(transports).toHaveLength(2);
    client.dispose();
  });

  it("settles an in-flight run as killed when the worker crashes", async () => {
    const transports: Fake[] = [];
    const client = createConsoleClient({
      createTransport: () => {
        const t = inProcess({ hang: transports.length === 0 });
        transports.push(t);
        return t;
      },
    });
    await client.init([]);
    const pending = client.run("1");
    await vi.waitFor(() => expect(transports[0]?.sent.some((m) => m.type === "run")).toBe(true));
    (transports[0] as Fake).fail("boom");
    expect(await pending).toMatchObject({ kind: "killed", reason: "crashed" });
    client.dispose();
  });

  it("inspects words", async () => {
    const client = createConsoleClient({ createTransport: () => inProcess() });
    await client.init([]);
    const r = await client.inspect("core:dup");
    expect(r.ok).toBe(true);
    expect(r.meta).toContain("core:dup");
    expect((await client.inspect("nope:nope")).ok).toBe(false);
    client.dispose();
  });
});
