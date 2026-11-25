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

/*
 * RECIPES-1.2.md sections 7 and 12, RW5: named inputs, `input:tab`, the early tab check, the per-step schema,
 * `dataInfo`, and protocol 2. Cases CR242 to CR246 and CR262. The same assertions run on the in-process baker, on
 * the client over the Node host, and (for the message rules) on the port.
 */
import { loadBundleNode } from "@forge/ops/node";
import { inputNames, recipeUsesV12 } from "@forge/recipe";
import type { Recipe } from "@forge/recipe";
import { afterAll, describe, expect, test } from "vitest";
import { createBakerClient } from "./client.js";
import { createBakerCore, implicitOf } from "./core.js";
import { createNodeWorkerHost } from "./host-node.js";
import { attachBakerCore } from "./port.js";
import { outputInfo } from "./render.js";
import { BAKE_INPUT_LIMITS, PROTOCOL_VERSION, RENDER_LIMITS } from "./types.js";
import type { Baker, BakeEvent, BakeResult, ClientMessage, WorkerMessage } from "./types.js";

const T = { trust: "trusted", pins: "ignore" } as const;
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const text = (r: BakeResult): string => {
  if (!r.ok) throw new Error(`expected success, got ${r.error.code}: ${r.error.message}`);
  if (r.output.kind === "str") return r.output.text;
  if (r.output.kind !== "bytes") throw new Error(`expected bytes, got ${r.output.kind}`);
  return new TextDecoder().decode(r.output.bytes);
};
const fail = (r: BakeResult) => {
  if (r.ok) throw new Error("expected a failure");
  return r.error;
};
const op = (name: string, params?: Record<string, unknown>, extra: object = {}) => ({
  kind: "op",
  op: name,
  ...(params === undefined ? {} : { params }),
  ...extra,
});
const rec = (...steps: unknown[]) => ({ forge: 1, steps });
const tab = (name: string) => op("input:tab", { tab: name });

const ORDERS = { name: "orders", bytes: utf8("id,total\n1,5\n2,7\n") };

const cores: Baker[] = [];
async function core(options: { early?: boolean } = {}): Promise<Baker> {
  const baker = createBakerCore({
    loadBundle: loadBundleNode,
    ...(options.early === false ? { earlyInputCheck: false } : {}),
  });
  await baker.init();
  cores.push(baker);
  return baker;
}

const clients: Baker[] = [];
async function client(): Promise<Baker> {
  const baker = createBakerClient({ host: () => createNodeWorkerHost() });
  await baker.init();
  clients.push(baker);
  return baker;
}

afterAll(async () => {
  for (const b of [...cores, ...clients]) await b.dispose();
});

// Run each case on the in-process baker and on the client over the Node host (a real worker thread).
const makers: [string, () => Promise<Baker>][] = [
  ["in-process", () => core()],
  ["client over the Node host", client],
];

