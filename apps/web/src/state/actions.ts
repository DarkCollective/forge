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
// The app store and its actions (UI.md section 3.2). Components read state through the store and
// change it only through these actions, so every invariant (revalidation, history, dirty flag,
// persistence of layout and theme) lives in one place. Pure apart from `localStorage` writes.
import type { Catalogue } from "@forge/ops";
import { validateRecipe } from "@forge/recipe";
import type { EncodingName } from "@forge/lang";
import type { Recipe, Step } from "@forge/recipe";
import { DEFAULT_LAYOUT, clamp, loadLayout, saveLayout } from "./layout.js";
import type { LayoutState } from "./layout.js";
import * as ops from "./recipe-ops.js";
import type { ListPath, StepPath } from "./recipe-ops.js";
import { createStore } from "./store.js";
import type { Store } from "./store.js";
import { loadThemePreference, saveThemePreference } from "./theme.js";
import type {
  AppState,
  BakeState,
  DialogId,
  EolName,
  InputTab,
  PaneId,
  Settings,
  ThemePreference,
} from "./types.js";

export type AppStore = Store<AppState>;

export const EMPTY_RECIPE: Recipe = Object.freeze({ forge: 1, steps: [] }) as Recipe;
export const HISTORY_LIMIT = 100;

export const IDLE_BAKE: BakeState = Object.freeze({
  status: "idle",
  result: null,
  runningPath: null,
  paused: null,
  progress: null,
  elapsedMs: null,
  stale: false,
});

let idCounter = 0;
/** A session-unique id (`t1`, `t2`, ...). Not for persistence. */
export function nextId(prefix = "t"): string {
  idCounter += 1;
  return `${prefix}${idCounter}`;
}

export function newInputTab(name: string, bytes: Uint8Array = new Uint8Array(0)): InputTab {
  return { id: nextId(), name, bytes, encoding: "utf8", eol: "lf" };
}

export interface CreateAppStoreOptions {
  /** Defaults to `localStorage`-backed loaders; tests pass fixed values. */
  layout?: LayoutState;
  theme?: ThemePreference;
  compact?: boolean;
}

export function createAppStore(options: CreateAppStoreOptions = {}): AppStore {
  const first = newInputTab("Input 1");
  const theme = options.theme ?? loadThemePreference();
  return createStore<AppState>({
    catalogue: { status: "loading" },
    recipe: EMPTY_RECIPE,
    issues: [],
    history: { past: [], future: [] },
    doc: { savedId: null, dirty: false },
    inputs: [first],
    activeInputId: first.id,
    bake: IDLE_BAKE,
    settings: { theme, autoBake: true, debounceMs: 300 },
    layout: options.layout ?? loadLayout(),
    ui: {
      dialog: null,
      helpOp: null,
      consoleOpen: false,
      compact: options.compact ?? false,
      compactTab: "recipe",
      selectedPath: null,
      resolvedTheme: "light",
      announcement: { id: 0, text: "" },
    },
    favourites: [],
    user: { source: "", error: null },
  });
}

/** Default step for an op added from the operations pane. Parameters are left to the catalogue defaults. */
export function defaultOpStep(op: string): Step {
  return { kind: "op", op };
}

