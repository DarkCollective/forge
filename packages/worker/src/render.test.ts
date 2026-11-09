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
import { bool, bytes, int, list, markSecret, num, record, str } from "@forge/lang";
import type { Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { outputToJson, renderValue, stripTimings } from "./render.js";
import { RENDER_LIMITS } from "./types.js";
import type { BakeResult, OutputValue } from "./types.js";

describe("renderValue", () => {
  test("bytes: a private copy and the strict UTF-8 view", () => {
    const source = new Uint8Array([104, 105]);
    const out = renderValue(bytes(source));
    expect(out).toEqual({ kind: "bytes", bytes: new Uint8Array([104, 105]), text: "hi" });
    if (out.kind !== "bytes") throw new Error("kind");
    expect(out.bytes).not.toBe(source);
    expect(out.bytes.buffer).not.toBe(source.buffer);
    expect(out.bytes.buffer.byteLength).toBe(2);
    expect(renderValue(bytes(new Uint8Array([0xff]))).kind).toBe("bytes");
    expect(renderValue(bytes(new Uint8Array([0xff])))).toMatchObject({ text: null });
    expect(renderValue(bytes(new Uint8Array()))).toMatchObject({ text: "" });
  });

  test("bytes larger than the text limit have no text", () => {
    const big = new Uint8Array(RENDER_LIMITS.maxTextBytes + 1);
    expect(renderValue(bytes(big))).toMatchObject({ kind: "bytes", text: null });
  });

  test("scalars", () => {
    expect(renderValue(str("é"))).toEqual({ kind: "str", text: "é" });
    expect(renderValue(int(42))).toEqual({ kind: "int", text: "42" });
    expect(renderValue(int(2n ** 70n))).toEqual({ kind: "int", text: (2n ** 70n).toString() });
    expect(renderValue(num(1.5))).toEqual({ kind: "num", value: 1.5 });
    expect(renderValue(bool(false))).toEqual({ kind: "bool", value: false });
  });

  test("lists and records, in insertion order", () => {
    expect(renderValue(list([int(1), str("a")]))).toEqual({
      kind: "list",
      items: [
        { kind: "int", text: "1" },
        { kind: "str", text: "a" },
      ],
      total: 2,
    });
    const rec = renderValue(
      record([
        ["b", int(1)],
        ["a", list([])],
      ]),
    );
    expect(rec).toEqual({
      kind: "record",
      entries: [
        { key: "b", value: { kind: "int", text: "1" } },
        { key: "a", value: { kind: "list", items: [], total: 0 } },
      ],
      total: 2,
    });
  });

  test("long lists and records are truncated at maxItems", () => {
    const items = Array.from({ length: RENDER_LIMITS.maxItems + 5 }, (_, i) => int(i));
    const out = renderValue(list(items));
    expect(out).toMatchObject({ kind: "list", total: RENDER_LIMITS.maxItems + 5 });
    expect(out.kind === "list" && out.items.length).toBe(RENDER_LIMITS.maxItems);
    const rec = renderValue(record(items.map((v, i) => [`k${i}`, v] as const)));
    expect(rec.kind === "record" && rec.entries.length).toBe(RENDER_LIMITS.maxItems);
    expect(rec).toMatchObject({ total: RENDER_LIMITS.maxItems + 5 });
  });

  test("secrets, quotations and files render as other", () => {
    const secret = markSecret(bytes(new Uint8Array([1, 2, 3])));
    expect(renderValue(secret)).toEqual({ kind: "other", tag: "bytes", repr: "<redacted>" });
    const quot = { tag: "quot", v: { code: [], effect: null } } as unknown as Value;
    const out = renderValue(quot);
    expect(out).toMatchObject({ kind: "other", tag: "quot" });
    expect(out.kind === "other" && out.repr.length).toBeLessThanOrEqual(RENDER_LIMITS.maxReprChars);
    expect(renderValue(list([secret]))).toMatchObject({
      items: [{ kind: "other", repr: "<redacted>" }],
    });
  });

  test("containers nested deeper than maxDepth render as other", () => {
    let v: Value = list([]);
    for (let i = 0; i < RENDER_LIMITS.maxDepth + 2; i++) v = list([v]);
    let depth = 0;
    let out: OutputValue = renderValue(v);
    while (out.kind === "list" && out.items[0] !== undefined) {
      out = out.items[0];
      depth++;
    }
    expect(out.kind).toBe("other");
    expect(depth).toBe(RENDER_LIMITS.maxDepth);
    let r: Value = record([]);
    for (let i = 0; i < RENDER_LIMITS.maxDepth + 1; i++) r = record([["k", r]]);
    expect(JSON.stringify(outputToJson(renderValue(r)))).toContain("$other");
  });

  test("a huge fan-out is bounded by the node budget", () => {
    const row = list(Array.from({ length: 1000 }, (_, i) => int(i)));
    const grid = list(Array.from({ length: 1000 }, () => row));
    const out = renderValue(grid);
    let others = 0;
    const walk = (o: OutputValue): void => {
      if (o.kind === "other") others++;
      else if (o.kind === "list") o.items.forEach(walk);
    };
    walk(out);
    expect(others).toBeGreaterThan(0);
  });
});

describe("outputToJson", () => {
  test("each kind", () => {
    expect(outputToJson({ kind: "str", text: "x" })).toBe("x");
    expect(outputToJson({ kind: "bool", value: true })).toBe(true);
    expect(outputToJson({ kind: "num", value: 2.5 })).toBe(2.5);
    expect(outputToJson({ kind: "num", value: -0 })).toEqual({ $num: "-0" });
    expect(outputToJson({ kind: "num", value: 0 })).toBe(0);
    expect(outputToJson({ kind: "int", text: "-7" })).toBe(-7);
    expect(outputToJson({ kind: "int", text: "9007199254740993" })).toEqual({
      $int: "9007199254740993",
    });
    expect(
      outputToJson({ kind: "bytes", bytes: new Uint8Array([0, 255, 16]), text: null }),
    ).toEqual({
      $bytes: "00ff10",
    });
    expect(outputToJson({ kind: "other", tag: "quot", repr: "[ ]" })).toEqual({ $other: "[ ]" });
  });

  test("lists and records, with and without truncation", () => {
    const item: OutputValue = { kind: "int", text: "1" };
    expect(outputToJson({ kind: "list", items: [item], total: 1 })).toEqual([1]);
    expect(outputToJson({ kind: "list", items: [item], total: 4 })).toEqual([1, { $truncated: 3 }]);
    const whole = outputToJson({
      kind: "record",
      entries: [{ key: "a", value: item }],
      total: 1,
    });
    expect({ ...(whole as object) }).toEqual({ a: 1 });
    const cut = outputToJson({
      kind: "record",
      entries: [{ key: "__proto__", value: item }],
      total: 3,
    }) as Record<string, unknown>;
    expect(Object.keys(cut).sort()).toEqual(["$truncated", "__proto__"]);
    expect(cut["$truncated"]).toBe(2);
    expect(Object.getPrototypeOf(cut)).toBeNull();
  });
});

describe("stripTimings", () => {
  const result: BakeResult = {
    id: 9,
    ok: true,
    output: { kind: "str", text: "x" },
    steps: [{ path: "/steps/0", ms: 12.5, runs: 1 }],
    coercions: [],
    coercionsTruncated: false,
    warnings: [],
    stats: { elapsedMs: 33, vmSteps: 4, effects: [] },
  };

  test("zeroes the id and the times and keeps the rest", () => {
    const stripped = stripTimings(result);
    expect(stripped.id).toBe(1);
    expect(stripped.stats).toEqual({ elapsedMs: 0, vmSteps: 4, effects: [] });
    expect(stripped.steps).toEqual([{ path: "/steps/0", ms: 0, runs: 1 }]);
    expect(result.id).toBe(9);
  });
});
