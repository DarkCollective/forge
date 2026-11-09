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
