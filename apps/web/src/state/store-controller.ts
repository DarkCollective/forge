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
import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { Store } from "./store.js";

/**
 * Lit reactive controller: re-renders the host when `selector(state)` changes.
 *
 *     private readonly recipe = new StoreController(this, store, (s) => s.recipe);
 *     render() { return html`${this.recipe.value.steps.length}`; }
 */
export class StoreController<S extends object, T> implements ReactiveController {
  private unsubscribe: (() => void) | undefined;
  private current: T;

  constructor(
    private readonly host: ReactiveControllerHost,
    private readonly store: Store<S>,
    private readonly selector: (state: S) => T,
    private readonly equals: (a: T, b: T) => boolean = Object.is,
  ) {
    this.current = selector(store.get());
    host.addController(this);
  }

  get value(): T {
    return this.current;
  }

  hostConnected(): void {
    this.current = this.selector(this.store.get());
    this.unsubscribe = this.store.select(
      this.selector,
      (value) => {
        this.current = value;
        this.host.requestUpdate();
      },
      { equals: this.equals },
    );
  }

  hostDisconnected(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
}
