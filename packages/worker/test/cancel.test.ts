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

// Gate 2, G2-4: cancellation, the watchdog and the deadline with real worker threads
// (RECIPES.md section 10.3). Timing bounds are generous: CI machines are slow.
import { afterEach, describe, expect, test } from "vitest";
import { createNodeWorkerHost } from "../src/host-node.js";
import { createBakerClient } from "../src/index.js";
import type { BakeEvent, BakeResult, BakerClient } from "../src/index.js";
import { FX_URL, utf8 } from "./helpers.js";

const SLACK_MS = 8_000;
const TIMEOUT = 40_000;
const op = (name: string, params?: object) => ({
  kind: "op",
  op: name,
  ...(params ? { params } : {}),
});
const rec = (...steps: unknown[]) => ({ forge: 1, steps });

let created = 0;
const clients: BakerClient[] = [];
function make(extra: object = {}, modules: string[] = [FX_URL]): BakerClient {
  const c = createBakerClient({
    host: () => {
      created++;
      return createNodeWorkerHost({ extraPrimitiveModules: modules });
    },
    ...extra,
  });
  clients.push(c);
  created = 0;
  return c;
}

afterEach(async () => {
  for (const c of clients.splice(0)) await c.dispose();
});

/** Resolves when the bake has reported its first progress event (so the worker is inside the recipe). */
function started(): { onEvent: (e: BakeEvent) => void; running: Promise<void> } {
  let resolve: () => void = () => undefined;
  const running = new Promise<void>((r) => (resolve = r));
  return { onEvent: (e) => e.type === "progress" && resolve(), running };
}

function error(r: BakeResult) {
  if (r.ok) throw new Error("expected a failure");
  return r.error;
}

describe("G2-4 cancellation with real worker threads", () => {
  test("(a) cancel stops an async step through the message", { timeout: TIMEOUT }, async () => {
    const c = make({ cancelGraceMs: 1000 });
    await c.init();
    const s = started();
    const p = c.bake(rec(op("fx:sleep", { ms: 60_000 })), utf8("x"), {
      trust: "trusted",
      onEvent: s.onEvent,
    });
    await s.running;
    const t0 = Date.now();
    await c.cancel();
    expect(Date.now() - t0).toBeLessThan(1000 + SLACK_MS);
    const e = error(await p);
    expect(e.code).toBe("E_ABORTED");
    expect(e.terminated).toBeUndefined();
    expect(e.path).toBe("/steps/0");
    expect(created).toBe(1);
  });

  test(
    "(b) cancel terminates a worker that is stuck in a synchronous step",
    { timeout: TIMEOUT },
    async () => {
      const c = make({ cancelGraceMs: 300 });
      await c.init();
      const s = started();
      const p = c.bake(rec(op("fx:busy", { ms: 60_000 })), utf8("x"), {
        trust: "trusted",
        onEvent: s.onEvent,
      });
      await s.running;
      const t0 = Date.now();
      await c.cancel();
      expect(Date.now() - t0).toBeLessThan(300 + SLACK_MS);
      const e = error(await p);
      expect(e).toMatchObject({ code: "E_ABORTED", terminated: true, path: "/steps/0" });
      expect(created).toBe(1);
      // The next bake runs on a fresh worker.
      const next = await c.bake(rec(op("fx:sleep", { ms: 1 }), op("text:upper")), utf8("x"), {
        trust: "trusted",
      });
      expect(next).toMatchObject({ ok: true, output: { kind: "str", text: "X" } });
      expect(created).toBe(2);
    },
  );

  test(
    "(c) the deadline terminates a bake that overruns its time limit",
    { timeout: TIMEOUT },
    async () => {
      const c = make({ deadlineGraceMs: 300 });
      await c.init();
      const t0 = Date.now();
      const r = await c.bake(rec(op("fx:busy", { ms: 60_000 })), utf8("x"), {
        trust: "trusted",
        limits: { maxMillis: 200 },
      });
      const elapsed = Date.now() - t0;
      expect(error(r)).toMatchObject({ code: "E_LIMIT_TIME", terminated: true });
      expect(elapsed).toBeGreaterThanOrEqual(450);
      expect(elapsed).toBeLessThan(200 + 300 + SLACK_MS);
    },
  );

  test(
    "the shared flag stops a tight loop without terminating the worker",
    { timeout: TIMEOUT },
    async () => {
      const globals = globalThis as { crossOriginIsolated?: boolean };
      globals.crossOriginIsolated = true;
      try {
        const c = make({ cancelGraceMs: 10_000 });
        await c.init();
        const s = started();
        // 1000 rounds of rot over 2 MB: seconds of FL steps unless stopped.
        const p = c.bake(
          rec({ kind: "repeat", times: 1000, steps: [op("classical:rot", { amount: 1 })] }),
          new Uint8Array(2_000_000).fill(65),
          { trust: "trusted", onEvent: s.onEvent },
        );
        await s.running;
        const t0 = Date.now();
        await c.cancel();
        expect(Date.now() - t0).toBeLessThan(SLACK_MS);
        const e = error(await p);
        expect(e.code).toBe("E_ABORTED");
        expect(e.terminated).toBeUndefined();
        expect(created).toBe(1);
      } finally {
        delete globals.crossOriginIsolated;
      }
    },
  );

  test("an untrusted regex recipe runs on a killable worker", { timeout: TIMEOUT }, async () => {
    const c = make();
    await c.init();
    const r = await c.bake(
      rec(op("regex:replace", { pattern: "a+", replacement: "b" })),
      utf8("caab"),
    );
    expect(r).toMatchObject({ ok: true, output: { kind: "str", text: "cbb" } });
  });

  test("a bake sent while another runs supersedes it", { timeout: TIMEOUT }, async () => {
    const c = make({ cancelGraceMs: 300 });
    await c.init();
    const s = started();
    const first = c.bake(rec(op("fx:busy", { ms: 60_000 })), utf8("x"), {
      trust: "trusted",
      onEvent: s.onEvent,
    });
    await s.running;
    const second = await c.bake(rec(op("text:upper")), utf8("x"), { trust: "trusted" });
    expect(second.ok).toBe(true);
    expect(error(await first).code).toBe("E_ABORTED");
  });

  test("a worker that exits unexpectedly fails the active bake", { timeout: TIMEOUT }, async () => {
    const c = make({}, [new URL("./fixtures/exit.mjs", import.meta.url).href]);
    const init = c.init().then(
      () => "ready",
      (e: Error) => e.message,
    );
    expect(await init).toContain("terminated");
    const r = await c.bake(rec(), utf8("x"));
    expect(r.ok).toBe(false);
  });

  test("a failing init in a worker is an Error", { timeout: TIMEOUT }, async () => {
    const c = make();
    await expect(c.init({ vocabs: ["nope"] })).rejects.toThrow("unknown vocabulary 'nope'");
  });
});
