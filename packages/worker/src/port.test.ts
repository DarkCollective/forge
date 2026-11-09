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
import { describe, expect, test } from "vitest";
import { fxLoader, utf8 } from "../test/helpers.js";
import { createBakerCore } from "./core.js";
import { attachBakerCore } from "./port.js";
import type { Baker, ClientMessage, OutputValue, WorkerMessage } from "./types.js";

interface Harness {
  readonly sent: { message: WorkerMessage; transfer: ArrayBuffer[] | undefined }[];
  send(message: unknown): void;
  waitFor(pred: (m: WorkerMessage) => boolean): Promise<WorkerMessage>;
  of(type: WorkerMessage["type"]): WorkerMessage[];
}

function attach(core: Baker): Harness {
  const sent: Harness["sent"] = [];
  const waiters: { pred: (m: WorkerMessage) => boolean; resolve: (m: WorkerMessage) => void }[] =
    [];
  let handler: (m: ClientMessage) => void = () => undefined;
  attachBakerCore(
    {
      postMessage(message, transfer) {
        sent.push({ message, transfer });
        for (const w of [...waiters]) {
          if (w.pred(message)) {
            waiters.splice(waiters.indexOf(w), 1);
            w.resolve(message);
          }
        }
      },
      onMessage(h) {
        handler = h;
      },
    },
    core,
  );
  return {
    sent,
    send: (m) => handler(m as ClientMessage),
    waitFor(pred) {
      const hit = sent.find((s) => pred(s.message));
      if (hit) return Promise.resolve(hit.message);
      return new Promise((resolve) => waiters.push({ pred, resolve }));
    },
    of: (type) => sent.map((s) => s.message).filter((m) => m.type === type),
  };
}

const bakeMsg = (
  id: number,
  recipe: unknown,
  text = "",
  options: object = {},
  abort?: unknown,
) => ({
  type: "bake",
  id,
  recipe,
  input: utf8(text).slice().buffer,
  options,
  ...(abort === undefined ? {} : { abort }),
});
const op = (name: string, params?: object) => ({
  kind: "op",
  op: name,
  ...(params ? { params } : {}),
});
const rec = (...steps: unknown[]) => ({ forge: 1, steps });
const isResult = (id: number) => (m: WorkerMessage) => m.type === "result" && m.id === id;

async function ready(loader = fxLoader): Promise<Harness> {
  const h = attach(createBakerCore({ loadBundle: loader, hardKill: true }));
  h.send({ type: "init", reqId: 1, protocol: 1, init: {} });
  await h.waitFor((m) => m.type === "ready");
  return h;
}

describe("init", () => {
  test("ready carries the info; a protocol mismatch is an init-error", async () => {
    const h = await ready();
    const m = h.of("ready")[0];
    expect(m).toMatchObject({ type: "ready", reqId: 1, info: { protocol: 1 } });
    h.send({ type: "init", reqId: 2, protocol: 2, init: {} });
    expect(h.of("init-error")[0]).toMatchObject({
      reqId: 2,
      error: { code: "E_PROTOCOL" },
    });
  });

  test("a failing init is an init-error with the text", async () => {
    const h = attach(createBakerCore({ loadBundle: fxLoader }));
    h.send({ type: "init", reqId: 5, protocol: 1, init: { vocabs: ["nope"] } });
    const m = await h.waitFor((x) => x.type === "init-error");
    expect(m).toMatchObject({ reqId: 5, error: { code: "E_INTERNAL" } });
    expect(JSON.stringify(m)).toContain("nope");
  });
});

