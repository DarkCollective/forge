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
import type { Catalogue } from "@forge/ops";
import type { Baker } from "@forge/worker";
import type { MagicCandidate, MagicOptions, MagicResult } from "@forge/worker/magic";
import type { ChecksReady } from "../ops/checks-data.js";
import { createMagicController, normaliseOptions } from "./controller.js";
import type { MagicDeps, MagicEngine, MagicState } from "./controller.js";
import { previewOutput, summarise, viewCandidate } from "./magic-view.js";

const catalogue = { version: "v1", ops: [] } as unknown as Catalogue;
const checks: ChecksReady = {
  evaluator: {} as ChecksReady["evaluator"],
  index: {
    get: () => undefined,
    entries: () => new Map([["a:b", { checks: [] }]]).entries() as never,
    size: 1,
  },
};
const STATS = {
  tried: 3,
  failed: 0,
  prunedEmpty: 0,
  prunedRepeat: 0,
  prunedNoGain: 0,
  prunedBreadth: 0,
  elapsedMs: 5,
};

function candidate(ops: string[], text: string, score = 0.9): MagicCandidate {
  const output = new TextEncoder().encode(text);
  return {
    recipe: { forge: 1, steps: ops.map((op) => ({ kind: "op", op })) } as never,
    ops,
    depth: ops.length,
    score,
    reasons: ["decoded text"],
    output,
    outputLength: output.length,
  };
}

function result(
  candidates: MagicCandidate[],
  stopped: MagicResult["stopped"] = "done",
): MagicResult {
  return { candidates, stopped, stats: STATS, quarantined: [] };
}

interface Fixture {
  deps: MagicDeps;
  baker: { inits: unknown[]; created: number; disposed: number };
  calls: MagicOptions[];
}

function fixture(
  engine: (input: Uint8Array, o: MagicOptions) => Promise<MagicResult>,
  userSource = "",
): Fixture {
  const baker = { inits: [] as unknown[], created: 0, disposed: 0 };
  const calls: MagicOptions[] = [];
  const deps: MagicDeps = {
    createBaker: () => {
      baker.created++;
      return {
        hardKill: true,
        init: (i: unknown) => {
          baker.inits.push(i);
          return Promise.resolve({});
        },
        dispose: () => {
          baker.disposed++;
          return Promise.resolve();
        },
      } as unknown as Baker;
    },
    loadEngine: () =>
      Promise.resolve<MagicEngine>({
        magic: (input, o) => {
          calls.push(o);
          return engine(input, o);
        },
      }),
    loadChecks: () => Promise.resolve(checks),
    userSource: () => userSource,
  };
  return { deps, baker, calls };
}

