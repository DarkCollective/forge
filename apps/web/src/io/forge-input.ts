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
import { baseStyles, paneStyles } from "../styles/shared.js";

/** PLACEHOLDER (WP 3.5 replaces this file). Input pane. */
@customElement("forge-input")
export class ForgeInput extends LitElement {
  static override styles = [baseStyles, paneStyles];

  /** Move focus to the pane's main control (called by the shell's pane shortcuts). */
  focusPrimary(): void {
    this.renderRoot.querySelector<HTMLElement>("h2")?.focus();
  }

  protected override render() {
    return html`<header class="pane-head"><h2 tabindex="-1">Input</h2></header>
      <div class="pane-body muted">Coming in WP 3.5.</div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "forge-input": ForgeInput;
  }
}
