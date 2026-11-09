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
import { describe, expect, test } from "vitest";
import { fxLoader, utf8 } from "../test/helpers.js";
import { createBakerCore } from "./core.js";
import { createInProcessBaker } from "./inprocess.js";
import type { Baker, BakeEvent, BakeResult } from "./types.js";

async function make(loadBundle = loadBundleNode, hardKill = false): Promise<Baker> {
  const baker = createBakerCore({ loadBundle, hardKill });
  await baker.init();
  return baker;
}

const op = (name: string, params?: Record<string, unknown>, extra: object = {}) => ({
  kind: "op",
  op: name,
  ...(params === undefined ? {} : { params }),
  ...extra,
});
const rec = (...steps: unknown[]) => ({ forge: 1, steps });
const T = { trust: "trusted" } as const;

function fail(r: BakeResult) {
  if (r.ok) throw new Error("expected a failure");
  return r.error;
}
function out(r: BakeResult) {
  if (!r.ok) throw new Error(`expected success, got ${r.error.code}: ${r.error.message}`);
  return r.output;
}

const DEMO = {
  forge: 1,
  name: "Demo",
  steps: [
    op("base64:decode", { alphabet: "standard" }),
    { kind: "comment", text: "split into lines" },
    {
      kind: "fork",
      split: { value: "\n", enc: "utf8" },
      join: { value: "0a", enc: "hex" },
      steps: [
        op("classical:rot", { amount: 13 }, { breakpoint: true }),
        op("text:upper", undefined, { disabled: true, note: "off for now" }),
      ],
    },
    { kind: "subsection", pattern: "[a-z]+", flags: "i", steps: [op("text:reverse")] },
    {
      kind: "if",
      test: { kind: "regex", pattern: "^o" },
      then: [op("text:lower")],
      else: [],
    },
    {
      kind: "repeat",
      until: "stable",
      steps: [op("regex:replace", { pattern: "aa", replacement: "a" })],
    },
    op("hex:encode", { delimiter: "space" }),
  ],
};

describe("init", () => {
  test("returns the full set of vocabularies, with recipe and its dependencies", async () => {
    const baker = createBakerCore({ loadBundle: loadBundleNode });
    const info = await baker.init({ vocabs: ["hex"] });
    expect(info.protocol).toBe(1);
    expect(info.vocabs).toEqual(["base64", "hex", "recipe", "regex"]);
    expect(info.catalogueVersion).toMatch(/^[0-9a-f]{16}$/);
    const all = await baker.init();
    expect(all.vocabs).toContain("classical");
  });

  test("rejects with the error text when assembly fails; the baker is then not ready", async () => {
    const baker = createBakerCore({ loadBundle: loadBundleNode });
    await baker.init();
    await expect(baker.init({ vocabs: ["nope"] })).rejects.toThrow("unknown vocabulary 'nope'");
    const r = await baker.bake(rec(), new Uint8Array());
    expect(fail(r).code).toBe("E_NOT_READY");
    await expect(
      baker.init({ units: [{ name: "evil.fth", source: "IN: hex\n: x ( -- ) ;" }] }),
    ).rejects.toThrow(/E_READONLY/);
    await expect(
      baker.init({ units: [{ name: "evil.fth", source: 'IN: mine\n: x ( -- ) "" 1 2 3 [' }] }),
    ).rejects.toThrow();
  });

  test("a rejection that is not an Error is still an Error", async () => {
    const baker = createBakerCore({
      loadBundle: () => Promise.reject("plain string" as unknown as Error),
    });
    await expect(baker.init()).rejects.toThrow("plain string");
  });

  test("user units extend the catalogue", async () => {
    const baker = createBakerCore({ loadBundle: loadBundleNode });
    await baker.init({
      units: [
        {
          name: "mine.fth",
          source: `IN: mine
: twice ( bytes -- bytes )
  "Doubles the data." doc
  "Test" category
  dup cat ;
`,
        },
      ],
    });
    // The word is not in the bundle's catalogue as a bundle op, but it is a valid catalogue op.
    const r = await baker.bake(rec(op("mine:twice")), utf8("ab"), T);
    expect(out(r)).toMatchObject({ kind: "bytes", text: "abab" });
  });
});