describe("a run", () => {
  test("is idle until asked, creates no baker, and loads nothing", () => {
    const f = fixture(() => Promise.resolve(result([])));
    const c = createMagicController(f.deps);
    expect(c.state.phase).toBe("idle");
    expect(f.baker.created).toBe(0);
  });

  test("passes the page's checks, depth and crib, and ends done with the candidates", async () => {
    const f = fixture(() => Promise.resolve(result([candidate(["a:b"], "hello")])));
    const c = createMagicController(f.deps);
    const seen: string[] = [];
    c.subscribe(() => seen.push(c.state.phase));
    await c.run(new Uint8Array([1]), catalogue, { depth: 4, crib: "he.*" });
    expect(c.state).toMatchObject({ phase: "done", announcement: "Magic found 1 candidate" });
    expect(seen[0]).toBe("running");
    const o = f.calls[0] as MagicOptions;
    expect(o.depth).toBe(4);
    expect(o.crib).toBe("he.*");
    expect(Object.keys(o.checks ?? {})).toEqual(["a:b"]);
    expect(o.baker.hardKill).toBe(true);
    expect(o.signal).toBeDefined();
  });

  test("omits the crib when it is empty, and clamps the depth", async () => {
    const f = fixture(() => Promise.resolve(result([])));
    const c = createMagicController(f.deps);
    await c.run(new Uint8Array([1]), catalogue, { depth: 99, crib: "" });
    const o = f.calls[0] as MagicOptions;
    expect("crib" in o).toBe(false);
    expect(o.depth).toBe(6);
    expect(normaliseOptions({ depth: 0, crib: "" }).depth).toBe(1);
    expect(normaliseOptions({ depth: Number.NaN, crib: "" }).depth).toBe(3);
  });

  test("no candidate is a result, announced as such", async () => {
    const f = fixture(() => Promise.resolve(result([])));
    const c = createMagicController(f.deps);
    await c.run(new Uint8Array([1]), catalogue, { depth: 3, crib: "" });
    expect(c.state).toMatchObject({ phase: "done", announcement: "Magic found no candidate" });
  });

  test("reports progress while it runs", async () => {
    let release: (r: MagicResult) => void = () => undefined;
    const f = fixture(
      (_i, o) =>
        new Promise<MagicResult>((resolve) => {
          o.onProgress?.({ tried: 7, candidates: 1, depth: 2, elapsedMs: 40 });
          release = resolve;
        }),
    );
    const c = createMagicController(f.deps);
    const p = c.run(new Uint8Array([1]), catalogue, { depth: 3, crib: "" });
    await new Promise((r) => setTimeout(r, 0));
    expect(c.state).toMatchObject({
      phase: "running",
      stage: "searching",
      progress: { tried: 7 },
    });
    release(result([]));
    await p;
    expect(c.state.phase).toBe("done");
  });

  test("Cancel aborts the signal and ends cancelled with what was found", async () => {
    const f = fixture(
      (_i, o) =>
        new Promise<MagicResult>((resolve) => {
          o.signal?.addEventListener("abort", () =>
            resolve(result([candidate(["a:b"], "x")], "aborted")),
          );
        }),
    );
    const c = createMagicController(f.deps);
    const p = c.run(new Uint8Array([1]), catalogue, { depth: 3, crib: "" });
    await new Promise((r) => setTimeout(r, 0));
    c.cancel();
    await p;
    expect(c.state).toMatchObject({ phase: "cancelled", announcement: "Magic cancelled" });
    const st = c.state as MagicState;
    expect(st.phase === "cancelled" ? st.result.candidates : []).toHaveLength(1);
  });

  test("a Cancel before the search starts never starts it", async () => {
    const f = fixture(() => Promise.resolve(result([])));
    const c = createMagicController(f.deps);
    const p = c.run(new Uint8Array([1]), catalogue, { depth: 3, crib: "" });
    c.cancel();
    await p;
    expect(c.state.phase).toBe("cancelled");
    expect(f.calls).toHaveLength(0);
  });

  test("an error of the engine is a state with a message, and the next run works", async () => {
    let fail = true;
    const f = fixture(() =>
      fail ? Promise.reject(new Error("bad crib")) : Promise.resolve(result([])),
    );
    const c = createMagicController(f.deps);
    await c.run(new Uint8Array([1]), catalogue, { depth: 3, crib: "(" });
    expect(c.state).toMatchObject({
      phase: "error",
      message: "bad crib",
      announcement: "Magic failed: bad crib",
    });
    fail = false;
    await c.run(new Uint8Array([1]), catalogue, { depth: 3, crib: "" });
    expect(c.state.phase).toBe("done");
  });

  test("the baker is created once, lazily, and initialised again only when the user words change", async () => {
    let source = "";
    const f = fixture(() => Promise.resolve(result([])));
    const deps = { ...f.deps, userSource: () => source };
    const c = createMagicController(deps);
    await c.run(new Uint8Array([1]), catalogue, { depth: 3, crib: "" });
    await c.run(new Uint8Array([1]), catalogue, { depth: 3, crib: "" });
    expect(f.baker.created).toBe(1);
    expect(f.baker.inits).toHaveLength(1);
    source = ": x ;";
    await c.run(new Uint8Array([1]), catalogue, { depth: 3, crib: "" });
    expect(f.baker.inits).toHaveLength(2);
    expect(f.baker.inits[1]).toMatchObject({ units: [{ name: "user", source }] });
    await c.dispose();
    expect(f.baker.disposed).toBe(1);
  });

  test("a second run waits for the first, and only the second one's result is kept", async () => {
    const order: string[] = [];
    let n = 0;
    const f = fixture(async (_i, o) => {
      const mine = ++n;
      order.push(`start${mine}`);
      if (mine === 1) await new Promise((r) => o.signal?.addEventListener("abort", () => r(0)));
      order.push(`end${mine}`);
      return result(mine === 1 ? [] : [candidate(["a:b"], "two")], mine === 1 ? "aborted" : "done");
    });
    const c = createMagicController(f.deps);
    const first = c.run(new Uint8Array([1]), catalogue, { depth: 3, crib: "" });
    await new Promise((r) => setTimeout(r, 0));
    const second = c.run(new Uint8Array([1]), catalogue, { depth: 3, crib: "" });
    await Promise.all([first, second]);
    expect(order).toEqual(["start1", "end1", "start2", "end2"]);
    expect(c.state).toMatchObject({ phase: "done" });
  });

  test("reset cancels a run and returns to idle", async () => {
    const f = fixture(
      (_i, o) =>
        new Promise<MagicResult>((resolve) => {
          o.signal?.addEventListener("abort", () => resolve(result([], "aborted")));
        }),
    );
    const c = createMagicController(f.deps);
    const p = c.run(new Uint8Array([1]), catalogue, { depth: 3, crib: "" });
    await new Promise((r) => setTimeout(r, 0));
    c.reset();
    await p;
    expect(c.state.phase).toBe("idle");
  });
});

