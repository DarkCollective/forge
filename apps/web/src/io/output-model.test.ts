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
import { describe, expect, it } from "vitest";
import type { Recipe } from "@forge/recipe";
import type { OutputValue } from "@forge/worker";
import {
  chooseView,
  describeValue,
  detailText,
  downloadBytes,
  downloadSpec,
  outputBytes,
  outputText,
  stepLabel,
} from "./output-model.js";

const utf = (s: string): OutputValue => ({
  kind: "bytes",
  bytes: new TextEncoder().encode(s),
  text: s,
});
const bin: OutputValue = { kind: "bytes", bytes: Uint8Array.of(0xff, 0), text: null };

describe("outputBytes / outputText", () => {
  it("maps scalars to bytes", () => {
    expect(Array.from(outputBytes({ kind: "str", text: "é" }) ?? [])).toEqual([0xc3, 0xa9]);
    expect(Array.from(outputBytes({ kind: "int", text: "12" }) ?? [])).toEqual([0x31, 0x32]);
    expect(Array.from(outputBytes({ kind: "bool", value: true }) ?? [])).toEqual([
      116, 114, 117, 101,
    ]);
    expect(outputBytes({ kind: "list", items: [], total: 0 })).toBeNull();
    expect(outputBytes({ kind: "other", tag: "quot", repr: "x" } as OutputValue)).toBeNull();
    expect(outputBytes(bin)).toBe((bin as { bytes: Uint8Array }).bytes);
  });
  it("has no text for non-UTF-8 bytes", () => {
    expect(outputText(bin)).toBeNull();
    expect(outputText(utf("hi"))).toBe("hi");
    expect(outputText({ kind: "num", value: 1.5 })).toBe("1.5");
  });
});

describe("describeValue", () => {
  it("renders nested structures with truncation notes", () => {
    const v: OutputValue = {
      kind: "record",
      total: 3,
      entries: [
        { key: "a", value: { kind: "int", text: "1" } },
        {
          key: "b",
          value: { kind: "list", total: 5, items: [utf("x"), bin] },
        },
      ],
    };
    expect(describeValue(v)).toBe(
      [
        "{",
        '  "a": 1',
        '  "b": [',
        '    "x"',
        "    <2 bytes>",
        "    ... 3 more",
        "  ]",
        "  ... 1 more",
        "}",
      ].join("\n"),
    );
    expect(describeValue({ kind: "list", items: [], total: 0 })).toBe("[]");
    expect(describeValue({ kind: "record", entries: [], total: 0 })).toBe("{}");
  });
});

describe("view and download choice", () => {
  it("chooses hex when bytes are not UTF-8, whatever was preferred", () => {
    expect(chooseView(bin, "text")).toBe("hex");
    expect(chooseView(utf("a"), null)).toBe("text");
    expect(chooseView(utf("a"), "hex")).toBe("hex");
    expect(chooseView({ kind: "int", text: "1" }, "hex")).toBe("text");
  });
  it("names and types downloads", () => {
    expect(downloadSpec(bin)).toEqual({
      filename: "forge-output.bin",
      mime: "application/octet-stream",
    });
    expect(downloadSpec(utf("a"))?.mime).toBe("text/plain;charset=utf-8");
    expect(downloadSpec({ kind: "list", items: [], total: 0 })?.filename).toBe("forge-output.txt");
    expect(new TextDecoder().decode(downloadBytes({ kind: "list", items: [], total: 0 }))).toBe(
      "[]",
    );
  });
});

describe("stepLabel", () => {
  const recipe = {
    forge: 1,
    steps: [
      { kind: "op", op: "base64:decode" },
      { kind: "repeat", steps: [{ kind: "op", op: "x:y" }] },
    ],
  } as unknown as Recipe;
  it("labels top level and nested steps", () => {
    expect(stepLabel(recipe, "/steps/0")).toBe("Step 1: base64:decode");
    expect(stepLabel(recipe, "/steps/1")).toBe("Step 2: repeat");
    expect(stepLabel(recipe, "/steps/1/steps/0")).toBe("Step 2.1: x:y");
  });
  it("survives a path that no longer exists", () => {
    expect(stepLabel(recipe, "/steps/9")).toBe("Step 10");
    expect(stepLabel(recipe, "")).toBe("Step");
  });
});

describe("detailText", () => {
  it("makes text of anything", () => {
    expect(detailText("a")).toBe("a");
    expect(detailText(3)).toBe("3");
    expect(detailText(null)).toBe("null");
    expect(detailText({ a: [1] })).toBe('{"a":[1]}');
  });
});