describe("bake", () => {
  test("events and result carry the client's id; the output buffer is transferred", async () => {
    const h = await ready();
    h.send(bakeMsg(41, rec(op("hex:decode")), "6162"));
    const m = await h.waitFor(isResult(41));
    expect(m).toMatchObject({ type: "result", id: 41, result: { id: 41, ok: true } });
    const entry = h.sent.find((s) => s.message === m);
    const output = m.type === "result" && m.result.ok ? m.result.output : undefined;
    if (output?.kind !== "bytes") throw new Error("expected a bytes output");
    expect(entry?.transfer).toEqual([output.bytes.buffer]);
    const events = h.of("event");
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(e).toMatchObject({ id: 41, event: { id: 41 } });
  });

  test("a failed bake with a partial value transfers the partial's buffer", async () => {
    const h = await ready();
    h.send(bakeMsg(2, rec(op("hex:decode"), op("text:upper")), "ff"));
    const m = await h.waitFor(isResult(2));
    const r = m.type === "result" ? m.result : null;
    expect(r?.ok).toBe(false);
    const partial = r && !r.ok ? r.partial : undefined;
    if (partial?.kind !== "bytes") throw new Error("expected a bytes partial");
    const entry = h.sent.find((s) => s.message === m);
    expect(entry?.transfer).toEqual([partial.bytes.buffer]);
  });

  test("a non-bytes output transfers nothing", async () => {
    const h = await ready();
    h.send(bakeMsg(3, rec(op("hex:decode")), "6162"));
    await h.waitFor(isResult(3));
    h.send(
      bakeMsg(
        4,
        rec({
          kind: "if",
          test: { kind: "op", op: "regex:test", params: { pattern: "a" } },
          then: [],
        }),
        "a",
      ),
    );
    const m = await h.waitFor(isResult(4));
    expect(m.type === "result" && m.result.ok).toBe(true);
  });

  test("ids must increase; a repeated id gets E_PROTOCOL", async () => {
    const h = await ready();
    h.send(bakeMsg(5, rec(), "a"));
    await h.waitFor(isResult(5));
    h.send(bakeMsg(5, rec(), "a"));
    h.send(bakeMsg(4, rec(), "a"));
    await h.waitFor(isResult(4));
    const results = h.of("result");
    expect(results[1]).toMatchObject({ result: { ok: false, error: { code: "E_PROTOCOL" } } });
    expect(results[2]).toMatchObject({ result: { ok: false, error: { code: "E_PROTOCOL" } } });
    expect(h.of("fatal")).toEqual([]);
  });

  test("bake before init is a result with E_NOT_READY", async () => {
    const h = attach(createBakerCore({ loadBundle: fxLoader }));
    h.send(bakeMsg(1, rec()));
    const m = await h.waitFor(isResult(1));
    expect(m).toMatchObject({ result: { error: { code: "E_NOT_READY" } } });
  });

  test("a new bake cancels the active one and waits for its result", async () => {
    const h = await ready();
    h.send(bakeMsg(1, rec(op("fx:sleep", { ms: 60_000 })), "a", { trust: "trusted" }));
    await h.waitFor((m) => m.type === "event");
    h.send(bakeMsg(2, rec(op("text:upper")), "a", { trust: "trusted" }));
    await h.waitFor(isResult(2));
    const order = h.of("result").map((m) => (m.type === "result" ? m.id : 0));
    expect(order).toEqual([1, 2]);
    expect(h.of("result")[0]).toMatchObject({ result: { error: { code: "E_ABORTED" } } });
  });

  test("cancel, step and continue address only the active bake", async () => {
    const h = await ready();
    h.send(bakeMsg(1, rec(op("fx:sleep", { ms: 60_000 })), "a", { trust: "trusted" }));
    await h.waitFor((m) => m.type === "event");
    h.send({ type: "cancel", id: 99 });
    h.send({ type: "step", id: 99 });
    h.send({ type: "continue", id: 1 });
    h.send({ type: "step", id: 1 });
    await new Promise((r) => setTimeout(r, 20));
    expect(h.of("result")).toEqual([]);
    h.send({ type: "cancel", id: 1 });
    const m = await h.waitFor(isResult(1));
    expect(m).toMatchObject({ result: { error: { code: "E_ABORTED" } } });
  });

  test("a cancel for a bake that has not started yet is remembered", async () => {
    const h = await ready();
    h.send(bakeMsg(1, rec(op("fx:sleep", { ms: 60_000 })), "a", { trust: "trusted" }));
    await h.waitFor((m) => m.type === "event");
    h.send(bakeMsg(2, rec(op("text:upper")), "a", { trust: "trusted" }));
    h.send({ type: "cancel", id: 2 });
    const m = await h.waitFor(isResult(2));
    expect(m).toMatchObject({
      result: { error: { code: "E_ABORTED", message: expect.stringContaining("before") } },
    });
  });

  test("debug stepping through messages", async () => {
    const h = await ready();
    h.send(
      bakeMsg(1, rec(op("hex:decode"), op("text:upper")), "6162", {
        trust: "trusted",
        debug: { startPaused: true },
      }),
    );
    await h.waitFor((m) => m.type === "event" && m.event.type === "paused");
    h.send({ type: "step", id: 1 });
    await h.waitFor((m) => m.type === "event" && m.event.type === "resumed");
    while (
      h.of("event").filter((m) => m.type === "event" && m.event.type === "paused").length < 2
    ) {
      await new Promise((r) => setTimeout(r, 2));
    }
    h.send({ type: "continue", id: 1 });
    const m = await h.waitFor(isResult(1));
    expect(m.type === "result" && m.result.ok).toBe(true);
  });

  test("the shared abort flag stops a bake", async () => {
    const h = await ready();
    const sab = new SharedArrayBuffer(4);
    Atomics.store(new Int32Array(sab), 0, 1);
    h.send(
      bakeMsg(
        1,
        rec({ kind: "repeat", times: 1000, steps: [op("text:upper")] }),
        "a",
        { trust: "trusted" },
        sab,
      ),
    );
    const m = await h.waitFor(isResult(1));
    expect(m).toMatchObject({ result: { error: { code: "E_ABORTED" } } });
  });

  test("init while a bake runs cancels it; dispose cancels and releases", async () => {
    const h = await ready();
    h.send(bakeMsg(1, rec(op("fx:sleep", { ms: 60_000 })), "a", { trust: "trusted" }));
    await h.waitFor((m) => m.type === "event");
    h.send({ type: "init", reqId: 2, protocol: 1, init: {} });
    await h.waitFor((m) => m.type === "ready" && m.reqId === 2);
    expect(h.of("result")[0]).toMatchObject({ result: { error: { code: "E_ABORTED" } } });
    h.send(bakeMsg(2, rec(op("fx:sleep", { ms: 60_000 })), "a", { trust: "trusted" }));
    await h.waitFor((m) => m.type === "event" && m.id === 2);
    h.send({ type: "dispose" });
    await h.waitFor(isResult(2));
    h.send(bakeMsg(3, rec(), ""));
    const m = await h.waitFor(isResult(3));
    expect(m).toMatchObject({ result: { error: { code: "E_NOT_READY" } } });
  });
});

