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

// The client against a fake host that answers only when the test says so (RECIPES.md section 10.3, G2-4 d).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createBakerClient } from "./client.js";
import type {
  BakeEvent,
  BakeResult,
  BakerClient,
  ClientMessage,
  WorkerHost,
  WorkerMessage,
} from "./types.js";

const INFO = { protocol: 1 as const, catalogueVersion: "0123456789abcdef", vocabs: ["hex"] };

class FakeHost implements WorkerHost {
  readonly sent: ClientMessage[] = [];
  readonly transfers: (ArrayBuffer[] | undefined)[] = [];
  terminated = false;
  autoReady = true;
  private onMsg: (m: WorkerMessage) => void = () => undefined;
  private onErr: (e: { message: string }) => void = () => undefined;

  postMessage(message: ClientMessage, transfer?: ArrayBuffer[]): void {
    this.sent.push(message);
    this.transfers.push(transfer);
    if (message.type === "init" && this.autoReady) {
      const reqId = message.reqId;
      void Promise.resolve().then(() => this.reply({ type: "ready", reqId, info: INFO }));
    }
  }
  onMessage(handler: (m: WorkerMessage) => void): void {
    this.onMsg = handler;
  }
  onError(handler: (e: { message: string }) => void): void {
    this.onErr = handler;
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(message: unknown): void {
    this.onMsg(message as WorkerMessage);
  }
  fail(message: string): void {
    this.onErr({ message });
  }
  of<T extends ClientMessage["type"]>(type: T): Extract<ClientMessage, { type: T }>[] {
    return this.sent.filter((m): m is Extract<ClientMessage, { type: T }> => m.type === type);
  }
  /** The `id` of the last bake message. */
  get lastId(): number {
    return (this.of("bake").at(-1) as { id: number }).id;
  }
}

function resultOf(id: number, over: object = {}): BakeResult {
  return {
    id,
    ok: true,
    output: { kind: "str", text: "ok" },
    steps: [],
    coercions: [],
    coercionsTruncated: false,
    warnings: [],
    stats: { elapsedMs: 1, vmSteps: 1, effects: [] },
    ...over,
  } as BakeResult;
}

const progress = (id: number, path: string | null): unknown => ({
  type: "event",
  id,
  event: { type: "progress", id, path, done: 0, total: 1, vmSteps: 1, elapsedMs: 1 },
});

let hosts: FakeHost[];
/** When false, hosts created from now on do not answer `init` by themselves. */
let autoReady = true;
function client(extra: object = {}): BakerClient {
  hosts = [];
  autoReady = true;
  return createBakerClient({
    host: () => {
      const h = new FakeHost();
      h.autoReady = autoReady;
      hosts.push(h);
      return h;
    },
    ...extra,
  });
}
const input = () => new Uint8Array([1, 2, 3]);
const recipe = { forge: 1, steps: [] };
const tick = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

async function started(
  c: BakerClient,
  options: object = {},
): Promise<{
  host: FakeHost;
  result: Promise<BakeResult>;
}> {
  await c.init();
  const host = hosts[hosts.length - 1] as FakeHost;
  const result = c.bake(recipe, input(), options);
  await tick();
  return { host, result };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated;
});

