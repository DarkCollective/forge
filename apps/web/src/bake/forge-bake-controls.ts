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
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { store } from "../state/app.js";
import { StoreController } from "../state/store-controller.js";
import { baseStyles } from "../styles/shared.js";

/** PLACEHOLDER (WP 3.6 replaces this file). Bake state, timing, step/continue, auto-bake toggle. */
@customElement("forge-bake-controls")
export class ForgeBakeControls extends LitElement {
  static override styles = [baseStyles];

  private readonly status = new StoreController(this, store, (s) => s.bake.status);

  protected override render() {
    return html`<span role="status" class="muted">Bake: ${this.status.value}</span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "forge-bake-controls": ForgeBakeControls;
  }
}