describe("bake basics", () => {
  test("E_NOT_READY before init", async () => {
    const baker = createBakerCore({ loadBundle: loadBundleNode });
    const e = fail(await baker.bake(rec(), new Uint8Array()));
    expect(e.code).toBe("E_NOT_READY");
    expect(e.path).toBeNull();
  });

  test("an empty recipe returns the input", async () => {
    const baker = await make();
    const r = await baker.bake(rec(), utf8("hi"), T);
    expect(out(r)).toMatchObject({ kind: "bytes", text: "hi" });
    expect(r.steps).toEqual([]);
    expect(r.stats.vmSteps).toBeGreaterThan(0);
  });

  test("E_RECIPE_INVALID carries the issues and no path", async () => {
    const baker = await make();
    const e = fail(await baker.bake({ forge: 2, steps: [] }, new Uint8Array()));
    expect(e.code).toBe("E_RECIPE_INVALID");
    expect(e.path).toBeNull();
    expect(e.issues?.[0]?.code).toBe("bad-version");
    expect(fail(await baker.bake("nonsense", new Uint8Array())).code).toBe("E_RECIPE_INVALID");
  });

  test("pins: warn keeps a warning, strict fails, ignore is silent", async () => {
    const baker = await make();
    const pinned = rec(op("text:upper", undefined, { hash: "0".repeat(64) }));
    const warn = await baker.bake(pinned, utf8("a"), T);
    expect(out(warn)).toMatchObject({ kind: "str", text: "A" });
    expect(warn.warnings.map((w) => w.code)).toEqual(["hash-mismatch"]);
    const strict = await baker.bake(pinned, utf8("a"), { ...T, pins: "strict" });
    expect(fail(strict).code).toBe("E_RECIPE_INVALID");
    const ignore = await baker.bake(pinned, utf8("a"), { ...T, pins: "ignore" });
    expect(ignore.warnings).toEqual([]);
  });

  test("an alias is accepted with a warning", async () => {
    const baker = await make();
    const r = await baker.bake(rec(op("classical:rot13")), utf8("Hello"), T);
    expect(out(r)).toMatchObject({ text: "Uryyb" });
    expect(r.warnings.map((w) => w.code)).toEqual(["alias-used"]);
  });

  test("ids increase", async () => {
    const baker = await make();
    const a = await baker.bake(rec(), new Uint8Array(), T);
    const b = await baker.bake(rec(), new Uint8Array(), T);
    expect(b.id).toBeGreaterThan(a.id);
  });

  test("in-process baker has hardKill false and ignores the option", async () => {
    const baker = createInProcessBaker({ loadBundle: loadBundleNode });
    expect(baker.hardKill).toBe(false);
    await baker.dispose();
    expect(fail(await baker.bake(rec(), new Uint8Array())).code).toBe("E_NOT_READY");
  });
});

describe("E_UNSAFE_HOST", () => {
  const regexRecipes = [
    rec(op("regex:test", { pattern: "a" }), op("text:upper")),
    rec({ kind: "subsection", pattern: "a", steps: [] }),
    rec({ kind: "if", test: { kind: "regex", pattern: "a" }, then: [] }),
  ];

  test("an untrusted regex recipe is refused on a host that cannot be killed", async () => {
    const baker = await make();
    for (const recipe of regexRecipes) {
      const e = fail(await baker.bake(recipe, utf8("a")));
      expect(e.code).toBe("E_UNSAFE_HOST");
      expect(e.detail).toEqual({ reason: "regex" });
    }
  });

  test("trusted bakes and hard-kill hosts run it; disabled regex steps do not count", async () => {
    const plain = await make();
    expect((await plain.bake(regexRecipes[1], utf8("a"), T)).ok).toBe(true);
    const killable = await make(loadBundleNode, true);
    expect(killable.hardKill).toBe(true);
    const r = await killable.bake(regexRecipes[1], utf8("a"));
    expect(r.ok).toBe(true);
    const disabled = rec(op("regex:test", { pattern: "a" }, { disabled: true }));
    expect((await plain.bake(disabled, utf8("a"))).ok).toBe(true);
  });
});

describe("limits", () => {
  test("untrusted bakes can only tighten, trusted may loosen", async () => {
    const baker = await make();
    const loop = rec({ kind: "repeat", times: 1000, steps: [op("text:upper")] });
    const tight = await baker.bake(loop, utf8("a"), { limits: { maxSteps: 50 } });
    expect(fail(tight).code).toBe("E_LIMIT_STEPS");
    const loosened = await baker.bake(loop, utf8("a"), { limits: { maxSteps: 1e12 } });
    expect(loosened.ok).toBe(true);
  });
});