describe.each(makers)("named inputs and input:tab (%s)", (_name, make) => {
  test("input:tab reads the raw bytes of the named tab and ignores the data above it", async () => {
    const baker = await make();
    const r = await baker.bake(rec(tab("orders")), utf8("ignored"), { ...T, inputs: [ORDERS] });
    expect(text(r)).toBe("id,total\n1,5\n2,7\n");
    const r2 = await baker.bake(rec(op("text:upper"), tab("orders")), utf8("x"), {
      ...T,
      inputs: [ORDERS, { name: "b", bytes: utf8("B") }],
    });
    expect(text(r2)).toBe("id,total\n1,5\n2,7\n");
  });

  test("the name is matched exactly: case, spaces and Unicode form", async () => {
    const baker = await make();
    const inputs = [{ name: "é", bytes: utf8("nfc") }, ORDERS];
    for (const name of ["Orders", " orders", "orders ", "é"]) {
      const e = fail(await baker.bake(rec(tab(name)), utf8(""), { ...T, inputs }));
      expect(e.code).toBe("E_PARAM_INVALID");
    }
    expect(text(await baker.bake(rec(tab("é")), utf8(""), { ...T, inputs }))).toBe("nfc");
  });

  test("CR243 the early check fails before step 0 with the shape of section 7.4", async () => {
    const baker = await make();
    const r = await baker.bake(rec(tab("missing")), utf8(""), { ...T, inputs: [ORDERS] });
    const e = fail(r);
    expect(e).toMatchObject({
      code: "E_PARAM_INVALID",
      path: "/steps/0",
      word: "input:tab",
      detail: { param: "tab", reason: "no-such-input", tab: "missing", tabs: ["orders"] },
    });
    expect(r.steps).toEqual([]);
  });

  test("CR243 a bake with no inputs finds no tabs", async () => {
    const baker = await make();
    const e = fail(await baker.bake(rec(tab("orders")), utf8(""), T));
    expect(e).toMatchObject({ code: "E_PARAM_INVALID", detail: { tabs: [] } });
  });

  test("CR243 the first missing name in document order is the one reported", async () => {
    const baker = await make();
    const e = fail(
      await baker.bake(rec(tab("orders"), tab("zz"), tab("yy")), utf8(""), {
        ...T,
        inputs: [ORDERS],
      }),
    );
    expect(e.path).toBe("/steps/1");
    expect(e.detail["tab"]).toBe("zz");
  });

  test("CR243 a tab supplied by a register is checked by the primitive and names the register", async () => {
    const baker = await make();
    const recipe = rec(
      { kind: "register", name: "t", steps: [op("text:upper")] },
      op("input:tab", { tab: { ref: "t" } }),
    );
    const r = await baker.bake(recipe, utf8("nope"), { ...T, inputs: [ORDERS] });
    const e = fail(r);
    expect(e).toMatchObject({
      code: "E_PARAM_INVALID",
      path: "/steps/1",
      word: "input:tab",
      detail: { reason: "no-such-input", tab: "NOPE", tabs: ["orders"], register: "t" },
    });
    expect(r.steps.map((s) => s.path)).toContain("/steps/1");
    const ok = await baker.bake(recipe, utf8("orders"), {
      ...T,
      inputs: [{ ...ORDERS, name: "ORDERS" }],
    });
    expect(text(ok)).toBe("id,total\n1,5\n2,7\n");
  });

  test("detail.tabs lists at most 20 names, each cut to 80 code points", async () => {
    const baker = await make();
    const inputs = Array.from({ length: 25 }, (_, i) => ({
      name: `${"é".repeat(100)}${i}`,
      bytes: utf8("x"),
    }));
    const e = fail(await baker.bake(rec(tab("nope")), utf8(""), { ...T, inputs }));
    const tabs = e.detail["tabs"] as string[];
    expect(tabs).toHaveLength(20);
    expect(tabs.every((t) => [...t].length === 80)).toBe(true);
  });

  test("CR244 a duplicate name, too many inputs and a bad name are E_PROTOCOL and run nothing", async () => {
    const baker = await make();
    const go = (inputs: { name: string; bytes: Uint8Array }[]) =>
      baker.bake(rec(op("text:upper")), utf8("a"), { ...T, inputs });
    const dup = await go([
      { name: "a", bytes: utf8("1") },
      { name: "a", bytes: utf8("2") },
    ]);
    expect(fail(dup)).toMatchObject({
      code: "E_PROTOCOL",
      path: null,
      detail: { reason: "input-duplicate", name: "a" },
    });
    expect(dup.steps).toEqual([]);
    const many = await go(
      Array.from({ length: BAKE_INPUT_LIMITS.maxInputs + 1 }, (_, i) => ({
        name: `t${i}`,
        bytes: utf8(""),
      })),
    );
    expect(fail(many)).toMatchObject({ code: "E_PROTOCOL", detail: { reason: "input-count" } });
    const bad = ["a\nb", "", "x\u0085y", "lone\ud800", "z".repeat(121)];
    for (const name of bad) {
      const r = await go([{ name, bytes: utf8("") }]);
      expect(fail(r), JSON.stringify(name)).toMatchObject({
        code: "E_PROTOCOL",
        detail: { reason: "input-name" },
      });
      expect(r.steps).toEqual([]);
    }
    // 32 inputs and a name of 120 code points are fine.
    const fine = await go([
      ...Array.from({ length: 31 }, (_, i) => ({ name: `t${i}`, bytes: utf8("") })),
      { name: "😀".repeat(120), bytes: utf8("") },
    ]);
    expect(text(fine)).toBe("A");
  });

  test("the total size of the inputs and the main input is bounded by maxTotalBytes", async () => {
    const baker = await make();
    const r = await baker.bake(rec(op("text:upper")), utf8("abc"), {
      ...T,
      limits: { maxTotalBytes: 10 },
      inputs: [{ name: "a", bytes: new Uint8Array(8) }],
    });
    expect(fail(r)).toMatchObject({ code: "E_PROTOCOL", detail: { reason: "input-size" } });
  });

  test("CR245 a step that left a table reports its schema; a step that failed has no out", async () => {
    const baker = await make();
    const r = await baker.bake(
      rec(op("csv:parse"), op("bytes-slice:take", { start: 0, length: 1 })),
      utf8("a,b\n1,x\n"),
      T,
    );
    expect(r.steps.find((s) => s.path === "/steps/0")?.out).toEqual({
      tag: "ext",
      kind: "table",
      schema: [
        { name: "a", type: "int" },
        { name: "b", type: "str" },
      ],
    });
    // The step after it failed (bytes-slice wants bytes): it has an entry and no out.
    expect(r.ok).toBe(false);
    const failed = r.steps.find((s) => s.path === "/steps/1");
    expect(failed).toBeDefined();
    expect(failed?.out).toBeUndefined();
  });

  test("CR245 a step that left bytes reports the tag only; steps after a failure have no report", async () => {
    const baker = await make();
    const r = await baker.bake(
      rec(op("text:upper"), op("hex:decode"), op("text:lower")),
      utf8("zz"),
      T,
    );
    expect(r.ok).toBe(false);
    expect(r.steps.find((s) => s.path === "/steps/0")?.out).toEqual({ tag: "str" });
    expect(r.steps.some((s) => s.path === "/steps/2")).toBe(false);
  });

  test("CR245 the last step reports its output too", async () => {
    const baker = await make();
    const r = await baker.bake(rec(op("text:upper"), op("csv:parse")), utf8("a\n1\n"), T);
    expect(r.ok).toBe(true);
    expect(r.steps.find((s) => s.path === "/steps/1")?.out).toMatchObject({ kind: "table" });
  });

  test("CR245 a fork child that runs three times reports its last output", async () => {
    const baker = await make();
    const r = await baker.bake(
      rec({
        kind: "fork",
        split: { value: "\n", enc: "utf8" },
        join: { value: "0a", enc: "hex" },
        steps: [op("text:upper")],
      }),
      utf8("a\nb\nc"),
      T,
    );
    const child = r.steps.find((s) => s.path === "/steps/0/steps/0");
    expect(child).toMatchObject({ runs: 3, out: { tag: "str" } });
  });

  test("CR245 a table of 300 columns has 256 and schemaTruncated", async () => {
    const baker = await make();
    const header = Array.from({ length: 300 }, (_, i) => `c${i}`).join(",");
    const r = await baker.bake(rec(op("csv:parse")), utf8(`${header}\n`), T);
    const out = r.steps.find((s) => s.path === "/steps/0")?.out;
    expect(out?.schema).toHaveLength(RENDER_LIMITS.maxSchemaColumns);
    expect(out?.schemaTruncated).toBe(true);
  });

  test("CR246 a pause before /steps/1 has dataInfo equal to the out of /steps/0", async () => {
    const baker = await make();
    const events: BakeEvent[] = [];
    const r = await baker.bake(rec(op("csv:parse"), op("table:to-json")), utf8("a,b\n1,x\n"), {
      ...T,
      debug: { startPaused: true },
      onEvent: (e) => {
        events.push(e);
        if (e.type === "paused") void baker.step();
      },
    });
    expect(r.ok).toBe(true);
    const paused = events.filter(
      (e): e is Extract<BakeEvent, { type: "paused" }> => e.type === "paused",
    );
    const at1 = paused.find((e) => e.path === "/steps/1");
    expect(at1?.dataInfo).toEqual(r.steps.find((s) => s.path === "/steps/0")?.out);
    expect(paused.find((e) => e.path === "/steps/0")?.dataInfo).toEqual({ tag: "bytes" });
  });
});