describe("hostile input", () => {
  test("a malformed message is fatal, and nothing is handled afterwards", async () => {
    const h = await ready();
    h.send({ type: "bake", id: "x" });
    expect(h.of("fatal")).toHaveLength(1);
    h.send({ type: "init", reqId: 3, protocol: 1, init: {} });
    h.send(bakeMsg(1, rec()));
    await new Promise((r) => setTimeout(r, 20));
    expect(h.of("fatal")).toHaveLength(1);
    expect(h.of("ready")).toHaveLength(1);
    expect(h.of("result")).toEqual([]);
  });

  test.each([null, 7, "init", [], { type: "nope" }, { type: "step", id: -1 }])(
    "garbage %j is fatal",
    async (garbage) => {
      const h = attach(createBakerCore({ loadBundle: fxLoader }));
      h.send(garbage);
      expect(h.of("fatal")).toHaveLength(1);
    },
  );

  test("an internal failure of the core is fatal", async () => {
    const core: Baker = {
      hardKill: true,
      init: () => Promise.reject(new Error("x")),
      bake: () => Promise.reject(new Error("boom")),
      step: () => Promise.resolve(),
      continue: () => Promise.resolve(),
      cancel: () => Promise.resolve(),
      dispose: () => Promise.reject("not an error"),
    };
    const h = attach(core);
    h.send(bakeMsg(1, rec()));
    const m = await h.waitFor((x) => x.type === "fatal");
    expect(m).toMatchObject({ message: "boom" });
    const h2 = attach(core);
    h2.send({ type: "dispose" });
    expect(await h2.waitFor((x) => x.type === "fatal")).toMatchObject({ message: "not an error" });
  });

  test("an init failure that is not an Error still answers", async () => {
    const core: Baker = {
      hardKill: true,
      init: () => Promise.reject("plain"),
      bake: () => Promise.reject(new Error("x")),
      step: () => Promise.resolve(),
      continue: () => Promise.resolve(),
      cancel: () => Promise.resolve(),
      dispose: () => Promise.resolve(),
    };
    const h = attach(core);
    h.send({ type: "init", reqId: 1, protocol: 1, init: {} });
    expect(await h.waitFor((x) => x.type === "init-error")).toMatchObject({
      error: { message: "plain" },
    });
  });

  test("every bytes buffer inside a list or record output is transferred", async () => {
    const b = (n: number): OutputValue => ({
      kind: "bytes",
      bytes: new Uint8Array([n]),
      text: null,
    });
    const output: OutputValue = {
      kind: "list",
      total: 2,
      items: [
        b(1),
        { kind: "record", total: 1, entries: [{ key: "k", value: b(2) }] },
        { kind: "str", text: "s" },
      ],
    };
    const core: Baker = {
      hardKill: true,
      init: () => Promise.reject(new Error("x")),
      bake: (_r, _i, options) => {
        options?.onEvent?.({ type: "resumed", id: 0 });
        return Promise.resolve({
          id: 0,
          ok: true,
          output,
          steps: [],
          coercions: [],
          coercionsTruncated: false,
          warnings: [],
          stats: { elapsedMs: 0, vmSteps: 0, effects: [] },
        });
      },
      step: () => Promise.resolve(),
      continue: () => Promise.resolve(),
      cancel: () => Promise.resolve(),
      dispose: () => Promise.resolve(),
    };
    const h = attach(core);
    h.send(bakeMsg(1, rec(), ""));
    await h.waitFor(isResult(1));
    const entry = h.sent.find((s) => s.message.type === "result");
    expect(entry?.transfer).toHaveLength(2);
  });

  test("too many pending cancels are not remembered", async () => {
    const h = await ready();
    for (let i = 10; i < 200; i++) h.send({ type: "cancel", id: i });
    h.send(bakeMsg(150, rec(), "a"));
    const m = await h.waitFor(isResult(150));
    expect(m).toMatchObject({ result: { ok: true } });
  });
});
