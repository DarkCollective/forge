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
import { encodeShare, recipeUsesV11, registerInfo } from "@forge/recipe";
import type { EncodeShareResult } from "@forge/recipe";
import { css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ForgeDialog } from "../shell/forge-dialog.js";
import { actions, store } from "../state/app.js";
import type { DialogId } from "../state/types.js";
import { icons } from "../styles/icons.js";
import { bakeUi } from "./ui-state.js";
import { StoreController } from "../state/store-controller.js";
import { describeEncodeError, secretWarnings, shareUrl } from "./url.js";

/** Share dialog (UI.md WP 3.6): builds a link, with or without the input, and warns about what it contains. */
@customElement("forge-share-dialog")
export class ForgeShareDialog extends ForgeDialog {
  static override styles = [
    ForgeDialog.styles,
    css`
      .warn {
        border: var(--border-width) solid var(--danger);
        border-inline-start-width: 0.4rem;
        border-radius: var(--radius-m);
        padding: var(--space-3);
        margin-block: 0 var(--space-3);
        background: var(--surface-2);
      }
      .warn strong {
        color: var(--danger);
      }
      .notice {
        border: var(--border-width) solid var(--border-strong);
        border-radius: var(--radius-m);
        padding: var(--space-3);
        margin-block-end: var(--space-3);
      }
      .notice.error {
        border-color: var(--danger);
      }
      .notice ul,
      .warn ul {
        margin: var(--space-2) 0 0;
        padding-inline-start: var(--space-4);
      }
      .field {
        margin-block: var(--space-3);
      }
      label.check {
        display: flex;
        align-items: flex-start;
        gap: var(--space-2);
      }
      label.check input {
        min-height: 0;
        margin-block-start: 0.3rem;
      }
      textarea {
        width: 100%;
        min-height: 6rem;
        font-family: var(--font-mono);
        font-size: var(--text-xs);
        word-break: break-all;
        resize: vertical;
      }
      .actions {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        margin-block-start: var(--space-2);
      }
      .error {
        color: var(--danger);
      }
    `,
  ];

  protected readonly dialogId: DialogId = "share";
  protected readonly heading = "Share";

  @state() private includeInput = false;
  @state() private confirmed = false;
  @state() private result: EncodeShareResult | null = null;

  private readonly ui = new StoreController(this, bakeUi, (s) => s.notice);
  private wasOpen = false;
  private generation = 0;

  protected override updated(): void {
    super.updated();
    if (this.isOpen && !this.wasOpen) {
      this.includeInput = false;
      this.confirmed = false;
      this.result = null;
      void this.compute();
    }
    this.wasOpen = this.isOpen;
  }

  private async compute(): Promise<void> {
    const mine = ++this.generation;
    const s = store.get();
    const tab = s.inputs.find((t) => t.id === s.activeInputId);
    const catalogue = s.catalogue.status === "ready" ? s.catalogue.catalogue : undefined;
    const result = await encodeShare(
      {
        recipe: s.recipe,
        ...(this.includeInput && tab !== undefined
          ? { input: tab.bytes, inputEncoding: tab.encoding }
          : {}),
      },
      catalogue === undefined ? {} : { catalogue },
    );
    if (mine !== this.generation) return;
    this.result = result;
    this.confirmed = false;
  }

  private onIncludeInput(e: Event): void {
    this.includeInput = (e.target as HTMLInputElement).checked;
    this.result = null;
    void this.compute();
  }

  private async copy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      actions.announce("Link copied to the clipboard.");
    } catch {
      const area = this.renderRoot.querySelector<HTMLTextAreaElement>("textarea.link");
      area?.focus();
      area?.select();
      actions.announce(
        "Could not copy automatically. The link is selected; press Control or Command C.",
      );
    }
  }

  private renderNotice() {
    const notice = this.ui.value;
    if (notice === null) return nothing;
    return html`<div class="notice ${notice.severity}" role="note">
      <strong
        >${notice.severity === "error" ? "A link could not be opened" : "Link warnings"}</strong
      >
      <p>${notice.summary}</p>
      ${
        notice.details.length > 0
          ? html`<ul>
              ${notice.details.map((d) => html`<li>${d}</li>`)}
            </ul>`
          : nothing
      }
      <button type="button" @click=${() => bakeUi.set({ notice: null })}>Dismiss</button>
    </div>`;
  }

  private renderLink() {
    const result = this.result;
    if (result === null) return html`<p class="muted" role="status">Creating the link…</p>`;
    if (!result.ok) {
      return html`<p class="error" role="alert">${describeEncodeError(result.error)}</p>
        ${
          result.error.issues !== undefined && result.error.issues.length > 0
            ? html`<ul>
                ${result.error.issues.slice(0, 10).map((i) => html`<li>${i.path} ${i.message}</li>`)}
              </ul>`
            : nothing
        }`;
    }
    const secrets = secretWarnings(result.warnings);
    if (secrets.length > 0 && !this.confirmed) {
      return html`<div class="warn" role="alert">
        <p>
          <strong>Key values would be written in the link.</strong> These parameters hold key
          material, and it would be stored in clear text in the link:
        </p>
        <ul>
          ${secrets.map((w) => html`<li class="mono">${w.path}</li>`)}
        </ul>
        <div class="actions">
          <button type="button" @click=${() => (this.confirmed = true)}>
            I understand, show the link
          </button>
        </div>
      </div>`;
    }
    const url = shareUrl(window.location, result.fragment);
    return html`<div class="field">
      <label for="share-link">Link (${url.length} characters)</label>
      <textarea
        id="share-link"
        class="link"
        readonly
        rows="4"
        spellcheck="false"
        .value=${url}
      ></textarea>
      <div class="actions">
        <button type="button" class="primary" @click=${() => void this.copy(url)}>
          ${icons.copy}<span>Copy link</span>
        </button>
      </div>
    </div>`;
  }

  /** One line each, plain text (RECIPES-1.1.md sections 1.3 and 4.9, Q18). */
  private renderV11Notes() {
    const s = store.get();
    if (!recipeUsesV11(s.recipe)) return nothing;
    const secret =
      s.catalogue.status === "ready" &&
      registerInfo(s.recipe, s.catalogue.catalogue).some((r) => r.secret);
    return html`<p class="notice v11" role="note">
      This recipe needs Forge 1.1 or later; older versions show an
      error.${
        secret
          ? " A register takes its key from the input, so a link that includes the input includes the key."
          : ""
      }
    </p>`;
  }

  protected override renderBody() {
    const s = store.get();
    const tab = s.inputs.find((t) => t.id === s.activeInputId);
    return html`${this.renderNotice()}
      <p class="warn" role="note">
        <strong>Anyone who has this link can read what is in it.</strong> The recipe, the input (if
        you include it), toggle values and any key parameters are written in clear text in the link
        (compressed, not encrypted). Do not share secrets this way.
      </p>
      ${this.renderV11Notes()}
      <label class="check">
        <input type="checkbox" .checked=${this.includeInput} @change=${this.onIncludeInput} />
        <span>
          Include the
          input${tab === undefined ? "" : ` (${tab.bytes.length} bytes, "${tab.name}")`}. Off by
          default: a link without the input is shorter and reveals less.
        </span>
      </label>
      ${this.renderLink()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "forge-share-dialog": ForgeShareDialog;
  }
}
