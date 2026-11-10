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
import { LitElement, css, html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { actions, store } from "../state/app.js";
import { StoreController } from "../state/store-controller.js";
import { baseStyles } from "../styles/shared.js";
import { icons } from "../styles/icons.js";
import { describeValue, statusText } from "./format.js";
import { bakeController } from "./service.js";
import { bakeUi } from "./ui-state.js";

/** Bake status, manual bake, auto-bake and debug controls (UI.md WP 3.6). Lives in the status bar. */
@customElement("forge-bake-controls")
export class ForgeBakeControls extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        font-size: var(--text-xs);
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-2) var(--space-3);
      }
      .status {
        font-weight: var(--weight-medium);
      }
      .status.failed {
        color: var(--danger);
      }
      .data {
        font-family: var(--font-mono);
        color: var(--text-muted);
        max-width: 24rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .grow {
        flex: 1;
      }
      button {
        min-height: 1.75rem;
        font-size: var(--text-xs);
      }
      label {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        white-space: nowrap;
      }
      label input {
        min-height: 0;
      }
      .notice {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        color: var(--danger);
        font-weight: var(--weight-medium);
      }
      .notice.warning {
        color: var(--text);
      }
      @media (max-width: 560px) {
        .data,
        .opt-label {
          display: none;
        }
      }
    `,
  ];

  private readonly bake = new StoreController(this, store, (s) => s.bake);
  private readonly autoBake = new StoreController(this, store, (s) => s.settings.autoBake);
  private readonly ui = new StoreController(this, bakeUi, (s) => s);

  private renderNotice() {
    const notice = this.ui.value.notice;
    if (notice === null) return nothing;
    return html`<span
      class="notice ${notice.severity}"
      role=${notice.severity === "error" ? "alert" : "status"}
    >
      <span>${notice.summary}</span>
      <button type="button" @click=${() => actions.openDialog("share")}>Details</button>
      <button
        type="button"
        class="ghost icon"
        aria-label="Dismiss link message"
        @click=${() => bakeUi.set({ notice: null })}
      >
        ${icons.close}
      </button>
    </span>`;
  }

  protected override render() {
    const bake = this.bake.value;
    const auto = this.autoBake.value;
    const { debug, startPaused } = this.ui.value;
    const active = bake.status === "baking" || bake.status === "paused" || bake.status === "queued";
    const paused = bake.status === "paused" && bake.paused !== null;
    const controller = bakeController();
    const text = statusText(bake, { autoBake: auto });
    return html`<div class="row">
      <span class="status ${bake.status}" role="status" aria-live="polite">${text}</span>
      ${
        paused && bake.paused !== null
          ? html`<span class="data" title=${describeValue(bake.paused.data, 400)}
              >Next input: ${describeValue(bake.paused.data)}</span
            >`
          : nothing
      }
      ${
        bake.status === "done" && bake.stale
          ? html`<span class="muted">(out of date)</span>`
          : nothing
      }
      <span class="grow"></span>
      ${this.renderNotice()}
      ${
        paused
          ? html`<button type="button" @click=${() => controller?.step()} title="Step (F10)">
                ${icons.step}<span>Step</span>
              </button>
              <button type="button" @click=${() => controller?.continue()} title="Continue (F8)">
                ${icons.play}<span>Continue</span>
              </button>`
          : nothing
      }
      ${
        active
          ? html`<button type="button" @click=${() => controller?.cancel()}>
              ${icons.stop}<span>${paused ? "Stop" : "Cancel"}</span>
            </button>`
          : nothing
      }
      <button type="button" class="primary" @click=${() => controller?.bakeNow()}>
        ${icons.play}<span>Bake</span>
      </button>
      <label>
        <input
          type="checkbox"
          .checked=${auto}
          @change=${(e: Event) =>
            actions.setSetting("autoBake", (e.target as HTMLInputElement).checked)}
        />
        <span>Auto-bake</span>
      </label>
      <button
        type="button"
        aria-pressed=${debug ? "true" : "false"}
        title="Debug: pause at breakpoints and step through the recipe"
        @click=${() => bakeUi.set({ debug: !debug })}
      >
        <span>Debug</span>
      </button>
      ${
        debug
          ? html`<label class="opt-label">
              <input
                type="checkbox"
                .checked=${startPaused}
                @change=${(e: Event) =>
                  bakeUi.set({ startPaused: (e.target as HTMLInputElement).checked })}
              />
              <span>Start paused</span>
            </label>`
          : nothing
      }
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "forge-bake-controls": ForgeBakeControls;
  }
}
