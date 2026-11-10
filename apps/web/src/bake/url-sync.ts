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
// The only router (UI.md WP 3.6): load the recipe (and input) from a `#` share fragment, and keep the
// fragment in step with the recipe. The window and the codec are injected so this is testable.
import type { DecodeShareFn, EncodeShareFn } from "@forge/recipe";
import type { Actions, AppStore } from "../state/actions.js";
import { createDebouncer, realTimers } from "./debounce.js";
import type { Timers } from "./debounce.js";
import { bakeUi } from "./ui-state.js";
import type { BakeUiStore } from "./ui-state.js";
import {
  FRAGMENT_DEBOUNCE_MS,
  autoFragmentFor,
  classifyHash,
  describeShareError,
  describeWarnings,
  fragmentOf,
  urlWithFragment,
} from "./url.js";

export interface UrlSyncEnv {
  readonly location: { readonly hash: string; readonly pathname: string; readonly search: string };
  readonly history: { replaceState(data: unknown, unused: string, url: string): void };
  addEventListener(type: "hashchange", listener: () => void): void;
  removeEventListener(type: "hashchange", listener: () => void): void;
}

export interface UrlSyncDeps {
  readonly store: AppStore;
  readonly actions: Actions;
  readonly env: UrlSyncEnv;
  readonly encode: EncodeShareFn;
  readonly decode: DecodeShareFn;
  readonly ui?: BakeUiStore;
  readonly timers?: Timers;
  readonly debounceMs?: number;
}

export interface UrlSync {
  start(): void;
  dispose(): void;
  /** Resolves when the work started by the last hash event or recipe change has finished (tests). */
  idle(): Promise<void>;
}

export function createUrlSync(deps: UrlSyncDeps): UrlSync {
  const { store, actions, env, encode, decode } = deps;
  const ui = deps.ui ?? bakeUi;
  let lastWritten: string | null = null;
  /** The recipe object that `loadDocument` installed from a link: do not rewrite the link for it. */
  let loadedRecipe: unknown = null;
  let work: Promise<void> = Promise.resolve();
  const unsubs: (() => void)[] = [];
  let started = false;

  const track = (p: Promise<void>): void => {
    work = work.then(() => p).catch(() => undefined);
  };

  function catalogueView() {
    const c = store.get().catalogue;
    return c.status === "ready" ? c.catalogue : undefined;
  }

  async function applyHash(): Promise<void> {
    const action = classifyHash(env.location.hash, lastWritten);
    if (action !== "decode") return;
    const fragment = fragmentOf(env.location.hash);
    const catalogue = catalogueView();
    const result = await decode(fragment, catalogue === undefined ? {} : { catalogue });
    if (!result.ok) {
      ui.set({ notice: describeShareError(result.error) });
      actions.announce(`This link could not be opened: ${result.error.message}`);
      return;
    }
    loadedRecipe = result.recipe;
    actions.loadDocument({
      recipe: result.recipe,
      ...(result.input === undefined ? {} : { input: result.input }),
      inputEncoding: result.inputEncoding,
    });
    const notice = describeWarnings(result.warnings);
    ui.set({ notice });
    actions.announce(
      notice === null
        ? "Opened the recipe from the link."
        : "Opened the recipe from the link, with warnings.",
    );
  }

  async function writeFragment(): Promise<void> {
    const snapshot = store.get();
    const catalogue = catalogueView();
    if (catalogue === undefined) return;
    const result = await encode({ recipe: snapshot.recipe }, { catalogue });
    if (store.get().recipe !== snapshot.recipe) return; // a newer edit will write
    const decision = autoFragmentFor(result);
    if (decision.action === "set") {
      if (decision.fragment === lastWritten && fragmentOf(env.location.hash) === lastWritten)
        return;
      lastWritten = decision.fragment;
      env.history.replaceState(null, "", urlWithFragment(env.location, decision.fragment));
    } else if (decision.action === "clear") {
      lastWritten = null;
      if (env.location.hash !== "" && env.location.hash !== "#") {
        env.history.replaceState(null, "", urlWithFragment(env.location, null));
      }
    }
  }

  const writer = createDebouncer(
    () => track(writeFragment()),
    deps.debounceMs ?? FRAGMENT_DEBOUNCE_MS,
    deps.timers ?? realTimers,
  );

  const onHashChange = (): void => {
    if (catalogueView() === undefined && store.get().catalogue.status === "loading") return; // handled when ready
    track(applyHash());
  };

  return {
    start(): void {
      if (started) return;
      started = true;
      // Wait for the catalogue (decoding validates against it), then apply the initial hash once.
      let initial = false;
      unsubs.push(
        store.select(
          (s) => s.catalogue.status,
          (status) => {
            if (initial || status === "loading") return;
            initial = true;
            track(applyHash());
          },
          { immediate: true },
        ),
      );
      unsubs.push(
        store.select(
          (s) => s.recipe,
          (recipe) => {
            if (!initial) return;
            if (recipe === loadedRecipe) return;
            writer.schedule();
          },
        ),
      );
      env.addEventListener("hashchange", onHashChange);
    },
    dispose(): void {
      writer.cancel();
      for (const u of unsubs.splice(0)) u();
      env.removeEventListener("hashchange", onHashChange);
      started = false;
    },
    async idle(): Promise<void> {
      writer.flush();
      let seen: Promise<void>;
      do {
        seen = work;
        await seen;
      } while (seen !== work);
    },
  };
}
