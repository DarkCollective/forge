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
 * The Magic engine (PLAN.md WP 6.29): layered inputs find the expected recipe at its depth, dull inputs end with no
 * candidate, every limit holds, a hostile operation is killed by the watchdog, the search is deterministic.
 */
import checksJson from "@forge/ops/checks.json";
import type { ChecksDoc } from "@forge/ops";
import { loadBundleNode } from "@forge/ops/node";
import { gzipSync, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { catalogue } from "../../test/helpers.js";
import { createBakerClient } from "../client.js";
import { createNodeWorkerHost } from "../host-node.js";
import { createInProcessBaker } from "../inprocess.js";
import type { BakeOptions, BakeResult, Baker, BakerClient } from "../types.js";
import { magic } from "./search.js";
import type { MagicCandidate, MagicOp, MagicResult } from "./types.js";

const checks = (checksJson as unknown as ChecksDoc).ops;
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const MAGIC_FX = new URL("../../test/fixtures/magic-fx.mjs", import.meta.url).href;

const PLAIN = "Hello, World! This is a secret message for the magic engine.";
const ROT13 = "Uryyb, Jbeyq! Guvf vf n frperg zrffntr sbe gur zntvp ratvar.";
/** DER of SEQUENCE { INTEGER 1, UTF8String "Hello" }. */
const DER = Uint8Array.from([0x30, 0x0a, 0x02, 0x01, 0x01, 0x0c, 0x05, 72, 101, 108, 108, 111]);
/** Base64 of gzip of... no: hex of gzip of Base64 of the text. */
const LAYERED = enc(hex(gzipSync(enc(b64(enc(PLAIN))))));

const baker = createInProcessBaker({ loadBundle: loadBundleNode });
beforeAll(async () => {
  await baker.init();
});

const names = (r: MagicResult): string[] => r.candidates.map((c) => c.ops.join(">"));
const find = (r: MagicResult, ...ops: string[]): MagicCandidate | undefined =>
  r.candidates.find((c) => c.ops.join(">") === ops.join(">"));

/** A baker that delays every bake (and records them), to make time-based limits testable. */
function slowBaker(inner: Baker, ms: () => number): Baker & { calls: string[]; cancels: number } {
  const calls: string[] = [];
  const self = {
    calls,
    cancels: 0,
    hardKill: inner.hardKill,
    init: (i?: Parameters<Baker["init"]>[0]) => inner.init(i),
    async bake(recipe: unknown, input: Uint8Array, o?: BakeOptions): Promise<BakeResult> {
      calls.push(JSON.stringify(recipe));
      await new Promise((r) => setTimeout(r, ms()));
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

const clients: BakerClient[] = [];
function hardKillClient(extra: object = {}, modules: string[] = []): BakerClient {
  const c = createBakerClient({
    host: () => createNodeWorkerHost({ extraPrimitiveModules: modules }),
    ...extra,
  });
  clients.push(c);
  return c;
}
afterAll(async () => {
  for (const c of clients.splice(0)) await c.dispose();
});

describe("layered inputs", () => {
  test("Base64 then gzip then hex is found at depth 3, as a recipe that bakes back", async () => {
    const r = await magic(LAYERED, { baker, catalogue, checks, results: 10 });
    const c = find(r, "hex:decode", "deflate:gunzip", "base64:decode");
    expect(c).toBeDefined();
    expect(c?.depth).toBe(3);
    expect(c?.recipe).toEqual({
      forge: 1,
      steps: [
        { kind: "op", op: "hex:decode" },
        { kind: "op", op: "deflate:gunzip" },
        { kind: "op", op: "base64:decode" },
      ],
    });
    expect(dec(c?.output ?? new Uint8Array())).toBe(PLAIN);
    expect(c?.outputLength).toBe(PLAIN.length);
    expect(c?.reasons.length).toBeGreaterThan(0);
    // The first step alone is a candidate too, detected as gzip.
    expect(find(r, "hex:decode")?.reasons.join(";")).toContain("gzip");
    // The recipe really does what it says.
    const baked = await baker.bake(c?.recipe, LAYERED, { trust: "trusted" });
    expect(baked.ok && baked.output.kind === "bytes" && dec(baked.output.bytes)).toBe(PLAIN);
  });

  test("ROT13 inside Base64 is found with a crib, on a worker with a hard kill", async () => {
    const client = hardKillClient();
    await client.init();
    const input = enc(b64(enc(ROT13)));
    const r = await magic(input, { baker: client, catalogue, checks, crib: "Hello, World" });
    expect(names(r)[0]).toBe("base64:decode>classical:rot");
    expect(r.candidates[0]?.depth).toBe(2);
    expect(r.candidates[0]?.reasons).toContain("matches the crib");
    expect(dec(r.candidates[0]?.output ?? new Uint8Array())).toBe(PLAIN);
    // Without the crib nothing can tell ROT13 from any other text: only the Base64 step is found.
    const without = await magic(input, { baker: client, catalogue, checks });
    expect(names(without)).toEqual(["base64:decode"]);
  }, 60_000);

  test("a ZIP behind hex or Base64 is found by its signature at depth 1", async () => {
    const zip = zipSync({ "a.txt": enc(PLAIN) });
    const viaHex = await magic(enc(hex(zip)), { baker, catalogue, checks, results: 10 });
    expect(find(viaHex, "hex:decode")?.reasons.join(";")).toContain("ZIP");
    const viaB64 = await magic(enc(b64(zip)), { baker, catalogue, checks });
    expect(names(viaB64)).toEqual(["base64:decode"]);
    expect(viaB64.candidates[0]?.reasons.join(";")).toContain("ZIP");
  });

  test("a PEM block is taken apart by pem:to-hex, and its body dumped as ASN.1", async () => {
    const body = b64(DER).replace(/(.{8})/g, "$1\n");
    const pem = enc(`-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`);
    const r = await magic(pem, { baker, catalogue, checks, results: 10 });
    expect(find(r, "pem:to-hex", "asn1-dump:parse")).toBeDefined();
    expect(find(r, "pem:to-hex")).toBeDefined();
  });
});

describe("dull inputs", () => {
  test("random bytes and ordinary prose end with no candidate, quickly", async () => {
    let seed = 12345;
    const noise = Uint8Array.from({ length: 2048 }, () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed >>> 24;
    });
    const prose = enc(
      "The quick brown fox jumps over the lazy dog, and then it sleeps in the sun all afternoon.",
    );
    for (const input of [noise, prose]) {
      const t = performance.now();
      const r = await magic(input, { baker, catalogue, checks, deadlineMs: 5000 });
      expect(r.candidates).toEqual([]);
      expect(r.stopped).toBe("done");
      expect(performance.now() - t).toBeLessThan(5000);
    }
  });

  test("empty input has nothing to search", async () => {
    const r = await magic(new Uint8Array(), { baker, catalogue, checks });
    expect(r.candidates).toEqual([]);
    expect(r.stats.tried).toBe(0);
  });

  test("a dull input with a crib that never matches ends within the deadline with no candidate", async () => {
    const client = hardKillClient();
    await client.init();
    const t = performance.now();
    const r = await magic(enc("nothing to see here, just a plain sentence."), {
      baker: client,
      catalogue,
      checks,
      crib: "ZZZZ-never",
      depth: 2,
      deadlineMs: 4000,
    });
    expect(r.candidates).toEqual([]);
    expect(performance.now() - t).toBeLessThan(7000);
  }, 60_000);
});

describe("limits", () => {
  /** hex and Base64 layers, alternating: eight levels deep. */
  function deep(): Uint8Array {
    let s = PLAIN;
    for (let i = 0; i < 8; i++) s = i % 2 === 0 ? b64(enc(s)) : hex(enc(s));
    return enc(s);
  }

  test("depth: default 3, maximum 6, and a given depth is a ceiling", async () => {
    const maxDepth = async (depth?: number): Promise<number> => {
      const r = await magic(deep(), {
        baker,
        catalogue,
        checks,
        results: 50,
        branching: 64,
        maxTried: 5000,
        ...(depth === undefined ? {} : { depth }),
      });
      return Math.max(0, ...r.candidates.map((c) => c.depth));
    };
    expect(await maxDepth()).toBe(3);
    expect(await maxDepth(1)).toBe(1);
    expect(await maxDepth(5)).toBe(5);
    expect(await maxDepth(99)).toBe(6);
  });

  test("branching: one child per level, the rest counted as pruned", async () => {
    const wide = await magic(LAYERED, { baker, catalogue, checks, results: 50 });
    const narrow = await magic(LAYERED, { baker, catalogue, checks, results: 50, branching: 1 });
    expect(wide.stats.prunedBreadth).toBe(0);
    expect(narrow.stats.prunedBreadth).toBeGreaterThan(0);
    expect(narrow.candidates.length).toBeLessThanOrEqual(3);
    expect(narrow.candidates.length).toBeLessThan(wide.candidates.length);
  });

  test("total tried: the search stops at the cap", async () => {
    const r = await magic(LAYERED, { baker, catalogue, checks, maxTried: 4 });
    expect(r.stats.tried).toBe(4);
    expect(r.stopped).toBe("max-tried");
    const big = await magic(LAYERED, { baker, catalogue, checks, maxTried: 1e9 });
    expect(big.stats.tried).toBeLessThanOrEqual(10_000);
  });

  test("deadline: the search stops when it passes, with what it has", async () => {
    const slow = slowBaker(baker, () => 25);
    const t = performance.now();
    const r = await magic(LAYERED, { baker: slow, catalogue, checks, deadlineMs: 150 });
    expect(r.stopped).toBe("deadline");
    expect(performance.now() - t).toBeLessThan(1500);
    expect(slow.calls.length).toBeLessThan(20);
  });

  test("abort: the signal cancels the search and the run in progress", async () => {
    const slow = slowBaker(baker, () => 25);
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 80);
    const r = await magic(LAYERED, { baker: slow, catalogue, checks, signal: ctl.signal });
    expect(r.stopped).toBe("aborted");
    expect(slow.cancels).toBeGreaterThan(0);
    const before = new AbortController();
    before.abort();
    const none = await magic(LAYERED, { baker: slow, catalogue, checks, signal: before.signal });
    expect(none.stopped).toBe("aborted");
    expect(none.stats.tried).toBe(0);
  });

  test("results: a given number is a ceiling", async () => {
    const r = await magic(LAYERED, { baker, catalogue, checks, results: 1 });
    expect(r.candidates).toHaveLength(1);
  });

  test("a crib needs a hard-kill baker, and has a length limit", async () => {
    await expect(magic(enc("x"), { baker, catalogue, checks, crib: "x" })).rejects.toThrow(
      /hardKill/,
    );
    const client = hardKillClient();
    await expect(
      magic(enc("x"), { baker: client, catalogue, checks, crib: "x".repeat(1025) }),
    ).rejects.toThrow(/too long/);
  });

  test("an uninitialised baker is an error, not an empty answer", async () => {
    const fresh = createInProcessBaker({ loadBundle: loadBundleNode });
    await expect(magic(LAYERED, { baker: fresh, catalogue, checks })).rejects.toThrow(
      /not initialised/,
    );
  });
});

describe("which operations are tried", () => {
  const op = (qname: string, extra: Partial<MagicOp> = {}): MagicOp => ({
    qname,
    input: "bytes",
    output: "bytes",
    params: [],
    effects: [],
    needsHardKill: false,
    ...extra,
  });
  const evidence = {
    expects: null,
    checks: [
      { scope: "input" as const, test: { kind: "charset" as const, alphabet: "a-z", min: 1 } },
    ],
  };

  test("no required parameter, no effect, bytes or str in and out, no hard kill without one", async () => {
    const ops = [
      op("t:fine"),
      op("t:str", { input: "str", output: "str" }),
      op("t:needs-param", { params: [{ required: true }] }),
      op("t:default-param", { params: [{ required: false }] }),
      op("t:random", { effects: ["+random"] }),
      op("t:time", { effects: ["+time"] }),
      op("t:list-out", { output: "list" }),
      op("t:int-in", { input: "int" }),
      op("t:regexy", { needsHardKill: true }),
      op("t:excluded"),
    ];
    const doc = Object.fromEntries(ops.map((o) => [o.qname, evidence]));
    const stub = slowBaker(baker, () => 0);
    await magic(enc("abcdefgh"), {
      baker: stub,
      catalogue: { ops },
      checks: doc,
      exclude: ["t:excluded"],
    });
    const tried = stub.calls.map(
      (c) => (JSON.parse(c) as { steps: { op: string }[] }).steps[0]?.op,
    );
    expect(new Set(tried)).toEqual(new Set(["t:fine", "t:str", "t:default-param"]));
  });

  test("an operation without evidence (a compressor, an encoder) is not tried without a crib", async () => {
    const stub = slowBaker(baker, () => 0);
    const r = await magic(enc(PLAIN), { baker: stub, catalogue, checks: {} });
    expect(stub.calls).toEqual([]);
    expect(r.candidates).toEqual([]);
  });
});

describe("determinism", () => {
  test("the same input gives the same candidates in the same order, whatever the timing", async () => {
    const key = (r: MagicResult): string =>
      JSON.stringify(r.candidates.map((c) => [c.ops, c.score, c.reasons, hex(c.output)]));
    const a = await magic(LAYERED, { baker, catalogue, checks, results: 20 });
    const jitter = slowBaker(baker, () => Math.floor(Math.random() * 4));
    const b = await magic(LAYERED, { baker: jitter, catalogue, checks, results: 20 });
    const c = await magic(LAYERED, { baker, catalogue, checks, results: 20 });
    expect(a.candidates.length).toBeGreaterThan(1);
    expect(key(b)).toBe(key(a));
    expect(key(c)).toBe(key(a));
    expect({ ...a.stats, elapsedMs: 0 }).toEqual({ ...c.stats, elapsedMs: 0 });
  });

  test("candidates are ordered by score, then fewer steps", async () => {
    const r = await magic(LAYERED, { baker, catalogue, checks, results: 50 });
    for (let i = 1; i < r.candidates.length; i++) {
      const p = r.candidates[i - 1] as MagicCandidate;
      const q = r.candidates[i] as MagicCandidate;
      expect(p.score).toBeGreaterThanOrEqual(q.score);
      if (p.score === q.score) expect(p.depth).toBeLessThanOrEqual(q.depth);
    }
  });
});

describe("a hostile or slow operation (real worker threads)", () => {
  const fxOp = (qname: string): MagicOp => ({
    qname,
    input: "bytes",
    output: "bytes",
    params: [],
    effects: [],
    needsHardKill: false,
  });
  const evidence = {
    expects: null,
    checks: [
      {
        scope: "input" as const,
        test: { kind: "charset" as const, alphabet: "A-Za-z0-9 ,!.", min: 0.5 },
      },
    ],
  };

  test("is killed by the watchdog, quarantined, and the search goes on", async () => {
    const client = hardKillClient({ deadlineGraceMs: 100, cancelGraceMs: 100 }, [MAGIC_FX]);
    await client.init();
    const t = performance.now();
    const r = await magic(LAYERED, {
      baker: client,
      catalogue: { ops: [...catalogue.ops, fxOp("mfx:spin"), fxOp("mfx:slow")] },
      checks: { ...checks, "mfx:spin": evidence, "mfx:slow": evidence },
      limits: { maxMillis: 100 },
      deadlineMs: 30_000,
      results: 10,
    });
    expect(r.quarantined).toContain("mfx:spin");
    expect(r.stats.failed).toBeGreaterThan(0);
    expect(r.stopped).toBe("done");
    expect(performance.now() - t).toBeLessThan(30_000);
    // The honest chain is still found, on the worker the watchdog restarted.
    expect(find(r, "hex:decode", "deflate:gunzip", "base64:decode")).toBeDefined();
  }, 60_000);

  test("cannot hold the search past its deadline", async () => {
    const client = hardKillClient({ deadlineGraceMs: 100, cancelGraceMs: 100 }, [MAGIC_FX]);
    await client.init();
    const t = performance.now();
    const r = await magic(enc("Hello, World! Hello again."), {
      baker: client,
      catalogue: { ops: [fxOp("mfx:spin")] },
      checks: { "mfx:spin": evidence },
      limits: { maxMillis: 5000 },
      deadlineMs: 600,
    });
    // A run's time limit is the smaller of its own and what is left until the deadline, so the watchdog fires near it.
    expect(performance.now() - t).toBeLessThan(4000);
    expect(r.candidates).toEqual([]);
    expect(r.quarantined).toEqual(["mfx:spin"]);
  }, 60_000);

  test("a run over the size limit is a failure of that run, not of the search", async () => {
    const r = await magic(LAYERED, { baker, catalogue, checks, limits: { maxValueBytes: 8 } });
    expect(r.candidates).toEqual([]);
    expect(r.stats.failed).toBeGreaterThan(0);
  });
});
