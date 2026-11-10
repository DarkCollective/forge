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
import { valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

// lorenz is FL (vocab/lorenz.fth). The published examples (the General Report, Tony Sale's Virtual
// Colossus) and the values of an independent simulator are in vocab/lorenz.test.json; these tests
// cover round trips, reciprocity, the autoclave, parameter validation and the size of the work.
const { str, int, bool } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["lorenz", "raise"]));

const WHEELS = [
  "chi1",
  "chi2",
  "chi3",
  "chi4",
  "chi5",
  "psi1",
  "psi2",
  "psi3",
  "psi4",
  "psi5",
  "mu37",
  "mu61",
] as const;
const LENGTHS = [41, 31, 29, 26, 23, 43, 47, 51, 53, 59, 37, 61];

interface Opts {
  model?: string;
  p5?: boolean;
  pattern?: string;
  input?: string;
  output?: string;
  shifts?: string;
  custom?: Record<string, string>;
  start?: number[];
}

function args(data: string, o: Opts, dflt: { input: string; output: string }): Value[] {
  const custom = o.custom ?? {};
  return [
    str(data),
    str(o.model ?? "SZ42a"),
    bool(o.p5 ?? false),
    str(o.pattern ?? "KH"),
    str(o.input ?? dflt.input),
    str(o.output ?? dflt.output),
    str(o.shifts ?? "auto"),
    ...WHEELS.map((w) => str(custom[w] ?? "")),
    ...LENGTHS.map((_, i) => int(o.start?.[i] ?? 1)),
  ];
}
const enc = (data: string, o: Opts = {}) =>
  runtime.call("lorenz:encrypt", args(data, o, { input: "text", output: "ita2" }));
const dec = (data: string, o: Opts = {}) =>
  runtime.call("lorenz:decrypt", args(data, o, { input: "ita2", output: "text" }));
const BP = { input: "ita2", output: "ita2" };

function top(r: { stack: readonly Value[] }): { v: unknown } {
  return r.stack[r.stack.length - 1] as { v: unknown };
}
function text(r: { ok: boolean; stack: readonly Value[] }): string {
  expect(r.ok).toBe(true);
  return top(r).v as string;
}
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const ALPHABET = "/E4A9SIU3DRJNFCKTZLWHYPQOBG5MXV8";
function randomBp(next: () => number, n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(next() * 32)];
  return s;
}
function randomStarts(next: () => number): number[] {
  return LENGTHS.map((n) => 1 + Math.floor(next() * n));
}
function randomPattern(next: () => number, n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += next() < 0.5 ? "x" : ".";
  return s;
}