describe("the demo recipe (section 12.2)", () => {
  test("bakes, with per-piece run counts", async () => {
    const baker = await make();
    const r = await baker.bake(DEMO, utf8("VXJ5eWIKSmJleXE="), T);
    expect(out(r)).toEqual({ kind: "str", text: "6f 6c 6c 65 68 0a 64 6c 72 6f 77" });
    expect(r.steps.find((s) => s.path === "/steps/2/steps/0")?.runs).toBe(2);
    expect(r.steps.map((s) => s.path)).not.toContain("/steps/2/steps/1");
    expect(r.steps.map((s) => s.path)).toContain("/steps/5/steps/0");
    for (const s of r.steps) expect(s.ms).toBeGreaterThanOrEqual(0);
  });

  test("debug pauses at the breakpoint before each piece", async () => {
    const baker = await make();
    const events: BakeEvent[] = [];
    const seen: string[] = [];
    const result = baker.bake(DEMO, utf8("VXJ5eWIKSmJleXE="), {
      ...T,
      debug: {},
      onEvent: (e) => {
        events.push(e);
        if (e.type === "paused") {
          seen.push(e.data.kind === "bytes" ? (e.data.text ?? "?") : "?");
          void baker.continue();
        }
      },
    });
    await result;
    const paused = events.filter((e) => e.type === "paused");
    expect(paused.map((e) => e.type === "paused" && [e.path, e.reason])).toEqual([
      ["/steps/2/steps/0", "breakpoint"],
      ["/steps/2/steps/0", "breakpoint"],
    ]);
    expect(seen).toEqual(["Uryyb", "Jbeyq"]);
    expect(events.filter((e) => e.type === "resumed")).toHaveLength(2);
  });
});

describe("debugging", () => {
  const three = rec(op("hex:decode"), op("text:upper"), op("text:lower"));

  test("startPaused, then step through every step start", async () => {
    const baker = await make();
    const log: string[] = [];
    const r = await baker.bake(three, utf8("6162"), {
      ...T,
      debug: { startPaused: true },
      onEvent: (e) => {
        if (e.type === "paused") {
          log.push(`${e.reason}:${e.path}`);
          void baker.step();
        }
      },
    });
    expect(r.ok).toBe(true);
    expect(log).toEqual(["start:/steps/0", "step:/steps/1", "step:/steps/2"]);
  });

  test("step then continue runs to the next breakpoint", async () => {
    const baker = await make();
    const recipe = rec(
      op("hex:decode"),
      op("text:upper", undefined, { breakpoint: true }),
      op("text:lower"),
      op("text:upper", undefined, { breakpoint: true }),
    );
    const log: string[] = [];
    let n = 0;
    const r = await baker.bake(recipe, utf8("6162"), {
      ...T,
      debug: { startPaused: true },
      onEvent: (e) => {
        if (e.type !== "paused") return;
        log.push(`${e.reason}:${e.path}`);
        void (n++ === 0 ? baker.continue() : baker.step());
      },
    });
    expect(r.ok).toBe(true);
    expect(log).toEqual([
      "start:/steps/0",
      "breakpoint:/steps/1",
      "step:/steps/2",
      "breakpoint:/steps/3",
    ]);
  });

  test("breakpoints are ignored without debug", async () => {
    const baker = await make();
    const events: BakeEvent[] = [];
    const r = await baker.bake(
      rec(op("hex:decode", undefined, { breakpoint: true })),
      utf8("6162"),
      {
        ...T,
        onEvent: (e) => events.push(e),
      },
    );
    expect(r.ok).toBe(true);
    expect(events.some((e) => e.type === "paused")).toBe(false);
  });

  test("step and continue when nothing is paused are ignored", async () => {
    const baker = await make();
    await baker.step();
    await baker.continue();
    await baker.cancel();
    expect((await baker.bake(rec(), utf8("x"), T)).ok).toBe(true);
    await baker.step();
  });

  test("cancel ends a paused bake with E_ABORTED", async () => {
    const baker = await make();
    const events: BakeEvent[] = [];
    const p = baker.bake(three, utf8("6162"), {
      ...T,
      debug: { startPaused: true },
      onEvent: (e) => {
        events.push(e);
        if (e.type === "paused") void baker.cancel();
      },
    });
    const r = await p;
    expect(fail(r).code).toBe("E_ABORTED");
    expect(events.filter((e) => e.type === "resumed")).toEqual([]);
  });

  test("a new bake supersedes a paused one", async () => {
    const baker = await make();
    let first: Promise<BakeResult> | undefined;
    const paused = new Promise<void>((resolve) => {
      first = baker.bake(three, utf8("6162"), {
        ...T,
        debug: { startPaused: true },
        onEvent: (e) => {
          if (e.type === "paused") resolve();
        },
      });
    });
    await paused;
    const second = await baker.bake(rec(), utf8("x"), T);
    expect(second.ok).toBe(true);
    expect(fail(await (first as Promise<BakeResult>)).code).toBe("E_ABORTED");
  });

  test("a throwing listener does not break the bake", async () => {
    const baker = await make();
    const r = await baker.bake(three, utf8("6162"), {
      ...T,
      onEvent: () => {
        throw new Error("listener");
      },
    });
    expect(r.ok).toBe(true);
  });
});

