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
import { LitElement, css, html } from "lit";
import { customElement } from "lit/decorators.js";
import { loadCatalogue } from "../catalogue.js";
import { actions, store } from "../state/app.js";
import { StoreController } from "../state/store-controller.js";
import { baseStyles } from "../styles/shared.js";

/**
 * The status bar: `<forge-bake-controls>` (WP 3.6: bake state, timing, step/continue, auto-bake)
 * on the left, the catalogue state on the right.
 */
@customElement("forge-statusbar")
export class ForgeStatusbar extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        background: var(--surface-2);
        border-top: var(--border-width) solid var(--border-strong);
        font-size: var(--text-xs);
      }
      .bar {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        min-height: var(--statusbar-h);
        padding: 0 var(--space-3);
      }
      forge-bake-controls {
        flex: 1;
        min-width: 0;
      }
      .cat {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        color: var(--text-muted);
        white-space: nowrap;
      }
      .cat button {
        min-height: 1.5rem;
      }
      .err {
        color: var(--danger);
      }
      @media (max-width: 560px) {
        .detail {
          display: none;
        }
      }
    `,
  ];

  private readonly catalogue = new StoreController(this, store, (s) => s.catalogue);

  protected override render() {
    const c = this.catalogue.value;
    let info;
    if (c.status === "loading") info = html`<span>Loading operations…</span>`;
    else if (c.status === "error") {
      info = html`<span class="err">Could not load operations (${c.message}).</span>
        <button type="button" @click=${() => void loadCatalogue(actions, store)}>Retry</button>`;
    } else {
      info = html`<span
        >${c.catalogue.ops.length} operations<span class="detail">
          · catalogue <span class="mono">${c.catalogue.version}</span></span
        ></span
      >`;
    }
    return html`<div class="bar">
      <forge-bake-controls></forge-bake-controls>
      <div class="cat" role="status">${info}</div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "forge-statusbar": ForgeStatusbar;
  }
}
