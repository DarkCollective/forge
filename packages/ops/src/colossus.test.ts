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

// colossus is FL (vocab/colossus.fth). Its tables are checked against a direct count over the tape
// in vocab/colossus.test.json (values from an independent simulator). These tests build messages
// with known chi settings through lorenz and check that the true setting comes out on top, and
// cover the size of the work and the parameters.
const { str, int, bool } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["lorenz", "colossus", "raise"]));

const CHI = [41, 31, 29, 26, 23];

interface Opts {
  a?: number;
  b?: number;
  condition?: string;
  target?: string;
  pattern?: string;
  custom?: string[];
  known?: number[];
  top?: number;
  total?: number;
}

function count(cipher: string, o: Opts = {}) {
  return runtime.call("colossus:count", [
    str(cipher),
    int(o.a ?? 1),
    int(o.b ?? 2),
    str(o.condition ?? ""),
    str(o.target ?? "dot"),
    str(o.pattern ?? "KH"),
    ...[0, 1, 2, 3, 4].map((i) => str(o.custom?.[i] ?? "")),
    ...[0, 1, 2, 3, 4].map((i) => int(o.known?.[i] ?? 0)),
    int(o.top ?? 10),
    int(o.total ?? 0),
  ]);
}

function lorenzEncrypt(plain: string, start: number[], pattern = "KH", model = "SZ42a") {
  const wheels = [
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
  ];
  return runtime.call("lorenz:encrypt", [
    str(plain),
    str(model),
    bool(false),
    str(pattern),
    str("text"),
    str("ita2"),
    str("double"),
    ...wheels.map(() => str("")),
    ...start.map((s) => int(s)),
  ]);
}