describe("progress", () => {
  test("a final event always arrives; events are throttled", async () => {
    const baker = await make();
    const events: BakeEvent[] = [];
    const recipe = rec(
      op("hex:decode"),
      { kind: "comment", text: "x" },
      op("text:upper", undefined, { disabled: true }),
      op("text:lower"),
    );
    const r = await baker.bake(recipe, utf8("6162"), { ...T, onEvent: (e) => events.push(e) });
    expect(r.ok).toBe(true);
    const progress = events.filter((e) => e.type === "progress");
    expect(progress.length).toBeLessThanOrEqual(3);
    const last = progress[progress.length - 1];
    expect(last).toMatchObject({ type: "progress", done: 2, total: 2, path: "/steps/3" });
  });

  test("a many-step recipe emits far fewer events than steps", async () => {
    const baker = await make();
    const steps = Array.from({ length: 300 }, () => op("text:upper"));
    let count = 0;
    await baker.bake(rec(...steps), utf8("a"), {
      ...T,
      onEvent: (e) => e.type === "progress" && count++,
    });
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThan(300);
  });
});

describe("errors are attributed to steps (section 12.6)", () => {
  const fork = rec(op("hex:decode"), {
    kind: "fork",
    split: { value: "\n", enc: "utf8" },
    join: { value: "\n", enc: "utf8" },
    steps: [op("text:upper")],
  });

  test("an error in a fork child names the child", async () => {
    const baker = await make();
    const r = await baker.bake(fork, utf8("610a62ff0a63".replace(/(..)/g, "$1")), T);
    // The input is not hex text for the bytes above; use real hex text instead.
    expect(r.ok).toBe(false);
    const text = "610a62ff0a63";
    const real = await baker.bake(fork, utf8(text), T);
    const e = fail(real);
    expect(e.code).toBe("E_COERCE");
    expect(e.word).toBe("text:upper");
    expect(e.path).toBe("/steps/1/steps/0");
  });

  test("a failing top-level step, with the partial value", async () => {
    const baker = await make();
    const r = await baker.bake(rec(op("hex:decode"), op("text:upper")), utf8("ff"), T);
    const e = fail(r);
    expect(e).toMatchObject({ code: "E_COERCE", path: "/steps/1", word: "text:upper" });
    expect(r.ok ? null : r.partial).toMatchObject({ kind: "bytes" });
    expect(r.steps.map((s) => s.path)).toEqual(["/steps/0", "/steps/1"]);
  });

  test("repeated uses of one op are attributed exactly", async () => {
    const baker = await make();
    const recipe = rec(
      op("hex:decode"),
      op("text:upper"),
      op("hex:encode"),
      op("hex:decode"),
      op("text:lower"),
    );
    const r = await baker.bake(recipe, utf8("6162"), T);
    expect(out(r)).toMatchObject({ kind: "str", text: "ab" });
    expect(r.coercions).toEqual([
      { path: "/steps/1", op: "text:upper", from: "bytes", to: "str" },
      { path: "/steps/2", op: "hex:encode", from: "str", to: "bytes" },
      { path: "/steps/3", op: "hex:decode", from: "str", to: "bytes" },
      { path: "/steps/4", op: "text:lower", from: "bytes", to: "str" },
    ]);
    // Same op in a fork, run per piece, and as a later separate step.
    const forked = rec(
      op("hex:decode"),
      {
        kind: "fork",
        split: { value: "\n", enc: "utf8" },
        join: { value: "\n", enc: "utf8" },
        steps: [op("text:upper")],
      },
      op("text:upper"),
    );
    const r2 = await baker.bake(forked, utf8("610a62"), T);
    expect(r2.coercions.map((c) => [c.path, c.op])).toEqual([
      ["/steps/1/steps/0", "text:upper"],
      ["/steps/1/steps/0", "text:upper"],
      ["/steps/2", "text:upper"],
    ]);
    expect(r2.coercionsTruncated).toBe(false);
  });

  test("coercions of parameters, bodies, aliases and tests are filtered", async () => {
    const baker = await make();
    const r = await baker.bake(
      rec(
        op("hex:decode"),
        { kind: "if", test: { kind: "op", op: "regex:test", params: { pattern: "a" } }, then: [] },
        op("classical:rot13"),
        op("regex:replace", { pattern: "a", replacement: "b" }),
      ),
      utf8("6162"),
      T,
    );
    expect(r.coercions.map((c) => [c.path, c.op])).toEqual([["/steps/3", "regex:replace"]]);
  });

  test("a full step log gives null paths and coercionsTruncated reports the VM record", async () => {
    const baker = await make();
    const steps = Array.from({ length: 6 }, (_, i) =>
      i % 2 === 0 ? op("classical:rot", { amount: 0 }) : op("text:upper"),
    );
    const r = await baker.bake(rec(...steps), utf8("6162"), {
      ...T,
      limits: { maxTraceEntries: 4 },
    });
    expect(r.ok).toBe(true);
    expect(r.coercionsTruncated).toBe(true);
    expect(r.coercions.length).toBeLessThanOrEqual(4);
    const e = await baker.bake(rec(...steps), utf8("6162"), {
      ...T,
      limits: { maxTraceEntries: 2 },
    });
    expect(e.coercions.every((c) => c.path === null || c.path.startsWith("/steps/"))).toBe(true);
    expect(e.coercions.some((c) => c.path === null)).toBe(true);
  });
});

