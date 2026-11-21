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
 * RECIPES-1.1.md (WP 6.38): the baker with `register` and `return` steps, cases CR131 to CR138, the
 * registers of a `paused` event (also across the Worker protocol), `detail.register`, the hard-kill
 * recursion and the Magic engine (section 4.11).
 */
import checksJson from "@forge/ops/checks.json";
import type { ChecksDoc } from "@forge/ops";
import { loadBundleNode } from "@forge/ops/node";
import { afterAll, describe, expect, test } from "vitest";
import { catalogue } from "../test/helpers.js";
import { createBakerClient } from "./client.js";
import { createBakerCore } from "./core.js";
import { createNodeWorkerHost } from "./host-node.js";
import { magic } from "./magic/search.js";
import type { Baker, BakeEvent, BakeOptions, BakeResult, BakerClient } from "./types.js";

const clone = <V>(v: V): V => JSON.parse(JSON.stringify(v)) as V;
const T = { trust: "trusted" } as const;
const utf8 = (s: string) => new TextEncoder().encode(s);
const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

async function make(hardKill = false): Promise<Baker> {
  const baker = createBakerCore({ loadBundle: loadBundleNode, hardKill });
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
const reg = (name: string, steps: unknown[], extra: object = {}) => ({
  kind: "register",
  name,
  steps,
  ...extra,
});
const ref = (name: string) => ({ ref: name });
const ret = (extra: object = {}) => ({ kind: "return", ...extra });

function out(r: BakeResult) {
  if (!r.ok) throw new Error(`expected success, got ${r.error.code}: ${r.error.message}`);
  return r.output;
}
function fail(r: BakeResult) {
  if (r.ok) throw new Error("expected a failure");
  return r.error;
}
const bytesOf = (r: BakeResult): string => {
  const o = out(r);
  if (o.kind !== "bytes") throw new Error(`expected bytes, got ${o.kind}`);
  return hex(o.bytes);
};

// The recipes of RECIPES-1.1.md section 6.
const M = rec(
  reg("iv", [op("bytes-slice:take", { start: 0, length: 16 })]),
  reg("key", [op("bytes-slice:take", { start: 16, length: 32 })]),
  op("bytes-slice:remove", { start: 0, length: 48 }),
  op("aes:decrypt", { key: ref("key"), iv: ref("iv"), mode: "CBC" }),
);
const BLOB = hexBytes(
  "a0a1a2a3a4a5a6a7a8a9aaabacadaeaf000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f6f498b8b870a0d8175f26312b99705c8",
);
const CR128 = rec(
  reg("n", [op("search:count", { pattern: "a" })]),
  op("classical:rot", { amount: ref("n") }),
);
const CR123 = rec({
  kind: "fork",
  split: { value: "\n", enc: "utf8" },
  join: { value: "0a", enc: "hex" },
  steps: [
    reg("pat", [op("bytes-slice:take", { start: 0, length: 2 })]),
    op("bytes-slice:remove", { start: 0, length: 3 }),
    op("regex:replace", { pattern: ref("pat"), replacement: "-" }),
  ],
});
const encode = op("hex:encode", { delimiter: "none", case: "upper" });
const CR120 = rec(
  op("hex:decode"),
  {
    kind: "if",
    test: { kind: "regex", pattern: "^a" },
    then: [encode, ret()],
  },
  op("text:reverse"),
);
const CR121 = rec(
  op("hex:decode"),
  {
    kind: "if",
    test: { kind: "regex", pattern: "^a" },
    then: [
      { kind: "if", test: { kind: "regex", pattern: "b$" }, then: [encode, ret()] },
      op("text:upper"),
    ],
  },
  { kind: "if", test: { kind: "regex", pattern: "z" }, then: [op("text:lower")] },
  op("hex:encode"),
);

describe("registers and return, end to end through the baker", () => {
  test("CR131 recipe M decrypts the blob", async () => {
    const baker = await make();
    const r = await baker.bake(M, BLOB);
    expect(bytesOf(r)).toBe(hex(utf8("attack at dawn")));
    // The register steps ran once each and are reported with their children.
    expect(r.steps.map((s) => [s.path, s.runs])).toEqual([
      ["/steps/0", 1],
      ["/steps/0/steps/0", 1],
      ["/steps/1", 1],
      ["/steps/1/steps/0", 1],
      ["/steps/2", 1],
      ["/steps/3", 1],
    ]);
  });

  test("CR132 a register supplies an int parameter", async () => {
    const baker = await make(true);
    expect(bytesOf(await baker.bake(CR128, utf8("banana")))).toBe("656471647164");
  });

  test("CR134 a register per fork piece, as a regex parameter", async () => {
    const baker = await make(true);
    const r = await baker.bake(CR123, utf8("ab:xxabxx\ncd:yycdyy"));
    expect(bytesOf(r)).toBe("78782d78780a79792d7979");
    // Each piece runs the register once.
    expect(r.steps.find((s) => s.path === "/steps/0/steps/0")?.runs).toBe(2);
  });

  test("CR135 return taken, not taken, and from a nested if", async () => {
    const baker = await make(true);
    const str = async (recipe: unknown, input: string) => {
      const o = out(await baker.bake(recipe, utf8(input)));
      return o.kind === "str" ? o.text : o.kind;
    };
    expect(await str(CR120, "6162")).toBe("6162");
    expect(await str(CR120, "6362")).toBe("bc");
    expect(await str(CR121, "6162")).toBe("6162");
    expect(await str(CR121, "6161")).toBe("4141");
    expect(await str(CR121, "6263")).toBe("6263");
  });

  test("CR136 a return at the root skips what follows and keeps the tag of the data", async () => {
    const baker = await make();
    const r = await baker.bake(rec(op("hex:decode"), ret(), op("text:upper")), utf8("6162"));
    const o = out(r);
    expect(o).toMatchObject({ kind: "bytes", text: "ab" });
    expect(hex((o as { bytes: Uint8Array }).bytes)).toBe("6162");
    expect(r.warnings).toMatchObject([
      { code: "unreachable-step", path: "/steps/2", detail: { after: "/steps/1" } },
    ]);
    // The step after the return never started: no report.
    expect(r.steps.map((s) => s.path)).toEqual(["/steps/0", "/steps/1"]);
  });

  test("a disabled return is a comment: the rest of the recipe runs", async () => {
    const baker = await make();
    const o = out(
      await baker.bake(
        rec(op("hex:decode"), ret({ disabled: true }), op("text:upper")),
        utf8("6162"),
      ),
    );
    expect(o).toMatchObject({ kind: "str", text: "AB" });
  });

  test("a register may hold any tag (a list); only the data flows on", async () => {
    const baker = await make();
    const r = await baker.bake(
      rec(reg("parts", [op("text:split", { separator: "," })]), op("text:upper")),
      utf8("a,b"),
    );
    expect(out(r)).toMatchObject({ kind: "str", text: "A,B" });
  });
});

describe("CR133 deferred validation names the register", () => {
  test("E_PARAM_INVALID: a register out of the range of an int parameter", async () => {
    const baker = await make(true);
    const e = fail(await baker.bake(CR128, utf8("a".repeat(26))));
    expect(e).toMatchObject({
      code: "E_PARAM_INVALID",
      path: "/steps/1",
      word: "classical:rot",
      detail: { param: "amount", constraint: "[0..25]", register: "n" },
    });
    expect(e.detail["value"]).toBe("26");
  });

  test("E_TYPE: a bytes register for an int parameter", async () => {
    const baker = await make();
    const recipe = rec(
      reg("n", [op("bytes-slice:take", { start: 0, length: 1 })]),
      op("classical:rot", { amount: ref("n") }),
    );
    const e = fail(await baker.bake(recipe, utf8("banana")));
    expect(e).toMatchObject({
      code: "E_TYPE",
      path: "/steps/1",
      word: "classical:rot",
      detail: { param: "amount", expected: "int", actual: "bytes", register: "n" },
    });
  });

  test("E_PARAM_INVALID: a register that is not a regex", async () => {
    const baker = await make(true);
    const recipe = rec(
      reg("p", [op("bytes-slice:take", { start: 0, length: 1 })]),
      op("bytes-slice:remove", { start: 0, length: 2 }),
      op("regex:replace", { pattern: ref("p"), replacement: "-" }),
    );
    const e = fail(await baker.bake(recipe, utf8("(:xxabxx")));
    expect(e).toMatchObject({
      code: "E_PARAM_INVALID",
      path: "/steps/2",
      word: "regex:replace",
      detail: { param: "pattern", constraint: "regex", register: "p" },
    });
  });

  test("E_COERCE: a register that is not UTF-8 for a str parameter", async () => {
    const baker = await make(true);
    const recipe = rec(
      reg("p", [op("hex:decode")]),
      op("regex:replace", { pattern: ref("p"), replacement: "-" }),
    );
    const e = fail(await baker.bake(recipe, utf8("ff")));
    expect(e.code).toBe("E_COERCE");
    expect(e).toMatchObject({ path: "/steps/1", detail: { register: "p" } });
  });

  test("a secret register: the key slot shows no value, only the register name", async () => {
    const baker = await make();
    // A 3-byte key is not a valid AES key: the value of the register must not reach the error.
    const recipe = rec(
      reg("k", [op("bytes-slice:take", { start: 0, length: 3 })]),
      reg("v", [op("bytes-slice:take", { start: 3, length: 16 })]),
      op("bytes-slice:remove", { start: 0, length: 19 }),
      op("aes:decrypt", { key: ref("k"), iv: ref("v"), mode: "CBC" }),
    );
    const r = await baker.bake(recipe, utf8("KEY0123456789abcdefXXXXXXXXXXXXXXXX"));
    const e = fail(r);
    expect(e.path).toBe("/steps/3");
    // E_RANGE comes from a helper word and carries lengths only, no `param`: the baker adds `register` only
    // when `detail.param` names a parameter that the step supplies by reference (section 2.5).
    expect(e.code).toBe("E_RANGE");
    expect(e.detail).toEqual({ length: 3 });
    expect(JSON.stringify(e)).not.toContain("KEY");
    expect(JSON.stringify(e)).not.toContain("4b4559");
  });

  test("the register is named at the step that takes it, not at an earlier literal step", async () => {
    const baker = await make(true);
    const recipe = rec(
      reg("n", [op("search:count", { pattern: "a" })]),
      op("classical:rot", { amount: 3 }),
      op("classical:rot", { amount: ref("n") }),
    );
    const r = await baker.bake(recipe, utf8("a".repeat(30)));
    const e = fail(r);
    // The failure is at the reference (n is 30), not at the literal step.
    expect(e.path).toBe("/steps/2");
    expect(e.detail["register"]).toBe("n");
  });

  test("a very large register value does not reach the error detail unclipped (Q20)", async () => {
    const baker = await make(true);
    const big = "(".repeat(200_000);
    const recipe = rec(
      reg("p", [op("bytes-slice:take", { start: 0, length: 200_000 })]),
      op("regex:replace", { pattern: ref("p"), replacement: "-" }),
    );
    const e = fail(await baker.bake(recipe, utf8(big), T));
    expect(e.detail["register"]).toBe("p");
    expect(JSON.stringify(e.detail).length).toBeLessThan(10_000);
  });
});

describe("CR137 registers at a pause", () => {
  test("recipe M: both registers are secret and shown redacted", async () => {
    const baker = await make();
    const recipe = rec(M.steps[0], M.steps[1], M.steps[2], {
      ...(M.steps[3] as object),
      breakpoint: true,
    });
    const paused: Extract<BakeEvent, { type: "paused" }>[] = [];
    const r = await baker.bake(recipe, BLOB, {
      debug: {},
      onEvent: (e) => {
        if (e.type === "paused") {
          paused.push(e);
          void baker.continue();
        }
      },
    });
    expect(r.ok).toBe(true);
    expect(paused).toHaveLength(1);
    expect(paused[0]).toMatchObject({ path: "/steps/3", reason: "breakpoint" });
    expect(paused[0]?.registers).toEqual([
      { name: "iv", path: "/steps/0", value: { kind: "other", tag: "bytes", repr: "<redacted>" } },
      { name: "key", path: "/steps/1", value: { kind: "other", tag: "bytes", repr: "<redacted>" } },
    ]);
    // No key or iv byte appears anywhere in the event.
    const text = JSON.stringify(paused[0]?.registers);
    expect(text).not.toContain("160");
  });

  test("a register that feeds a regex parameter is shown, once per piece", async () => {
    const baker = await make(true);
    const recipe = clone(CR123) as { steps: { steps: Record<string, unknown>[] }[] };
    (recipe.steps[0] as { steps: Record<string, unknown>[] }).steps[1]!["breakpoint"] = true;
    const paused: Extract<BakeEvent, { type: "paused" }>[] = [];
    const r = await baker.bake(recipe, utf8("ab:xxabxx\ncd:yycdyy"), {
      ...T,
      debug: {},
      onEvent: (e) => {
        if (e.type === "paused") {
          paused.push(e);
          void baker.continue();
        }
      },
    });
    expect(r.ok).toBe(true);
    expect(paused.map((p) => [p.path, p.reason])).toEqual([
      ["/steps/0/steps/1", "breakpoint"],
      ["/steps/0/steps/1", "breakpoint"],
    ]);
    expect(paused.map((p) => p.registers)).toEqual([
      [
        {
          name: "pat",
          path: "/steps/0/steps/0",
          value: { kind: "bytes", bytes: utf8("ab"), text: "ab" },
        },
      ],
      [
        {
          name: "pat",
          path: "/steps/0/steps/0",
          value: { kind: "bytes", bytes: utf8("cd"), text: "cd" },
        },
      ],
    ]);
  });

  test("stepping: the registers appear when they are bound, and not before", async () => {
    const baker = await make(true);
    const log: [string, string[]][] = [];
    const r = await baker.bake(CR128, utf8("banana"), {
      ...T,
      debug: { startPaused: true },
      onEvent: (e) => {
        if (e.type === "paused") {
          log.push([e.path, (e.registers ?? []).map((x) => x.name)]);
          void baker.step();
        }
      },
    });
    expect(r.ok).toBe(true);
    // Inside the register and at its own start nothing is bound yet; the next step sees `n`.
    expect(log).toEqual([
      ["/steps/0", []],
      ["/steps/0/steps/0", []],
      ["/steps/1", ["n"]],
    ]);
    const intValue = (await (async () => {
      const seen: BakeEvent[] = [];
      await baker.bake(CR128, utf8("banana"), {
        ...T,
        debug: { startPaused: true },
        onEvent: (e) => {
          seen.push(e);
          if (e.type === "paused") void baker.step();
        },
      });
      const last = seen.filter((e) => e.type === "paused").at(-1);
      return last?.type === "paused" ? last.registers?.[0]?.value : undefined;
    })()) as unknown;
    expect(intValue).toEqual({ kind: "int", text: "3" });
  });

  test("a recipe without registers sends the v1 shape of `paused`", async () => {
    const baker = await make();
    const seen: BakeEvent[] = [];
    await baker.bake(rec(op("hex:decode", undefined, { breakpoint: true })), utf8("6162"), {
      debug: {},
      onEvent: (e) => {
        seen.push(e);
        if (e.type === "paused") void baker.continue();
      },
    });
    const p = seen.find((e) => e.type === "paused");
    expect(p).toBeDefined();
    expect(p).not.toHaveProperty("registers");
  });
});

describe("registers cross the Worker protocol", () => {
  const clients: BakerClient[] = [];
  afterAll(async () => {
    for (const c of clients.splice(0)) await c.dispose();
  });

  test("a client receives `registers` in `paused`", async () => {
    const client = createBakerClient({ host: () => createNodeWorkerHost() });
    clients.push(client);
    await client.init();
    const paused: Extract<BakeEvent, { type: "paused" }>[] = [];
    const recipe = clone(CR123) as { steps: { steps: Record<string, unknown>[] }[] };
    (recipe.steps[0] as { steps: Record<string, unknown>[] }).steps[1]!["breakpoint"] = true;
    const r = await client.bake(recipe, utf8("ab:xxabxx\ncd:yycdyy"), {
      debug: {},
      onEvent: (e) => {
        if (e.type === "paused") {
          paused.push(e);
          void client.continue();
        }
      },
    });
    expect(r.ok).toBe(true);
    expect(paused.map((p) => p.registers?.map((x) => x.name))).toEqual([["pat"], ["pat"]]);
  });
});

describe("CR138 steps open at a return, progress", () => {
  test("the steps that started have a report, the others none, and progress ends complete", async () => {
    const baker = await make(true);
    const events: BakeEvent[] = [];
    const r = await baker.bake(CR120, utf8("6162"), { onEvent: (e) => events.push(e) });
    expect(out(r)).toMatchObject({ kind: "str", text: "6162" });
    expect(r.steps.map((s) => [s.path, s.runs])).toEqual([
      ["/steps/0", 1],
      ["/steps/1", 1],
      ["/steps/1/then/0", 1],
      ["/steps/1/then/1", 1],
    ]);
    // The `if` and the `return` were open when `exit` ended the run: they are closed at the end time.
    for (const s of r.steps) expect(s.ms).toBeGreaterThanOrEqual(0);
    const progress = events.filter((e) => e.type === "progress");
    expect(progress.at(-1)).toMatchObject({ done: 3, total: 3, path: "/steps/1/then/1" });
  });

  test("a recipe that fails after a return-less run still reports the failure position", async () => {
    const baker = await make();
    const events: BakeEvent[] = [];
    const r = await baker.bake(
      rec(op("hex:decode"), op("hex:decode"), op("text:upper")),
      utf8("zz"),
      { onEvent: (e) => events.push(e) },
    );
    expect(r.ok).toBe(false);
    const last = events.filter((e) => e.type === "progress").at(-1);
    expect(last).toMatchObject({ done: 0, total: 3 });
  });

  test("a return inside a lowered if: breakpoints and stepping reach the return and end the bake", async () => {
    const baker = await make(true);
    const log: string[] = [];
    const recipe = rec(
      op("hex:decode"),
      {
        kind: "if",
        test: { kind: "regex", pattern: "^a" },
        then: [encode, ret({ breakpoint: true })],
      },
      op("text:reverse"),
    );
    const r = await baker.bake(recipe, utf8("6162"), {
      debug: {},
      onEvent: (e) => {
        if (e.type === "paused") {
          log.push(`${e.path}:${e.data.kind === "str" ? e.data.text : e.data.kind}`);
          void baker.step();
        }
      },
    });
    expect(out(r)).toMatchObject({ kind: "str", text: "6162" });
    expect(log).toEqual(["/steps/1/then/1:6162"]);
  });
});

describe("hard-kill recursion (section 4.6)", () => {
  const regexInRegister = rec(
    reg("r", [op("regex:replace", { pattern: "a", replacement: "b" })]),
    op("text:upper"),
  );

  test("a regex op inside a register needs a hard-kill baker for an untrusted bake", async () => {
    const plain = await make();
    const e = fail(await plain.bake(regexInRegister, utf8("a")));
    expect(e.code).toBe("E_UNSAFE_HOST");
    expect(e.detail).toEqual({ reason: "regex" });
    expect((await plain.bake(regexInRegister, utf8("a"), T)).ok).toBe(true);
    const killable = await make(true);
    expect((await killable.bake(regexInRegister, utf8("a"))).ok).toBe(true);
  });

  test("a reference to a regex parameter needs one too, and a disabled register does not", async () => {
    const plain = await make();
    const viaRef = rec(
      reg("p", [op("bytes-slice:take", { start: 0, length: 1 })]),
      op("regex:replace", { pattern: ref("p"), replacement: "-" }),
    );
    expect(fail(await plain.bake(viaRef, utf8("a"))).code).toBe("E_UNSAFE_HOST");
    const disabled = rec(
      reg("r", [op("regex:replace", { pattern: "a", replacement: "b" })], { disabled: true }),
      op("text:upper"),
    );
    expect((await plain.bake(disabled, utf8("a"))).ok).toBe(true);
  });

  test("a return needs nothing", async () => {
    const plain = await make();
    expect((await plain.bake(rec(op("hex:decode"), ret()), utf8("6162"))).ok).toBe(true);
  });
});

describe("Magic never generates register or return steps (section 4.11)", () => {
  test("every recipe the engine bakes or returns is made of op steps only", async () => {
    const inner = await make(true);
    const seen: unknown[] = [];
    const spy: Baker = {
      hardKill: inner.hardKill,
      init: (i) => inner.init(i),
      bake: (recipe: unknown, input: Uint8Array, o?: BakeOptions) => {
        seen.push(recipe);
        return inner.bake(recipe, input, o);
      },
      step: () => inner.step(),
      continue: () => inner.continue(),
      cancel: () => inner.cancel(),
      dispose: () => inner.dispose(),
    };
    const checks = (checksJson as unknown as ChecksDoc).ops;
    const input = utf8(btoa("Hello, World! This is a secret message."));
    const result = await magic(input, { baker: spy, catalogue, checks, results: 10 });
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(seen.length).toBeGreaterThan(0);
    const kinds = (recipe: unknown): string[] =>
      ((recipe as { steps: { kind: string }[] }).steps ?? []).map((s) => s.kind);
    for (const recipe of seen) for (const k of kinds(recipe)) expect(k).toBe("op");
    for (const c of result.candidates) {
      for (const k of kinds(c.recipe)) expect(k).toBe("op");
      for (const step of c.recipe.steps) expect(JSON.stringify(step)).not.toContain('"ref"');
    }
  });
});
