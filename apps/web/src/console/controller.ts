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
// The console controller: the session model behind `forge-console` (scrollback, stack, vocabulary,
// pending definition, inspector) and the glue between the console worker client and the app store
// (UI.md section 5): starting the worker, publishing the catalogue with user ops, reloading on user
// word changes. It lives outside the element so the scrollback survives the pane being closed.
import type { Catalogue } from "@forge/ops";
import type { Actions, AppStore } from "../state/actions.js";
import type { ConsoleClient, InitResult } from "../fl/console-client.js";
import type { UserUnit } from "../fl/protocol.js";
import { classifyLine } from "./definition.js";
import { CommandHistory } from "./history.js";

export type EntryKind = "input" | "output" | "error" | "info";

export interface ConsoleEntry {
  readonly id: number;
  readonly kind: EntryKind;
  /** Prompt shown before an input entry (`user>` or `...`). */
  readonly prompt?: string;
  readonly text: string;
}

export interface InspectorState {
  readonly status: "idle" | "loading" | "done" | "error";
  readonly qname: string;
  readonly meta: string;
  readonly source: string;
  readonly help: string;
  readonly error: string;
}

export interface ConsoleViewState {
  readonly entries: readonly ConsoleEntry[];
  /** `.s` text of the session stack, one string per line. */
  readonly stack: readonly string[];
  readonly vocab: string;
  readonly vocabs: readonly string[];
  readonly busy: boolean;
  /** True while the worker is loading the vocabularies. */
  readonly starting: boolean;
  /** Source of the unfinished multi-line definition, "" when none. */
  readonly pending: string;
  /** Text for the polite status line ("Result: ..."). */
  readonly status: string;
  readonly inspector: InspectorState;
}

export const MAX_ENTRIES = 500;
export const MAX_ENTRY_CHARS = 20_000;
export const RELOAD_DEBOUNCE_MS = 300;

export const HELP_TEXT = [
  "FL console. Type FL source at the prompt; the data stack is shown after each line.",
  "A line with an unclosed ':' continues on the next line (prompt \"...\") until its ';'. Escape drops an unfinished definition.",
  "Meta commands:",
  "  .help    show this help",
  "  .clear   clear the scrollback",
  "  .reset   start a fresh session (empty stack and variables); your user words stay",
  'Words: help and see describe a word (for example: "dup" see .), words lists a vocabulary, VOCAB x changes the current vocabulary.',
  "Definitions typed here last for this session only. Keep words in the My words tab of the Open dialog.",
].join("\n");

const IDLE_INSPECTOR: InspectorState = {
  status: "idle",
  qname: "",
  meta: "",
  source: "",
  help: "",
  error: "",
};

export function userUnits(source: string): UserUnit[] {
  return source === "" ? [] : [{ name: "user", source }];
}