describe("init and bake", () => {
  test("bake before init is E_NOT_READY, and no worker is created", async () => {
    const c = client();
    const r = await c.bake(recipe, input());
    expect(r.ok === false && r.error.code).toBe("E_NOT_READY");
    expect(hosts).toHaveLength(0);
    expect(c.hardKill).toBe(true);
  });

  test("init returns the info; init-error rejects", async () => {
    const c = client();
    expect(await c.init({ vocabs: ["hex"] })).toEqual(INFO);
    const h = hosts[0] as FakeHost;
    expect(h.of("init")[0]).toMatchObject({ protocol: 1, init: { vocabs: ["hex"] } });
    h.autoReady = false;
    const p = c.init();
    await tick();
    h.reply({
      type: "init-error",
      reqId: h.of("init")[1]?.reqId,
      error: { code: "E_INTERNAL", message: "no vocab", path: null, word: null, detail: {} },
    });
    await expect(p).rejects.toThrow("no vocab");
  });

  test("bake copies and transfers the input and strips local options", async () => {
    const c = client();
    const data = input();
    await c.init();
    const h = hosts[0] as FakeHost;
    const onEvent = vi.fn();
    const p = c.bake(recipe, data, { trust: "trusted", onEvent, abortFlag: new Int32Array(1) });
    await tick();
    const msg = h.of("bake")[0];
    expect(msg).toMatchObject({ id: 1, recipe, options: { trust: "trusted" } });
    expect(Object.keys(msg?.options ?? {})).toEqual(["trust"]);
    expect(msg?.abort).toBeUndefined();
    expect(new Uint8Array(msg?.input as ArrayBuffer)).toEqual(data);
    expect(msg?.input).not.toBe(data.buffer);
    expect(h.transfers[h.sent.indexOf(msg as ClientMessage)]).toEqual([msg?.input]);
    h.reply({ type: "result", id: 1, result: resultOf(1) });
    expect((await p).ok).toBe(true);
  });

  test("events are forwarded to the listener; a throwing listener is harmless", async () => {
    const c = client();
    const seen: BakeEvent[] = [];
    const { host, result } = await started(c, {
      onEvent: (e: BakeEvent) => {
        seen.push(e);
        throw new Error("listener");
      },
    });
    host.reply(progress(1, "/steps/0"));
    host.reply({ type: "event", id: 1, event: { type: "resumed", id: 1 } });
    host.reply({ type: "result", id: 1, result: resultOf(1) });
    await result;
    expect(seen.map((e) => e.type)).toEqual(["progress", "resumed"]);
  });

  test("events and results for other bake ids are ignored", async () => {
    const c = client();
    const seen: BakeEvent[] = [];
    const { host, result } = await started(c, { onEvent: (e: BakeEvent) => seen.push(e) });
    host.reply(progress(7, "/steps/0"));
    host.reply({ type: "result", id: 7, result: resultOf(7) });
    host.reply({ type: "ready", reqId: 999, info: INFO });
    host.reply({
      type: "init-error",
      reqId: 999,
      error: { code: "E", message: "m", path: null, word: null, detail: {} },
    });
    expect(seen).toEqual([]);
    host.reply({ type: "result", id: 1, result: resultOf(1) });
    expect((await result).id).toBe(1);
    // With nothing active, stray events and results are dropped quietly.
    host.reply(progress(1, null));
    host.reply({ type: "result", id: 1, result: resultOf(1) });
  });

  test("step and continue are forwarded for the active bake only", async () => {
    const c = client();
    await c.step();
    await c.continue();
    const { host, result } = await started(c);
    await c.step();
    await c.continue();
    expect(host.of("step")).toEqual([{ type: "step", id: 1 }]);
    expect(host.of("continue")).toEqual([{ type: "continue", id: 1 }]);
    host.reply({ type: "result", id: 1, result: resultOf(1) });
    await result;
  });

  test("a bake started while another runs cancels it first", async () => {
    const c = client();
    const { host, result: first } = await started(c);
    const second = c.bake(recipe, input());
    await tick();
    expect(host.of("cancel")).toEqual([{ type: "cancel", id: 1 }]);
    host.reply({
      type: "result",
      id: 1,
      result: resultOf(1, {
        ok: false,
        error: { code: "E_ABORTED", message: "a", path: null, word: null, detail: {} },
      }),
    });
    expect((await first).ok).toBe(false);
    await tick();
    expect(host.of("bake")).toHaveLength(2);
    host.reply({ type: "result", id: 2, result: resultOf(2) });
    expect((await second).id).toBe(2);
  });
});