export function createActions(store: AppStore, persist = true) {
  const get = store.get;

  function issuesFor(recipe: Recipe, catalogue = get().catalogue) {
    return validateRecipe(recipe, catalogue.status === "ready" ? catalogue.catalogue : undefined)
      .issues;
  }

  /** Replace the recipe through the one door that revalidates, records history and marks dirty. */
  function commit(next: Recipe, options: { history?: boolean } = {}): void {
    const s = get();
    if (next === s.recipe) return;
    const record = options.history !== false;
    store.set({
      recipe: next,
      issues: issuesFor(next),
      doc: { ...s.doc, dirty: true },
      history: record
        ? { past: [...s.history.past, s.recipe].slice(-HISTORY_LIMIT), future: [] }
        : s.history,
      bake: s.bake.result === null ? s.bake : { ...s.bake, stale: true },
    });
  }

  function patchInput(id: string, patch: Partial<InputTab>): void {
    const s = get();
    let touched = false;
    const inputs = s.inputs.map((t) => {
      if (t.id !== id) return t;
      touched = true;
      return { ...t, ...patch };
    });
    if (!touched) return;
    store.set({
      inputs,
      doc: { ...s.doc, dirty: true },
      bake: s.bake.result === null ? s.bake : { ...s.bake, stale: true },
    });
  }

  let announceId = 0;

  return {
    // ---- catalogue ----------------------------------------------------------------------------
    setCatalogueLoading(): void {
      store.set({ catalogue: { status: "loading" } });
    },
    /** Also used by the console worker to publish a catalogue that includes user ops. */
    setCatalogue(catalogue: Catalogue): void {
      const state = { status: "ready", catalogue } as const;
      store.set({ catalogue: state, issues: issuesFor(get().recipe, state) });
    },
    setCatalogueError(message: string): void {
      store.set({ catalogue: { status: "error", message } });
    },

    // ---- recipe -------------------------------------------------------------------------------
    setRecipe(recipe: Recipe): void {
      commit(recipe);
    },
    setRecipeName(name: string): void {
      const s = get().recipe;
      const trimmed = name.slice(0, 120);
      const rest: Record<string, unknown> = { ...s };
      delete rest.name;
      commit((trimmed === "" ? rest : { ...rest, name: trimmed }) as unknown as Recipe);
    },
    /** Append or insert an op step; returns the new step's path. */
    addOp(op: string, at: { listPath?: ListPath; index?: number } = {}): StepPath {
      const listPath = at.listPath ?? "/steps";
      const list = ops.getList(get().recipe, listPath);
      const index = clamp(at.index ?? list.length, 0, list.length);
      commit(ops.insertStep(get().recipe, listPath, index, defaultOpStep(op)));
      return ops.childPath(listPath, index);
    },
    insertStep(listPath: ListPath, index: number, step: Step): StepPath {
      const list = ops.getList(get().recipe, listPath);
      const at = clamp(index, 0, list.length);
      commit(ops.insertStep(get().recipe, listPath, at, step));
      return ops.childPath(listPath, at);
    },
    removeStep(path: StepPath): void {
      const s = get();
      commit(ops.removeStep(s.recipe, path));
      if (s.ui.selectedPath !== null && ops.isWithin(s.ui.selectedPath, path)) {
        store.set({ ui: { ...get().ui, selectedPath: null } });
      }
    },
    moveStep(from: StepPath, toList: ListPath, toIndexGap: number): void {
      commit(ops.moveStep(get().recipe, from, toList, toIndexGap));
    },
    duplicateStep(path: StepPath): void {
      commit(ops.duplicateStep(get().recipe, path));
    },
    patchStep(path: StepPath, patch: Record<string, unknown>): void {
      commit(ops.patchStep(get().recipe, path, patch));
    },
    setParam(nodePath: string, name: string, value: unknown): void {
      commit(ops.setParam(get().recipe, nodePath, name, value));
    },
    undo(): void {
      const s = get();
      const previous = s.history.past.at(-1);
      if (previous === undefined) return;
      store.set({
        recipe: previous,
        issues: issuesFor(previous),
        history: { past: s.history.past.slice(0, -1), future: [s.recipe, ...s.history.future] },
        doc: { ...s.doc, dirty: true },
        bake: s.bake.result === null ? s.bake : { ...s.bake, stale: true },
      });
    },
    redo(): void {
      const s = get();
      const next = s.history.future[0];
      if (next === undefined) return;
      store.set({
        recipe: next,
        issues: issuesFor(next),
        history: { past: [...s.history.past, s.recipe], future: s.history.future.slice(1) },
        doc: { ...s.doc, dirty: true },
        bake: s.bake.result === null ? s.bake : { ...s.bake, stale: true },
      });
    },
    /**
     * Replace the whole document (a share link, a saved recipe, "new"). Resets history and the dirty
     * flag, and optionally the input of the active tab.
     */
    loadDocument(doc: {
      recipe: Recipe;
      input?: Uint8Array;
      inputEncoding?: EncodingName;
      savedId?: string | null;
    }): void {
      const s = get();
      const inputs =
        doc.input === undefined
          ? s.inputs
          : s.inputs.map((t) =>
              t.id === s.activeInputId
                ? {
                    ...t,
                    bytes: doc.input as Uint8Array,
                    encoding: doc.inputEncoding ?? t.encoding,
                  }
                : t,
            );
      store.set({
        recipe: doc.recipe,
        issues: issuesFor(doc.recipe),
        history: { past: [], future: [] },
        doc: { savedId: doc.savedId ?? null, dirty: false },
        inputs,
        bake: s.bake.result === null ? s.bake : { ...s.bake, stale: true },
        ui: { ...s.ui, selectedPath: null },
      });
    },
    markSaved(savedId: string): void {
      store.set({ doc: { savedId, dirty: false } });
    },

    // ---- inputs -------------------------------------------------------------------------------
    setInputBytes(id: string, bytes: Uint8Array): void {
      patchInput(id, { bytes });
    },
    setInputEncoding(id: string, encoding: EncodingName): void {
      patchInput(id, { encoding });
    },
    setInputEol(id: string, eol: EolName): void {
      patchInput(id, { eol });
    },
    setInputName(id: string, name: string): void {
      patchInput(id, { name: name.slice(0, 80) });
    },
    addInput(name?: string, bytes?: Uint8Array): string {
      const s = get();
      const tab = newInputTab(name ?? `Input ${s.inputs.length + 1}`, bytes);
      store.set({ inputs: [...s.inputs, tab], activeInputId: tab.id });
      return tab.id;
    },
    closeInput(id: string): void {
      const s = get();
      if (s.inputs.length <= 1) return;
      const index = s.inputs.findIndex((t) => t.id === id);
      if (index < 0) return;
      const inputs = s.inputs.filter((t) => t.id !== id);
      const active =
        s.activeInputId === id
          ? (inputs[Math.min(index, inputs.length - 1)] as InputTab).id
          : s.activeInputId;
      store.set({ inputs, activeInputId: active });
    },
    selectInput(id: string): void {
      if (get().inputs.some((t) => t.id === id)) store.set({ activeInputId: id });
    },

    // ---- bake (written by WP 3.6 only) --------------------------------------------------------
    setBake(patch: Partial<BakeState>): void {
      store.set({ bake: { ...get().bake, ...patch } });
    },

    // ---- settings, theme, layout ---------------------------------------------------------------
    setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
      store.set({ settings: { ...get().settings, [key]: value } });
    },
    setTheme(theme: ThemePreference): void {
      store.set({ settings: { ...get().settings, theme } });
      if (persist) saveThemePreference(theme);
    },
    setLayout(patch: Partial<LayoutState>): void {
      const layout = { ...get().layout, ...patch };
      store.set({ layout });
      if (persist) saveLayout(layout);
    },
    resetLayout(): void {
      const layout = { ...DEFAULT_LAYOUT };
      store.set({ layout });
      if (persist) saveLayout(layout);
    },

    // ---- ui -----------------------------------------------------------------------------------
    openDialog(dialog: DialogId): void {
      // "op-help" needs an operation: open it with `openOpHelp`.
      if (dialog === "op-help") return;
      store.set({ ui: { ...get().ui, dialog, helpOp: null } });
    },
    /**
     * Open the help dialog for `qname`, or, while it is open, show the help of another operation in
     * it. Ignored unless the catalogue is ready and has that operation (the name may come from
     * anywhere, so it is checked rather than trusted).
     */
    openOpHelp(qname: string): void {
      const cat = get().catalogue;
      if (typeof qname !== "string" || qname === "" || cat.status !== "ready") return;
      if (!cat.catalogue.ops.some((o) => o.qname === qname)) return;
      store.set({ ui: { ...get().ui, dialog: "op-help", helpOp: qname } });
    },
    closeDialog(): void {
      store.set({ ui: { ...get().ui, dialog: null, helpOp: null } });
    },
    setConsoleOpen(open: boolean): void {
      const ui = get().ui;
      store.set({
        ui: {
          ...ui,
          consoleOpen: open,
          compactTab: !open && ui.compactTab === "console" ? "recipe" : ui.compactTab,
        },
      });
    },
    setCompact(compact: boolean): void {
      store.set({ ui: { ...get().ui, compact } });
    },
    setCompactTab(tab: PaneId): void {
      const ui = get().ui;
      store.set({
        ui: { ...ui, compactTab: tab, consoleOpen: tab === "console" ? true : ui.consoleOpen },
      });
    },
    selectStep(path: StepPath | null): void {
      store.set({ ui: { ...get().ui, selectedPath: path } });
    },
    setResolvedTheme(theme: AppState["ui"]["resolvedTheme"]): void {
      store.set({ ui: { ...get().ui, resolvedTheme: theme } });
    },
    /** Say something through the shared polite live region. */
    announce(text: string): void {
      announceId += 1;
      store.set({ ui: { ...get().ui, announcement: { id: announceId, text } } });
    },

    // ---- favourites, user words ---------------------------------------------------------------
    setFavourites(favourites: readonly string[]): void {
      store.set({ favourites: [...new Set(favourites)] });
    },
    toggleFavourite(qname: string): void {
      const f = get().favourites;
      store.set({ favourites: f.includes(qname) ? f.filter((q) => q !== qname) : [...f, qname] });
    },
    setUserSource(source: string): void {
      store.set({ user: { source, error: null } });
    },
    setUserError(error: string | null): void {
      store.set({ user: { ...get().user, error } });
    },
  };
}

export type Actions = ReturnType<typeof createActions>;
