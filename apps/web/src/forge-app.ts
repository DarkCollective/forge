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
import { FORGE_LANG_VERSION } from "@forge/lang";

@customElement("forge-app")
export class ForgeApp extends LitElement {
  static override styles = css`
    :host {
      display: grid;
      grid-template: "ops recipe input" 1fr "ops recipe output" 1fr / 1fr 1fr 2fr;
      gap: 8px;
      height: 100vh;
      box-sizing: border-box;
      padding: 8px;
    }
    section {
      border: 1px solid #888;
      padding: 8px;
    }
    .ops {
      grid-area: ops;
    }
    .recipe {
      grid-area: recipe;
    }
    .input {
      grid-area: input;
    }
    .output {
      grid-area: output;
    }
  `;

  override render() {
    return html`
      <section class="ops">Operations</section>
      <section class="recipe">Recipe</section>
      <section class="input">Input</section>
      <section class="output">
        Output
        <p>forge-lang v${FORGE_LANG_VERSION}</p>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "forge-app": ForgeApp;
  }
}
