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
// Layout state and the pure splitter logic (UI.md section 1.3). No DOM access except `localStorage`
// in `loadLayout` / `saveLayout`, which swallow every storage error.

export const COMPACT_BREAKPOINT_PX = 900;
export const LAYOUT_STORAGE_KEY = "forge.layout.v1";

export interface LayoutState {
  /** Operations pane width in px. */
  opsWidth: number;
  /** Recipe pane width in px. The input/output column takes the rest. */
  recipeWidth: number;
  /** Share of the right column given to the input pane, in percent (10..90). */
  inputPercent: number;
  /** Console pane height in px (when open). */
  consoleHeight: number;
  opsCollapsed: boolean;
  recipeCollapsed: boolean;
}

export const DEFAULT_LAYOUT: Readonly<LayoutState> = Object.freeze({
  opsWidth: 280,
  recipeWidth: 440,
  inputPercent: 40,
  consoleHeight: 240,
  opsCollapsed: false,
  recipeCollapsed: false,
});

export const LAYOUT_LIMITS = Object.freeze({
  opsWidth: { min: 200, max: 520 },
  recipeWidth: { min: 300, max: 900 },
  inputPercent: { min: 10, max: 90 },
  consoleHeight: { min: 120, max: 800 },
  /** The input/output column never gets narrower than this. */
  ioMinWidth: 320,
});

export function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------------------------
// Splitter keyboard and pointer logic
// ---------------------------------------------------------------------------------------------

export interface SplitterConfig {
  /** Smallest expanded size, in the splitter's own units (px, or percent for the input/output split). */
  min: number;
  max: number;
  /** Arrow key step. */
  step: number;
  /** Shift+Arrow and PageUp/PageDown step. */
  largeStep: number;
  /** ARIA orientation of the separator line: "vertical" is a bar between side-by-side panes. */
  orientation: "vertical" | "horizontal";
  /**
   * True when the controlled pane lies after the handle (to its right, or below it), so moving the
   * handle towards the start makes the pane bigger.
   */
  invert: boolean;
}

export type SplitterKeyResult =
  { kind: "set"; value: number } | { kind: "toggle" } | { kind: "none" };

/**
 * What a key press does to a splitter. A vertical separator answers Left/Right, a horizontal one
 * Up/Down (the WAI-ARIA window splitter pattern); Home goes to the minimum, End to the maximum,
 * Enter toggles collapse. Arrows move the *handle*: `invert` flips the effect on the size.
 */
export function splitterKey(
  key: string,
  shiftKey: boolean,
  value: number,
  cfg: SplitterConfig,
): SplitterKeyResult {
  const vertical = cfg.orientation === "vertical";
  const towardsEnd = vertical ? "ArrowRight" : "ArrowDown";
  const towardsStart = vertical ? "ArrowLeft" : "ArrowUp";
  const sign = cfg.invert ? -1 : 1;
  const step = shiftKey ? cfg.largeStep : cfg.step;
  switch (key) {
    case towardsEnd:
      return { kind: "set", value: clamp(value + sign * step, cfg.min, cfg.max) };
    case towardsStart:
      return { kind: "set", value: clamp(value - sign * step, cfg.min, cfg.max) };
    case "PageDown":
      return { kind: "set", value: clamp(value + sign * cfg.largeStep, cfg.min, cfg.max) };
    case "PageUp":
      return { kind: "set", value: clamp(value - sign * cfg.largeStep, cfg.min, cfg.max) };
    case "Home":
      return { kind: "set", value: cfg.min };
    case "End":
      return { kind: "set", value: cfg.max };
    case "Enter":
      return { kind: "toggle" };
    default:
      return { kind: "none" };
  }
}

/** The size after dragging the handle from `startPos` to `pos` (both in px along the drag axis). */
export function pointerSize(
  startSize: number,
  startPos: number,
  pos: number,
  cfg: Pick<SplitterConfig, "min" | "max" | "invert">,
  unitsPerPx = 1,
): number {
  const delta = (pos - startPos) * unitsPerPx * (cfg.invert ? -1 : 1);
  return clamp(startSize + delta, cfg.min, cfg.max);
}

// ---------------------------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------------------------

function num(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === "number" && Number.isFinite(v) ? clamp(Math.round(v), min, max) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/** Turn anything read from storage into a valid layout. Unknown keys are dropped. */
export function sanitizeLayout(raw: unknown): LayoutState {
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const L = LAYOUT_LIMITS;
  const D = DEFAULT_LAYOUT;
  return {
    opsWidth: num(o.opsWidth, D.opsWidth, L.opsWidth.min, L.opsWidth.max),
    recipeWidth: num(o.recipeWidth, D.recipeWidth, L.recipeWidth.min, L.recipeWidth.max),
    inputPercent: num(o.inputPercent, D.inputPercent, L.inputPercent.min, L.inputPercent.max),
    consoleHeight: num(o.consoleHeight, D.consoleHeight, L.consoleHeight.min, L.consoleHeight.max),
    opsCollapsed: bool(o.opsCollapsed, D.opsCollapsed),
    recipeCollapsed: bool(o.recipeCollapsed, D.recipeCollapsed),
  };
}

export function loadLayout(
  storage: Pick<Storage, "getItem"> | undefined = safeStorage(),
): LayoutState {
  try {
    const text = storage?.getItem(LAYOUT_STORAGE_KEY);
    return sanitizeLayout(text == null ? null : JSON.parse(text));
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function saveLayout(
  layout: LayoutState,
  storage: Pick<Storage, "setItem"> | undefined = safeStorage(),
): void {
  try {
    storage?.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Storage may be full, blocked or absent: the layout then lasts for this visit only.
  }
}

export function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
