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
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../styles/shared.js";

/**
 * PLACEHOLDER (WP 3.4 replaces this file). The parameter form of one op step, generated from the
 * catalogue. `path` is the JSON pointer of the op node ("/steps/0", or "/steps/2/test" for an if-test).
 */
@customElement("forge-param-form")
export class ForgeParamForm extends LitElement {
  static override styles = [baseStyles];

  @property({ type: String }) path = "";

  protected override render() {
    return html`<span class="muted">Parameters of ${this.path} (WP 3.4)</span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "forge-param-form": ForgeParamForm;
  }
}
