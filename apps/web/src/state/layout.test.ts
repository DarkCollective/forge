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
import {
  DEFAULT_LAYOUT,
  LAYOUT_LIMITS,
  LAYOUT_STORAGE_KEY,
  clamp,
  loadLayout,
  pointerSize,
  sanitizeLayout,
  saveLayout,
  splitterKey,
} from "./layout.js";
import type { SplitterConfig } from "./layout.js";

const vertical: SplitterConfig = {
  min: 200,
  max: 500,
  step: 16,
  largeStep: 64,
  orientation: "vertical",
  invert: false,
};

describe("splitterKey", () => {
  it("moves the handle with the arrows (vertical separator: Left/Right)", () => {
    expect(splitterKey("ArrowRight", false, 300, vertical)).toEqual({ kind: "set", value: 316 });
    expect(splitterKey("ArrowLeft", false, 300, vertical)).toEqual({ kind: "set", value: 284 });
    expect(splitterKey("ArrowRight", true, 300, vertical)).toEqual({ kind: "set", value: 364 });
    expect(splitterKey("ArrowUp", false, 300, vertical)).toEqual({ kind: "none" });
  });

  it("answers Up/Down for a horizontal separator", () => {
    const h = { ...vertical, orientation: "horizontal" as const };
    expect(splitterKey("ArrowDown", false, 300, h)).toEqual({ kind: "set", value: 316 });
    expect(splitterKey("ArrowUp", false, 300, h)).toEqual({ kind: "set", value: 284 });
    expect(splitterKey("ArrowLeft", false, 300, h)).toEqual({ kind: "none" });
  });

  it("inverts for panes after the handle", () => {
    const inv = { ...vertical, invert: true };
    expect(splitterKey("ArrowRight", false, 300, inv)).toEqual({ kind: "set", value: 284 });
    expect(splitterKey("ArrowLeft", false, 300, inv)).toEqual({ kind: "set", value: 316 });
  });

  it("clamps, and Home/End go to the limits", () => {
    expect(splitterKey("ArrowRight", false, 495, vertical)).toEqual({ kind: "set", value: 500 });
    expect(splitterKey("ArrowLeft", false, 205, vertical)).toEqual({ kind: "set", value: 200 });
    expect(splitterKey("Home", false, 300, vertical)).toEqual({ kind: "set", value: 200 });
    expect(splitterKey("End", false, 300, vertical)).toEqual({ kind: "set", value: 500 });
    expect(splitterKey("PageDown", false, 300, vertical)).toEqual({ kind: "set", value: 364 });
  });

  it("Enter toggles collapse; other keys do nothing", () => {
    expect(splitterKey("Enter", false, 300, vertical)).toEqual({ kind: "toggle" });
    expect(splitterKey("a", false, 300, vertical)).toEqual({ kind: "none" });
  });
});

describe("pointerSize", () => {
  it("follows the pointer, clamped, inverted for later panes", () => {
    expect(pointerSize(300, 100, 150, vertical)).toBe(350);
    expect(pointerSize(300, 100, 900, vertical)).toBe(500);
    expect(pointerSize(300, 100, -900, vertical)).toBe(200);
    expect(pointerSize(300, 100, 150, { ...vertical, invert: true })).toBe(250);
  });

  it("converts pixels to units", () => {
    expect(pointerSize(40, 0, 50, { min: 10, max: 90, invert: false }, 1 / 10)).toBe(45);
  });
});

describe("layout persistence", () => {
  it("clamp", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(clamp(5, 7, 3)).toBe(7);
  });

  it("sanitizes hostile or partial stored data", () => {
    expect(sanitizeLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(sanitizeLayout("x")).toEqual(DEFAULT_LAYOUT);
    const l = sanitizeLayout({
      opsWidth: 99999,
      recipeWidth: "wide",
      inputPercent: -4,
      consoleHeight: NaN,
      opsCollapsed: "yes",
      recipeCollapsed: true,
      extra: 1,
    });
    expect(l.opsWidth).toBe(LAYOUT_LIMITS.opsWidth.max);
    expect(l.recipeWidth).toBe(DEFAULT_LAYOUT.recipeWidth);
    expect(l.inputPercent).toBe(LAYOUT_LIMITS.inputPercent.min);
    expect(l.consoleHeight).toBe(DEFAULT_LAYOUT.consoleHeight);
    expect(l.opsCollapsed).toBe(false);
    expect(l.recipeCollapsed).toBe(true);
    expect("extra" in l).toBe(false);
  });

  it("round-trips through storage and survives broken storage", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    const layout = { ...DEFAULT_LAYOUT, opsWidth: 333, opsCollapsed: true };
    saveLayout(layout, storage);
    expect(mem.has(LAYOUT_STORAGE_KEY)).toBe(true);
    expect(loadLayout(storage)).toEqual(layout);
    mem.set(LAYOUT_STORAGE_KEY, "{not json");
    expect(loadLayout(storage)).toEqual(DEFAULT_LAYOUT);
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadLayout(throwing)).toEqual(DEFAULT_LAYOUT);
    expect(() => saveLayout(layout, throwing)).not.toThrow();
    expect(loadLayout(undefined)).toEqual(DEFAULT_LAYOUT);
  });
});
