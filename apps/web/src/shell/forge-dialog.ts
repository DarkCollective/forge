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
import type { CSSResultGroup, TemplateResult } from "lit";
import { actions, store } from "../state/app.js";
import { StoreController } from "../state/store-controller.js";
import type { DialogId } from "../state/types.js";
import { baseStyles } from "../styles/shared.js";
import { icons } from "../styles/icons.js";

/**
 * Base class of every modal dialog (UI.md section 3.4). A subclass names its `dialogId` and
 * `heading` and renders its content in `renderBody()`. The dialog is open exactly while
 * `state.ui.dialog === dialogId`, so any component opens it with `actions.openDialog(id)`. It wraps
 * the native <dialog> (focus trap, Escape, inert background, focus return come from the browser);
 * the body is only rendered while open.
 */
export abstract class ForgeDialog extends LitElement {
  static override styles: CSSResultGroup = [
    baseStyles,
    css`
      dialog {
        width: min(42rem, calc(100vw - 2 * var(--space-4)));
        max-height: calc(100vh - 2 * var(--space-5));
        padding: 0;
        border: var(--border-width) solid var(--border-strong);
        border-radius: var(--radius-l);
        background: var(--surface);
        color: var(--text);
        box-shadow: var(--shadow-pop);
        overflow: hidden;
      }
      dialog[open] {
        display: flex;
        flex-direction: column;
      }
      dialog::backdrop {
        background: rgb(0 0 0 / 0.5);
      }
      header {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-3) var(--space-4);
        border-bottom: var(--border-width) solid var(--border);
      }
      header h2 {
        font-size: var(--text-lg);
        margin-inline-end: auto;
      }
      .body {
        padding: var(--space-4);
        overflow: auto;
      }
    `,
  ];

  protected abstract readonly dialogId: DialogId;
  protected abstract readonly heading: string;
  protected abstract renderBody(): TemplateResult;

  /** True for a dialog with no focusable content that can scroll: the body then takes a tab stop. */
  protected readonly scrollableBody: boolean = false;

  protected readonly current = new StoreController(this, store, (s) => s.ui.dialog);

  protected get isOpen(): boolean {
    return this.current.value === this.dialogId;
  }

  protected override updated(): void {
    const dialog = this.renderRoot.querySelector("dialog");
    if (dialog === null) return;
    if (this.isOpen && !dialog.open) dialog.showModal();
    else if (!this.isOpen && dialog.open) dialog.close();
  }

  private readonly onClose = (): void => {
    if (store.get().ui.dialog === this.dialogId) actions.closeDialog();
  };

  protected override render() {
    const titleId = `${this.dialogId}-title`;
    return html`<dialog aria-labelledby=${titleId} @close=${this.onClose} @cancel=${this.onClose}>
      <header>
        <h2 id=${titleId}>${this.heading}</h2>
        <button
          type="button"
          class="ghost icon"
          aria-label="Close"
          @click=${() => actions.closeDialog()}
        >
          ${icons.close}
        </button>
      </header>
      <div
        class="body"
        tabindex=${this.scrollableBody ? "0" : nothing}
        role=${this.scrollableBody ? "region" : nothing}
        aria-label=${this.scrollableBody ? this.heading : nothing}
      >
        ${this.isOpen ? this.renderBody() : null}
      </div>
    </dialog>`;
  }
}
