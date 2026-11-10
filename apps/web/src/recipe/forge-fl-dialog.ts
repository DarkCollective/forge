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
// "View as FL" (UI.md WP 3.3): the canonical FL text of the recipe, as text only, with a Copy button.
// The lines of the selected step are highlighted. The text form is read-only here; UI.md does not
// specify editing it.
import { css, html, nothing } from "lit";
import type { CSSResultGroup } from "lit";
import { compileRecipe } from "@forge/recipe";
import type { CompileOutcome } from "@forge/recipe";
import { ForgeDialog } from "../shell/forge-dialog.js";
import { actions, store } from "../state/app.js";
import { StoreController } from "../state/store-controller.js";
import type { DialogId } from "../state/types.js";
import { icons } from "../styles/icons.js";
import { customElement } from "lit/decorators.js";

@customElement("forge-fl-dialog")
export class ForgeFlDialog extends ForgeDialog {
  static override styles: CSSResultGroup = [
    ForgeDialog.styles,
    css`
      .toolbar {
        display: flex;
        gap: var(--space-2);
        align-items: center;
        margin-block-end: var(--space-3);
      }
      .code {
        margin: 0;
        padding: var(--space-2) 0;
        max-height: 55vh;
        overflow: auto;
        font-family: var(--font-mono);
        font-size: var(--text-sm);
        line-height: 1.45;
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        border-radius: var(--radius-s);
        counter-reset: ln;
      }
      .code:focus-visible {
        outline-offset: 0;
      }
      .line {
        display: block;
        padding-inline: var(--space-3) var(--space-3);
        white-space: pre;
        counter-increment: ln;
        min-height: 1.45em;
      }
      .line::before {
        content: counter(ln);
        display: inline-block;
        min-width: 2.5em;
        margin-inline-end: var(--space-3);
        text-align: end;
        color: var(--text-muted);
        user-select: none;
      }
      .line.hl {
        background: var(--selection);
      }
      .line.off {
        color: var(--text-muted);
      }
      .note {
        font-size: var(--text-sm);
        color: var(--text-muted);
        margin: var(--space-3) 0 0;
      }
      ul.problems {
        margin: 0;
        padding-inline-start: var(--space-4);
      }
      .status {
        font-size: var(--text-sm);
        color: var(--text-muted);
      }
    `,
  ];

  protected readonly dialogId: DialogId = "fl";
  protected readonly heading = "Recipe as FL";

  private readonly recipe = new StoreController(this, store, (s) => s.recipe);
  private readonly cat = new StoreController(this, store, (s) => s.catalogue);
  private readonly selected = new StoreController(this, store, (s) => s.ui.selectedPath);
  private copied = "";

  private async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.copied = "Copied to the clipboard.";
      actions.announce("Copied the recipe text to the clipboard");
    } catch {
      this.copied = "Copying was not allowed. Select the text and copy it by hand.";
      actions.announce(this.copied);
    }
    this.requestUpdate();
  }

  protected override renderBody() {
    const c = this.cat.value;
    if (c.status !== "ready") {
      return html`<p class="muted">The operation catalogue is not loaded yet.</p>`;
    }
    const outcome: CompileOutcome = compileRecipe(this.recipe.value, c.catalogue);
    if (!outcome.ok) {
      return html`<p>The recipe cannot be shown as FL until these problems are fixed.</p>
        <ul class="problems">
          ${outcome.issues.map((i) => html`<li><code>${i.path || "/"}</code>: ${i.message}</li>`)}
        </ul>`;
    }
    const sel = this.selected.value;
    const range = sel === null ? undefined : outcome.lines.find((l) => l.path === sel);
    const lines = outcome.text.split("\n");
    if (lines.at(-1) === "") lines.pop();
    const off = new Set<number>();
    for (const l of outcome.lines) {
      if (l.disabled) for (let n = l.startLine; n <= l.endLine; n += 1) off.add(n);
    }
    return html`<div class="toolbar">
        <button type="button" class="primary" @click=${() => void this.copy(outcome.text)}>
          ${icons.copy} Copy
        </button>
        <span class="status" role="status">${this.copied}</span>
      </div>
      <pre class="code" tabindex="0" aria-label="FL text of the recipe">
${lines.map((text, i) => {
          const n = i + 1;
          const hl = range !== undefined && n >= range.startLine && n <= range.endLine;
          return html`<span class="line ${hl ? "hl" : ""} ${off.has(n) ? "off" : ""}"
            >${text}</span
          >`;
        })}</pre>
      ${
        outcome.issues.length > 0
          ? html`<ul class="problems">
              ${outcome.issues.map((i) => html`<li>${i.message}</li>`)}
            </ul>`
          : nothing
      }
      <p class="note">
        This text contains every parameter value, including keys, in the clear. Do not paste it
        anywhere you would not paste a secret. The selected step's lines are highlighted.
      </p>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "forge-fl-dialog": ForgeFlDialog;
  }
}