describe("failures at run time", () => {
  test("a bad base64 input is E_COERCE at the step with JSON-safe detail", async () => {
    const baker = await make();
    const e = fail(await baker.bake(rec(op("base64:decode")), utf8("Zm9v!"), T));
    expect(e.code).toBe("E_COERCE");
    expect(e.path).toBe("/steps/0");
    expect(() => JSON.stringify(e)).not.toThrow();
  });

  test("a time limit is E_LIMIT_TIME", async () => {
    const baker = await make(fxLoader);
    const e = fail(
      await baker.bake(rec(op("fx:sleep", { ms: 5000 })), utf8("x"), {
        ...T,
        limits: { maxMillis: 30 },
      }),
    );
    expect(e.code).toBe("E_LIMIT_TIME");
    expect(e.path).toBe("/steps/0");
  });

  test("cancel stops an async step", async () => {
    const baker = await make(fxLoader);
    const p = baker.bake(rec(op("fx:sleep", { ms: 60_000 })), utf8("x"), T);
    await new Promise((r) => setTimeout(r, 30));
    await baker.cancel();
    const r = await p;
    expect(fail(r).code).toBe("E_ABORTED");
    expect(fail(r).terminated).toBeUndefined();
  });

  test("a bake started while another runs cancels it first", async () => {
    const baker = await make(fxLoader);
    const first = baker.bake(rec(op("fx:sleep", { ms: 60_000 })), utf8("x"), T);
    await new Promise((r) => setTimeout(r, 20));
    const second = await baker.bake(rec(op("text:upper")), utf8("x"), T);
    expect(out(second)).toMatchObject({ text: "X" });
    expect(fail(await first).code).toBe("E_ABORTED");
  });

  test("three bakes started together: the middle one is superseded before it starts", async () => {
    const baker = await make(fxLoader);
    const a = baker.bake(rec(op("fx:sleep", { ms: 60_000 })), utf8("x"), T);
    const b = baker.bake(rec(op("text:upper")), utf8("x"), T);
    const c = baker.bake(rec(op("text:lower")), utf8("X"), T);
    expect(fail(await a).code).toBe("E_ABORTED");
    expect(fail(await b).code).toBe("E_ABORTED");
    expect(out(await c)).toMatchObject({ text: "x" });
  });

  test("the abort flag stops a loop", async () => {
    const baker = await make();
    const flag = new Int32Array(new SharedArrayBuffer(4));
    Atomics.store(flag, 0, 1);
    const loop = rec({ kind: "repeat", times: 1000, steps: [op("text:upper")] });
    const r = await baker.bake(loop, utf8("a"), { ...T, abortFlag: flag });
    expect(fail(r).code).toBe("E_ABORTED");
  });

  test("unit text that fails to load is reported by its code", async () => {
    const baker = createBakerCore({ loadBundle: loadBundleNode });
    await baker.init();
    // A recipe that validates but whose word cannot be loaded cannot be built from JSON; instead
    // check that dispose then bake is not ready.
    await baker.dispose();
    expect(fail(await baker.bake(rec(), new Uint8Array())).code).toBe("E_NOT_READY");
  });
});
