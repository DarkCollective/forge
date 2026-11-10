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
// The shape of the application state (UI.md section 3.2). This file is a shared contract: a change
// needs the orchestrator's agreement, because every pane reads it.
import type { Catalogue } from "@forge/ops";
import type { EncodingName } from "@forge/lang";
import type { Recipe, RecipeIssue } from "@forge/recipe";
import type { BakeResult, OutputValue } from "@forge/worker";
import type { LayoutState } from "./layout.js";

export type ThemePreference = "system" | "light" | "dark" | "contrast";
export type ResolvedTheme = "light" | "dark" | "contrast";

export type PaneId = "ops" | "recipe" | "input" | "output" | "console";
export type DialogId = "share" | "save" | "open" | "fl" | "shortcuts";

/** Line ending shown and produced by the text editor of an input tab. */
export type EolName = "lf" | "crlf" | "cr";

/** One input document. The bytes are canonical; `encoding` and `eol` only say how the editor shows them. */
export interface InputTab {
  readonly id: string;
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly encoding: EncodingName;
  readonly eol: EolName;
}

export type CatalogueState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly catalogue: Catalogue }
  | { readonly status: "error"; readonly message: string };

export type BakeStatus =
  | "idle" // nothing baked yet
  | "queued" // a debounced auto-bake is waiting
  | "baking"
  | "paused" // stopped at a breakpoint or after a step
  | "done"
  | "failed"
  | "cancelled";

/** Written only by the bake controller (WP 3.6); everyone else reads it. */
export interface BakeState {
  readonly status: BakeStatus;
  /** The last finished result (kept while the next bake runs, so the output does not flash). */
  readonly result: BakeResult | null;
  /** Path of the step running now (progress events), or null. */
  readonly runningPath: string | null;
  readonly paused: {
    readonly path: string;
    readonly reason: "start" | "breakpoint" | "step";
    readonly data: OutputValue;
  } | null;
  readonly progress: { readonly done: number; readonly total: number } | null;
  /** Whole-call time of the last finished bake. */
  readonly elapsedMs: number | null;
  /** True when the recipe, input or user words changed after `result` was produced. */
  readonly stale: boolean;
}

export interface Settings {
  readonly theme: ThemePreference;
  readonly autoBake: boolean;
  readonly debounceMs: number;
}

/** The recipe document's relation to the library (WP 3.7). */
export interface DocState {
  /** Id of the saved recipe this document came from, or null. */
  readonly savedId: string | null;
  /** True when the recipe or its input changed since it was loaded or saved. */
  readonly dirty: boolean;
}

export interface HistoryState {
  readonly past: readonly Recipe[];
  readonly future: readonly Recipe[];
}

export interface UiState {
  readonly dialog: DialogId | null;
  readonly consoleOpen: boolean;
  /** True below COMPACT_BREAKPOINT_PX: one pane at a time, chosen by `compactTab`. */
  readonly compact: boolean;
  readonly compactTab: PaneId;
  /** JSON pointer of the step whose parameter form is shown/focused, or null. */
  readonly selectedPath: string | null;
  readonly resolvedTheme: ResolvedTheme;
  /** Text for the shared polite live region. `id` changes on every call so a repeat is re-announced. */
  readonly announcement: { readonly id: number; readonly text: string };
}

export interface AppState {
  readonly catalogue: CatalogueState;
  readonly recipe: Recipe;
  /** `validateRecipe(recipe, catalogue)` issues, recomputed on every recipe or catalogue change. */
  readonly issues: readonly RecipeIssue[];
  readonly history: HistoryState;
  readonly doc: DocState;
  readonly inputs: readonly InputTab[];
  readonly activeInputId: string;
  readonly bake: BakeState;
  readonly settings: Settings;
  readonly layout: LayoutState;
  readonly ui: UiState;
  /** Qualified names of favourite operations, in the order they were added. */
  readonly favourites: readonly string[];
  /** The persistent user words: one FL source unit (`IN: user` ...). Empty string = none. */
  readonly user: {
    readonly source: string;
    /** Why the user unit failed to load (reported by the console worker or the baker), or null. */
    readonly error: string | null;
  };
}