describe("what is shown", () => {
  test("a text output is cut at 80 characters, on one line, with controls visible", () => {
    const text = `${"a".repeat(50)}\n\u0001${"b".repeat(60)}`;
    const bytes = new TextEncoder().encode(text);
    const p = previewOutput(bytes, bytes.length);
    expect(p.kind).toBe("text");
    expect(p.cut).toBe(true);
    expect(p.text).toBe("a".repeat(50) + "\\n\\x01" + "b".repeat(28));
    expect(p.text).not.toContain("\n");
  });

  test("a short output is not cut; a kept prefix of a longer one is", () => {
    const b = new TextEncoder().encode("hello");
    expect(previewOutput(b, 5)).toMatchObject({ text: "hello", kind: "text", cut: false });
    expect(previewOutput(b, 9000).cut).toBe(true);
  });

  test("bytes that are not text show as hex", () => {
    const b = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff]);
    expect(previewOutput(b, 5)).toMatchObject({
      text: "89 50 4e 47 ff",
      kind: "bytes",
      cut: false,
    });
  });

  test("a prefix cut inside a character is still text", () => {
    const whole = new TextEncoder().encode("héllo");
    const cut = whole.subarray(0, 2); // 'h' and the first byte of 'e acute'
    expect(previewOutput(cut, whole.length).kind).toBe("text");
  });

  test("the candidate view has the chain, score, reasons and length", () => {
    const v = viewCandidate(candidate(["hex:from", "deflate:gunzip"], "hi", 0.8765), 0);
    expect(v).toMatchObject({
      chain: "hex:from → deflate:gunzip",
      score: "0.88",
      reasons: ["decoded text"],
      outputLength: 2,
      preview: "hi",
    });
  });

  test("the summary says what stopped the search", () => {
    expect(summarise({ candidates: [], stopped: "done" })).toBe("Magic found no candidate");
    expect(summarise({ candidates: [candidate(["a:b"], "x")], stopped: "deadline" })).toBe(
      "Magic found 1 candidate; the search stopped at its time limit",
    );
  });
});
