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
// The `ext` variant of OutputValue (X2): the text form with its `truncated` flag, the kind's `view`, the
// nesting inside lists and records, and the vector JSON form.
import { ext, list, nullValue, record, registerExtKind } from "@forge/lang";
import type { ExtKind, Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { outputToJson, renderValue } from "./render.js";
import { RENDER_LIMITS } from "./types.js";

function cut(text: string, max: number): string {
  return text.length <= max ? text : max <= 3 ? text.slice(0, max) : text.slice(0, max - 3) + "...";
}

const viewed: ExtKind<{ rows: number }> = {
  kind: "render-viewed",
  equals: (a, b) => a.rows === b.rows,
  sizeOf: () => 8,
  toText: (p, max) => cut(`rows=${p.rows}`, max),
  view: (p, o) => ({ rows: p.rows, shown: Math.min(p.rows, o.maxRows) }),
};
const plain: ExtKind<string> = {
  kind: "render-plain",
  equals: (a, b) => a === b,
  sizeOf: () => 8,
  toText: (p, max) => cut(p, max),
};
const brokenView: ExtKind<number> = {
  kind: "render-broken",
  equals: (a, b) => a === b,
  sizeOf: () => 8,
  toText: (p) => `n${p}`,
  view: () => {
    throw new Error("no view today");
  },
};
const emptyView: ExtKind<number> = { ...brokenView, kind: "render-empty", view: () => undefined };
registerExtKind(viewed);
registerExtKind(plain);
registerExtKind(brokenView);
registerExtKind(emptyView);
/** A kind that ignores `max` and always gives a text of 10,000 code units. */
registerExtKind<number>({
  ...brokenView,
  kind: "render-rude",
  toText: () => "x".repeat(10_000),
});

describe("renderValue of an ext value", () => {
  test("the text form, the kind name and a false truncated flag", () => {
    expect(renderValue(ext("render-plain", "hello"))).toEqual({
      kind: "ext",
      extKind: "render-plain",
      text: "hello",
      truncated: false,
    });
    expect(renderValue(nullValue())).toEqual({
      kind: "ext",
      extKind: "null",
      text: "null",
      truncated: false,
    });
  });

  test("the kind's view is passed along, asked for maxExtRows", () => {
    expect(renderValue(ext("render-viewed", { rows: 5000 }))).toEqual({
      kind: "ext",
      extKind: "render-viewed",
      text: "rows=5000",
      truncated: false,
      view: { rows: 5000, shown: RENDER_LIMITS.maxExtRows },
    });
  });

  test("a view that throws or returns nothing leaves the text form alone", () => {
    for (const kind of ["render-broken", "render-empty"]) {
      const out = renderValue(ext(kind, 3));
      expect(out).toEqual({ kind: "ext", extKind: kind, text: "n3", truncated: false });
      expect("view" in out).toBe(false);
    }
  });

  test("a text of exactly maxExtTextChars is whole; one more is cut and flagged", () => {
    const max = RENDER_LIMITS.maxExtTextChars;
    const whole = renderValue(ext("render-plain", "a".repeat(max)));
    expect(whole).toMatchObject({ truncated: false });
    expect(whole.kind === "ext" && whole.text).toBe("a".repeat(max));
    const over = renderValue(ext("render-plain", "a".repeat(max + 1)));
    expect(over).toMatchObject({ truncated: true });
    expect(over.kind === "ext" && over.text.length).toBe(max);
    expect(over.kind === "ext" && over.text.endsWith("...")).toBe(true);
    const far = renderValue(ext("render-plain", "a".repeat(max * 50)));
    expect(far.kind === "ext" && far.text.length).toBe(max);
    expect(far).toMatchObject({ truncated: true });
  });

  test("a kind that ignores the limit is cut by the renderer", () => {
    const out = renderValue(ext("render-rude", 1));
    expect(out).toMatchObject({ truncated: true });
    expect(out.kind === "ext" && out.text.length).toBe(RENDER_LIMITS.maxExtTextChars);
  });

  test("an unregistered kind renders as <ext KIND>", () => {
    const ghost: Value = { tag: "ext", kind: "render-ghost", v: 1 };
    expect(renderValue(ghost)).toEqual({
      kind: "ext",
      extKind: "render-ghost",
      text: "<ext render-ghost>",
      truncated: false,
    });
  });

  test("a kind whose toText throws still renders", () => {
    registerExtKind<number>({
      ...brokenView,
      kind: "render-bad-text",
      toText: () => {
        throw new Error("boom");
      },
    });
    expect(renderValue(ext("render-bad-text", 1))).toMatchObject({
      kind: "ext",
      text: "<ext render-bad-text>",
    });
  });

  test("ext values nest in lists and records", () => {
    const v = list([ext("render-plain", "a"), record([["k", nullValue()]])]);
    expect(renderValue(v)).toEqual({
      kind: "list",
      total: 2,
      items: [
        { kind: "ext", extKind: "render-plain", text: "a", truncated: false },
        {
          kind: "record",
          total: 1,
          entries: [
            { key: "k", value: { kind: "ext", extKind: "null", text: "null", truncated: false } },
          ],
        },
      ],
    });
  });

  test("the output is structured-clone-safe", () => {
    const out = renderValue(ext("render-viewed", { rows: 3 }));
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });
});

describe("outputToJson of an ext value", () => {
  test("is { $ext, text }, with $truncated only when the text was cut", () => {
    expect(outputToJson(renderValue(ext("render-plain", "hi")))).toEqual({
      $ext: "render-plain",
      text: "hi",
    });
    expect(
      outputToJson(renderValue(ext("render-plain", "a".repeat(RENDER_LIMITS.maxExtTextChars + 9)))),
    ).toMatchObject({ $ext: "render-plain", $truncated: true });
    expect(outputToJson(renderValue(list([nullValue()])))).toEqual([
      { $ext: "null", text: "null" },
    ]);
  });
});
