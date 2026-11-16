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
 * `magic:magic` (PLAN.md WP 6.33): the report of the layered inputs of 6.29, the run's deadline stopping the
 * search, cancelling the bake cancelling it, the charging of steps and bytes to the run, a deterministic report.
 */
import checksJson from "@forge/ops/checks.json";
import type { ChecksDoc } from "@forge/ops";
import { loadBundleNode } from "@forge/ops/node";
import { gzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { catalogue } from "../../test/helpers.js";
import { createBakerClient } from "../client.js";
import { createBakerCore } from "../core.js";
import { createNodeWorkerHost } from "../host-node.js";
import { createInProcessBaker } from "../inprocess.js";
import type { BakeOptions, BakeResult, Baker, BakerClient } from "../types.js";
import { createRunMagicHost } from "./host.js";
import type { MagicRun } from "./host.js";
import type { AbortSignalLike } from "@forge/lang";

const checks = (checksJson as unknown as ChecksDoc).ops;
const enc = (s: string) => new TextEncoder().encode(s);
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

const PLAIN = "Hello, World! This is a secret message for the magic engine.";
/** The layered input of 6.29: hex of gzip of Base64 of the text. */
const LAYERED = enc(hex(gzipSync(enc(b64(enc(PLAIN))), { mtime: 0 })));
const RECIPE = { forge: 1, steps: [{ kind: "op", op: "magic:magic" }] };

/** What the report for LAYERED is (the five best candidates; the right one is the third, as in 6.29; gzip with its time fixed at 0). */
const LAYERED_REPORT = [
  "recipe: oid:from-hex",
  "score: 0.57",
  "reasons: valid UTF-8 text, 100% printable; looks like ASCII text; takes apart the hex data; entropy 3.7 to 3.3 bits per byte",
  "output: 0.31.1416.0.0.0.0.0.0.3.11.118.15.43.78.114.7080.15220.75.41.75.21033532172.118.",
  "",
  "recipe: asn1-dump:parse",
  "score: 0.55",
  "reasons: valid UTF-8 text, 100% printable; looks like ASCII text, LF line endings; takes apart the hex data",
  "output: [UNIVERSAL 1416]\\n",
  "",
  "recipe: hex:decode deflate:gunzip base64:decode",
  "score: 0.55",
  "reasons: valid UTF-8 text, 100% printable; looks like ASCII text; takes apart the base64 data",
  `output: ${PLAIN}`,
  "",
  "recipe: hex:decode deflate:gunzip",
  "score: 0.45",
  "reasons: valid UTF-8 text, 100% printable; takes apart the gzip data",
  "output: SGVsbG8sIFdvcmxkISBUaGlzIGlzIGEgc2VjcmV0IG1lc3NhZ2UgZm9yIHRoZSBtYWdpYyBlbmdpbmUu",
  "",
  "recipe: hex:decode",
  "score: 0.35",
  expect.stringMatching(/^reasons: takes apart the hex data; detected as gzip data$/),
  expect.stringMatching(/^output: \\x1f/),
];

function text(r: BakeResult): string {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  if (r.output.kind !== "str") throw new Error(`not a str: ${r.output.kind}`);
  return r.output.text;
}

const clients: BakerClient[] = [];
function client(): BakerClient {
  const c = createBakerClient({ host: () => createNodeWorkerHost() });
  clients.push(c);
  return c;
}
afterAll(async () => {
  for (const c of clients.splice(0)) await c.dispose();
});

const baker = createInProcessBaker({ loadBundle: loadBundleNode });
beforeAll(async () => {
  await baker.init();
}, 60_000);

describe("the report", () => {
  test("the layered input of 6.29 gives the expected report, in a bake on a worker", async () => {
    const c = client();
    await c.init();
    const r = await c.bake(RECIPE, LAYERED);
    const lines = text(r).split("\n");
    expect(lines).toHaveLength(LAYERED_REPORT.length);
    lines.forEach((line, i) => {
      const want = LAYERED_REPORT[i];
      if (typeof want === "string") expect(line).toBe(want);
      else expect(line).toEqual(want);
    });
    // A block is four lines, the recipe is FL text, and the first 80 characters of the output.
    expect(text(r).split("\n\n")).toHaveLength(5);
    // The nested steps are charged to the run: they are in its step count.
    expect(r.stats.vmSteps).toBeGreaterThan(100_000);
  }, 60_000);

  test("the report is deterministic: the same on a worker, in process, and when repeated", async () => {
    const c = client();
    await c.init();
    const a = text(await c.bake(RECIPE, LAYERED));
    const b = text(await c.bake(RECIPE, LAYERED));
    const inProcess = text(await baker.bake(RECIPE, LAYERED, { trust: "trusted" }));
    expect(b).toBe(a);
    expect(inProcess).toBe(a);
  }, 60_000);

  test("data that needs nothing has no candidate", async () => {
    const r = await baker.bake(RECIPE, enc("Hello, World!"), { trust: "trusted" });
    expect(text(r)).toBe("no candidate");
  }, 60_000);

  test("the parameters: depth, intensive (a no-op) and the crib", async () => {
    const c = client();
    await c.init();
    const rot13 = enc(b64(enc("Uryyb, Jbeyq! Guvf vf n frperg zrffntr sbe gur zntvp ratvar.")));
    const withCrib = await c.bake(
      { forge: 1, steps: [{ kind: "op", op: "magic:magic", params: { crib: "Hello, World" } }] },
      rot13,
    );
    expect(text(withCrib).split("\n")[0]).toBe("recipe: base64:decode classical:rot");
    const shallow = await c.bake(
      { forge: 1, steps: [{ kind: "op", op: "magic:magic", params: { depth: 1 } }] },
      LAYERED,
    );
    expect(text(shallow)).not.toContain("recipe: hex:decode deflate:gunzip base64:decode");
    const intense = await c.bake(
      { forge: 1, steps: [{ kind: "op", op: "magic:magic", params: { intensive: true } }] },
      LAYERED,
    );
    expect(text(intense)).toBe(text(await c.bake(RECIPE, LAYERED)));
  }, 120_000);

  test("it needs a hard kill: an untrusted in-process bake is refused", async () => {
    const op = catalogue.ops.find((o) => o.qname === "magic:magic");
    expect(op?.needsHardKill).toBe(true);
    const r = await baker.bake(RECIPE, LAYERED, { trust: "untrusted" });
    expect(!r.ok && r.error.code).toBe("E_UNSAFE_HOST");
  });

  test("a nested search does not disturb the next bake, and a new init rebuilds it", async () => {
    const core = createBakerCore({ loadBundle: loadBundleNode });
    await core.init({ vocabs: ["magic", "base64", "hex"] });
    expect(
      text(await core.bake(RECIPE, enc("SGVsbG8sIFdvcmxkIQ=="), { trust: "trusted" })),
    ).toContain("recipe: base64:decode");
    await core.init({ vocabs: ["magic", "base64", "hex"] });
    expect(text(await core.bake(RECIPE, enc("48656c6c6f"), { trust: "trusted" }))).toContain(
      "recipe: hex:decode",
    );
    await core.dispose();
  }, 60_000);
});

/** A baker that delays every bake and records them, so that time and cancellation are testable. */
function slowBaker(inner: Baker, ms: number): Baker & { calls: number; cancels: number } {
  const self = {
    calls: 0,
    cancels: 0,
    hardKill: inner.hardKill,
    init: (i?: Parameters<Baker["init"]>[0]) => inner.init(i),
    async bake(recipe: unknown, input: Uint8Array, o?: BakeOptions): Promise<BakeResult> {
      self.calls++;
      await new Promise((r) => setTimeout(r, ms));
      return inner.bake(recipe, input, o);
    },
    step: () => inner.step(),
    continue: () => inner.continue(),
    async cancel() {
      self.cancels++;
      await inner.cancel();
    },
    dispose: () => inner.dispose(),
  };
  return self;
}

function hostFor(nested: Baker, run: Partial<MagicRun> & { signal: AbortSignalLike }) {
  const full: MagicRun = {
    limits: { maxSteps: 10_000_000, maxTotalBytes: 1 << 30, maxMillis: 30_000 },
    startedAt: performance.now(),
    steps: () => 0,
    ...run,
  };
  return createRunMagicHost(
    { baker: () => Promise.resolve(nested), environment: () => ({ catalogue, checks }) },
    full,
  );
}
const request = { data: LAYERED, depth: 3, intensive: false, crib: "" };

describe("the run's limits", () => {
  test("the run's deadline stops the search: it returns near the deadline and runs nothing after", async () => {
    const slow = slowBaker(baker, 40);
    const ctl = new AbortController();
    const { host } = hostFor(slow, {
      signal: ctl.signal,
      // 450 ms in all, less the reserve kept back for the report: the search has about 250 ms.
      limits: { maxSteps: 10_000_000, maxTotalBytes: 1 << 30, maxMillis: 450 },
    });
    const t = performance.now();
    const report = await host.search(request);
    const took = performance.now() - t;
    expect(took).toBeLessThan(450);
    expect(report.candidates).toBeDefined();
    const calls = slow.calls;
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThan(15);
    await new Promise((r) => setTimeout(r, 200));
    expect(slow.calls).toBe(calls);
  });

  test("a run with no time left gets an empty search at once", async () => {
    const slow = slowBaker(baker, 40);
    const { host } = hostFor(slow, {
      signal: new AbortController().signal,
      limits: { maxSteps: 10_000_000, maxTotalBytes: 1 << 30, maxMillis: 100 },
      startedAt: performance.now() - 10_000,
    });
    const report = await host.search(request);
    expect(report.candidates).toEqual([]);
    expect(slow.calls).toBeLessThanOrEqual(1);
  });

  test("cancelling the run cancels the search and the run in progress", async () => {
    const slow = slowBaker(baker, 40);
    const ctl = new AbortController();
    const { host } = hostFor(slow, { signal: ctl.signal });
    setTimeout(() => ctl.abort(), 120);
    const t = performance.now();
    await expect(host.search(request)).rejects.toMatchObject({ code: "E_ABORTED" });
    expect(performance.now() - t).toBeLessThan(1000);
    expect(slow.cancels).toBeGreaterThan(0);
    const calls = slow.calls;
    await new Promise((r) => setTimeout(r, 200));
    expect(slow.calls).toBe(calls);
    // Aborted before it starts: nothing runs.
    const before = new AbortController();
    before.abort();
    const fresh = slowBaker(baker, 1);
    await expect(
      hostFor(fresh, { signal: before.signal }).host.search(request),
    ).rejects.toMatchObject({
      code: "E_ABORTED",
    });
    expect(fresh.calls).toBe(0);
  });

  test("steps are charged to the run: the search fails with E_LIMIT_STEPS when they are used up", async () => {
    const slow = slowBaker(baker, 0);
    const { host, charge } = hostFor(slow, {
      signal: new AbortController().signal,
      limits: { maxSteps: 3000, maxTotalBytes: 1 << 30, maxMillis: 30_000 },
      steps: () => 1000,
    });
    await expect(host.search(request)).rejects.toMatchObject({ code: "E_LIMIT_STEPS" });
    // What the run had used counts: the search had 2000 steps, and was charged at least that much.
    expect(charge.steps).toBeGreaterThanOrEqual(1);
    expect(charge.steps).toBeLessThan(40_000);
    // A search that starts with the steps already used up does not run at all.
    const none = slowBaker(baker, 0);
    await expect(
      hostFor(none, {
        signal: new AbortController().signal,
        limits: { maxSteps: 500, maxTotalBytes: 1 << 30, maxMillis: 30_000 },
        steps: () => 500,
      }).host.search(request),
    ).rejects.toMatchObject({ code: "E_LIMIT_STEPS" });
    expect(none.calls).toBe(0);
  });

  test("bytes are charged to the run: the search fails with E_LIMIT_TOTAL when they are used up", async () => {
    const slow = slowBaker(baker, 0);
    const { host, charge } = hostFor(slow, {
      signal: new AbortController().signal,
      limits: { maxSteps: 10_000_000, maxTotalBytes: 400, maxMillis: 30_000 },
    });
    await expect(host.search(request)).rejects.toMatchObject({ code: "E_LIMIT_TOTAL" });
    expect(charge.bytes).toBeGreaterThanOrEqual(400);
    expect(slow.calls).toBeLessThan(10);
  });

  test("a bake that has too few steps fails with E_LIMIT_STEPS, and one with room succeeds", async () => {
    const small = await baker.bake(RECIPE, LAYERED, {
      trust: "trusted",
      limits: { maxSteps: 50_000 },
    });
    expect(!small.ok && small.error.code).toBe("E_LIMIT_STEPS");
    const room = await baker.bake(RECIPE, LAYERED, {
      trust: "trusted",
      limits: { maxSteps: 5_000_000 },
    });
    expect(room.ok).toBe(true);
    // The search is in the step count of the result.
    expect(room.stats.vmSteps).toBeGreaterThan(100_000);
  }, 60_000);

  test("the deadline of a bake on a worker ends it with E_LIMIT_TIME, in time", async () => {
    const c = client();
    await c.init();
    // Warm the nested baker, so the time goes to the search.
    text(await c.bake(RECIPE, enc("x")));
    const t = performance.now();
    const r = await c.bake(
      {
        forge: 1,
        steps: [{ kind: "op", op: "magic:magic", params: { crib: "NEVER-IN-ANY-OUTPUT" } }],
      },
      LAYERED,
      { limits: { maxMillis: 500 } },
    );
    expect(performance.now() - t).toBeLessThan(4000);
    // Either the search reported what it had, or the run's own deadline fired first.
    if (!r.ok) expect(r.error.code).toBe("E_LIMIT_TIME");
    // The worker is usable afterwards.
    expect(text(await c.bake(RECIPE, enc("Hello, World!")))).toBe("no candidate");
  }, 60_000);

  test("cancelling the bake on a worker cancels the search", async () => {
    const c = client();
    await c.init();
    text(await c.bake(RECIPE, enc("x")));
    const crib = {
      forge: 1,
      steps: [{ kind: "op", op: "magic:magic", params: { crib: "NEVER-IN-ANY-OUTPUT" } }],
    };
    const pending = c.bake(crib, LAYERED);
    setTimeout(() => void c.cancel(), 300);
    const t = performance.now();
    const r = await pending;
    expect(!r.ok && r.error.code).toBe("E_ABORTED");
    expect(performance.now() - t).toBeLessThan(3000);
    expect(text(await c.bake(RECIPE, enc("Hello, World!")))).toBe("no candidate");
  }, 60_000);
});