function text(r: { ok: boolean; stack: readonly Value[] }): string {
  expect(r.ok).toBe(true);
  return (r.stack[r.stack.length - 1] as { v: string }).v;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Military-sounding text with the repeats of real traffic: spaces, figures, doubled shifts. */
function message(next: () => number, length: number): string {
  const words = [
    "ANGRIFF",
    "BEI",
    "DER",
    "ARMEE",
    "NORD",
    "OSTEN",
    "VERBAENDE",
    "STELLUNG",
    "FEIND",
    "KOMMANDO",
    "UND",
    "MIT",
    "DIE",
    "WEITERGABE",
    "VERBOTEN",
  ];
  let out = "";
  while (out.length < length) {
    out += words[Math.floor(next() * words.length)];
    out += next() < 0.4 ? `  ${1 + Math.floor(next() * 90)}  ` : "  ";
  }
  return out.slice(0, length);
}

/** The data rows of the table: [rank, wheel a start, wheel b start, count]. */
function rows(table: string): number[][] {
  return table
    .split("\n")
    .slice(2)
    .filter((l) => /^\s*\d/.test(l))
    .map((l) => l.trim().split(/\s+/).map(Number));
}

describe("colossus", () => {
  test("the true chi1 and chi2 settings come out on top for several messages", async () => {
    const next = rng(4);
    for (let trial = 0; trial < 4; trial++) {
      const start = [
        1 + Math.floor(next() * 41),
        1 + Math.floor(next() * 31),
        1 + Math.floor(next() * 29),
        1 + Math.floor(next() * 26),
        1 + Math.floor(next() * 23),
        1 + Math.floor(next() * 43),
        1 + Math.floor(next() * 47),
        1 + Math.floor(next() * 51),
        1 + Math.floor(next() * 53),
        1 + Math.floor(next() * 59),
        1 + Math.floor(next() * 37),
        1 + Math.floor(next() * 61),
      ];
      const cipher = text(await lorenzEncrypt(message(next, 4000), start));
      const table = text(await count(cipher, { top: 3 }));
      const [first] = rows(table);
      expect(first?.slice(1, 3), table).toEqual([start[0], start[1]]);
    }
  }, 60_000);

  test("another pair of wheels, and the other target, give the right place too", async () => {
    const next = rng(6);
    const start = [7, 20, 5, 11, 3, 1, 1, 1, 1, 1, 1, 1];
    const cipher = text(await lorenzEncrypt(message(next, 5000), start, "BREAM"));
    // the 1+2 run finds chi1 and chi2; the counts of the dot and the cross targets add up
    const dot = rows(text(await count(cipher, { pattern: "BREAM", top: 100 })));
    const cross = rows(text(await count(cipher, { pattern: "BREAM", target: "cross", top: 100 })));
    expect(dot[0]?.slice(1, 3)).toEqual([7, 20]);
    expect(cross.length).toBeGreaterThan(0);
    const dotSettings = new Map(dot.map((r) => [`${r[1]},${r[2]}`, r[3] as number]));
    for (const r of cross) {
      const d = dotSettings.get(`${r[1]},${r[2]}`);
      if (d !== undefined) expect(d + (r[3] as number)).toBe(4999);
    }
  }, 60_000);

  test("a message of a few thousand characters runs inside the default limits", async () => {
    const next = rng(9);
    const cipher = text(
      await lorenzEncrypt(message(next, 8000), [3, 4, 5, 6, 7, 1, 2, 3, 4, 5, 6, 7]),
    );
    const r = await count(cipher);
    expect(r.ok).toBe(true);
    expect(r.steps).toBeLessThan(10_000_000);
  }, 60_000);

  test("top limits the rows and the set total cuts them off", async () => {
    const next = rng(10);
    const cipher = text(
      await lorenzEncrypt(message(next, 1500), [1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2]),
    );
    expect(rows(text(await count(cipher, { top: 7 }))).length).toBe(7);
    const all = rows(text(await count(cipher, { top: 100 })));
    expect(all.length).toBe(100);
    for (let i = 1; i < all.length; i++) {
      expect((all[i - 1] as number[])[3]).toBeGreaterThanOrEqual((all[i] as number[])[3] as number);
    }
    const cut = (all[9] as number[])[3] as number;
    const some = rows(text(await count(cipher, { top: 100, total: cut })));
    expect(some.length).toBeGreaterThanOrEqual(10);
    expect(Math.min(...some.map((r) => r[3] as number))).toBeGreaterThanOrEqual(cut);
    const none = text(await count(cipher, { total: 1500 }));
    expect(none).toContain("no setting reached the set total of 1500");
  }, 60_000);

  test("the wheels in either order, and the sums of a known wheel", async () => {
    const next = rng(11);
    const cipher = text(
      await lorenzEncrypt(message(next, 600), [4, 3, 2, 1, 5, 1, 2, 3, 4, 5, 1, 2]),
    );
    const ab = text(await count(cipher, { a: 2, b: 1, top: 1 }));
    expect(ab).toContain("chi2 x chi1");
    const known = text(
      await count(cipher, { a: 3, b: 4, condition: "dz1+dx1+dz3+dx3+dz4+dx4", known: [4], top: 2 }),
    );
    expect(known).toContain("dz1+dx1+dz3+dx3+dz4+dx4 = dot");
  });

  test("bad conditions and wheels are refused", async () => {
    for (const o of [
      { b: 1 },
      { condition: "dz1+z" },
      { condition: "dz1+dd1" },
      { condition: "dz1+" },
      { condition: "dz3+dx3" },
      { pattern: "custom" },
    ]) {
      const r = await count("ABCD", o);
      expect(r.ok, JSON.stringify(o)).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("E_RANGE");
    }
    const q = await count("ABCD", { condition: "q1" });
    expect(q.ok).toBe(false);
    if (!q.ok) expect(q.error.code).toBe("E_PARAM_INVALID");
    const empty = await count("");
    expect(empty.ok).toBe(false);
    const bad = await count("AB1");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("E_COERCE");
  });

  test("custom chi patterns can be used for the search", async () => {
    const chi = CHI.map((n) => "x.".repeat(n).slice(0, n));
    const r = await count("ABCDEFGHIJ", { pattern: "custom", custom: chi, top: 1 });
    expect(r.ok).toBe(true);
  });

  test("the word carries doc, category and a help text for every parameter", () => {
    const meta = runtime.meta("colossus:count");
    expect(meta.category).toBe("Cipher machines");
    expect(meta.doc).toBeTruthy();
    expect(meta.params.map((p) => p.doc).every((d) => d && d.length > 0)).toBe(true);
  });
});