describe("cancellation and the watchdog", () => {
  test("cancel with nothing active resolves at once", async () => {
    const c = client();
    await c.cancel();
    await c.init();
    await c.cancel();
    expect((hosts[0] as FakeHost).of("cancel")).toEqual([]);
  });

  test("a result that arrives in time ends the cancel; the timer is cleared", async () => {
    const c = client({ cancelGraceMs: 500 });
    const { host, result } = await started(c);
    const cancelled = c.cancel();
    const again = c.cancel();
    expect(host.of("cancel")).toHaveLength(1);
    host.reply({
      type: "result",
      id: 1,
      result: resultOf(1, {
        ok: false,
        error: { code: "E_ABORTED", message: "a", path: null, word: null, detail: {} },
      }),
    });
    await Promise.all([cancelled, again]);
    expect((await result).ok).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(host.terminated).toBe(false);
  });

  test("the cancel timer terminates the worker and synthesises E_ABORTED", async () => {
    const c = client({ cancelGraceMs: 300 });
    const { host, result } = await started(c);
    host.reply(progress(1, "/steps/2"));
    const cancelled = c.cancel();
    await vi.advanceTimersByTimeAsync(299);
    expect(host.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await cancelled;
    expect(host.terminated).toBe(true);
    const r = await result;
    expect(r).toMatchObject({
      id: 1,
      ok: false,
      error: { code: "E_ABORTED", terminated: true, path: "/steps/2" },
      steps: [],
      coercions: [],
    });
    expect(r.stats.elapsedMs).toBeGreaterThanOrEqual(300);
  });

  test("after a kill the next bake gets a fresh host that is initialised again", async () => {
    const c = client({ cancelGraceMs: 10 });
    await c.init({ vocabs: ["hex"] });
    const first = hosts[0] as FakeHost;
    const p = c.bake(recipe, input());
    await tick();
    const cancelled = c.cancel();
    await vi.advanceTimersByTimeAsync(20);
    await cancelled;
    await p;
    expect(hosts).toHaveLength(1);
    const next = c.bake(recipe, input(), { trust: "trusted" });
    await tick();
    expect(hosts).toHaveLength(2);
    const second = hosts[1] as FakeHost;
    expect(second.of("init")[0]).toMatchObject({ init: { vocabs: ["hex"] } });
    expect(second.of("bake")).toHaveLength(1);
    expect(second.of("bake")[0]?.id).toBe(2);
    second.reply({ type: "result", id: 2, result: resultOf(2) });
    expect((await next).ok).toBe(true);
    // A late answer from the terminated worker is ignored.
    first.reply({ type: "result", id: 1, result: resultOf(1) });
    first.reply({ type: "fatal", message: "late" });
    expect(second.terminated).toBe(false);
  });

  test("an init after a kill is the only init the new worker sees", async () => {
    const c = client({ cancelGraceMs: 10 });
    await c.init();
    const p = c.bake(recipe, input());
    await tick();
    const cancelled = c.cancel();
    await vi.advanceTimersByTimeAsync(20);
    await cancelled;
    await p;
    await c.init({ vocabs: ["base64"] });
    expect(hosts).toHaveLength(2);
    expect((hosts[1] as FakeHost).of("init")).toHaveLength(1);
  });

  test("the deadline timer fires after maxMillis plus the grace", async () => {
    const c = client({ deadlineGraceMs: 100 });
    const { host, result } = await started(c, { trust: "trusted", limits: { maxMillis: 200 } });
    host.reply(progress(1, "/steps/0"));
    await vi.advanceTimersByTimeAsync(299);
    expect(host.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    const r = await result;
    expect(host.terminated).toBe(true);
    expect(r).toMatchObject({
      ok: false,
      error: { code: "E_LIMIT_TIME", terminated: true, path: "/steps/0" },
    });
  });

  test("untrusted bakes use the untrusted time limit", async () => {
    const c = client({ deadlineGraceMs: 0 });
    const { host, result } = await started(c, { limits: { maxMillis: 1e9 } });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(host.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect((await result).ok).toBe(false);
  });

  test("the deadline does not run while the bake is paused", async () => {
    const c = client({ deadlineGraceMs: 0 });
    const { host, result } = await started(c, { trust: "trusted", limits: { maxMillis: 1000 } });
    await vi.advanceTimersByTimeAsync(600);
    host.reply({
      type: "event",
      id: 1,
      event: {
        type: "paused",
        id: 1,
        path: "/steps/0",
        reason: "step",
        data: { kind: "str", text: "" },
      },
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(host.terminated).toBe(false);
    host.reply({ type: "event", id: 1, event: { type: "resumed", id: 1 } });
    await vi.advanceTimersByTimeAsync(300);
    expect(host.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(150);
    expect((await result).ok).toBe(false);
    expect(host.terminated).toBe(true);
  });

  test("resumed without a pause changes nothing; an unbounded limit sets no deadline", async () => {
    const c = client();
    const { host, result } = await started(c, {
      trust: "trusted",
      limits: { maxMillis: Infinity },
    });
    host.reply({ type: "event", id: 1, event: { type: "resumed", id: 1 } });
    host.reply({
      type: "event",
      id: 1,
      event: {
        type: "paused",
        id: 1,
        path: "/steps/0",
        reason: "step",
        data: { kind: "str", text: "" },
      },
    });
    await vi.advanceTimersByTimeAsync(1e9);
    expect(host.terminated).toBe(false);
    host.reply({ type: "result", id: 1, result: resultOf(1) });
    expect((await result).ok).toBe(true);
  });
});

describe("worker failure", () => {
  test("a fatal message fails the active bake and drops the worker", async () => {
    const c = client();
    const { host, result } = await started(c);
    host.reply({ type: "fatal", message: "boom" });
    const r = await result;
    expect(r).toMatchObject({ ok: false, error: { code: "E_INTERNAL", terminated: true } });
    expect(r.ok === false && r.error.message).toContain("boom");
    expect(host.terminated).toBe(true);
  });

  test("onError fails the active bake; without one the worker is simply dropped", async () => {
    const c = client();
    const { host, result } = await started(c);
    host.fail("exited");
    expect((await result).ok === false && (await result).ok).toBe(false);
    expect(host.terminated).toBe(true);
    const c2 = client();
    await c2.init();
    const idle = hosts[0] as FakeHost;
    idle.fail("gone");
    expect(idle.terminated).toBe(true);
    const next = c2.bake(recipe, input());
    await tick();
    expect(hosts).toHaveLength(2);
    (hosts[1] as FakeHost).reply({ type: "result", id: 1, result: resultOf(1) });
    expect((await next).ok).toBe(true);
  });

  test("a malformed message from the worker is a failure", async () => {
    const c = client();
    const { host, result } = await started(c);
    host.reply({ type: "result", id: "x" });
    const r = await result;
    expect(r.ok === false && r.error.message).toContain("malformed");
  });

  test("a malformed message from a dropped worker is ignored", async () => {
    const c = client();
    const { host, result } = await started(c);
    host.fail("x");
    await result;
    host.reply("junk");
    host.fail("again");
  });

  test("a worker that dies during init rejects the init", async () => {
    const c = client();
    await c.init();
    const h = hosts[0] as FakeHost;
    h.autoReady = false;
    const p = c.init();
    await tick();
    h.fail("died");
    await expect(p).rejects.toThrow("terminated");
  });

  test("when the replayed init fails, bake is E_NOT_READY", async () => {
    const c = client();
    await c.init();
    (hosts[0] as FakeHost).fail("died");
    autoReady = false;
    const next = c.bake(recipe, input());
    await tick();
    const h2 = hosts[1] as FakeHost;
    h2.reply({
      type: "init-error",
      reqId: h2.of("init")[0]?.reqId,
      error: { code: "E_INTERNAL", message: "bad", path: null, word: null, detail: {} },
    });
    const r = await next;
    expect(r.ok === false && r.error.code).toBe("E_NOT_READY");
  });

  test("a worker lost between its ready and the bake continuing fails the bake", async () => {
    const c = client();
    await c.init();
    (hosts[0] as FakeHost).fail("died");
    autoReady = false;
    const next = c.bake(recipe, input());
    await tick();
    const h2 = hosts[1] as FakeHost;
    h2.reply({ type: "ready", reqId: h2.of("init")[0]?.reqId, info: INFO });
    h2.fail("died right after");
    const r = await next;
    expect(r).toMatchObject({ ok: false, error: { code: "E_INTERNAL", terminated: true } });
  });

  test("a worker lost while the replayed init is pending fails the bake", async () => {
    const c = client();
    await c.init();
    (hosts[0] as FakeHost).fail("died");
    autoReady = false;
    const next = c.bake(recipe, input());
    await tick();
    (hosts[1] as FakeHost).fail("died again");
    const r = await next;
    expect(r.ok === false && r.error.code).toBe("E_NOT_READY");
  });
});

describe("the shared abort flag", () => {
  test("not used when the page is not cross-origin isolated", async () => {
    const c = client();
    const { host, result } = await started(c);
    expect(host.of("bake")[0]?.abort).toBeUndefined();
    host.reply({ type: "result", id: 1, result: resultOf(1) });
    await result;
  });

  test("a new flag per bake, set by cancel", async () => {
    (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated = true;
    const c = client();
    const { host, result } = await started(c);
    const flag = host.of("bake")[0]?.abort as SharedArrayBuffer;
    expect(flag.byteLength).toBe(4);
    expect(Atomics.load(new Int32Array(flag), 0)).toBe(0);
    const cancelled = c.cancel();
    expect(Atomics.load(new Int32Array(flag), 0)).toBe(1);
    host.reply({ type: "result", id: 1, result: resultOf(1) });
    await Promise.all([cancelled, result]);
    const p2 = c.bake(recipe, input());
    await tick();
    const flag2 = host.of("bake")[1]?.abort as SharedArrayBuffer;
    expect(flag2).not.toBe(flag);
    expect(Atomics.load(new Int32Array(flag2), 0)).toBe(0);
    host.reply({ type: "result", id: 2, result: resultOf(2) });
    await p2;
  });

  test("sharedAbort: false turns it off", async () => {
    (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated = true;
    const c = client({ sharedAbort: false });
    const { host, result } = await started(c);
    expect(host.of("bake")[0]?.abort).toBeUndefined();
    host.reply({ type: "result", id: 1, result: resultOf(1) });
    await result;
  });
});

describe("dispose", () => {
  test("cancels, tells the worker, terminates it and forgets the init", async () => {
    const c = client();
    const { host, result } = await started(c);
    const d = c.dispose();
    host.reply({
      type: "result",
      id: 1,
      result: resultOf(1, {
        ok: false,
        error: { code: "E_ABORTED", message: "a", path: null, word: null, detail: {} },
      }),
    });
    await d;
    expect((await result).ok).toBe(false);
    expect(host.of("dispose")).toHaveLength(1);
    expect(host.terminated).toBe(true);
    const r = await c.bake(recipe, input());
    expect(r.ok === false && r.error.code).toBe("E_NOT_READY");
    await c.dispose();
  });
});
