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
/** A small hand-written reactive store (UI.md section 3.1). No dependencies. */
export type Listener<S> = (state: S, previous: S) => void;
export type Patch<S> = Partial<S> | ((state: S) => Partial<S>);

export interface Store<S extends object> {
  /** The current state. Never mutate it: states are replaced, not edited. */
  get(): S;
  /** Shallow-merge a patch. Listeners run synchronously, and only when some key changed (`Object.is`). */
  set(patch: Patch<S>): void;
  /** Subscribe to every change. Returns the unsubscribe function. */
  subscribe(listener: Listener<S>): () => void;
  /**
   * Subscribe to one derived value. `listener` runs when `selector(state)` changes under `equals`
   * (default `Object.is`), and once straight away when `immediate` is true.
   */
  select<T>(
    selector: (state: S) => T,
    listener: (value: T, previous: T) => void,
    options?: { equals?: (a: T, b: T) => boolean; immediate?: boolean },
  ): () => void;
}

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<Listener<S>>();

  function set(patch: Patch<S>): void {
    const next = typeof patch === "function" ? patch(state) : patch;
    let changed = false;
    for (const key of Object.keys(next) as (keyof S)[]) {
      if (!Object.is(state[key], next[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    const previous = state;
    state = { ...state, ...next };
    for (const listener of [...listeners]) listener(state, previous);
  }

  function subscribe(listener: Listener<S>): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function select<T>(
    selector: (s: S) => T,
    listener: (value: T, previous: T) => void,
    options: { equals?: (a: T, b: T) => boolean; immediate?: boolean } = {},
  ): () => void {
    const equals = options.equals ?? Object.is;
    let current = selector(state);
    if (options.immediate === true) listener(current, current);
    return subscribe((s) => {
      const next = selector(s);
      if (equals(current, next)) return;
      const previous = current;
      current = next;
      listener(next, previous);
    });
  }

  return { get: () => state, set, subscribe, select };
}