describe("lorenz", () => {
  test("the alphabet has 32 different characters and the sets have twelve patterns", async () => {
    expect(new Set(ALPHABET).size).toBe(32);
    expect(text(await runtime.call("lorenz:ita2-alphabet", []))).toBe(ALPHABET);
    for (const set of ["kh-patterns", "zmug-patterns", "bream-patterns"]) {
      const r = await runtime.call(`lorenz:${set}`, []);
      const wheels = (top(r).v as { v: string }[]).map((x) => x.v);
      expect(wheels.map((w) => w.length)).toEqual(LENGTHS);
      for (const w of wheels) expect(w).toMatch(/^[x.]+$/);
    }
    const lengths = await runtime.call("lorenz:wheel-lengths", []);
    expect((top(lengths).v as { v: number }[]).map((x) => Number(x.v))).toEqual(LENGTHS);
  });

  test("the published sets are balanced as the General Report says (about half crosses)", async () => {
    const r = await runtime.call("lorenz:kh-patterns", []);
    const wheels = (top(r).v as { v: string }[]).map((x) => x.v);
    for (const w of wheels.slice(0, 10)) {
      const crosses = [...w].filter((c) => c === "x").length;
      expect(Math.abs(crosses / w.length - 0.5)).toBeLessThan(0.15);
    }
  });

  test("without P5 the machine is reciprocal: enciphering twice gives the input", async () => {
    const next = rng(3);
    for (const model of ["SZ40", "SZ42a", "SZ42b"]) {
      for (const pattern of ["KH", "ZMUG", "BREAM"]) {
        const data = randomBp(next, 1 + Math.floor(next() * 300));
        const o = { model, pattern, start: randomStarts(next), ...BP };
        const once = text(await enc(data, o));
        expect(once).not.toBe(data);
        expect(text(await enc(once, o))).toBe(data);
        expect(text(await dec(once, o))).toBe(data);
      }
    }
  });

  test("custom wheels: decrypt undoes encrypt for every model, with and without P5", async () => {
    const next = rng(5);
    for (const [model, p5] of [
      ["SZ40", false],
      ["SZ42a", false],
      ["SZ42b", false],
      ["SZ42a", true],
      ["SZ42b", true],
    ] as const) {
      const custom: Record<string, string> = {};
      WHEELS.forEach((w, i) => {
        custom[w] = randomPattern(next, LENGTHS[i] as number);
      });
      const o = { model, p5, pattern: "custom", custom, start: randomStarts(next), ...BP };
      const data = randomBp(next, 500);
      const once = text(await enc(data, o));
      expect(text(await dec(once, o))).toBe(data);
    }
  });

  test("with P5 the key depends on the plain text, so enciphering twice does not undo it", async () => {
    const next = rng(8);
    const data = randomBp(next, 400);
    const o = { model: "SZ42a", p5: true, start: randomStarts(next), ...BP };
    const once = text(await enc(data, o));
    expect(text(await enc(once, o))).not.toBe(data);
    expect(text(await dec(once, o))).toBe(data);
    // and without the flag the same input gives another cipher text
    expect(text(await enc(data, { ...o, p5: false }))).not.toBe(once);
  });

  test("text round trips through the ITA2 shifts, in both shift styles", async () => {
    const message =
      "Attack at dawn on 12 May, at 06:30 (Berlin time)! Reply: yes/no? Cost 3.50 + tax = 4'0";
    for (const shifts of ["auto", "double"]) {
      for (const model of ["SZ40", "SZ42b"]) {
        const o = { model, shifts, start: [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8] };
        const cipher = text(await enc(message, o));
        expect(cipher).toMatch(/^[/E4A9SIU3DRJNFCKTZLWHYPQOBG5MXV8]+$/);
        expect(text(await dec(cipher, o))).toBe(message.toUpperCase());
      }
    }
  });

  test("a different start position of any single wheel changes the cipher text", async () => {
    const next = rng(2);
    const data = randomBp(next, 200);
    const base = randomStarts(next);
    const ref = text(await enc(data, { start: base, ...BP }));
    for (let i = 0; i < 12; i++) {
      const start = base.slice();
      start[i] = ((start[i] as number) % (LENGTHS[i] as number)) + 1;
      expect(text(await enc(data, { start, ...BP }))).not.toBe(ref);
    }
  });

  test("the empty message and one character", async () => {
    expect(text(await enc(""))).toBe("");
    expect(text(await dec("", { model: "SZ42b", p5: true }))).toBe("");
    expect(text(await enc("/", { ...BP, pattern: "BREAM" })).length).toBe(1);
  });

  test("a pattern of the wrong length or with other characters is refused", async () => {
    const bad = await enc("A", { custom: { chi1: "x.x." } });
    expect(bad.ok).toBe(false);
    const alien = await enc("A", { custom: { chi2: "a".repeat(31) } });
    expect(alien.ok).toBe(false);
    if (!alien.ok) expect(alien.error.code).toBe("E_PARAM_INVALID");
  });

  test("a start position out of range, an unknown model and P5 on an SZ40 are refused", async () => {
    const start = LENGTHS.map(() => 1);
    start[0] = 42;
    expect((await enc("A", { start })).ok).toBe(false);
    expect((await enc("A", { model: "SZ41" })).ok).toBe(false);
    const r = await enc("A", { model: "SZ40", p5: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_RANGE");
  });

  test("custom needs all twelve patterns, and one custom wheel replaces only that wheel", async () => {
    const r = await enc("A", { pattern: "custom", custom: { chi1: "x".repeat(41) } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_RANGE");
    const plain = text(await enc("HELLO", { ...BP, input: "ita2" }));
    const swapped = text(
      await enc("HELLO", { input: "ita2", output: "ita2", custom: { mu37: "x".repeat(37) } }),
    );
    expect(swapped.length).toBe(plain.length);
  });

  test("characters that have no ITA2 code and bad ITA2 text are E_COERCE", async () => {
    for (const bad of ["€", "aé", "~", "\t"]) {
      const r = await enc(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("E_COERCE");
    }
    for (const bad of ["AB1", "AB%", "café"]) {
      const r = await dec(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("E_COERCE");
    }
  });

  test("64 KiB of ITA2 in and out, every model, inside the default limits", async () => {
    const next = rng(31);
    const data = randomBp(next, 65536);
    for (const [model, p5] of [
      ["SZ40", false],
      ["SZ42b", true],
    ] as const) {
      const o = { model, p5, ...BP };
      const cipher = await enc(data, o);
      expect(cipher.ok).toBe(true);
      const back = await dec(top(cipher).v as string, o);
      expect(back.ok).toBe(true);
      expect(top(back).v).toBe(data);
    }
  }, 60_000);

  test("64 KiB of text goes in and comes out as text", async () => {
    const next = rng(32);
    const words = ["ANGRIFF", "BEI", "12", "MORGEN", "NORD,", "OSTEN", "FUEHRER", "KOMMANDO"];
    let message = "";
    while (message.length < 65536) message += `${words[Math.floor(next() * words.length)]} `;
    message = message.slice(0, 65536);
    const o = { model: "SZ42a", start: randomStarts(next) };
    const cipher = await enc(message, o);
    expect(cipher.ok).toBe(true);
    const back = await dec(top(cipher).v as string, o);
    expect(back.ok).toBe(true);
    expect(top(back).v).toBe(message);
  }, 60_000);

  test("the words carry doc, category and a help text for every parameter", () => {
    for (const name of ["lorenz:encrypt", "lorenz:decrypt"]) {
      const meta = runtime.meta(name);
      expect(meta.category).toBe("Cipher machines");
      expect(meta.doc).toBeTruthy();
      expect(meta.params.length).toBe(30);
      expect(meta.params.map((p) => p.doc).every((d) => d && d.length > 0)).toBe(true);
    }
  });
});