describe("CR262 recipes that read tabs", () => {
  const recipe = rec(tab("orders.b64"), {
    kind: "if",
    test: { kind: "regex", pattern: "." },
    then: [op("input:tab", { tab: "customers.csv" }, { disabled: true })],
  }) as unknown as Recipe;

  test("inputNames lists the enabled literal names in document order, and the recipe needs v1.2", () => {
    expect(inputNames(recipe)).toEqual([{ name: "orders.b64", path: "/steps/0" }]);
    expect(recipeUsesV12(rec(tab("a")) as unknown as Recipe)).toBe(true);
  });

  test("a disabled step is not checked early", async () => {
    const baker = await core();
    const r = await baker.bake(
      rec(tab("a"), op("input:tab", { tab: "gone" }, { disabled: true })),
      utf8(""),
      { ...T, inputs: [{ name: "a", bytes: utf8("A") }] },
    );
    expect(text(r)).toBe("A");
  });
});

describe("outputInfo", () => {
  test("a value that is not an ext has only its tag; quotations are other", () => {
    expect(outputInfo({ tag: "str", v: "x" } as never)).toEqual({ tag: "str" });
    expect(outputInfo({ tag: "quot" } as never)).toEqual({ tag: "other" });
  });
});

describe("protocol 2", () => {
  function attach(baker: Baker) {
    const sent: WorkerMessage[] = [];
    let handler: (m: ClientMessage) => void = () => undefined;
    attachBakerCore(
      {
        postMessage: (m) => void sent.push(m),
        onMessage: (h) => void (handler = h),
      },
      baker,
    );
    return { sent, send: (m: unknown) => handler(m as ClientMessage) };
  }
  const until = async (fn: () => boolean) => {
    for (let i = 0; i < 2000 && !fn(); i++) await new Promise((r) => setTimeout(r, 5));
  };

  test("PROTOCOL_VERSION is 2", () => {
    expect(PROTOCOL_VERSION).toBe(2);
  });

  test("a protocol 1 client gets E_PROTOCOL at init", async () => {
    const h = attach(createBakerCore({ loadBundle: loadBundleNode }));
    h.send({ type: "init", reqId: 1, protocol: 1, init: {} });
    expect(h.sent[0]).toMatchObject({ type: "init-error", error: { code: "E_PROTOCOL" } });
  });

  test("a bake message with inputs reaches input:tab; the inputs travel as buffers", async () => {
    const h = attach(createBakerCore({ loadBundle: loadBundleNode }));
    h.send({ type: "init", reqId: 1, protocol: 2, init: {} });
    await until(() => h.sent.some((m) => m.type === "ready"));
    h.send({
      type: "bake",
      id: 1,
      recipe: rec(tab("a")),
      input: new ArrayBuffer(0),
      inputs: [{ name: "a", data: utf8("hello").slice().buffer }],
      options: { trust: "trusted" },
    });
    await until(() => h.sent.some((m) => m.type === "result"));
    const result = h.sent.find((m) => m.type === "result");
    expect(result?.type === "result" && text(result.result)).toBe("hello");
  });

  test("a malformed inputs entry is a malformed message", () => {
    const h = attach(createBakerCore({ loadBundle: loadBundleNode }));
    h.send({
      type: "bake",
      id: 1,
      recipe: rec(),
      input: new ArrayBuffer(0),
      inputs: [{ name: "a", data: "no" }],
      options: {},
    });
    expect(h.sent[0]).toMatchObject({ type: "fatal" });
  });
});

describe("CR266 StepReport.implicit", () => {
  const conversions = [
    { from: "table", to: "relation", op: "relix:from" },
    { from: "relation", to: "table", op: "relix:run", atEnd: true as const },
  ];
  const line = (path: string, implicit?: { line: number; op: string }[]) =>
    ({
      path,
      kind: "op",
      startLine: 1,
      endLine: 2,
      disabled: false,
      breakpoint: false,
      implicit,
    }) as never;

  test("an inserted line is reported with the kinds the catalogue says it converts", () => {
    const found = implicitOf([line("/steps/1"), line("/steps/2", [{ line: 2, op: "relix:run" }])], {
      conversions,
    } as never);
    expect([...found]).toEqual([
      ["/steps/2", [{ op: "relix:run", from: "relation", to: "table" }]],
    ]);
  });

  test("a catalogue with no conversions reports none", () => {
    expect(implicitOf([line("/steps/2", [{ line: 2, op: "relix:run" }])], {} as never).size).toBe(
      0,
    );
  });
});