/** The last line of `text`, shortened, for the status line. */
export function lastLine(text: string, max = 200): string {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  const line = lines[lines.length - 1] ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export interface ConsoleController {
  getState(): ConsoleViewState;
  subscribe(listener: () => void): () => void;
  readonly history: CommandHistory;
  /** Start the worker if it is not running yet (idempotent). */
  start(): void;
  submit(line: string): Promise<void>;
  /** Drop an unfinished multi-line definition. */
  cancelPending(): void;
  /** Hard-kill the running line; the worker restarts and the session is lost. */
  stop(): void;
  reset(): Promise<void>;
  clear(): void;
  setVocab(vocab: string): Promise<void>;
  inspect(qname: string): Promise<void>;
  /** The client replaced a killed worker: the session is fresh (wired to the client's `onRestart`). */
  restarted(result: InitResult): void;
  /** Wire the controller to the app store (called once by the feature). Returns an unsubscribe. */
  attach(): () => void;
  dispose(): void;
}

export interface ConsoleControllerOptions {
  readonly client: ConsoleClient;
  readonly store: AppStore;
  readonly actions: Actions;
  readonly debounceMs?: number;
}

export function createConsoleController(options: ConsoleControllerOptions): ConsoleController {
  const { client, store, actions } = options;
  const debounceMs = options.debounceMs ?? RELOAD_DEBOUNCE_MS;
  const history = new CommandHistory();
  const listeners = new Set<() => void>();
  let nextEntry = 1;
  let started = false;
  let lastPublished: { catalogue: Catalogue; source: string } | undefined;
  let state: ConsoleViewState = {
    entries: [],
    stack: [],
    vocab: "user",
    vocabs: [],
    busy: false,
    starting: false,
    pending: "",
    status: "",
    inspector: IDLE_INSPECTOR,
  };

  const set = (patch: Partial<ConsoleViewState>): void => {
    state = { ...state, ...patch };
    for (const l of [...listeners]) l();
  };

  const clip = (text: string): string =>
    text.length > MAX_ENTRY_CHARS
      ? `${text.slice(0, MAX_ENTRY_CHARS)}\n… (output cut at ${MAX_ENTRY_CHARS} characters)`
      : text;

  const add = (kind: EntryKind, text: string, prompt?: string): void => {
    const entry: ConsoleEntry = {
      id: nextEntry++,
      kind,
      text: clip(text),
      ...(prompt !== undefined ? { prompt } : {}),
    };
    const entries = [...state.entries, entry];
    set({
      entries: entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries,
    });
  };

  const currentSource = (): string => store.get().user.source;

  /** Publish the worker's catalogue (with user ops) and the user unit's load error. */
  function publish(result: InitResult, source: string): void {
    const shown = store.get().catalogue;
    const same = shown.status === "ready" && shown.catalogue.version === result.catalogue.version;
    if (!same) actions.setCatalogue(result.catalogue);
    lastPublished = { catalogue: result.catalogue, source };
    actions.setUserError(result.userError);
  }

  function applyInit(
    result: InitResult,
    source: string,
    why: "start" | "reload" | "restart",
  ): void {
    publish(result, source);
    const message =
      why === "start"
        ? "Console ready."
        : why === "reload"
          ? "User words reloaded; the session was reset."
          : "Console restarted with a fresh session.";
    set({ vocab: result.vocab, vocabs: result.vocabs, stack: [], starting: false, pending: "" });
    add("info", message);
    if (result.userError !== null) add("error", `User words not loaded: ${result.userError}`);
    for (const w of result.warnings) add("info", `warning: ${w}`);
  }

  async function load(why: "start" | "reload"): Promise<void> {
    const source = currentSource();
    set({ starting: true });
    try {
      const result = await client.init(userUnits(source));
      // The user words changed while loading: that change has its own pending reload.
      applyInit(result, source, why);
    } catch (e) {
      started = false;
      set({ starting: false });
      add("error", `The console could not start: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function start(): void {
    if (started) return;
    started = true;
    void load("start");
  }

  async function runSource(source: string): Promise<void> {
    set({ busy: true, pending: "" });
    const outcome = await client.run(source);
    if (outcome.kind === "killed") {
      set({
        busy: false,
        stack: [],
        vocab: "user",
        pending: "",
        status: `Result: ${outcome.message}`,
      });
      add("error", outcome.message);
      return;
    }
    if (outcome.output !== "") add("output", outcome.output.replace(/\n$/, ""));
    if (!outcome.ok && outcome.error !== undefined) add("error", outcome.error.message);
    const shown = outcome.ok ? (outcome.stack[0] ?? "") : "";
    const summary = !outcome.ok
      ? (outcome.error?.message ?? "error")
      : outcome.output !== ""
        ? outcome.output
        : shown;
    set({
      busy: false,
      stack: outcome.stack,
      vocab: outcome.vocab,
      vocabs: outcome.vocabs,
      status: `Result: ${lastLine(summary)}`,
    });
  }

  const controller: ConsoleController = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    history,
    start,

    async submit(line) {
      if (state.busy) return;
      start();
      const prompt = state.pending === "" ? `${state.vocab}>` : "...";
      const action = classifyLine(line, state.pending);
      history.push(line);
      add("input", line, prompt);
      switch (action.kind) {
        case "meta":
          if (action.command === ".help") add("info", HELP_TEXT);
          else if (action.command === ".clear") set({ entries: [] });
          else await controller.reset();
          return;
        case "continue":
          set({ pending: action.pending });
          return;
        case "run":
          await runSource(action.source);
          return;
      }
    },

    cancelPending() {
      if (state.pending !== "") {
        set({ pending: "" });
        add("info", "Definition dropped.");
      }
    },

    stop() {
      if (state.busy) client.stop();
    },

    async reset() {
      if (state.busy) return;
      start();
      try {
        const vocab = await client.reset();
        set({ stack: [], pending: "", vocab, status: "Result: session reset" });
        add("info", "Session reset: empty stack and variables.");
      } catch (e) {
        add("error", `Reset failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },

    clear() {
      set({ entries: [] });
    },

    async setVocab(vocab) {
      if (state.busy || vocab === state.vocab) return;
      await controller.submit(`VOCAB ${vocab}`);
    },

    async inspect(qname) {
      const name = qname.trim();
      if (name === "") return;
      start();
      set({ inspector: { ...IDLE_INSPECTOR, status: "loading", qname: name } });
      try {
        const r = await client.inspect(name);
        set({
          inspector: r.ok
            ? {
                status: "done",
                qname: r.qname,
                meta: r.meta,
                source: r.source,
                help: r.help,
                error: "",
              }
            : { ...IDLE_INSPECTOR, status: "error", qname: name, error: r.error ?? "unknown word" },
        });
      } catch (e) {
        set({
          inspector: {
            ...IDLE_INSPECTOR,
            status: "error",
            qname: name,
            error: e instanceof Error ? e.message : String(e),
          },
        });
      }
    },

    restarted(result) {
      applyInit(result, currentSource(), "restart");
    },

    attach() {
      const offs: (() => void)[] = [];
      let timer: ReturnType<typeof setTimeout> | undefined;
      // Persistent user words need the worker now (the catalogue must list them); else wait for the pane.
      if (currentSource() !== "") start();
      offs.push(
        store.select(
          (s) => s.ui.consoleOpen,
          (open) => {
            if (open) start();
          },
          { immediate: true },
        ),
      );
      offs.push(
        store.select(
          (s) => s.user.source,
          () => {
            if (timer !== undefined) clearTimeout(timer);
            timer = setTimeout(() => {
              timer = undefined;
              if (!started && currentSource() === "") return;
              if (!started) {
                start();
                return;
              }
              void load("reload");
            }, debounceMs);
          },
        ),
      );
      // The build-time catalogue may land after ours (it loads in parallel): put ours back once.
      offs.push(
        store.select(
          (s) => s.catalogue,
          (c) => {
            if (
              c.status === "ready" &&
              lastPublished !== undefined &&
              lastPublished.source === currentSource() &&
              c.catalogue.version !== lastPublished.catalogue.version
            ) {
              actions.setCatalogue(lastPublished.catalogue);
            }
          },
        ),
      );
      return () => {
        if (timer !== undefined) clearTimeout(timer);
        for (const off of offs) off();
      };
    },

    dispose() {
      client.dispose();
      listeners.clear();
    },
  };
  return controller;
}
